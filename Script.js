// ==========================================
// 1. CONFIGURATION & INITIALIZATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyC75Zmb17vj7K3HeQKiHxbKvAzGIQmqQw4",
    authDomain: "e-campus-marketplace.firebaseapp.com",
    projectId: "e-campus-marketplace",
    storageBucket: "e-campus-marketplace.firebasestorage.app",
    messagingSenderId: "920245597144",
    appId: "1:920245597144:web:b2d1b5a74d562968f478ad",
    measurementId: "G-0L7G265Q5F"
};

const ALLOWED_ADMINS = ["admin@scc.com", "justinvenedict.scc@gmail.com", "valeriebilo.scc@gmail.com"];
const PROFIT_PERCENTAGE = 0.12;

let auth, db; 
let globalUsers = [], globalProducts = [], globalTickets = [], globalReports = [];
let activeReportMessages = [];
let activeReportMessagesReportId = '';
let unsubscribeActiveReportMessages = null;
let currentTab = 'customers';
let currentInventoryTab = 'verified';
let editingProductId = null;
let currentCalendarDate = new Date(); 
let selectedFullDate = new Date();
let currentLogTab = 'Activity';
let hasInitializedDataListeners = false;

try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("Firebase Active");
} catch (e) { console.error("Init Error:", e); }


// ==========================================
// 2. AUTHENTICATION & PROFILE
// ==========================================
window.handleLogin = function() {
    const e = document.getElementById('loginEmail').value.trim();
    const p = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('loginError');

    if (btn) btn.textContent = "Verifying...";
    if (errorMsg) errorMsg.classList.add('hidden');

    auth.signInWithEmailAndPassword(e, p)
    .then(async (userCredential) => {
        // SUCCESSFUL LOGIN LOG
        // We log this in Section 2's onAuthStateChanged/fetchProfile, 
        // so we don't need to add it here.
    })
    .catch((err) => { // Removed 'async' from here
        if (btn) btn.textContent = "Sign In";
        if (errorMsg) {
            errorMsg.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4"></i> <span>${err.message}</span>`;
            errorMsg.classList.remove('hidden');
            if (window.lucide) lucide.createIcons();
        }

        // LOG THE FAILED ATTEMPT
        db.collection('logs').add({
            adminEmail: e,
            action: "Login Failed",
            details: `Error: ${err.code}`,
            level: "System",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            console.log("Failed login recorded in System Logs.");
        }).catch(logErr => {
            console.warn("Log failed: check Firebase Rules.", logErr);
        });
    });
};

window.handleLogout = function() { auth.signOut().then(() => window.location.reload()); };

auth.onAuthStateChanged(async (user) => {
    const login = document.getElementById('login-screen');
    const dash = document.getElementById('dashboard-container');
    const sidebar = document.getElementById('sidebar');

    if (user) {
        if (ALLOWED_ADMINS.some(admin => admin.toLowerCase() === user.email.toLowerCase())) {
            if (login) login.style.display = 'none';
            if (dash) { dash.classList.remove('hidden'); dash.classList.add('flex'); }
            if (sidebar) sidebar.classList.remove('hidden'); 
            initDataListeners(); await fetchAndSyncUserProfile(user);
        } else { alert("Access Denied."); auth.signOut(); }
    } else {
        if (login) login.style.display = 'flex';
        if (dash) { dash.classList.add('hidden'); dash.classList.remove('flex'); }
        if (sidebar) sidebar.classList.add('hidden');
    }
});

async function fetchAndSyncUserProfile(user) {
    const userRef = db.collection('admin').doc(user.uid);
    try {
        const doc = await userRef.get();
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();
        
        let profileData;

        if (doc.exists) {
            profileData = doc.data();
            updateProfileUI(profileData.name || "Admin", profileData.role || "Admin", user.email, profileData.photoURL);
            
            if (profileData.role === 'Super Admin') {
                const logBtn = document.getElementById('nav-logs');
                if (logBtn) logBtn.classList.remove('hidden');
            }
            await userRef.update({ lastLogin: timestamp });
        } else {
            profileData = { name: "Admin User", email: user.email, role: "Admin", createdAt: timestamp, lastLogin: timestamp };
            await userRef.set(profileData);
            updateProfileUI(profileData.name, profileData.role, user.email);
        }

        // --- NEW DYNAMIC GREETING LOGIC (The "Team" addition) ---
        // 1. Get first name
        const firstName = profileData.name.split(' ')[0];
        document.querySelectorAll('.user-first-name').forEach(el => el.innerText = firstName);

        // 2. Time-aware greeting
        const hour = new Date().getHours();
        let welcome;
        if (hour < 12) welcome = "Good morning";
        else if (hour < 18) welcome = "Good afternoon";
        else welcome = "Good evening";

        const greetingEl = document.getElementById('greeting-text');
        if (greetingEl) greetingEl.innerText = welcome;
        // -------------------------------------------------------

    } catch (e) { 
        console.error("Profile Error", e); 
    }
}

function updateProfileUI(name, role, email, photoURL) {
    document.querySelectorAll('.user-name').forEach(el => el.innerText = name);
    document.querySelectorAll('.user-role').forEach(el => el.innerText = role);
    const imgUrl = photoURL || `https://ui-avatars.com/api/?name=${name}&background=852221&color=fff`;
    ['mp_img', 'sidebar-avatar', 'header-avatar', 'dropdown-avatar'].forEach(id => {
        const el = document.getElementById(id); if(el) el.src = imgUrl;
    });
}




// ==========================================
// 3. MASTER DATA LISTENERS 
// ==========================================

// --- REPLACE JUST THE TOP OF SECTION 3 ---
let productsApproved = [];
let productsVendors = [];
let productsPending = [];

function getProductMergeKey(product = {}) {
    const sellerUid = product.sellerUid || product.sellerId || '';
    const productId = product.productId || product.id || '';
    const name = String(product.Product || product.name || '').trim().toLowerCase();
    return `${sellerUid}::${productId || name}::${name}`;
}

function getProductSourcePriority(product = {}) {
    const source = String(product.source || '');
    if (source === 'ApprovedMarketplace') return 4;
    if (source === 'MobilePending') return 3;
    if (source === 'VendorPortal') return 2;
    return 0;
}

function mergeAndRefreshProducts() {
    const merged = [...productsApproved, ...productsVendors, ...productsPending];
    const dedupedProducts = new Map();

    merged.forEach(product => {
        const key = getProductMergeKey(product);
        const existing = dedupedProducts.get(key);
        if (!existing || getProductSourcePriority(product) >= getProductSourcePriority(existing)) {
            dedupedProducts.set(key, product);
        }
    });

    globalProducts = Array.from(dedupedProducts.values());
    console.log("📊 Data Sync: Approved(", productsApproved.length, ") | Vendor(", productsVendors.length, ") | Pending(", productsPending.length, ")");
    
    renderProducts();
    renderSchoolListings();
    renderPendingApprovals();
    updateDashboardStats();
}

function normalizeProduct(doc, source) {
    const data = doc.data ? doc.data() : doc;
    const rawName = data.Product || data.name || 'Unnamed Item';
    const imageCollection = Array.isArray(data.imageUrls) ? data.imageUrls : (Array.isArray(data.photoURLs) ? data.photoURLs : []);
    const rawImage = data.Image || data.imageUrl || data.photoURL || imageCollection[0];
    const workflowStatus = normalizeWorkflowStatus(data.Status ?? data.status, source);
    const availability = normalizeAvailability(data, workflowStatus);
    const rawStock = data.Stock ?? data.stock ?? data.Stock_count ?? data.stock_count ?? data.stockCount;

    return {
        ...data,
        id: doc.id || data.id,
        path: doc.ref ? doc.ref.path : (data.path || ''),
        source,
        Product: rawName,
        Price: Number(data.Price ?? data.price ?? 0) || 0,
        Stock: rawStock === undefined || rawStock === null || rawStock === '' ? null : Number(rawStock),
        Category: data.Category || data.category || '--',
        DepartmentTag: data.DepartmentTag || data.departmentTag || '',
        departmentTag: data.departmentTag || data.DepartmentTag || '',
        Status: workflowStatus,
        WorkflowStatus: workflowStatus,
        Availability: availability,
        Recipient: data.Recipient || data.vendorName || data.recipientName || data.sellerName || '--',
        displayVendor: data.displayVendor || data.Recipient || data.vendorName || data.recipientName || data.sellerName || '--',
        Description: data.Description || data.description || '',
        Condition: data.Condition || data.condition || '',
        Image: rawImage,
        imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : (Array.isArray(data.photoURLs) ? data.photoURLs : (rawImage ? [rawImage] : [])),
        SizeStocks: data.SizeStocks || data.sizeStocks || {},
        sellerEmail: data.sellerEmail || '',
        sellerName: data.sellerName || data.vendorName || data.recipientName || '',
        recipientName: data.recipientName || '',
        vendorName: data.vendorName || data.sellerName || data.recipientName || ''
    };
}

function getProductById(id) {
    return globalProducts.find(product => product.id === id);
}

function getProductRecipient(product) {
    return product.Recipient || '--';
}

function getProductName(product) {
    return product.Product || 'Unnamed Item';
}

function getProductImage(product) {
    const candidates = [
        product.Image,
        product.imageUrl,
        product.photoURL,
        Array.isArray(product.imageUrls) ? product.imageUrls[0] : '',
        Array.isArray(product.photoURLs) ? product.photoURLs[0] : '',
        product.thumbnailUrl
    ].filter(Boolean);

    for (const candidate of candidates) {
        const value = String(candidate).trim();
        if (!value) continue;
        if (value.startsWith('data:image/')) return value;
        if (/^https?:\/\//i.test(value)) return value;
        if (/^gs:\/\//i.test(value)) return value;
    }

    return getProductImageFallback(product);
}

function getProductImageFallback(product) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(getProductName(product))}&background=eee`;
}

window.handleProductImageError = function(imgEl, productName) {
    if (imgEl.dataset.fallbackApplied === 'true') return;
    imgEl.dataset.fallbackApplied = 'true';
    imgEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(productName || 'Product')}&background=eee`;
}

function getProductCategory(product) {
    return product.Category || '--';
}

function getProductPrice(product) {
    return Number(product.Price ?? 0) || 0;
}

function formatPeso(value) {
    return `\u20B1${Number(value || 0).toLocaleString()}`;
}

function getCurrentAdminName() {
    const adminName = document.querySelector('.user-name');
    return adminName ? adminName.innerText.trim() : '';
}

function isSizedCategory(category = '') {
    const normalized = String(category || '').trim().toLowerCase();
    return [
        'school uniform and clothings',
        'school uniform & clothing',
        'sports & pe',
        'pe and sports'
    ].includes(normalized);
}

function formatCurrencyInputValue(value) {
    const digits = String(value || '').replace(/[^\d.]/g, '');
    if (!digits) return '';

    const [wholeRaw, decimalRaw = ''] = digits.split('.');
    const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
    const formattedWhole = Number(whole).toLocaleString('en-PH');
    const decimal = decimalRaw.slice(0, 2);
    return `PHP ${formattedWhole}${decimal ? `.${decimal}` : ''}`;
}

function parseCurrencyInputValue(value) {
    const sanitized = String(value || '').replace(/[^\d.]/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function setCurrencyInputValue(inputId, value) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value ? formatCurrencyInputValue(value) : '';
}

function setConditionSelection(groupName, value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    const inputs = Array.from(document.querySelectorAll(`input[name="${groupName}"]`));

    inputs.forEach(input => {
        input.checked = false;
        input.parentElement?.classList.remove('active');
    });

    if (!normalized) return;

    const matchedInput = inputs.find(input => input.value.trim().toLowerCase() === normalized);
    if (!matchedInput) return;

    matchedInput.checked = true;
    matchedInput.parentElement?.classList.add('active');
}

function getSelectedCondition(groupName) {
    const selected = Array.from(document.querySelectorAll(`input[name="${groupName}"]`)).find(input => input.checked);
    return selected ? selected.value : '';
}

function readSizeStocks(sectionId) {
    const section = document.getElementById(sectionId);
    const sizeStocks = {};
    if (!section || section.classList.contains('hidden')) return sizeStocks;

    section.querySelectorAll('.size-stock-grid > div').forEach(row => {
        const size = row.querySelector('.size-label')?.value.trim();
        const stock = row.querySelector('.size-stock')?.value.trim();
        if (!size || stock === '') return;
        const parsed = Number(stock);
        if (!Number.isNaN(parsed)) sizeStocks[size] = parsed;
    });
    return sizeStocks;
}

function populateSizeStocks(sectionId, sizeStocks = {}) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const entries = Object.entries(sizeStocks || {});
    const rows = Array.from(section.querySelectorAll('.size-stock-grid > div'));
    rows.forEach((row, index) => {
        const [size = row.querySelector('.size-label')?.defaultValue || '', stock = ''] = entries[index] || [];
        const sizeInput = row.querySelector('.size-label');
        const stockInput = row.querySelector('.size-stock');
        if (sizeInput) sizeInput.value = size || '';
        if (stockInput) stockInput.value = stock !== '' ? stock : '';
    });
}

function toggleSizeStockSection(prefix) {
    const category = document.getElementById(`${prefix}_category`)?.value || '';
    const section = document.getElementById(`${prefix}_size_stock_section`);
    if (!section) return;
    section.classList.toggle('hidden', !isSizedCategory(category));
}

function renderImagePreview(containerId, imageSources = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = imageSources.slice(0, 3).map(src => `
        <div class="image-preview-card">
            <img src="${src}" onerror="this.closest('.image-preview-card').remove()">
        </div>
    `).join('');
}

function collectProductImageFiles(inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.files) return [];
    return Array.from(input.files).slice(0, 3);
}

async function uploadProductImages(files, fallbackName) {
    if (!files.length) return [];
    const uploaded = await Promise.all(files.map(file => uploadToCloudinary(file)));
    return uploaded.filter(Boolean).slice(0, 3);
}

function buildProductImageFields(imageUrls, name) {
    const images = imageUrls.length ? imageUrls.slice(0, 3) : [`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=eee`];
    return {
        Image: images[0],
        Images: images,
        imageUrl: images[0],
        photoURL: images[0],
        imageUrls: images,
        photoURLs: images
    };
}

