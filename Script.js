// ==========================================
// 1. CONFIGURATION
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

let auth, db; 
let globalProducts = [], globalTickets = [];
let currentVendorName = ""; // To store "Library" or "Virtual Lab"
let editingProductId = null;

try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
} catch (e) { console.error("Init Error:", e); }

// ==========================================
// 2. THE SECURITY GATE (Missing Authentication Listener)
// ==========================================
auth.onAuthStateChanged(async (user) => {
    const loginUI = document.getElementById('login-screen');
    const dashUI = document.getElementById('dashboard-container');
    const sidebarUI = document.getElementById('sidebar');

    if (user) {
        // 1. Check if they are a VENDOR (in the 'users' collection)
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (userDoc.exists) {
            const userData = userDoc.data();
            const type = (userData.userType || userData.type || "").toUpperCase();

            if (type === "SELLER" || type === "STAFF") {
                // SUCCESS: Logged in as Vendor
                currentVendorName = userData.name; // Auto-tags product as "Library", etc.
                
                // HIDE Login, SHOW Dashboard
                if (loginUI) loginUI.style.display = 'none';
                if (dashUI) dashUI.classList.remove('hidden');
                if (sidebarUI) sidebarUI.classList.remove('hidden');

                updateVendorUI(userData);
                initVendorData(user.uid);
            } else {
                alert("Access Denied: You are registered as a Customer.");
                auth.signOut();
            }
        } 
        // 2. Fallback: Check if they are an ADMIN trying to view the Vendor panel
        else {
            const adminDoc = await db.collection('admin').doc(user.uid).get();
            if (adminDoc.exists) {
                // Admins are allowed to see the Vendor panel for testing
                if (loginUI) loginUI.style.display = 'none';
                if (dashUI) dashUI.classList.remove('hidden');
                if (sidebarUI) sidebarUI.classList.remove('hidden');
                
                const adminData = adminDoc.data();
                currentVendorName = adminData.name;
                updateVendorUI(adminData);
                initVendorData(user.uid);
            } else {
                alert("Account not found.");
                auth.signOut();
            }
        }
    } else {
        // LOGGED OUT STATE
        if (loginUI) loginUI.style.display = 'flex';
        if (dashUI) dashUI.classList.add('hidden');
        if (sidebarUI) sidebarUI.classList.add('hidden');
    }
});

// ==========================================
// 3. LOGIN & UI HELPERS
// ==========================================
window.handleLogin = function() {
    const e = document.getElementById('loginEmail').value.trim();
    const p = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    if (btn) { btn.textContent = "Verifying..."; btn.disabled = true; }

    auth.signInWithEmailAndPassword(e, p)
    .then(() => { console.log("Auth success, waiting for listener..."); })
    .catch((err) => {
        if (btn) { btn.textContent = "Sign In"; btn.disabled = false; }
        alert("Login Error: " + err.message); 
    });
};

function updateVendorUI(data) {
    document.querySelectorAll('.user-name').forEach(el => el.innerText = data.name);
    document.querySelectorAll('.user-role').forEach(el => el.innerText = data.userType || data.role || "Vendor");
    const avatar = `https://ui-avatars.com/api/?name=${data.name}&background=852221&color=fff`;
    ['sidebar-avatar', 'header-avatar'].forEach(id => {
        const el = document.getElementById(id); if(el) el.src = avatar;
    });
}

// ==========================================
// 4. EXCLUSIVE DATA LISTENERS
// ==========================================
function initVendorData(vendorUid) {
    // ONLY fetch products belonging to THIS vendor
    db.collection('products')
      .where('sellerId', '==', vendorUid)
      .onSnapshot(snap => {
        globalProducts = [];
        snap.forEach(d => globalProducts.push({ id: d.id, ...d.data() }));
        renderVendorProducts();
        updateVendorStats();
    });
}

// ==========================================
// 5. AUTO-TAGGING & CRUD
// ==========================================
window.saveNewProduct = async function() {
    const name = document.getElementById('inp_name').value; 
    const price = document.getElementById('inp_price').value;
    const stock = document.getElementById('inp_stock').value;
    const file = document.getElementById('inp_file').files[0];
    
    if (!name || !price) return alert("Please fill Name and Price");

    try {
        let imageUrl = file ? await uploadToCloudinary(file) : `https://ui-avatars.com/api/?name=${name}&background=eee`;

        const productData = {
            Product: name,
            Price: Number(price),
            Stock: Number(stock) || 0,
            Category: document.getElementById('inp_category').value, 
            Status: 'Pending',
            sellerId: auth.currentUser.uid, // The ID of the person logged in
            Recipient: currentVendorName, // Automatically tags as "Library", "Virtual Lab", etc.
            Description: document.getElementById('inp_desc').value || '',
            Image: imageUrl,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('products').add(productData);
        alert("Product submitted for approval!");
        closeModal('addItemModal'); 
    } catch (e) { alert(e.message); }
};

// ==========================================
// 6. RENDER ENGINE & UTILS
// ==========================================
function renderVendorProducts() {
    const tbody = document.querySelector('#productsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    globalProducts.forEach(p => {
        const stockPercent = Math.min((p.Stock / 100) * 100, 100);
        const barColor = p.Stock < 5 ? 'bg-red-500' : 'bg-green-500';

        tbody.innerHTML += `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
            <td class="px-8 py-5 flex items-center gap-4">
                <img src="${p.Image}" class="w-10 h-10 rounded-lg object-cover shadow-sm">
                <div><p class="font-bold dark:text-white">${p.Product}</p><p class="text-[10px] text-gray-400 uppercase">${p.Category}</p></div>
            </td>
            <td class="px-8 py-5"><div class="flex items-center gap-2"><div class="w-20 bg-gray-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden"><div class="h-full ${barColor}" style="width: ${stockPercent}%"></div></div><span class="font-bold">${p.Stock}</span></div></td>
            <td class="px-8 py-5 text-right"><span class="px-2 py-1 rounded text-[10px] font-black uppercase ${p.Status === 'In Stock' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}">${p.Status}</span></td>
        </tr>`;
    });
}

function updateVendorStats() {
    if(document.getElementById('dash-active-products')) 
        document.getElementById('dash-active-products').innerText = globalProducts.length;
}

window.switchView = function(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-' + viewName).classList.remove('hidden');
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };
window.handleLogout = function() { auth.signOut().then(() => window.location.reload()); };

async function uploadToCloudinary(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "e-marketplace");
    const res = await fetch(`https://api.cloudinary.com/v1_1/dokaqnqg6/image/upload`, { method: "POST", body: formData });
    const data = await res.json();
    return data.secure_url; 
}

function toggleTheme() {
    const html = document.documentElement;
    html.classList.toggle('dark');
    localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    if(window.lucide) lucide.createIcons();
}
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
document.addEventListener('DOMContentLoaded', () => { if(window.lucide) lucide.createIcons(); });