function hasNumericStock(product) {
    return product.Stock !== undefined && product.Stock !== null && product.Stock !== '' && !Number.isNaN(Number(product.Stock));
}

function getProductStockDisplay(product) {
    if (hasNumericStock(product)) return String(Number(product.Stock) || 0);
    return product.Availability || normalizeAvailability(product, product.WorkflowStatus || product.Status || '') || 'In Stock';
}

function getProductStockMetric(product) {
    if (hasNumericStock(product)) return Number(product.Stock) || 0;

    const availability = String(product.Availability || normalizeAvailability(product, product.WorkflowStatus || product.Status || '') || '').toLowerCase();
    if (availability === 'out of stock') return 0;
    if (availability === 'low stock') return 10;
    return 100;
}

function getPendingSubmitter(product) {
    return product.sellerName || product.vendorName || product.Recipient || product.recipientName || 'User';
}

function normalizeUserVerificationState(user = {}) {
    const verifiedValue = String(user.verified ?? '').trim().toLowerCase();

    if (user.emailVerified === true) return true;
    if (user.verified === true) return true;
    if (verifiedValue === 'verified') return true;

    if (user.verified === false) return false;
    if (verifiedValue === 'unverified') return false;

    return false;
}

function getUserTypeLabel(user = {}) {
    return String(user.userType || user.usertype || user.type || 'user').trim() || 'user';
}

function getUserAvatar(user = {}) {
    const candidates = [
        user.profileImage,
        user.photoURL,
        user.avatar,
        user.avatarUrl,
        user.imageUrl,
        user.image
    ].filter(Boolean);

    for (const candidate of candidates) {
        const value = String(candidate).trim();
        if (!value) continue;
        if (value.startsWith('data:image/')) return value;
        if (/^https?:\/\//i.test(value)) return value;
        if (/^gs:\/\//i.test(value)) return value;
    }

    return getUserAvatarFallback(user);
}

function getUserAvatarFallback(user = {}) {
    const name = user.name || 'User';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;
}

window.handleUserImageError = function(imgEl, userName) {
    if (imgEl.dataset.fallbackApplied === 'true') return;
    imgEl.dataset.fallbackApplied = 'true';
    imgEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName || 'User')}&background=random&color=fff`;
}

function updateUnverifiedUserIndicator() {
    const bellDot = document.querySelector('.absolute.top-2.right-2.bg-red-500');
    if (!bellDot) return;

    const hasUnverifiedUsers = globalUsers.some(user => !normalizeUserVerificationState(user));
    if (hasUnverifiedUsers) bellDot.classList.remove('hidden');
    else bellDot.classList.add('hidden');
}

function normalizeWorkflowStatus(rawStatus, source = '') {
    const status = String(rawStatus || '').trim().toLowerCase();
    if (!status) return source === 'MobilePending' ? 'Pending' : 'Unknown';
    if (['pending', 'for approval'].includes(status)) return 'Pending';
    if (['approved', 'verified', 'active'].includes(status)) return 'Approved';
    if (['rejected', 'declined'].includes(status)) return 'Rejected';
    if (['in stock', 'in-stock'].includes(status)) return 'Approved';
    if (['out of stock', 'out-of-stock'].includes(status)) return 'Approved';
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function normalizeProductVerificationState(product = {}) {
    const verifiedValue = String(product.verified ?? '').trim().toLowerCase();
    const workflowStatus = String(product.WorkflowStatus || product.Status || product.status || '').trim().toLowerCase();
    if (product.verified === true) return true;
    if (verifiedValue === 'verified') return true;
    if (product.source === 'ApprovedMarketplace') return true;
    if (product.source === 'VendorPortal' && workflowStatus === 'approved') return true;
    return false;
}

function isOutOfStockProduct(product = {}) {
    return String(product.Availability || normalizeAvailability(product, product.WorkflowStatus || product.Status || '') || '').trim().toLowerCase() === 'out of stock';
}

function getInventoryProducts() {
    if (currentInventoryTab === 'outofstock') {
        return globalProducts.filter(product => normalizeProductVerificationState(product) && isOutOfStockProduct(product));
    }

    if (currentInventoryTab === 'allrecords') {
        return [...globalProducts];
    }

    return globalProducts.filter(product => normalizeProductVerificationState(product) && !isOutOfStockProduct(product));
}

function normalizeAvailability(product, workflowStatus = '') {
    const rawAvailability = product.Availability ?? product.availability;
    const availability = String(rawAvailability || '').trim().toLowerCase();
    const status = String(product.Status ?? product.status ?? '').trim().toLowerCase();

    if (availability === 'in stock' || availability === 'in-stock') return 'In Stock';
    if (availability === 'out of stock' || availability === 'out-of-stock') return 'Out of Stock';
    if (availability === 'low stock' || availability === 'low-stock') return 'Low Stock';

    if (status === 'in stock' || status === 'in-stock') return 'In Stock';
    if (status === 'out of stock' || status === 'out-of-stock') return 'Out of Stock';
    if (status === 'low stock' || status === 'low-stock') return 'Low Stock';

    if (workflowStatus === 'Rejected') return 'Out of Stock';
    return 'In Stock';
}

function isApprovedProduct(product) {
    return product.WorkflowStatus === 'Approved';
}

function getAvailabilityBadge(status) {
    const s = String(status || '').toLowerCase();
    const base = "px-2 py-1 rounded text-xs font-bold";
    if (s === 'in stock') return `${base} bg-green-100 text-green-600`;
    if (s === 'low stock') return `${base} bg-orange-100 text-orange-600`;
    if (s === 'out of stock') return `${base} bg-red-100 text-red-600`;
    return `${base} bg-gray-100 text-gray-500`;
}

function buildApprovedProductCopy(product, itemId) {
    const productImages = Array.isArray(product.imageUrls) && product.imageUrls.length
        ? product.imageUrls
        : (Array.isArray(product.photoURLs) && product.photoURLs.length ? product.photoURLs : [product.Image || product.imageUrl || product.photoURL].filter(Boolean));

    return {
        ...product,
        id: itemId,
        productId: product.productId || itemId,
        Product: getProductName(product),
        name: getProductName(product),
        Price: getProductPrice(product),
        price: getProductPrice(product),
        Category: getProductCategory(product),
        category: getProductCategory(product),
        DepartmentTag: product.DepartmentTag || product.departmentTag || '',
        departmentTag: product.departmentTag || product.DepartmentTag || '',
        Recipient: getProductRecipient(product),
        displayVendor: product.displayVendor || getProductRecipient(product),
        recipientName: product.recipientName || getProductRecipient(product),
        Description: product.Description || '',
        description: product.Description || '',
        Condition: product.Condition || product.condition || '',
        condition: product.Condition || product.condition || '',
        Image: productImages[0] || '',
        imageUrl: productImages[0] || '',
        photoURL: productImages[0] || '',
        Images: productImages,
        imageUrls: productImages,
        photoURLs: productImages,
        itemType: product.itemType || 'Physical Item',
        fulfillmentType: product.fulfillmentType || 'Campus Pick-up',
        approvalStatus: product.approvalStatus || 'Approved',
        Status: 'Approved',
        status: 'approved',
        WorkflowStatus: 'Approved',
        Availability: 'In Stock',
        availability: 'in-stock',
        Stock_count: Number(product.Stock ?? product.Stock_count ?? 0) || 0,
        stock: Number(product.stock ?? product.Stock ?? product.Stock_count ?? 0) || 0,
        SizeStocks: product.SizeStocks || product.sizeStocks || null,
        sizeStocks: product.sizeStocks || product.SizeStocks || null,
        sourcePath: product.sourcePath || `products_approved/${itemId}`,
        verified: true,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

function getMobileSellerUid(product = {}) {
    return product.sellerUid || product.sellerId || product.uid || product.userId || '';
}

function getMobileProductId(docSnap, product = {}) {
    return product.productId || product.id || docSnap.id;
}

function getMobileSellerProductPath(sellerUid, productId) {
    return `seller_products/${sellerUid}/products/${productId}`;
}

function buildMobileWorkflowUpdate(status, availability) {
    const capitalizedStatus = String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1);
    const update = {
        Status: capitalizedStatus,
        status: String(status || '').toLowerCase(),
        WorkflowStatus: capitalizedStatus,
        Availability: availability
    };

    if (availability) {
        update.availability = availability.toLowerCase().replace(/\s+/g, '-');
    }

    return update;
}

function getProductSourceLabel(product) {
    if (product.source === 'MobilePending') return 'products_pending';
    if (product.source === 'ApprovedMarketplace') return 'products_approved';
    if (product.source === 'VendorPortal') return 'vendor listings';
    return product.source || 'unknown';
}

function isPendingProduct(product) {
    return product.WorkflowStatus === 'Pending';
}

function escapeForAttribute(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 3. The Master Listener Function (ONE declaration only)
function initDataListeners() {
    if (hasInitializedDataListeners) return;
    hasInitializedDataListeners = true;

    triggerSkeleton('finance-orders-table', 4, 5);
    triggerSkeleton('tbody-all-items', 8, 7);
    triggerSkeleton('tbody-customers', 5, 5);
    triggerSkeleton('activity-list', 3, 1);

    // PATH A: Approved Marketplace Products
    db.collection('products_approved').onSnapshot(snap => {
        productsApproved = snap.docs.map(doc => normalizeProduct(doc, 'ApprovedMarketplace'));
        mergeAndRefreshProducts();
    });

    // PATH B: Vendor Portal Products
    db.collectionGroup('listings').onSnapshot(snap => {
        productsVendors = snap.docs.map(doc => normalizeProduct(doc, 'VendorPortal'));
        mergeAndRefreshProducts();
    }, err => {
        console.error("🔥 Path B Failed. Check for an Index link below:", err);
    });

    // PATH C: Mobile App Pending Products
    db.collection('products_pending').onSnapshot(snap => {
        productsPending = snap.docs.map(doc => normalizeProduct({
            id: doc.id,
            ref: doc.ref,
            data: () => ({ Status: 'Pending', ...doc.data() })
        }, 'MobilePending'));
        mergeAndRefreshProducts();
    });

    // Users Listener
    db.collection('users').onSnapshot(snap => {
        globalUsers = snap.docs
            .map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() }))
            .sort((a, b) => {
                const aTime = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
                const bTime = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
                return bTime - aTime;
            });
        renderUsers(); 
        updateUnverifiedUserIndicator();
        updateDashboardStats(); 
    });

    // Financials
    db.collection('financials').onSnapshot(() => updateDashboardStats());
    renderDashboardActivity();
    
    // Support Tickets
    db.collection('tickets').orderBy('createdAt', 'desc').onSnapshot(snap => {
        globalTickets = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (!document.getElementById('view-inbox').classList.contains('hidden')) renderInbox();
        refreshActiveInboxItem();
    });

    // Product Reports from the mobile app moderation flow
    db.collection('product_reports').orderBy('createdAt', 'desc').onSnapshot(snap => {
        globalReports = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (!document.getElementById('view-inbox').classList.contains('hidden')) renderInbox();
        refreshActiveInboxItem();
    });
}




// ==========================================
// 4. SMART DASHBOARD (Audit Mode Logic)
// ==========================================
function updateDashboardStats() {
    const revenueCard = document.getElementById('dash-total-revenue');
    const finRevenueCard = document.getElementById('fin-total-revenue');
    const salesCard = document.getElementById('dash-total-overall-sales');
    const orderCountCard = document.getElementById('dash-total-orders');
    const tableBody = document.getElementById('finance-orders-table');

    if (revenueCard) triggerSkeleton('dash-total-revenue', 1);
    if (salesCard) triggerSkeleton('dash-total-overall-sales', 1);

    db.collection('financials').orderBy('date', 'desc').get().then(snap => {
        let lifetimeNet = 0, lifetimeGross = 0, lifetimeCount = 0;
        let filteredNet = 0, filteredGross = 0, filteredCount = 0;
        let weeklyBuckets = [0, 0, 0, 0]; let allTransactions = []; 
        const now = new Date();
        const isToday = selectedFullDate.getDate() === now.getDate() && selectedFullDate.getMonth() === now.getMonth() && selectedFullDate.getFullYear() === now.getFullYear();

        if (snap.empty) {
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400 italic">No transactions found.</td></tr>`;
            if (revenueCard) revenueCard.innerText = "₱0.00"; if (salesCard) salesCard.innerText = "₱0.00";
            return;
        }

        snap.forEach(doc => {
            const d = doc.data();
            if(d.type === 'Income' && d.date) {
                const amount = parseFloat(d.amount) || 0;
                const adminProfit = amount * PROFIT_PERCENTAGE; 
                const docDate = d.date.toDate();
                
                lifetimeGross += amount; lifetimeNet += adminProfit; lifetimeCount++;
                allTransactions.push({ id: doc.id, ...d });

                const isMatch = docDate.getDate() === selectedFullDate.getDate() && docDate.getMonth() === selectedFullDate.getMonth() && docDate.getFullYear() === selectedFullDate.getFullYear();
                if (isMatch) { filteredGross += amount; filteredNet += adminProfit; filteredCount++; }

                if (docDate.getMonth() === now.getMonth() && docDate.getFullYear() === now.getFullYear()) {
                    let weekIdx = docDate.getDate() <= 7 ? 0 : docDate.getDate() <= 14 ? 1 : docDate.getDate() <= 21 ? 2 : 3;
                    weeklyBuckets[weekIdx] += adminProfit;
                }
            }
        });

        const displayNet = isToday ? lifetimeNet : filteredNet;
        const displayGross = isToday ? lifetimeGross : filteredGross;
        const displayCount = isToday ? lifetimeCount : filteredCount;

        if(revenueCard) revenueCard.innerText = "₱" + displayNet.toLocaleString(undefined, {minimumFractionDigits: 2});
        if(finRevenueCard) finRevenueCard.innerText = "₱" + displayNet.toLocaleString(undefined, {minimumFractionDigits: 2});
        if(salesCard) salesCard.innerText = "₱" + displayGross.toLocaleString(undefined, {minimumFractionDigits: 2});
        if(orderCountCard) orderCountCard.innerText = displayCount;

        const subText = document.querySelector('#dash-total-overall-sales + span');
        if (subText) {
            subText.innerText = isToday ? "Lifetime Gross amount" : `Gross amount for ${selectedFullDate.toLocaleDateString('en-GB')}`;
            subText.className = isToday ? "text-xs text-gray-400 font-medium" : "text-xs text-[#852221] dark:text-red-400 font-bold";
        }

        if (document.getElementById('dash-active-products')) document.getElementById('dash-active-products').innerText = globalProducts.filter(p => isApprovedProduct(p) && p.Availability === 'In Stock').length;
        if (document.getElementById('dash-total-users')) document.getElementById('dash-total-users').innerText = globalUsers.length;

        if (tableBody) {
            let dData = isToday ? allTransactions.slice(0, 4) : allTransactions.filter(order => {
                if (!order.date) return false; const dDate = order.date.toDate();
                return dDate.getDate() === selectedFullDate.getDate() && dDate.getMonth() === selectedFullDate.getMonth() && dDate.getFullYear() === selectedFullDate.getFullYear();
            });

            if (dData.length === 0) tableBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400 italic">No transactions recorded for ${selectedFullDate.toLocaleDateString('en-GB')}.</td></tr>`;
            else tableBody.innerHTML = dData.slice(0, 10).map(o => `<tr class="border-b border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800"><td class="py-4 font-medium text-gray-800 dark:text-gray-200">${o.buyerName || 'Walk-in'}</td><td class="py-4 text-gray-600 dark:text-gray-400">${o.itemName || 'Item'}</td><td class="py-4 text-gray-600 dark:text-gray-400">${o.date.toDate().toLocaleDateString('en-GB')}</td><td class="py-4 text-right font-medium text-gray-800 dark:text-gray-200">₱${parseFloat(o.amount).toLocaleString()}</td><td class="py-4 text-right"><span class="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-600">Completed</span></td></tr>`).join('');
        }

        if (window.myFinanceChart) { window.myFinanceChart.data.datasets[0].data = weeklyBuckets; window.myFinanceChart.update(); }
    });
}


// ==========================================
// 5. RENDER ENGINE (Products, Users, Logs, Ledger)
// ==========================================
function renderProducts() {
    const tDashboard = document.querySelector('#productsTable tbody');
    const tAllItems = document.getElementById('tbody-all-items');
    const inventoryProducts = getInventoryProducts();
    
    if (tDashboard) tDashboard.innerHTML = ''; 
    if (tAllItems) tAllItems.innerHTML = '';

    globalProducts.forEach(p => {
        const name = getProductName(p);
        const img = getProductImage(p);
        const price = getProductPrice(p);
        const stock = getProductStockDisplay(p);
        const stockMetric = getProductStockMetric(p);
        const status = p.WorkflowStatus || p.Status || 'Unknown';
        const availability = p.Availability || 'In Stock';

        // --- 1. PREMIUM DASHBOARD VIEW (Inventory Monitor) ---
        if (tDashboard && globalProducts.indexOf(p) < 5) {
            const stockPercent = Math.min((stockMetric / 100) * 100, 100);
            const barColor = stockMetric < 10 ? 'bg-red-500' : 'bg-green-500';

            tDashboard.innerHTML += `
            <tr onclick="viewProductDetails('${p.id}')" class="group hover:bg-slate-50 dark:hover:bg-white/5 transition-all cursor-pointer">
                <td class="px-8 py-5 flex items-center gap-4">
                    <img src="${img}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-12 h-12 rounded-2xl object-cover grayscale group-hover:grayscale-0 transition-all duration-500 shadow-sm border border-gray-100 dark:border-dark-border">
                    <div>
                        <p class="font-bold text-slate-700 dark:text-white leading-none mb-1">${name}</p>
                        <p class="text-[10px] text-slate-400 font-mono uppercase">ID: ${p.id.substring(0,6)}</p>
                    </div>
                </td>
                <td class="px-8 py-5">
                    <div class="flex items-center gap-3">
                        <div class="flex-1 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full w-24 overflow-hidden">
                            <div class="h-full ${barColor} transition-all duration-1000" style="width: ${stockPercent}%"></div>
                        </div>
                        <span class="text-xs font-bold text-slate-500">${stock}</span>
                    </div>
                </td>
                <td class="px-8 py-5 text-right">
                    <div class="inline-flex flex-col items-end gap-1">
                        <span class="${getStatusBadge(status)} badge-premium uppercase tracking-tighter shadow-sm">${status}</span>
                        <span class="${getAvailabilityBadge(availability)} badge-premium uppercase tracking-tighter shadow-sm">${availability}</span>
                    </div>
                </td>
            </tr>`;
        }

        // --- 2. ALL ITEMS VIEW (Full Inventory Table) ---
        if (tAllItems && false) {
            tAllItems.innerHTML += `
            <tr class="table-row-hover group border-b border-gray-50 dark:border-dark-border transition-colors text-sm cursor-pointer">
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 flex items-center gap-3">
                    <img src="${img}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                    <div>
                        <p class="font-bold text-gray-700 dark:text-gray-300">${name}</p>
                        <p class="text-xs text-gray-400 font-mono">${p.id.substring(0,6).toUpperCase()}</p>
                    </div>
                </td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400">${getProductCategory(p)}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400">${getProductRecipient(p)}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">₱${price.toLocaleString()}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400 font-mono">${stock}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-right">
                    <div class="inline-flex flex-col items-end gap-1">
                        <span class="${getStatusBadge(status)}">${status}</span>
                        <span class="${getAvailabilityBadge(availability)}">${availability}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-right flex justify-end gap-2">
                    <button onclick="event.stopPropagation(); editProduct('${escapeForAttribute(p.id)}')" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded transition-all">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </button>
                    <button onclick="event.stopPropagation(); deleteItem('${escapeForAttribute(p.path)}', '${escapeForAttribute(name)}')" class="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition-all">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </td>
            </tr>`;
        }
    });

    if (tAllItems) {
        inventoryProducts.forEach(p => {
            const name = getProductName(p);
            const img = getProductImage(p);
            const price = getProductPrice(p);
            const stock = getProductStockDisplay(p);
            const status = p.WorkflowStatus || p.Status || 'Unknown';
            const availability = p.Availability || 'In Stock';

            tAllItems.innerHTML += `
            <tr class="table-row-hover group border-b border-gray-50 dark:border-dark-border transition-colors text-sm cursor-pointer">
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 flex items-center gap-3">
                    <img src="${img}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                    <div>
                        <p class="font-bold text-gray-700 dark:text-gray-300">${name}</p>
                        <p class="text-xs text-gray-400 font-mono">${p.id.substring(0,6).toUpperCase()}</p>
                    </div>
                </td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400">${getProductCategory(p)}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400">${getProductRecipient(p)}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">${formatPeso(price)}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-gray-600 dark:text-gray-400 font-mono">${stock}</td>
                <td onclick="viewProductDetails('${p.id}')" class="px-6 py-4 text-right">
                    <div class="inline-flex flex-col items-end gap-1">
                        <span class="${getStatusBadge(status)}">${status}</span>
                        <span class="${getAvailabilityBadge(availability)}">${availability}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-right flex justify-end gap-2">
                    <button onclick="event.stopPropagation(); editProduct('${escapeForAttribute(p.id)}')" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded transition-all">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </button>
                    <button onclick="event.stopPropagation(); deleteItem('${escapeForAttribute(p.path)}', '${escapeForAttribute(name)}')" class="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition-all">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </td>
            </tr>`;
        });
    }

    if (tAllItems && inventoryProducts.length === 0) {
        const emptyState = currentInventoryTab === 'outofstock'
            ? 'No verified out of stock items found.'
            : currentInventoryTab === 'allrecords'
                ? 'No products found.'
                : 'No verified in-stock inventory found.';
        tAllItems.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-gray-400 italic">${emptyState}</td></tr>`;
    }

    if(window.lucide) lucide.createIcons();
}

function renderSchoolListings() {
    const tbody = document.getElementById('tbody-school-listings');
    const filter = document.getElementById('deptFilter');
    if (!tbody) return;

    const officialDepts = ["Library", "Virtual Lab", "Computer Lab", "Supply Department"];
    const selected = filter ? filter.value : "All";

    // UPDATED FILTER: It checks vendorName first, then falls back to Recipient
    let data = globalProducts.filter(p => {
        const deptValue = getProductRecipient(p).trim();
        return officialDepts.some(dept => dept.toLowerCase() === deptValue.toLowerCase());
    });

    if (selected !== "All") {
        data = data.filter(p => {
            const deptValue = getProductRecipient(p).trim();
            return deptValue.toLowerCase() === selected.toLowerCase();
        });
    }

    tbody.innerHTML = '';
    if (data.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-gray-400 italic">No official items found.</td></tr>`; 
        return; 
    }

    data.sort((a, b) => getProductRecipient(a).localeCompare(getProductRecipient(b)))
    .forEach(p => {
        const name = getProductName(p);
        const dept = getProductRecipient(p);
        
        let badge = 'bg-gray-100 text-gray-600'; 
        const dLower = dept.toLowerCase();
        if(dLower.includes('library')) badge = 'bg-blue-50 text-blue-600';
        else if(dLower.includes('virtual')) badge = 'bg-purple-50 text-purple-600';
        else if(dLower.includes('computer')) badge = 'bg-indigo-50 text-indigo-600';
        else if(dLower.includes('supply')) badge = 'bg-amber-50 text-amber-600';

        tbody.innerHTML += `
        <tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-colors border-b dark:border-dark-border">
            <td class="px-6 py-4">
                <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${badge}">${dept}</span>
            </td>
            <td class="px-6 py-4 font-bold flex items-center gap-3">
                <img src="${getProductImage(p)}" onerror="handleProductImageError(this, '${escapeForAttribute(p.Product || p.name)}')" class="w-8 h-8 rounded shadow-sm object-cover">
                <span class="text-gray-800 dark:text-gray-200">${name}</span>
            </td>
            <td class="px-6 py-4 text-gray-500 text-xs">${getProductCategory(p)}</td>
            <td class="px-6 py-4 text-right font-mono font-bold text-slate-600 dark:text-slate-400">${getProductStockDisplay(p)}</td>
            <td class="px-6 py-4 text-right">
                <div class="inline-flex flex-col items-end gap-1">
                    <span class="${getStatusBadge(p.WorkflowStatus)} uppercase text-[9px] font-black">${p.WorkflowStatus}</span>
                    <span class="${getAvailabilityBadge(p.Availability)} uppercase text-[9px] font-black">${p.Availability}</span>
                </div>
            </td>
        </tr>`;
    });
}

function renderPendingApprovalsLegacy() {
    const tbody = document.getElementById('tbody-pending-approvals');
    if (!tbody) return;

    const pItems = globalProducts.filter(isPendingProduct);
    tbody.innerHTML = '';

    if (pItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-gray-400 italic">No pending items.</td></tr>`;
        return;
    }

    pItems.forEach(p => {
        const name = getProductName(p);
        const vendor = getPendingSubmitter(p);
        const category = getProductCategory(p);
        const price = getProductPrice(p).toLocaleString();
        const image = getProductImage(p);
        const source = getProductSourceLabel(p);
        const path = p.path || '--';
        
        tbody.innerHTML += `
        <tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-colors">
            <td class="px-6 py-4 flex items-center gap-3">
                <img src="${image}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                <div>
                    <p class="font-bold text-gray-700 dark:text-white">${name}</p>
                    <p class="text-[10px] text-gray-400 font-mono mt-1">${p.id.substring(0, 10).toUpperCase()}</p>
                </div>
            </td>
            <td class="px-6 py-4 text-gray-600 font-medium">${vendor}</td>
            <td class="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">${category}</td>
            <td class="px-6 py-4 text-xs">₱${p.Price || 0}</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="approveProduct('${escapeForAttribute(p.path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg text-xs font-bold transition-all">Approve</button>
                    <button onclick="rejectProduct('${escapeForAttribute(p.path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-xs font-bold transition-all">Reject</button>
                </div>
            </td>
        </tr>`;
    });
    if(window.lucide) lucide.createIcons();
}

function renderPendingApprovalsOld() {
    const tbody = document.getElementById('tbody-pending-approvals');
    if (!tbody) return;

    const pItems = globalProducts.filter(isPendingProduct);
    tbody.innerHTML = '';

    if (pItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-gray-400 italic">No pending items.</td></tr>`;
        return;
    }

    pItems.forEach(p => {
        const name = getProductName(p);
        const vendor = getPendingSubmitter(p);
        const category = getProductCategory(p);
        const price = getProductPrice(p).toLocaleString();
        const image = getProductImage(p);
        const source = getProductSourceLabel(p);
        const path = p.path || '--';
        const workflowStatus = p.WorkflowStatus || p.Status || 'Pending';
        const availability = p.Availability || 'In Stock';

        tbody.innerHTML += `
        <tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-colors">
            <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                    <img src="${image}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                    <div>
                        <p class="font-bold text-gray-700 dark:text-white">${name}</p>
                        <p class="text-[10px] text-gray-400 font-mono mt-1">${p.id.substring(0, 10).toUpperCase()}</p>
                        <div class="mt-1 flex flex-wrap gap-2 text-[10px]">
                            <span class="text-gray-400">Status:</span><span class="font-bold text-orange-600 dark:text-orange-400">${workflowStatus}</span>
                            <span class="text-gray-400">Availability:</span><span class="font-bold text-green-600 dark:text-green-400">${availability}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="font-medium text-gray-700 dark:text-gray-300">${vendor}</div>
                <div class="text-[10px] text-gray-400 mt-1">${p.sellerEmail || p.recipientName || ''}</div>
            </td>
            <td class="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">${category}</td>
            <td class="px-6 py-4">
                <div class="inline-flex flex-col gap-1 max-w-[320px]">
                    <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 w-fit">${source}</span>
                    <span class="text-[10px] text-gray-400 font-mono break-all">${path}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-right text-xs font-bold whitespace-nowrap">${formatPeso(price)}</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="approveProduct('${escapeForAttribute(path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg text-xs font-bold transition-all">Approve</button>
                    <button onclick="rejectProduct('${escapeForAttribute(path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-xs font-bold transition-all">Reject</button>
                </div>
            </td>
        </tr>`;
    });

    if(window.lucide) lucide.createIcons();
}

function renderPendingApprovals() {
    const tbody = document.getElementById('tbody-pending-approvals');
    if (!tbody) return;

    const pItems = globalProducts.filter(isPendingProduct);
    tbody.innerHTML = '';

    if (pItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-gray-400 italic">No pending items.</td></tr>`;
        return;
    }

    pItems.forEach(p => {
        const name = getProductName(p);
        const vendor = getPendingSubmitter(p);
        const category = getProductCategory(p);
        const price = getProductPrice(p).toLocaleString();
        const image = getProductImage(p);
        const source = getProductSourceLabel(p);
        const path = p.path || '--';

        tbody.innerHTML += `
        <tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-colors">
            <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                <img src="${image}" onerror="handleProductImageError(this, '${escapeForAttribute(name)}')" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                    <div>
                        <p class="font-bold text-gray-700 dark:text-white">${name}</p>
                        <p class="text-[10px] text-gray-400 font-mono mt-1">${p.id.substring(0, 10).toUpperCase()}</p>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="font-medium text-gray-700 dark:text-gray-300">${vendor}</div>
                <div class="text-[10px] text-gray-400 mt-1">${p.sellerEmail || p.recipientName || ''}</div>
            </td>
            <td class="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">${category}</td>
            <td class="px-6 py-4">
                <div class="inline-flex flex-col gap-1 max-w-[320px]">
                    <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 w-fit">${source}</span>
                    <span class="text-[10px] text-gray-400 font-mono break-all">${path}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-right text-xs font-bold whitespace-nowrap">${'\u20B1'}${price}</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="approveProduct('${escapeForAttribute(path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg text-xs font-bold transition-all">Approve</button>
                    <button onclick="rejectProduct('${escapeForAttribute(path)}', '${escapeForAttribute(name)}')" class="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-xs font-bold transition-all">Reject</button>
                </div>
            </td>
        </tr>`;
    });

    if(window.lucide) lucide.createIcons();
}

function renderUsers() {
    const tCus = document.getElementById('tbody-customers'); 
    const tSel = document.getElementById('tbody-sellers'); 
    const tUnv = document.getElementById('tbody-unverified');
    
    if(tCus) tCus.innerHTML = ''; 
    if(tSel) tSel.innerHTML = ''; 
    if(tUnv) tUnv.innerHTML = '';

    // --- TEAM DEBUG: Let's see what the role is ---
    const roleElement = document.querySelector('.user-role');
    const loggedInRole = roleElement ? roleElement.innerText.trim().toUpperCase() : "";
    console.log("Current Logged-in Role (Hardened):", loggedInRole);

    globalUsers.forEach(u => {
        const name = u.name || 'Unknown'; 
        const isVerified = normalizeUserVerificationState(u);
        const userId = u.id || u.uid; 
        const currentType = getUserTypeLabel(u).toUpperCase();
        const currentRole = (u.role || 'User').toUpperCase();
        const avatar = getUserAvatar(u);

        // 1. Logic for Promotion Button
        let promoBtn = "";
        
        // CHECK 1: Are you a Super Admin? Is the user Staff? Are they not yet an Admin?
        if (loggedInRole === "SUPER ADMIN") {
            if (currentType === "STAFF" && currentRole !== "ADMIN") {
                promoBtn = `<button onclick="promoteUser('${userId}')" class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded border border-red-100 hover:bg-red-600 hover:text-white transition-all mr-2 font-black uppercase tracking-tighter">Promote to Admin</button>`;
            }
        } 
        // CHECK 2: Are you a standard Admin? Is the user a Customer?
        else if (loggedInRole === "ADMIN") {
            if (currentType === "CUSTOMER" && isVerified) {
                promoBtn = `<button onclick="promoteUser('${userId}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 hover:bg-blue-600 hover:text-white transition-all mr-2 font-black uppercase tracking-tighter">Make Staff</button>`;
            }
        }

    // 2. The Complete Row Template
    const row = `
    <tr class="border-b border-gray-50 dark:border-dark-border table-row-hover transition-colors">
        <td class="px-6 py-4 flex items-center gap-3">
            <img src="${avatar}" onerror="handleUserImageError(this, '${escapeForAttribute(name)}')" class="w-8 h-8 rounded-full shadow-sm object-cover">
            <div>
                <p class="font-bold text-sm text-gray-700 dark:text-gray-300 leading-none mb-1">${name}</p>
                <p class="text-[10px] text-gray-400 font-mono">${u.email || ''}</p>
            </div>
        </td>
        <td class="px-6 py-4 text-gray-600 dark:text-gray-400 font-medium">${currentType}</td>
        <td class="px-6 py-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                ${u.role || 'User'}
            </span>
        </td>
        <td class="px-6 py-4">
            ${isVerified 
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-600 uppercase tracking-tighter">Verified</span>' 
                : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-500 uppercase tracking-tighter">Unverified</span>'}
        </td>
        <td class="px-6 py-4 text-right">
            <div class="flex items-center justify-end">
                ${!isVerified ? `<button onclick="openVerifyModal('${userId}', '${u.email}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold mr-3">Verify</button>` : ''}
                
                ${promoBtn}

                <button onclick="deleteItem('users/${userId}', '${name}')" class="text-red-400 hover:text-red-600 p-1.5 transition-colors">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </td>
    </tr>`;

    // 3. Sorting into Tabs (Simplified Logic)
    if (!isVerified) { 
        if(tUnv) tUnv.innerHTML += row; 
    } else if (currentType === 'SELLER' || currentType === 'STAFF') { 
        if(tSel) tSel.innerHTML += row; 
    } else { 
        if(tCus) tCus.innerHTML += row; 
    }
});

}

function renderTransactions() {
    const tbody = document.getElementById('tbody-transactions');
    if (!tbody) return;

    db.collection('financials').orderBy('date', 'desc').limit(50).get().then(snap => {
        tbody.innerHTML = ''; 
        if (snap.empty) { tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400 italic">No transactions found.</td></tr>'; return; }

        let html = ''; let tGross = 0; let tNet = 0;

        snap.forEach(doc => {
            const d = doc.data(); const amt = parseFloat(d.amount) || 0; const prof = amt * PROFIT_PERCENTAGE; 
            tGross += amt; tNet += prof;

            html += `<tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-colors text-sm"><td class="px-6 py-4 text-gray-500 font-mono">${d.date ? d.date.toDate().toLocaleDateString() : 'N/A'}</td><td class="px-6 py-4 font-medium text-gray-800 dark:text-white">${d.buyerName || 'Walk-in'}</td><td class="px-6 py-4 text-gray-600 dark:text-gray-300">${d.itemName || '--'}</td><td class="px-6 py-4"><span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-500">${d.category || 'General'}</span></td><td class="px-6 py-4 text-right"><div class="font-bold text-green-600">+₱${amt.toLocaleString()}</div><div class="text-[10px] text-gray-400">Profit: ₱${prof.toFixed(2)}</div></td><td class="px-6 py-4 text-gray-500 text-xs truncate max-w-[150px]">${d.description || ''}</td><td class="px-6 py-4 text-gray-600 text-xs">${d.recipient || 'Admin'}</td><td class="px-6 py-4 text-right text-xs font-mono text-gray-400">#${d.refId || doc.id.substring(0,8).toUpperCase()}</td></tr>`;
        });
        tbody.innerHTML = html;
        
        const tDisp = document.getElementById('total-income-display'); const pDisp = document.getElementById('trans-total-profit'); const rDisp = document.getElementById('trans-total-remittance');
        if(tDisp) tDisp.innerText = "₱" + tGross.toLocaleString(undefined, {minimumFractionDigits: 2});
        if(pDisp) pDisp.innerText = "₱" + tNet.toLocaleString(undefined, {minimumFractionDigits: 2});
        if(rDisp) rDisp.innerText = "₱" + (tGross - tNet).toLocaleString(undefined, {minimumFractionDigits: 2});
    }).catch(e => { tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-red-400">Error loading data.</td></tr>'; });
}



function renderDashboardActivity() {
    const actList = document.getElementById('activity-list'); if (!actList) return;
    db.collection('logs').orderBy('timestamp', 'desc').limit(5).onSnapshot(snap => {
        if (snap.empty) { actList.innerHTML = `<div class="text-xs text-gray-400 p-4">No recent activity.</div>`; return; }
        let html = '<div class="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-100 dark:bg-dark-border z-0"></div>';
        snap.forEach(doc => {
            const d = doc.data();
            html += `<div class="flex gap-4 relative z-10 mb-6"><div class="w-8 h-8 rounded-full bg-red-50 text-primary flex items-center justify-center flex-shrink-0 border-2 border-white dark:border-dark-card shadow-sm"><i data-lucide="activity" class="w-4 h-4"></i></div><div><h4 class="text-sm font-bold">${d.action}</h4><p class="text-xs text-gray-400 mt-0.5">${d.adminName} • ${d.timestamp ? d.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}</p></div></div>`;
        });
        actList.innerHTML = html; if(window.lucide) lucide.createIcons();
    });
}

function getStatusBadge(status) {
    const s = (status || '').toLowerCase(); const base = "px-2 py-1 rounded text-xs font-bold";
    if (['approved', 'in stock', 'active', 'verified'].includes(s)) return `${base} bg-green-100 text-green-600`;
    if (['out of stock', 'rejected', 'suspended'].includes(s)) return `${base} bg-red-100 text-red-600`;
    if (['low stock', 'pending'].includes(s)) return `${base} bg-orange-100 text-orange-600`;
    return `${base} bg-gray-100 text-gray-500`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeInboxStatus(status, fallback = 'open') {
    const normalized = String(status || fallback).trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized;
}

function formatInboxStatus(status) {
    const normalized = normalizeInboxStatus(status);
    return normalized.split(/[_\s-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function getInboxStatusClass(status) {
    const normalized = normalizeInboxStatus(status);
    const base = 'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider';
    if (['resolved', 'closed'].includes(normalized)) return `${base} bg-green-100 text-green-600`;
    if (['dismissed', 'rejected'].includes(normalized)) return `${base} bg-red-100 text-red-600`;
    if (['reviewing', 'pending'].includes(normalized)) return `${base} bg-amber-100 text-amber-700`;
    return `${base} bg-orange-100 text-orange-600`;
}

function getInboxListBadge(status) {
    const normalized = normalizeInboxStatus(status);
    if (['resolved', 'closed'].includes(normalized)) return { icon: 'check-circle', className: 'bg-green-100 text-green-600' };
    if (['dismissed', 'rejected'].includes(normalized)) return { icon: 'x-circle', className: 'bg-red-100 text-red-600' };
    if (['reviewing', 'pending'].includes(normalized)) return { icon: 'shield-alert', className: 'bg-amber-100 text-amber-700' };
    return { icon: 'alert-circle', className: 'bg-orange-100 text-orange-600' };
}

function getTimestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

function formatInboxListDate(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toLocaleDateString('en-GB');
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('en-GB') : 'Just now';
}

function formatInboxDateTime(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toLocaleString();
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Just now';
}

function getInboxItems() {
    const ticketItems = globalTickets.map(ticket => ({
        ...ticket,
        inboxType: 'ticket',
        inboxTitle: ticket.subject || 'Support Request',
        inboxPreview: ticket.message || '...',
        inboxSender: ticket.senderName || 'User',
        inboxStatus: ticket.status || 'Open',
        inboxTimestamp: ticket.createdAt
    }));

    const reportItems = globalReports.map(report => ({
        ...report,
        inboxType: 'report',
        inboxTitle: report.subject || `Product Report: ${report.productName || report.productId || 'Unnamed Product'}`,
        inboxPreview: report.description || report.reason || 'No report description provided.',
        inboxSender: report.reporterName || report.senderName || 'Reporter',
        inboxStatus: report.status || 'pending',
        inboxTimestamp: report.updatedAt || report.createdAt
    }));

    return [...reportItems, ...ticketItems].sort((a, b) => getTimestampMillis(b.inboxTimestamp) - getTimestampMillis(a.inboxTimestamp));
}

function getInboxItemById(type, id) {
    if (type === 'report') return globalReports.find(item => item.id === id) || null;
    return globalTickets.find(item => item.id === id) || null;
}

function getActiveInboxSelection() {
    return {
        id: document.getElementById('active-ticket-id')?.value || '',
        type: document.getElementById('active-ticket-type')?.value || 'ticket'
    };
}

function refreshActiveInboxItem() {
    const { id, type } = getActiveInboxSelection();
    if (!id) return;
    const item = getInboxItemById(type, id);
    if (item && !document.getElementById('inbox-active-ticket')?.classList.contains('hidden')) {
        window.viewTicket(id, type);
    }
}

function renderInboxMessageBubble(label, content, alignment = 'left', tone = 'default') {
    const isRight = alignment === 'right';
    const bubbleClass = tone === 'admin'
        ? 'bg-[#852221] text-white'
        : 'bg-white dark:bg-dark-card text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-dark-border';

    return `
        <div class="flex flex-col gap-1 mb-6 ${isRight ? 'items-end' : ''}">
            <span class="text-xs text-gray-400 ${isRight ? 'mr-2' : 'ml-2'} font-medium">${escapeHtml(label)}</span>
            <div class="${bubbleClass} p-5 rounded-2xl ${isRight ? 'rounded-tr-sm self-end' : 'rounded-tl-sm self-start'} shadow-sm inline-block max-w-[85%]">
                <p class="text-sm whitespace-pre-wrap leading-relaxed">${escapeHtml(content || '...')}</p>
            </div>
        </div>
    `;
}

function clearInboxReplyBox(type = 'ticket') {
    const replyBox = document.getElementById('ticket-reply-text');
    if (!replyBox) return;
    replyBox.value = '';
    replyBox.placeholder = type === 'report' ? 'Add internal review notes...' : 'Type reply...';
}

function getReportReplyEntries(report = {}) {
    const replies = Array.isArray(report.reportReplies) ? report.reportReplies.filter(Boolean) : [];

    if (replies.length > 0) {
        return replies.slice().sort((a, b) => {
            const aTime = Number(a?.createdAtMs || 0);
            const bTime = Number(b?.createdAtMs || 0);
            return aTime - bTime;
        });
    }

    if (report.reviewNotes) {
        return [{
            text: report.reviewNotes,
            authorName: 'Admin Review',
            createdAtMs: getTimestampMillis(report.updatedAt || report.createdAt)
        }];
    }

    return [];
}

function buildReportReplyPayload(replyText) {
    const user = auth.currentUser;
    return {
        text: replyText,
        authorId: user ? user.uid : '',
        authorName: document.querySelector('.user-name')?.innerText || 'Admin',
        createdAtMs: Date.now()
    };
}

function buildReportMessageDoc(replyText) {
    const user = auth.currentUser;
    return {
        text: replyText,
        senderUid: user ? user.uid : '',
        senderName: document.querySelector('.user-name')?.innerText || 'Admin',
        senderRole: 'admin',
        imageUrl: '',
        isInternal: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

function resetActiveReportMessages() {
    activeReportMessages = [];
    activeReportMessagesReportId = '';
    if (typeof unsubscribeActiveReportMessages === 'function') {
        unsubscribeActiveReportMessages();
    }
    unsubscribeActiveReportMessages = null;
}

function getActiveReportMessageEntries(reportId) {
    if (activeReportMessagesReportId !== reportId) return [];
    return activeReportMessages.slice().sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
}

function subscribeToReportMessages(reportId) {
    if (!reportId) return;
    if (activeReportMessagesReportId === reportId && typeof unsubscribeActiveReportMessages === 'function') return;

    resetActiveReportMessages();
    activeReportMessagesReportId = reportId;
    unsubscribeActiveReportMessages = db.collection('product_reports').doc(reportId).collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(snap => {
            activeReportMessages = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const { id, type } = getActiveInboxSelection();
            if (type === 'report' && id === reportId && !document.getElementById('inbox-active-ticket')?.classList.contains('hidden')) {
                window.viewTicket(reportId, 'report');
            }
        }, error => {
            console.error("Report messages listener error:", error);
        });
}

function applyLocalReportUpdate(id, updates = {}, replyPayload = null) {
    const reportIndex = globalReports.findIndex(x => x.id === id);
    if (reportIndex === -1) return;

    const currentReport = globalReports[reportIndex];
    const nextReport = {
        ...currentReport,
        ...updates,
        updatedAt: new Date()
    };

    if (replyPayload) {
        nextReport.reviewNotes = replyPayload.text;
        nextReport.reportReplies = [...getReportReplyEntries(currentReport), replyPayload];
    }

    globalReports[reportIndex] = nextReport;
}

function buildReportDocUpdate(status, actionTaken, replyText = '') {
    const user = auth.currentUser;
    const update = {
        status,
        actionTaken,
        reviewedBy: user ? user.uid : '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (replyText) {
        const replyPayload = buildReportReplyPayload(replyText);
        update.reviewNotes = replyText;
        update.reportReplies = firebase.firestore.FieldValue.arrayUnion(replyPayload);
        update.adminReply = replyText;
        update.adminReplyAt = firebase.firestore.FieldValue.serverTimestamp();
        update.adminReplyBy = user ? user.uid : '';
        update.hasUnreadAdminReply = true;
        update.lastMessage = replyText;
        update.lastMessageAt = firebase.firestore.FieldValue.serverTimestamp();
        update.lastMessageBy = 'admin';
        update.hasUnreadReporterReply = false;
        return { update, replyPayload };
    }

    return { update, replyPayload: null };
}

async function persistReportModerationUpdate(id, status, actionTaken, replyText = '', logLabel = 'Updated Product Report') {
    const { update, replyPayload } = buildReportDocUpdate(status, actionTaken, replyText);
    applyLocalReportUpdate(id, update, replyPayload);
    await db.collection('product_reports').doc(id).set(update, { merge: true });
    if (replyText) {
        const messageDoc = buildReportMessageDoc(replyText);
        await db.collection('product_reports').doc(id).collection('messages').add(messageDoc);
    }
    await logAction(logLabel, `Report ID: ${id.substring(0,6)}`, "Audit");
    clearInboxReplyBox('report');
    window.viewTicket(id, 'report');
    renderInbox();
}


// ==========================================
// 6. SUPPORT TICKETING ENGINE
// ==========================================
function renderInbox() {
    const listContainer = document.getElementById('inbox-list');
    if (!listContainer) return;
    const searchTerm = (document.getElementById('ticketSearch')?.value || '').trim().toLowerCase();
    const items = getInboxItems().filter(item => {
        if (!searchTerm) return true;
        return [
            item.inboxTitle,
            item.inboxPreview,
            item.inboxSender,
            item.reason,
            item.productName,
            item.productId,
            item.sourcePath,
            item.senderEmail,
            item.reporterEmail
        ].some(value => String(value || '').toLowerCase().includes(searchTerm));
    });

    if (items.length === 0) {
        const emptyMessage = searchTerm ? 'No inbox items match your search.' : 'Inbox is empty.';
        listContainer.innerHTML = `<div class="p-8 text-center text-gray-400 flex flex-col items-center"><i data-lucide="check-circle" class="w-8 h-8 mb-2 opacity-30 text-green-500"></i><span class="text-sm">${escapeHtml(emptyMessage)}</span></div>`;
        if(window.lucide) lucide.createIcons();
        return;
    }

    let html = '';
    items.forEach(item => {
        const badge = getInboxListBadge(item.inboxStatus);
        const dateStr = formatInboxListDate(item.inboxTimestamp);
        const typeLabel = item.inboxType === 'report' ? 'Report' : 'Ticket';
        const typeBadgeClass = item.inboxType === 'report'
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

        html += `
        <div onclick="viewTicket('${escapeForAttribute(item.id)}', '${item.inboxType}')" class="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-dark-border transition-colors border-b border-gray-50 dark:border-dark-border group">
            <div class="flex justify-between items-start mb-1">
                <h4 class="text-sm font-bold text-gray-800 dark:text-gray-200 group-hover:text-[#852221] transition-colors truncate pr-2">${escapeHtml(item.inboxTitle)}</h4>
                <span class="text-[10px] text-gray-400 whitespace-nowrap">${escapeHtml(dateStr)}</span>
            </div>
            <p class="text-xs text-gray-500 truncate mb-2">${escapeHtml(item.inboxPreview)}</p>
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">${escapeHtml(item.inboxSender)}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${typeBadgeClass}">${typeLabel}</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 ${badge.className}"><i data-lucide="${badge.icon}" class="w-3 h-3"></i> ${escapeHtml(formatInboxStatus(item.inboxStatus))}</span>
            </div>
        </div>`;
    });
    
    listContainer.innerHTML = html;
    if(window.lucide) lucide.createIcons();
}

window.viewTicket = function(id, type = 'ticket') {
    const item = getInboxItemById(type, id);
    if (!item) return;

    if (type === 'report') subscribeToReportMessages(id);
    else if (activeReportMessagesReportId) resetActiveReportMessages();

    document.getElementById('active-ticket-id').value = id;
    document.getElementById('active-ticket-type').value = type;
    document.getElementById('ticket-detail-id').innerText = `${type === 'report' ? '#RPT-' : '#TCK-'}${id.substring(0,6).toUpperCase()}`;
    document.getElementById('ticket-detail-subject').innerText = type === 'report'
        ? (item.subject || `Product Report: ${item.productName || item.productId || 'Unnamed Product'}`)
        : (item.subject || 'Support Request');
    document.getElementById('ticket-detail-sender').innerText = type === 'report'
        ? (item.reporterName || item.senderName || 'Unknown Reporter')
        : (item.senderName || 'Unknown User');
    document.getElementById('ticket-detail-date').innerText = formatInboxDateTime(type === 'report' ? (item.updatedAt || item.createdAt) : item.createdAt);

    const statusBadge = document.getElementById('ticket-detail-status');
    statusBadge.innerText = formatInboxStatus(type === 'report' ? (item.status || 'pending') : (item.status || 'Open'));
    statusBadge.className = getInboxStatusClass(type === 'report' ? item.status : item.status || 'Open');

    const conversationArea = document.getElementById('ticket-conversation');
    if (!conversationArea) return console.error("Missing ticket-conversation div!");

    const evidenceLink = document.getElementById('report-evidence-link');
    const attachBtn = document.getElementById('ticket-attach-btn');
    const reviewBtn = document.getElementById('report-review-btn');
    const dismissBtn = document.getElementById('report-dismiss-btn');
    const replyBtn = document.getElementById('ticket-reply-btn');
    const resolveBtn = document.getElementById('ticket-resolve-btn');
    const replyBox = document.getElementById('ticket-reply-text');

    let convoHtml = '';
    if (type === 'report') {
        const reportSummary = [
            `Reason: ${item.reason || 'Not specified'}`,
            `Product: ${item.productName || item.productId || 'Unknown product'}`,
            `Seller UID: ${item.sellerUid || item.sellerId || 'Unknown seller'}`,
            `Source: ${item.source || 'Unknown source'}`,
            `Path: ${item.sourcePath || 'Missing sourcePath'}`
        ].join('\n');
        convoHtml += renderInboxMessageBubble('Moderation Context', reportSummary);

        const reportMessages = getActiveReportMessageEntries(id);
        if (reportMessages.length > 0) {
            reportMessages.forEach(message => {
                const isAdmin = String(message.senderRole || '').toLowerCase() === 'admin';
                const label = isAdmin
                    ? (message.senderName || 'Admin')
                    : (message.senderName || item.reporterName || 'Reporter');
                convoHtml += renderInboxMessageBubble(label, message.text || '...', isAdmin ? 'right' : 'left', isAdmin ? 'admin' : 'default');
            });
        } else {
            convoHtml += renderInboxMessageBubble(item.reporterName || item.senderName || 'Reporter', item.description || item.reason || 'No report description provided.');
            getReportReplyEntries(item).forEach(reply => {
                convoHtml += renderInboxMessageBubble(reply.authorName || 'Admin Review', reply.text || '...', 'right', 'admin');
            });
        }

        if (replyBox) {
            replyBox.placeholder = 'Add internal review notes...';
            replyBox.value = '';
        }
        if (evidenceLink) {
            if (item.evidenceUrl) {
                evidenceLink.href = item.evidenceUrl;
                evidenceLink.classList.remove('hidden');
                evidenceLink.classList.add('flex');
            } else {
                evidenceLink.href = '#';
                evidenceLink.classList.add('hidden');
                evidenceLink.classList.remove('flex');
            }
        }
        if (attachBtn) attachBtn.classList.add('hidden');
        if (reviewBtn) reviewBtn.classList.remove('hidden');
        if (dismissBtn) dismissBtn.classList.remove('hidden');
        if (replyBtn) {
            replyBtn.innerText = 'Save Notes';
            replyBtn.classList.remove('hidden');
        }
        if (resolveBtn) {
            resolveBtn.innerText = 'Resolve';
            resolveBtn.classList.remove('hidden');
        }
    } else {
        convoHtml += renderInboxMessageBubble(item.senderName || 'User', item.message || '...');
        if (item.adminReply) {
            convoHtml += renderInboxMessageBubble('Admin (You)', item.adminReply, 'right', 'admin');
        }

        if (replyBox) {
            replyBox.placeholder = 'Type reply...';
            replyBox.value = '';
        }
        if (evidenceLink) {
            evidenceLink.href = '#';
            evidenceLink.classList.add('hidden');
            evidenceLink.classList.remove('flex');
        }
        if (attachBtn) attachBtn.classList.remove('hidden');
        if (reviewBtn) reviewBtn.classList.add('hidden');
        if (dismissBtn) dismissBtn.classList.add('hidden');
        if (replyBtn) {
            replyBtn.innerText = 'Send Reply';
            replyBtn.classList.remove('hidden');
        }
        if (resolveBtn) {
            resolveBtn.innerText = 'Resolve';
            resolveBtn.classList.remove('hidden');
        }
    }

    conversationArea.innerHTML = convoHtml;
    document.getElementById('inbox-empty-state').classList.add('hidden');
    document.getElementById('inbox-active-ticket').classList.remove('hidden');

    if(window.lucide) lucide.createIcons();
    setTimeout(() => { conversationArea.scrollTop = conversationArea.scrollHeight; }, 50);
};

window.closeTicketView = function() {
    document.getElementById('inbox-active-ticket').classList.add('hidden');
    document.getElementById('inbox-empty-state').classList.remove('hidden');
    document.getElementById('active-ticket-id').value = '';
    document.getElementById('active-ticket-type').value = 'ticket';
    resetActiveReportMessages();
};

window.replyToTicket = async function() {
    const id = document.getElementById('active-ticket-id').value;
    const type = document.getElementById('active-ticket-type').value || 'ticket';
    const replyText = document.getElementById('ticket-reply-text').value.trim();
    
    if(!id) return;
    if(!replyText) return alert("Please type a reply first before sending.");

    if (type === 'report') {
        const currentReport = getInboxItemById('report', id) || {};
        const nextStatus = normalizeInboxStatus(currentReport.status, 'pending') === 'pending'
            ? 'reviewing'
            : normalizeInboxStatus(currentReport.status, 'reviewing');
        try {
            await persistReportModerationUpdate(id, nextStatus, 'under_review', replyText, 'Updated Product Report');
        } catch (e) {
            console.error("Report Save Error:", e);
            alert("Failed to save review notes. " + e.message);
        }
        return;
    }

    const conversationArea = document.getElementById('ticket-conversation');
    if (conversationArea) {
        conversationArea.innerHTML += renderInboxMessageBubble('Admin (You)', replyText, 'right', 'admin');
        setTimeout(() => { conversationArea.scrollTop = conversationArea.scrollHeight; }, 10);
    }

    const statusBadge = document.getElementById('ticket-detail-status');
    if (statusBadge) {
        statusBadge.innerText = 'Resolved';
        statusBadge.className = 'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-600';
    }

    clearInboxReplyBox('ticket');

    const ticketIndex = globalTickets.findIndex(x => x.id === id);
    if (ticketIndex > -1) {
        globalTickets[ticketIndex].adminReply = replyText;
        globalTickets[ticketIndex].status = 'Resolved';
    }

    try {
        await db.collection('tickets').doc(id).update({ 
            adminReply: replyText,
            status: 'Resolved',
            repliedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await logAction("Replied to Ticket", `Ticket ID: ${id.substring(0,6)}`);
    } catch(e) { 
        console.error("Database Error:", e);
        alert("Warning: Visuals updated, but failed to save to database. " + e.message); 
    }
};

window.resolveTicket = async function() {
    const id = document.getElementById('active-ticket-id').value;
    const type = document.getElementById('active-ticket-type').value || 'ticket';
    if(!id) return;

    if (type === 'report') {
        const replyText = document.getElementById('ticket-reply-text').value.trim();
        try {
            await persistReportModerationUpdate(id, 'resolved', 'resolved_in_admin', replyText, 'Resolved Product Report');
        } catch(e) { alert("Error: " + e.message); }
        return;
    }
    
    try {
        await db.collection('tickets').doc(id).update({ status: 'Resolved' });
        await logAction("Resolved Ticket", `Ticket ID: ${id.substring(0,6)}`);
        clearInboxReplyBox('ticket');
        
        const statusBadge = document.getElementById('ticket-detail-status');
        if (statusBadge) {
            statusBadge.innerText = 'Resolved';
            statusBadge.className = 'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-600';
        }
    } catch(e) { alert("Error: " + e.message); }
};

window.markReportReviewing = async function() {
    const id = document.getElementById('active-ticket-id').value;
    const type = document.getElementById('active-ticket-type').value || 'ticket';
    if (!id || type !== 'report') return;

    const replyText = document.getElementById('ticket-reply-text').value.trim();
    try {
        await persistReportModerationUpdate(id, 'reviewing', 'under_review', replyText, 'Marked Product Report Reviewing');
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.dismissReport = async function() {
    const id = document.getElementById('active-ticket-id').value;
    const type = document.getElementById('active-ticket-type').value || 'ticket';
    if (!id || type !== 'report') return;

    const replyText = document.getElementById('ticket-reply-text').value.trim();
    try {
        await persistReportModerationUpdate(id, 'dismissed', 'dismissed_report', replyText, 'Dismissed Product Report');
    } catch (e) {
        alert("Error: " + e.message);
    }
};

// ==========================================
// 7. CRUD OPERATIONS (Save, Edit, Approvals)
// ==========================================
window.saveNewProduct = async function() {
    const name = document.getElementById('inp_name').value.trim(); 
    const price = parseCurrencyInputValue(document.getElementById('inp_price').value);
    const stock = document.getElementById('inp_stock').value;
    const files = collectProductImageFiles('inp_file');
    
    if (!name || !price) return alert("Please fill in the Product Name and Price");

    const btn = document.querySelector('#addItemModal button[onclick="saveNewProduct()"]');
    if (btn) { btn.textContent = "Uploading..."; btn.disabled = true; }

    try {
        const selectedAvailability = document.getElementById('inp_status').value || 'In Stock';
        const workflowStatus = selectedAvailability.toLowerCase() === 'pending' ? 'Pending' : 'Approved';
        const category = document.getElementById('inp_category').value || 'General';
        const usesSizeStocks = isSizedCategory(category);
        const rawSizeStocks = readSizeStocks('inp_size_stock_section');
        const sizeStocks = usesSizeStocks ? rawSizeStocks : null;
        const imageUrls = await uploadProductImages(files, name);
        const totalStock = stock !== ''
            ? Number(stock)
            : usesSizeStocks
                ? Object.values(rawSizeStocks).reduce((sum, value) => sum + (Number(value) || 0), 0)
                : 1;
        const condition = getSelectedCondition('inp_condition');
        const recipient = document.getElementById('inp_recipient').value.trim() || getCurrentAdminName();
        const departmentTag = document.getElementById('inp_department_tag').value.trim();
        const ownerUid = auth.currentUser ? auth.currentUser.uid : '';
        if (!condition) throw new Error("Please select a condition.");

        const productRef = db.collection(workflowStatus === 'Pending' ? 'products_pending' : 'products_approved').doc();
        const productData = {
            Product: name,
            name,
            Price: Number(price),
            price: Number(price),
            Stock: Number(totalStock) || 0,
            Stock_count: Number(totalStock) || 0,
            stockCount: Number(totalStock) || 0,
            stock: Number(totalStock) || 0,
            Category: category, 
            category,
            DepartmentTag: departmentTag,
            departmentTag,
            Status: workflowStatus,
            WorkflowStatus: workflowStatus,
            approvalStatus: workflowStatus,
            Availability: selectedAvailability === 'Pending' ? 'In Stock' : selectedAvailability,
            availability: (selectedAvailability === 'Pending' ? 'In Stock' : selectedAvailability).toLowerCase().replace(/\s+/g, '-'),
            Recipient: recipient,
            displayVendor: recipient,
            recipientName: recipient,
            Description: document.getElementById('inp_desc').value || '',
            description: document.getElementById('inp_desc').value || '',
            Condition: condition,
            condition,
            SizeStocks: sizeStocks,
            sizeStocks,
            sellerId: ownerUid,
            ownerId: ownerUid,
            uid: ownerUid,
            itemType: 'Physical Item',
            fulfillmentType: 'Campus Pick-up',
            listingId: productRef.id,
            sourcePath: `${workflowStatus === 'Pending' ? 'products_pending' : 'products_approved'}/${productRef.id}`,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...buildProductImageFields(imageUrls, name)
        };

        productData.status = workflowStatus.toLowerCase();
        productData.verified = workflowStatus === 'Approved';

        await productRef.set(productData);
        await logAction("Created Product", `Item: ${name} (ID: ${productRef.id.substring(0,6)})`);
        
        alert("Product Saved Successfully!");
        closeAndClearModal('addItemModal'); 
    } catch (e) { 
        console.error("Save Error:", e); alert("Error saving product: " + e.message); 
    } finally { if (btn) { btn.textContent = "Save Product"; btn.disabled = false; } }
};

window.editProduct = function(id) {
    const product = getProductById(id); 
    if (!product) return;
    
    document.getElementById('edit_id').value = id;
    document.getElementById('edit_name').value = getProductName(product);
    setCurrencyInputValue('edit_price', getProductPrice(product));
    document.getElementById('edit_stock').value = product.Stock ?? product.Stock_count ?? '';
    document.getElementById('edit_category').value = getProductCategory(product) || 'School Supplies';
    document.getElementById('edit_department_tag').value = product.DepartmentTag || product.departmentTag || '';
    document.getElementById('edit_status').value = product.WorkflowStatus === 'Pending' ? 'Pending' : (product.Availability || 'In Stock');
    document.getElementById('edit_recipient').value = getProductRecipient(product) || getCurrentAdminName();
    document.getElementById('edit_desc').value = product.Description || '';
    setConditionSelection('edit_condition', product.Condition || product.condition || '');
    populateSizeStocks('edit_size_stock_section', product.SizeStocks || product.sizeStocks || {});
    toggleSizeStockSection('edit');
    renderImagePreview('edit_preview', product.imageUrls || product.photoURLs || [getProductImage(product)]);
    openModal('editItemModal');
};

window.updateExistingProduct = async function() {
    const id = document.getElementById('edit_id').value;
    const name = document.getElementById('edit_name').value.trim(); 
    const price = parseCurrencyInputValue(document.getElementById('edit_price').value);
    const stock = document.getElementById('edit_stock').value;
    const files = collectProductImageFiles('edit_file');
    const product = getProductById(id);
    
    if (!id || !name || !price || !product) return alert("Missing required fields.");

    const btn = document.querySelector('#editItemModal button[onclick="updateExistingProduct()"]');
    if (btn) { btn.textContent = "Updating..."; btn.disabled = true; }

    try {
        const selectedAvailability = document.getElementById('edit_status').value || 'In Stock';
        const workflowStatus = selectedAvailability.toLowerCase() === 'pending' ? 'Pending' : 'Approved';
        const category = document.getElementById('edit_category').value || 'General';
        const usesSizeStocks = isSizedCategory(category);
        const rawSizeStocks = readSizeStocks('edit_size_stock_section');
        const sizeStocks = usesSizeStocks ? rawSizeStocks : null;
        const uploadedImages = files.length ? await uploadProductImages(files, name) : [];
        const imageUrls = uploadedImages.length ? uploadedImages : (product.imageUrls || product.photoURLs || [product.Image || product.imageUrl || product.photoURL].filter(Boolean));
        const totalStock = stock !== ''
            ? Number(stock)
            : usesSizeStocks
                ? Object.values(rawSizeStocks).reduce((sum, value) => sum + (Number(value) || 0), 0)
                : 1;
        const condition = getSelectedCondition('edit_condition');
        const recipient = document.getElementById('edit_recipient').value.trim() || getCurrentAdminName();
        const departmentTag = document.getElementById('edit_department_tag').value.trim();
        if (!condition) throw new Error("Please select a condition.");
        const productData = {
            Product: name,
            name,
            Price: Number(price),
            price: Number(price),
            Stock: Number(totalStock) || 0,
            Stock_count: Number(totalStock) || 0,
            stockCount: Number(totalStock) || 0,
            stock: Number(totalStock) || 0,
            Category: category, 
            category,
            DepartmentTag: departmentTag,
            departmentTag,
            Status: workflowStatus,
            approvalStatus: workflowStatus,
            Availability: selectedAvailability === 'Pending' ? 'In Stock' : selectedAvailability,
            availability: (selectedAvailability === 'Pending' ? 'In Stock' : selectedAvailability).toLowerCase().replace(/\s+/g, '-'),
            Recipient: recipient, 
            displayVendor: recipient,
            recipientName: recipient,
            Description: document.getElementById('edit_desc').value || '',
            description: document.getElementById('edit_desc').value || '',
            Condition: condition,
            condition,
            SizeStocks: sizeStocks,
            sizeStocks,
            sellerId: product.sellerId || getMobileSellerUid(product) || (auth.currentUser ? auth.currentUser.uid : ''),
            ownerId: product.ownerId || product.sellerId || getMobileSellerUid(product) || (auth.currentUser ? auth.currentUser.uid : ''),
            uid: product.uid || product.ownerId || product.sellerId || getMobileSellerUid(product) || (auth.currentUser ? auth.currentUser.uid : ''),
            itemType: product.itemType || 'Physical Item',
            fulfillmentType: product.fulfillmentType || 'Campus Pick-up',
            listingId: product.listingId || product.productId || product.id,
            sourcePath: product.sourcePath || product.path || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...buildProductImageFields(imageUrls, name)
        };
        productData.WorkflowStatus = productData.Status;

        if (product.source === 'MobilePending') {
            productData.name = productData.Product;
            productData.price = productData.Price;
            productData.category = productData.Category;
            productData.status = productData.Status.toLowerCase();
            productData.availability = productData.Availability.toLowerCase().replace(/\s+/g, '-');
            productData.recipientName = productData.Recipient;
            productData.description = productData.Description;
            productData.condition = productData.Condition;
            productData.stock_count = productData.Stock_count;
        }

        if (!product.path) throw new Error("Product path is missing.");
        await db.doc(product.path).update(productData);
        await logAction("Updated Product", `Item: ${name} (ID: ${id.substring(0,6)})`);
        
        alert("Product Updated Successfully!");
        closeAndClearModal('editItemModal'); 
    } catch (e) { 
        console.error("Update Error:", e); alert("Error updating product: " + e.message); 
    } finally { if (btn) { btn.textContent = "Update Product"; btn.disabled = false; } }
};

window.approveProduct = async function(fullPath, name) {
    if(!fullPath || fullPath === 'undefined') return alert("Error: Database path missing.");

    if(confirm(`Approve "${name}"?`)) {
        try { 
            const isMobilePending = fullPath.startsWith('products_pending/');
            const docRef = db.doc(fullPath);
            const snap = await docRef.get();
            if (!snap.exists) throw new Error("Product document not found.");

            const product = normalizeProduct(snap, isMobilePending ? 'MobilePending' : 'ApprovedMarketplace');
            const approvalData = {
                ...buildMobileWorkflowUpdate('approved', 'In Stock'),
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (isMobilePending) {
                const sellerUid = getMobileSellerUid({ ...snap.data(), ...product });
                const productId = getMobileProductId(snap, product);
                if (!sellerUid) throw new Error("Missing sellerUid for approved mobile product.");

                const batch = db.batch();
                const sellerDocRef = db.doc(getMobileSellerProductPath(sellerUid, productId));
                const approvedDocRef = db.collection('products_approved').doc(productId);
                const approvedCopy = {
                    ...buildApprovedProductCopy({ ...snap.data(), ...product, ...approvalData }, productId),
                    sourcePath: fullPath,
                    sellerUid,
                    sellerId: sellerUid
                };

                batch.update(docRef, {
                    ...approvalData,
                    verified: true,
                    sellerUid,
                    sellerId: sellerUid,
                    productId
                });
                batch.set(sellerDocRef, {
                    ...approvalData,
                    verified: true,
                    sellerUid,
                    sellerId: sellerUid,
                    productId
                }, { merge: true });
                batch.set(approvedDocRef, approvedCopy, { merge: true });
                await batch.commit();
            } else {
                await docRef.update(approvalData);
            }

            await logAction("Approved Product", `Item: ${name}`, "Audit"); 
            alert("Listing is now LIVE.");
        } catch (error) { alert("Error: " + error.message); }
    }
};

window.rejectProduct = async function(fullPath, name) {
    if(confirm(`Reject "${name}"?`)) {
        try { 
            const isMobilePending = fullPath.startsWith('products_pending/');
            const docRef = db.doc(fullPath);
            const snap = await docRef.get();
            if (!snap.exists) throw new Error("Product document not found.");

            const rejectData = {
                ...buildMobileWorkflowUpdate('rejected', 'Out of Stock'),
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (isMobilePending) {
                const sellerUid = getMobileSellerUid({ ...snap.data(), ...normalizeProduct(snap, 'MobilePending') });
                const productId = getMobileProductId(snap, snap.data());
                if (!sellerUid) throw new Error("Missing sellerUid for rejected mobile product.");

                const batch = db.batch();
                const sellerDocRef = db.doc(getMobileSellerProductPath(sellerUid, productId));
                const rejectedProductData = {
                    ...snap.data(),
                    ...rejectData,
                    id: productId,
                    productId,
                    sellerUid,
                    sellerId: sellerUid
                };

                batch.update(docRef, {
                    ...rejectData,
                    sellerUid,
                    sellerId: sellerUid,
                    productId
                });
                batch.set(sellerDocRef, {
                    ...rejectData,
                    sellerUid,
                    sellerId: sellerUid,
                    productId
                }, { merge: true });
                await batch.commit();
            } else {
                await docRef.update(rejectData);
            }

            await logAction("Rejected Product", `Item: ${name}`, "Audit"); 
            alert("Listing was rejected.");
        } catch (error) { alert("Error: " + error.message); }
    }
};

window.saveFinancialRecord = async function() {
    const amtVal = document.getElementById('fin_amount').value; const buyVal = document.getElementById('fin_buyer').value.trim(); const itmVal = document.getElementById('fin_item').value.trim();
    if (!amtVal || !buyVal || !itmVal) return alert("Please fill Amount, Buyer, and Item Name.");
    const btn = document.querySelector('#addFinanceModal button[onclick="saveFinancialRecord()"]'); btn.textContent = "Saving..."; btn.disabled = true;

    try {
        const dVal = document.getElementById('fin_date').value; const amt = parseFloat(amtVal);
        await db.collection('financials').add({
            type: "Income", date: dVal ? new Date(dVal) : new Date(), refId: document.getElementById('fin_refId').value.trim() || "AUTO-" + Date.now().toString().slice(-6),
            buyerName: buyVal, recipient: document.getElementById('fin_recipient').value.trim() || "General Fund", itemName: itmVal, category: document.getElementById('fin_category').value,
            amount: amt, description: document.getElementById('fin_desc').value.trim(), createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: auth.currentUser ? auth.currentUser.email : 'System'
        });
        await logAction("Recorded Income", `Sold: ${itmVal} to ${buyVal} for ₱${amt}`);
        alert("Transaction Saved!"); closeAndClearModal('addFinanceModal');
        if(typeof renderTransactions === 'function') renderTransactions();
    } catch (e) { alert("Error: " + e.message); } finally { btn.textContent = "Save Record"; btn.disabled = false; }
};

window.saveNewUser = async function() {
    const em = document.getElementById('u_email').value.trim();
    const nm = document.getElementById('u_name').value.trim();
    const phone = document.getElementById('u_phone').value.trim();
    if (!nm || !em || !phone) return alert("Please fill in name, email, and phone.");
    const btn = document.querySelector('#addUserModal button.bg-primary'); btn.textContent = "Creating..."; btn.disabled = true;
    let secApp = null;
    try {
        secApp = firebase.initializeApp(firebaseConfig, "Secondary");
        const tempPassword = generateTemporaryPassword();
        const generatedUID = await generateUniqueUserIdentifier();
        const cred = await secApp.auth().createUserWithEmailAndPassword(em, tempPassword);
        await cred.user.sendEmailVerification();
        await secApp.auth().sendPasswordResetEmail(em);

        await db.collection('users').doc(cred.user.uid).set({
            UID: generatedUID,
            uid: cred.user.uid,
            authUid: cred.user.uid,
            name: nm,
            email: em,
            phone,
            role: 'student',
            status: 'unverified',
            verified: false,
            emailVerified: false,
            usertype: 'user',
            userType: 'user',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await logAction("Created User", `Name: ${nm} (${em})`);
        await secApp.auth().signOut();
        alert("User created. Verification and password setup emails were sent.");
        closeAndClearModal('addUserModal');
    } catch (e) { alert("Error: " + e.message); } finally { if(secApp) secApp.delete(); btn.textContent = "Create User"; btn.disabled = false; }
};

window.saveVerifiedUser = async function() {
    const uid = document.getElementById('v_uid').value; const nm = document.getElementById('v_name').value;
    if(!nm) return alert("Please confirm the user's name");
    await db.collection('users').doc(uid).update({
        name: nm,
        userType: document.getElementById('v_type').value,
        usertype: String(document.getElementById('v_type').value || '').toLowerCase(),
        role: String(document.getElementById('v_role').value || '').toLowerCase(),
        verified: 'verified',
        emailVerified: true,
        status: 'active',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await logAction("Verified User", `User: ${nm} (ID: ${uid})`); closeModal('verifyUserModal'); alert("User Verified.");
};

window.saveMyProfile = async function() {
    const u = auth.currentUser; const nm = document.getElementById('mp_name').value; const file = document.getElementById('mp_file').files[0];
    const btn = document.querySelector('#myProfileModal button.bg-primary'); btn.textContent = "Updating..."; btn.disabled = true;
    try {
        let url = file ? await uploadToCloudinary(file) : null;
        await db.collection('admin').doc(u.uid).update({ name: nm, ...(url && {photoURL: url}) });
        await logAction("Updated Profile", `Admin: ${nm}`);
        updateProfileUI(nm, document.getElementById('mp_role').value, u.email, url || document.getElementById('mp_img').src);
        closeModal('myProfileModal'); alert("Profile Updated!");
    } catch(e) { alert(e.message); } finally { btn.textContent = "Update Profile"; btn.disabled = false; }
};

window.deleteItem = async function(docPath, itemName = 'this record') {
    if(confirm("Are you sure you want to delete this record?")) {
        try { 
            const isProductPath = /^products_|^seller_products\/|^vendor_products\/|^products_pending\/|^products_approved\//.test(docPath || '');
            if (!isProductPath) {
                await db.doc(docPath).delete();
                await logAction("Deleted Item", `Path: ${docPath}${itemName ? `, Item: ${itemName}` : ''}`, "Audit");
                return;
            }

            const product = globalProducts.find(p =>
                p.path === docPath ||
                `products_pending/${p.id}` === docPath ||
                `products_approved/${p.id}` === docPath
            );

            const productId = product?.productId || product?.id || String(docPath).split('/').pop();
            const sellerUid = getMobileSellerUid(product || {});
            const deleteTargets = new Set([
                docPath,
                `products_approved/${productId}`,
                `products_pending/${productId}`
            ]);

            if (sellerUid) {
                deleteTargets.add(`seller_products/${sellerUid}/products/${productId}`);
                deleteTargets.add(`vendor_products/${sellerUid}/products/${productId}`);
            }

            const batch = db.batch();
            Array.from(deleteTargets).filter(Boolean).forEach(path => {
                batch.delete(db.doc(path));
            });
            await batch.commit();

            await logAction("Deleted Item", `Paths: ${Array.from(deleteTargets).join(', ')}${itemName ? `, Item: ${itemName}` : ''}`, "Audit"); 
        } 
        catch (error) { alert("Error deleting: " + error.message); }
    }
};

async function logAction(actionTitle, actionDetails, logLevel = 'Activity') {
    const user = auth.currentUser; 
    if (!user) return;

    try {
        await db.collection('logs').add({
            adminId: user.uid,
            adminName: document.querySelector('.user-name').innerText || "Admin",
            adminEmail: user.email,
            action: actionTitle,
            details: actionDetails,
            level: logLevel, // Tags it as Audit, Activity, or System
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { console.error("Logging failed:", e); }
}

async function uploadToCloudinary(file) {
    const formData = new FormData(); formData.append("file", file); formData.append("upload_preset", "e-marketplace");
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/dokaqnqg6/image/upload`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("Cloudinary Upload Failed");
        const data = await res.json(); return data.secure_url; 
    } catch (err) { throw err; }
}

function generateTemporaryPassword(length = 18) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    const values = new Uint32Array(length);
    crypto.getRandomValues(values);
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
}

async function generateUniqueUserIdentifier() {
    let candidate = '';

    do {
        const rawId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
            .replace(/-/g, '')
            .toUpperCase()
            .slice(0, 20);
        candidate = `USR-${rawId}`;

        const existing = await db.collection('users').where('UID', '==', candidate).limit(1).get();
        if (existing.empty) return candidate;
    } while (true);
}


// ==========================================
// 8. UI & MODAL HELPERS 
// ==========================================
function triggerSkeleton(targetId, rows = 5, cols = 4) {
    const container = document.getElementById(targetId); if (!container) return;
    const isTable = container.tagName === 'TBODY'; let html = '';
    for (let i = 0; i < rows; i++) {
        if (isTable) {
            html += `<tr class="border-b border-gray-100 dark:border-dark-border">`;
            for (let j = 0; j < cols; j++) { html += `<td class="py-4 px-4"><div class="h-4 skeleton-box animate-skeleton w-3/4"></div></td>`; }
            html += `</tr>`;
        } else { html += `<div class="h-8 skeleton-box animate-skeleton mb-4 w-full rounded-lg"></div>`; }
    }
    container.innerHTML = html;
}

window.switchView = function(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewName); 
    if(target) target.classList.remove('hidden');

    if(viewName === 'transactions') { triggerSkeleton('tbody-transactions', 10, 8); renderTransactions(); }
    if(viewName === 'logs') { triggerSkeleton('tbody-logs', 10, 4); renderLogs(); }
    if(viewName === 'allItems') { triggerSkeleton('tbody-all-items', 8, 7); switchInventoryTab(currentInventoryTab || 'verified'); }
    if(viewName === 'schoolListings') { triggerSkeleton('tbody-school-listings', 8, 5); renderSchoolListings(); }
    if(viewName === 'pendingApprovals') { triggerSkeleton('tbody-pending-approvals', 4, 5); renderPendingApprovals(); }
    if(viewName === 'inbox') { renderInbox(); } 

    document.querySelectorAll('.nav-item').forEach(el => {
        el.className = 'nav-item flex items-center px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-dark-border text-gray-600 dark:text-gray-400 cursor-pointer transition-colors group';
        const i = el.querySelector('i'); 
        if(i) { i.classList.remove('text-white'); i.classList.remove('text-gray-400'); }
    });

    const activeNav = document.getElementById('nav-' + viewName);
    if(activeNav) {
        activeNav.className = 'nav-item flex items-center px-3 py-2.5 rounded-lg active cursor-pointer transition-colors';
        activeNav.querySelectorAll('i').forEach(i => i.classList.remove('group-hover:text-[#852221]'));
    }
    
    document.getElementById('userDropdown').classList.add('hidden'); 
    if(window.lucide) lucide.createIcons();
};

window.switchUserTab = function(type) {
    currentTab = type;
    document.querySelectorAll('[id^="tab-"]').forEach(b => {
        b.className = 'page-tab-inactive pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white cursor-pointer';
        if(b.id === 'tab-unverified') b.classList.add('text-red-500');
    });
    const activeBtn = document.getElementById('tab-' + type);
    if(activeBtn) activeBtn.className = (type === 'unverified') ? 'page-tab-active-danger pb-3 text-sm font-bold border-b-2 border-red-500 text-red-600 cursor-pointer' : 'page-tab-active pb-3 text-sm font-bold border-b-2 border-[#852221] text-[#852221] cursor-pointer';
    ['customers', 'sellers', 'unverified'].forEach(t => document.getElementById('tbody-' + t).classList.add('hidden'));
    const tBody = document.getElementById('tbody-' + type); if(tBody) tBody.classList.remove('hidden');
};

window.switchInventoryTab = function(type) {
    currentInventoryTab = type;
    document.querySelectorAll('[id^="inventory-tab-"]').forEach(btn => {
        btn.className = 'pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 cursor-pointer';
    });
    const activeBtn = document.getElementById('inventory-tab-' + type);
    if (activeBtn) activeBtn.className = 'pb-3 text-sm font-bold border-b-2 border-[#852221] text-[#852221] cursor-pointer';
    renderProducts();
};

window.openAddProductModal = function() {
    editingProductId = null; 
    document.querySelector('#addItemModal h3').innerText = "Add New Product";
    const saveBtn = document.querySelector('#addItemModal button[onclick="saveNewProduct()"]');
    if (saveBtn) saveBtn.textContent = "Save Product";
    document.getElementById('inp_recipient').value = getCurrentAdminName();
    document.getElementById('inp_department_tag').value = '';
    setConditionSelection('inp_condition', 'Brand New');
    toggleSizeStockSection('inp');
    renderImagePreview('inp_preview', []);
    openModal('addItemModal');
};

window.openModal = function(id) {
    const modal = document.getElementById(id); const dd = document.getElementById('userDropdown');
    if (dd) dd.classList.add('hidden'); if (!modal) return;
    if (modal.classList.contains('opacity-0') || modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        setTimeout(() => { modal.classList.remove('opacity-0'); const inner = modal.querySelector('div'); if(inner) { inner.classList.remove('scale-95'); inner.classList.add('scale-100'); } }, 10);
        if(id === 'addFinanceModal' && !document.getElementById('fin_date').value) document.getElementById('fin_date').valueAsDate = new Date();
    } else { modal.classList.add('open'); }
};

window.closeModal = function(id) {
    const modal = document.getElementById(id); if (!modal) return;
    if (modal.classList.contains('open')) { modal.classList.remove('open'); } 
    else {
        modal.classList.add('opacity-0'); const inner = modal.querySelector('div');
        if(inner) { inner.classList.remove('scale-100'); inner.classList.add('scale-95'); }
        setTimeout(() => { modal.classList.add('hidden'); }, 300);
    }
};

window.closeAndClearModal = function(id) {
    document.querySelectorAll(`#${id} input, #${id} textarea`).forEach(i => i.value = '');
    document.querySelectorAll(`#${id} select`).forEach(s => s.selectedIndex = 0);
    const mArea = document.querySelector(`#${id} .media-upload-area`);
    if(mArea) { mArea.innerHTML = `<i data-lucide="image" class="w-8 h-8 mx-auto text-gray-300 mb-2"></i><span class="text-xs text-gray-500">Click to Upload Image</span>`; if(window.lucide) lucide.createIcons(); }
    const preview = document.querySelector(`#${id} .image-preview-grid`);
    if (preview) preview.innerHTML = '';
    if (id === 'addItemModal') {
        document.getElementById('inp_recipient').value = getCurrentAdminName();
        document.getElementById('inp_department_tag').value = '';
        setConditionSelection('inp_condition', 'Brand New');
        populateSizeStocks('inp_size_stock_section', {});
        toggleSizeStockSection('inp');
    }
    if (id === 'editItemModal') {
        setConditionSelection('edit_condition', '');
        populateSizeStocks('edit_size_stock_section', {});
        toggleSizeStockSection('edit');
    }
    closeModal(id);
};

window.openVerifyModal = function(uid, email) {
    const user = globalUsers.find(item => (item.id || item.uid) === uid) || {};
    document.getElementById('v_uid').value = uid;
    document.getElementById('v_email').value = email;
    document.getElementById('v_name').value = user.name || '';

    const typeValue = getUserTypeLabel(user).toLowerCase();
    const roleValue = String(user.role || 'student').toLowerCase();
    const typeSelect = document.getElementById('v_type');
    const roleSelect = document.getElementById('v_role');

    if (typeSelect) {
        const matchedType = Array.from(typeSelect.options).find(option => option.value.toLowerCase() === typeValue);
        typeSelect.value = matchedType ? matchedType.value : 'Customer';
    }

    if (roleSelect) {
        const matchedRole = Array.from(roleSelect.options).find(option => option.value.toLowerCase() === roleValue);
        roleSelect.value = matchedRole ? matchedRole.value : 'User';
    }

    openModal('verifyUserModal');
};
window.openMyProfile = function() {
    const u = auth.currentUser;
    if(u) {
        document.getElementById('mp_email').value = u.email; document.getElementById('mp_uid').value = u.uid;
        document.getElementById('mp_name').value = document.querySelector('.user-name').innerText;
        document.getElementById('mp_role').value = document.querySelector('.user-role').innerText;
        document.getElementById('mp_img').src = document.getElementById('header-avatar').src;
        openModal('myProfileModal'); document.getElementById('userDropdown').classList.add('hidden');
    }
};

window.toggleUserDropdown = function() {
    const dd = document.getElementById('userDropdown');
    if (dd.classList.contains('hidden')) { dd.classList.remove('hidden'); setTimeout(() => { document.addEventListener('click', closeUserDropdownOutside); }, 10); } 
    else { dd.classList.add('hidden'); document.removeEventListener('click', closeUserDropdownOutside); }
};
function closeUserDropdownOutside(e) {
    const container = document.getElementById('userMenuContainer');
    if (container && !container.contains(e.target)) { document.getElementById('userDropdown').classList.add('hidden'); document.removeEventListener('click', closeUserDropdownOutside); }
}

function toggleTheme() {
    const html = document.documentElement; const icon = document.getElementById('theme-icon');
    if (html.classList.contains('dark')) { html.classList.remove('dark'); localStorage.setItem('theme', 'light'); if(icon) icon.setAttribute('data-lucide', 'moon'); } 
    else { html.classList.add('dark'); localStorage.setItem('theme', 'dark'); if(icon) icon.setAttribute('data-lucide', 'sun'); }
    if(window.lucide) lucide.createIcons(); 
}
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');

function setupSearch() {
    document.getElementById('globalSearch')?.addEventListener('input', (e) => {
        const table = document.querySelector('.view-section:not(.hidden) table');
        if (table) { const term = e.target.value.toLowerCase(); table.querySelectorAll('tbody tr').forEach(r => r.style.display = r.innerText.toLowerCase().includes(term) ? '' : 'none'); }
    });
    document.getElementById('ticketSearch')?.addEventListener('input', () => {
        renderInbox();
    });
    document.getElementById('productSearch')?.addEventListener('input', (e) => {
        document.querySelectorAll('#tbody-all-items tr').forEach(r => r.style.display = r.innerText.toLowerCase().includes(e.target.value.toLowerCase()) ? '' : 'none');
    });
    document.getElementById('userManagementSearch')?.addEventListener('input', (e) => {
        if (!document.getElementById('tbody-customers').classList.contains('hidden')) {
            document.querySelectorAll('#usersTable tbody tr').forEach(r => r.style.display = r.innerText.toLowerCase().includes(e.target.value.toLowerCase()) ? '' : 'none');
        }
    });
}

window.viewProductDetails = function(id) {
    const p = getProductById(id);
    if (!p) return;

    // Fill Modal Data
    document.getElementById('detail-img').src = getProductImage(p);
    document.getElementById('detail-name').innerText = getProductName(p);
    document.getElementById('detail-id').innerText = `#${p.id.toUpperCase()}`;
    document.getElementById('detail-category').innerText = getProductCategory(p) || 'General';
    document.getElementById('detail-price').innerText = `₱${getProductPrice(p).toLocaleString()}`;
    document.getElementById('detail-stock').innerText = hasNumericStock(p) ? `${Number(p.Stock) || 0} units` : getProductStockDisplay(p);
    document.getElementById('detail-recipient').innerText = getProductRecipient(p);
    document.getElementById('detail-status').innerText = `${p.WorkflowStatus || p.Status || 'Unknown'} | ${p.Availability || 'In Stock'}`;
    document.getElementById('detail-desc').innerText = p.Description || 'No description provided.';
    
    // FIX: Look for both database fields
    const allocatedField = document.getElementById('detail-recipient');
    if (allocatedField) {
        allocatedField.innerText = getProductRecipient(p);
    }

    openModal('productDetailModal');
};


// ==========================================
// 9. CALENDAR & CHART
// ==========================================
function renderCalendar() {
    const monthYearEl = document.getElementById("calendar-month"); const gridEl = document.getElementById("calendar-grid");
    if (!monthYearEl || !gridEl) return;

    const year = currentCalendarDate.getFullYear(), month = currentCalendarDate.getMonth();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    monthYearEl.innerText = `${monthNames[month]} ${year}`; gridEl.innerHTML = "";

    const firstDayIndex = new Date(year, month, 1).getDay(); const lastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDayIndex; i++) gridEl.appendChild(document.createElement("span"));

    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
        const dayEl = document.createElement("span"); dayEl.innerText = i;
        dayEl.className = "w-8 h-8 flex items-center justify-center rounded-full mx-auto cursor-pointer transition-all duration-200 text-sm";
        const isSelected = (i === selectedFullDate.getDate() && month === selectedFullDate.getMonth() && year === selectedFullDate.getFullYear());
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear());

        if (isSelected) dayEl.classList.add("bg-[#852221]", "text-white", "shadow-md", "font-bold");
        else if (isToday) dayEl.classList.add("text-[#852221]", "font-bold", "border", "border-red-100");
        else dayEl.classList.add("hover:bg-gray-100", "dark:hover:bg-gray-800", "text-gray-600", "dark:text-gray-300");

        dayEl.onclick = () => selectDay(i); gridEl.appendChild(dayEl);
    }
}

function selectDay(day) {
    selectedFullDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), day);
    renderCalendar(); updateDashboardStats(); 
}

function changeMonth(direction) { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + direction); renderCalendar(); }


// ==========================================
// 10. ON DOM LOAD INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();
    setupSearch();
    
    // Handle Add and Edit Image Previews Dynamically
    [
        { inputId: 'inp_file', previewId: 'inp_preview' },
        { inputId: 'edit_file', previewId: 'edit_preview' }
    ].forEach(({ inputId, previewId }) => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('change', (e) => {
                const files = Array.from(e.target.files || []).slice(0, 3);
                const readers = files.map(file => new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.readAsDataURL(file);
                }));

                Promise.all(readers).then(images => renderImagePreview(previewId, images));
            });
        }
    });

    ['inp_price', 'edit_price'].forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('blur', () => {
                input.value = formatCurrencyInputValue(input.value);
            });
        }
    });

    ['inp_category', 'edit_category'].forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) select.addEventListener('change', () => toggleSizeStockSection(selectId.startsWith('inp') ? 'inp' : 'edit'));
    });

    document.querySelectorAll('.condition-choice').forEach(input => {
        input.addEventListener('change', () => {
            const groupName = input.name;
            if (input.checked) setConditionSelection(groupName, input.value);
            else setConditionSelection(groupName, '');
        });
    });
    
    // Profile Avatar Preview
    const mpFile = document.getElementById('mp_file');
    if(mpFile) {
        mpFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(file) { const reader = new FileReader(); reader.onload = (e) => document.getElementById('mp_img').src = e.target.result; reader.readAsDataURL(file); }
        });
    }

    renderCalendar();

    // Chart Init
    const ctx = document.getElementById('financeChart');
    if(ctx && window.Chart) {
        if (window.myFinanceChart) window.myFinanceChart.destroy();
        window.myFinanceChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: ['Week 01', 'Week 02', 'Week 03', 'Week 04'], datasets: [{ label: 'Income', data: [0, 0, 0, 0], backgroundColor: '#852221', borderRadius: 4, barPercentage: 0.5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 1000, grid: { borderDash: [5, 5] } }, x: { grid: { display: false } } } }
        });
    }
});

// ==========================================
// 11. Smart Filtering Logic
// ==========================================

window.switchLogTab = function(level) {
    currentLogTab = level;
    // UI Update
    document.querySelectorAll('[id^="log-tab-"]').forEach(btn => {
        btn.className = 'pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700';
    });
    const activeBtn = document.getElementById('log-tab-' + level);
    activeBtn.className = 'pb-3 text-sm font-bold border-b-2 border-primary text-primary';
    
    renderLogs();
};

window.switchLogTab = function(level) {
    currentLogTab = level;
    document.querySelectorAll('[id^="log-tab-"]').forEach(btn => {
        btn.className = 'pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 cursor-pointer';
    });
    const activeBtn = document.getElementById('log-tab-' + level);
    if(activeBtn) activeBtn.className = 'pb-3 text-sm font-bold border-b-2 border-[#852221] text-[#852221] cursor-pointer';
    
    renderLogs();
};

function renderLogs() {
    const tbody = document.getElementById('tbody-logs'); 
    if (!tbody) return;
    
    triggerSkeleton('tbody-logs', 10, 4);

    db.collection('logs')
        .where('level', '==', currentLogTab) 
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get()
        .then(snap => {
            tbody.innerHTML = ''; 
            
            if (snap.empty) { 
                tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-16 text-center text-gray-400 italic">No ${currentLogTab} records found.</td></tr>`;
                return; 
            }

            let html = '';
            snap.forEach(doc => {
                const d = doc.data();
                const time = d.timestamp ? d.timestamp.toDate().toLocaleString('en-GB', {hour: '2-digit', minute:'2-digit', day:'2-digit', month:'2-digit'}) : 'Just now';
                
                let badgeClasses = "text-blue-600 bg-blue-50 dark:bg-blue-900/20";
                if(currentLogTab === 'Audit') badgeClasses = "text-red-600 bg-red-50 dark:bg-red-900/20";
                if(currentLogTab === 'System') badgeClasses = "text-amber-600 bg-amber-50 dark:bg-amber-900/20";

                html += `
                <tr class="hover:bg-gray-50 dark:hover:bg-dark-border transition-all border-b dark:border-dark-border">
                    <td class="pl-12 pr-6 py-4 text-gray-400 text-xs font-mono w-[20%] whitespace-nowrap">
                        ${time}
                    </td>
                    
                    <td class="px-10 py-4 font-semibold text-gray-700 dark:text-gray-300 w-[20%] truncate">
                        ${d.adminName || 'Admin'}
                    </td>
                    
                    <td class="px-10 py-4 w-[25%]">
                        <span class="inline-flex items-center justify-center px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter whitespace-nowrap ${badgeClasses} shadow-sm">
                            ${d.action}
                        </span>
                    </td>
                    
                    <td class="pl-10 pr-12 py-4 text-gray-400 font-mono text-xs italic w-[35%]">
                        <div class="line-clamp-1 hover:line-clamp-none transition-all duration-300 cursor-help">
                            ${d.details}
                        </div>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;
        });
}

window.promoteUser = async function(targetUid) {
    // 1. Get the current logged-in role from the sidebar (Hardened Check)
    const roleEl = document.querySelector('.user-role');
    const loggedInRole = roleEl ? roleEl.innerText.trim().toUpperCase() : "";
    
    // 2. Find the user we want to promote
    const targetUser = globalUsers.find(u => (u.id || u.uid) === targetUid);
    if (!targetUser) return alert("User not found.");

    // Define placeholders for the new data
    let newType = (targetUser.type || targetUser.userType || "Customer");
    let newRole = "";

    // 3. The Logic Gate (Case-Insensitive)
    if (loggedInRole === "SUPER ADMIN") {
        // Super Admin can turn Staff into Admin
        if (newType === "Staff") {
            newRole = "Admin";
        } else {
            return alert("Super Admins can only promote Staff to Admin.");
        }
    } 
    else if (loggedInRole === "ADMIN") {
        // Admin can turn Customer into Staff
        if (newType === "Customer") {
            newType = "Staff";
            newRole = "User";
        } else {
            return alert("Admins can only promote Customers to Staff.");
        }
    } 
    else {
        console.log("Team Debug - Failed Role Check:", loggedInRole);
        return alert("You do not have permission to promote users.");
    }

    // 4. Execute Firebase Update
    if (confirm(`Promote ${targetUser.name} to ${newRole === 'Admin' ? 'Admin' : 'Staff'}?`)) {
        try {
            await db.collection('users').doc(targetUid).update({
                type: newType,
                userType: newType, // Keeps both fields synced
                role: newRole,
                promotedBy: auth.currentUser.email,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 5. Log the Audit Trail
            await logAction("User Promotion", `Promoted ${targetUser.name} to ${newRole}`, "Audit");
            
            alert("Promotion successful!");

            // Refresh the UI so the button disappears and badges update
            if (typeof renderUsers === 'function') renderUsers();

        } catch (e) {
            console.error("Promotion Error:", e);
            alert("Failed to update user. Check Firebase Rules.");
        }
    }
};
