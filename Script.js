// ==========================================
// 1. CONFIGURATION & INIT
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
let globalProducts = [];
let globalSalesHistory = [];
let currentVendorName = ""; 
let currentUserData = null;
let currentUserCollection = 'users';
let globalChatThreads = [];
let globalFilteredChatThreads = [];
let globalActiveChatThread = null;
let globalActiveChatMessages = [];
let globalChatUsers = [];
let globalFilteredChatUsers = [];
let globalIncomingOrders = [];
let globalIncomingOrdersError = '';
let globalSalesHistoryError = '';
let globalReviewsError = '';
let globalUpdatingOrderIds = new Set();
let globalOfficialSalesHistory = [];
let globalProductReviews = [];
let globalSellerReputation = null;
let unsubscribeVendorProducts = null;
let unsubscribeChatThreads = null;
let unsubscribeChatMessages = null;
let unsubscribeIncomingOrders = null;
let unsubscribeOfficialSalesHistory = null;
let unsubscribeProductReviews = null;
let unsubscribeSellerReputation = null;

try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
} catch (e) { console.error("Init Error:", e); }

// ==========================================
// 2. THE SECURITY GATE (Auth & Login)
// ==========================================
window.handleLogin = async function() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');

    try {
        btn.disabled = true;
        btn.innerText = "Authenticating...";
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
        errorEl.classList.remove('hidden');
        errorEl.querySelector('span').innerText = e.message;
        btn.disabled = false;
        btn.innerText = "Sign In";
    }
};

auth.onAuthStateChanged(async (user) => {
    const loginUI = document.getElementById('login-screen');
    const dashUI = document.getElementById('dashboard-container');
    const sidebarUI = document.getElementById('sidebar');

    if (user) {
        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const type = (userData.userType || userData.type || "").toUpperCase();
                if (type === "SELLER" || type === "STAFF") {
                    currentUserCollection = 'users';
                    setupVendorSession(user.uid, userData);
                } else {
                    alert("Access Denied: Not a Vendor account.");
                    auth.signOut();
                }
            } else {
                const adminDoc = await db.collection('admin').doc(user.uid).get();
                if (adminDoc.exists) {
                    currentUserCollection = 'admin';
                    setupVendorSession(user.uid, adminDoc.data());
                } else {
                    auth.signOut();
                }
            }
        } catch (e) {
            console.error('Auth bootstrap failed:', e);
            const errorEl = document.getElementById('loginError');
            if (errorEl) {
                errorEl.classList.remove('hidden');
                errorEl.querySelector('span').innerText = e.message || 'Unable to load your vendor account right now.';
            }
            auth.signOut();
        }
    } else {
        currentUserData = null;
        currentVendorName = "";
        globalSalesHistory = [];
        globalChatThreads = [];
        globalFilteredChatThreads = [];
        globalActiveChatThread = null;
        globalActiveChatMessages = [];
        globalChatUsers = [];
        globalFilteredChatUsers = [];
        globalIncomingOrders = [];
        globalIncomingOrdersError = '';
        globalSalesHistoryError = '';
        globalReviewsError = '';
        globalUpdatingOrderIds = new Set();
        globalOfficialSalesHistory = [];
        globalProductReviews = [];
        globalSellerReputation = null;
        cleanupVendorDataListener();
        cleanupReviewsListeners();
        cleanupChatListeners();
        cleanupIncomingOrdersListener();
        cleanupSalesHistoryListeners();
        currentUserCollection = 'users';
        if (loginUI) loginUI.style.display = 'flex';
        if (dashUI) dashUI.classList.add('hidden');
        if (sidebarUI) sidebarUI.classList.add('hidden');
    }
});

function setupVendorSession(uid, data) {
    currentUserData = { ...data };
    currentVendorName = data.name;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard-container').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    updateVendorUI(data);
    initVendorData(uid); 
    initIncomingOrdersListener(uid);
    initSalesHistoryListener(uid);
    initReviewsListener(uid);
    initChatInboxListener(uid);
}

function updateVendorUI(data) {
    currentUserData = { ...(currentUserData || {}), ...data };
    currentVendorName = currentUserData.name || currentVendorName;
    document.querySelectorAll('.user-name').forEach(el => el.innerText = currentUserData.name || 'Vendor');
    document.querySelectorAll('.user-role').forEach(el => el.innerText = currentUserData.userType || currentUserData.type || "Authorized Seller");
    document.querySelectorAll('.user-first-name').forEach(el => el.innerText = (currentUserData.name || 'Vendor').split(' ')[0]);
    const avatar = currentUserData.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserData.name || 'Vendor')}&background=852221&color=fff`;
    ['sidebar-avatar', 'header-avatar'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) el.src = avatar; 
    });
    const profileAvatar = document.getElementById('profile-avatar');
    if(profileAvatar) profileAvatar.src = avatar;
}

// ==========================================
// 3. UI NAVIGATION & THEME
// ==========================================
window.switchView = function(viewName) {
    // 1. Toggle Sections
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewName);
    if(target) target.classList.remove('hidden');

    // 2. Update Header Title
    const titleEl = document.getElementById('current-view-title');
    if(titleEl) {
        const titles = { 
            'dashboard': 'Overview', 
            'allItems': 'My Inventory', 
            'orders': 'Incoming Checkout Requests', 
            'inbox': 'Customer Inbox',
            'salesHistory': 'Sales History',
            'reviews': 'Customer Reviews',
            'profile': 'My Profile',
            'settings': 'Settings'
        };
        titleEl.innerText = titles[viewName] || viewName;
    }

    // 3. Update Sidebar Active State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.getElementById('nav-' + viewName);
    if(navItem) navItem.classList.add('active');
    
    // 4. Load profile data if profile/settings view is opened
    if((viewName === 'profile' || viewName === 'settings') && auth.currentUser) {
        loadProfileData(auth.currentUser.uid);
    }
};

function updateSalesSummary(totalSales) {
    const lifetimeRevenue = totalSales * 0.12;
    const salesDisplay = document.getElementById('history-total-sales');
    const revDisplay = document.getElementById('history-total-revenue');
    const dashRevDisplay = document.getElementById('dash-total-revenue');

    if (salesDisplay) salesDisplay.innerText = formatMoney(totalSales);
    if (revDisplay) revDisplay.innerText = formatMoney(lifetimeRevenue);
    if (dashRevDisplay) dashRevDisplay.innerText = formatMoney(lifetimeRevenue);
}

function cleanupChatListeners() {
    if (typeof unsubscribeChatThreads === 'function') {
        unsubscribeChatThreads();
        unsubscribeChatThreads = null;
    }
    if (typeof unsubscribeChatMessages === 'function') {
        unsubscribeChatMessages();
        unsubscribeChatMessages = null;
    }
}

function cleanupIncomingOrdersListener() {
    if (typeof unsubscribeIncomingOrders === 'function') {
        unsubscribeIncomingOrders();
        unsubscribeIncomingOrders = null;
    }
}

function cleanupVendorDataListener() {
    if (typeof unsubscribeVendorProducts === 'function') {
        unsubscribeVendorProducts();
        unsubscribeVendorProducts = null;
    }
}

function cleanupReviewsListeners() {
    if (typeof unsubscribeProductReviews === 'function') {
        unsubscribeProductReviews();
        unsubscribeProductReviews = null;
    }
    if (typeof unsubscribeSellerReputation === 'function') {
        unsubscribeSellerReputation();
        unsubscribeSellerReputation = null;
    }
}

function cleanupSalesHistoryListeners() {
    if (typeof unsubscribeOfficialSalesHistory === 'function') {
        unsubscribeOfficialSalesHistory();
        unsubscribeOfficialSalesHistory = null;
    }
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (typeof value === 'number') return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatRelativeTime(value) {
    const ms = toMillis(value);
    if (!ms) return 'Just now';

    const diff = Date.now() - ms;
    const minute = 60000;
    const hour = 3600000;
    const day = 86400000;

    if (diff < minute) return 'Just now';
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;

    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatConversationDate(value) {
    const ms = toMillis(value);
    if (!ms) return '---';
    return new Date(ms).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getInitials(name) {
    const safeName = (name || 'Customer').trim();
    return safeName.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function formatRating(value) {
    const rating = Number(value || 0);
    return rating > 0 ? rating.toFixed(1) : '0.0';
}

function getReviewStars(rating) {
    const safeRating = Math.max(0, Math.min(5, Number(rating || 0)));
    const filled = Math.round(safeRating);
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

function getOrderBuyerName(order) {
    return order.buyerName || order.customerInfo?.fullName || 'Unknown Buyer';
}

function getOrderBuyerEmail(order) {
    return order.buyerEmail || order.customerInfo?.studentEmail || 'No email provided';
}

function getOrderContactNumber(order) {
    return order.customerInfo?.contactNumber || 'No contact number';
}

function getOrderSchoolLevel(order) {
    return order.customerInfo?.schoolLevel || 'Not specified';
}

function getOrderNotes(order) {
    return order.notes || 'No notes provided.';
}

function getOrderItemSummary(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) {
        const fallbackName = order.itemName || order.productName || 'Unnamed item';
        return { label: fallbackName, quantity: 1 };
    }

    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || items.length;
    const firstItem = items[0]?.name || order.itemName || order.productName || 'Unnamed item';
    const extraCount = items.length - 1;
    const label = extraCount > 0 ? `${firstItem} +${extraCount} more` : firstItem;
    return { label, quantity: totalQuantity };
}

function getIncomingOrderStatusConfig(status) {
    const normalized = status || 'pending_verification';
    const configs = {
        pending_verification: {
            label: 'Pending Verification',
            badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
        },
        confirmed: {
            label: 'Confirmed',
            badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
        },
        rejected: {
            label: 'Rejected',
            badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
        },
        completed: {
            label: 'Completed',
            badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        },
        cancelled: {
            label: 'Cancelled',
            badgeClass: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
        }
    };

    return configs[normalized] || {
        label: normalized.replace(/_/g, ' '),
        badgeClass: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
    };
}

function getAllowedIncomingOrderTransitions(currentStatus) {
    const transitions = {
        pending_verification: ['confirmed', 'rejected', 'cancelled'],
        confirmed: ['completed'],
        rejected: [],
        completed: [],
        cancelled: []
    };
    return transitions[currentStatus || 'pending_verification'] || [];
}

function canTransitionIncomingOrder(currentStatus, nextStatus) {
    return getAllowedIncomingOrderTransitions(currentStatus).includes(nextStatus);
}

function getReceiptStatusConfig(order) {
    if (order?.receiptSent === true) {
        return {
            label: 'Receipt Sent',
            detail: order.receiptSentAt ? `Sent ${formatTimestamp(order.receiptSentAt)}` : 'Email receipt delivered',
            badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        };
    }

    if (order?.receiptError) {
        return {
            label: 'Receipt Failed',
            detail: String(order.receiptError),
            badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
        };
    }

    if (order?.status === 'completed') {
        return {
            label: 'Receipt Pending',
            detail: 'Order is completed but no receipt confirmation has been saved yet.',
            badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
        };
    }

    return {
        label: 'Not Ready',
        detail: 'Receipt will trigger after the order reaches completed status.',
        badgeClass: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
    };
}

function normalizeRole(value) {
    return String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
}

function buildUserAvatar(user) {
    return user.avatarUrl || user.profileImage || user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=852221&color=fff`;
}

function getThreadRecipientId(thread) {
    if (!thread) return '';
    if (thread.participantId) return thread.participantId;
    const participantIds = Array.isArray(thread.raw?.participantIds) ? thread.raw.participantIds : [];
    return participantIds.find(id => id && id !== auth.currentUser?.uid) || '';
}

function getConversationParticipant(data, currentUid) {
    const participants = Array.isArray(data.participants) ? data.participants : [];
    const otherObject = participants.find(participant => {
        if (!participant || typeof participant !== 'object') return false;
        const id = participant.uid || participant.id || participant.userId || participant.participantId;
        return id && id !== currentUid;
    });

    if (otherObject) {
        return {
            id: otherObject.uid || otherObject.id || otherObject.userId || otherObject.participantId || '',
            name: otherObject.name || otherObject.displayName || otherObject.fullName || otherObject.participantName || 'Customer',
            avatar: otherObject.avatarUrl || otherObject.avatar || otherObject.photoURL || otherObject.profileImage || ''
        };
    }

    const participantIds = Array.isArray(data.participantIds) ? data.participantIds : [];
    const otherId = participantIds.find(id => id && id !== currentUid) || data.participantId || data.customerId || data.userId || '';
    const participantNames = data.participantNames && typeof data.participantNames === 'object' ? data.participantNames : {};
    const participantDetails = data.participantDetails && typeof data.participantDetails === 'object' ? data.participantDetails : {};
    const participantAvatars = data.participantAvatars && typeof data.participantAvatars === 'object' ? data.participantAvatars : {};

    return {
        id: otherId,
        name: participantNames[otherId] || participantDetails[otherId]?.name || data.participantName || data.customerName || data.studentName || data.userName || 'Customer',
        avatar: participantDetails[otherId]?.profilePic || participantDetails[otherId]?.avatarUrl || participantAvatars[otherId] || data.participantAvatar || data.customerAvatar || data.profileImage || ''
    };
}

function normalizeConversation(doc, currentUid) {
    const data = doc.data() || {};
    const participant = getConversationParticipant(data, currentUid);
    const unreadMap = data.unreadCounts && typeof data.unreadCounts === 'object' ? data.unreadCounts : {};

    return {
        id: doc.id,
        raw: data,
        participantId: participant.id,
        participantName: participant.name,
        participantAvatar: participant.avatar,
        lastMessage: data.lastMessage || data.lastText || data.recentMessage || data.message || 'No messages yet',
        lastMessageTime: toMillis(data.lastMessageTime || data.updatedAt || data.timestamp || data.createdAt),
        unreadCount: Number(
            unreadMap[currentUid] ??
            data.vendorUnreadCount ??
            data.sellerUnreadCount ??
            data.staffUnreadCount ??
            data.unreadCount ??
            0
        ),
        status: data.status || 'Open'
    };
}

function normalizeMessage(doc) {
    const data = typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        id: doc.id || `${toMillis(data.createdAt || data.timestamp || data.sentAt)}-${Math.random().toString(36).slice(2, 8)}`,
        text: data.text || data.message || data.content || data.body || '',
        senderId: data.senderId || data.userId || data.fromId || data.uid || data.authorId || '',
        senderName: data.senderName || data.userName || data.name || data.authorName || 'Customer',
        timestamp: toMillis(data.createdAt || data.timestamp || data.sentAt || data.lastMessageTime),
        avatar: data.senderAvatar || data.avatarUrl || data.profileImage || ''
    };
}

function renderInboxThreads() {
    const list = document.getElementById('inbox-thread-list');
    if (!list) return;

    if (globalFilteredChatThreads.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center px-6 py-16 text-center text-gray-400">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-gray-400 dark:bg-white/5">
                    <i data-lucide="inbox" class="h-7 w-7"></i>
                </div>
                <p class="text-sm font-semibold text-slate-500 dark:text-gray-300">No conversations found.</p>
                <p class="mt-1 text-xs">Chats from <span class="font-bold">chat_logs</span> will appear here.</p>
            </div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    list.innerHTML = globalFilteredChatThreads.map(thread => {
        const isActive = globalActiveChatThread?.id === thread.id;
        const avatar = thread.participantAvatar
            ? `<img src="${escapeHtml(thread.participantAvatar)}" class="h-12 w-12 rounded-2xl object-cover shadow-sm" alt="${escapeHtml(thread.participantName)}">`
            : `<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-primary dark:bg-white/5">${escapeHtml(getInitials(thread.participantName))}</div>`;

        return `
            <button onclick="selectInboxConversation('${thread.id}')" class="flex w-full items-start gap-4 px-5 py-4 text-left transition ${isActive ? 'bg-primary/5 dark:bg-primary/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'}">
                ${avatar}
                <div class="min-w-0 flex-1">
                    <div class="mb-1 flex items-center justify-between gap-3">
                        <p class="truncate text-sm font-black ${isActive ? 'text-primary dark:text-red-300' : 'text-slate-700 dark:text-white'}">${escapeHtml(thread.participantName)}</p>
                        <span class="shrink-0 text-[11px] font-semibold text-gray-400">${escapeHtml(formatRelativeTime(thread.lastMessageTime))}</span>
                    </div>
                    <p class="truncate text-xs ${thread.unreadCount > 0 ? 'font-bold text-slate-700 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}">${escapeHtml(thread.lastMessage)}</p>
                </div>
                ${thread.unreadCount > 0 ? `<span class="mt-1 inline-flex min-w-[24px] items-center justify-center rounded-full bg-primary px-2 py-1 text-[10px] font-black text-white">${thread.unreadCount}</span>` : ''}
            </button>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function renderNewMessageResults() {
    const results = document.getElementById('new-message-results');
    if (!results) return;

    if (globalFilteredChatUsers.length === 0) {
        results.innerHTML = `
            <div class="flex flex-col items-center justify-center px-6 py-12 text-center text-gray-400">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                    <i data-lucide="users" class="h-7 w-7"></i>
                </div>
                <p class="text-sm font-semibold text-slate-500 dark:text-gray-300">No users found.</p>
                <p class="mt-1 text-xs">Try another name or email.</p>
            </div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    results.innerHTML = globalFilteredChatUsers.map(user => `
        <button onclick="startConversationWithUser('${user.uid}')" class="flex w-full items-center gap-4 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-white dark:border-white/5 dark:hover:bg-white/5">
            <img src="${escapeHtml(user.avatar)}" class="h-12 w-12 rounded-2xl object-cover shadow-sm" alt="${escapeHtml(user.name)}">
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-black text-slate-700 dark:text-white">${escapeHtml(user.name)}</p>
                <p class="truncate text-xs text-gray-500 dark:text-gray-400">${escapeHtml(user.email || 'No email available')}</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:bg-white/10 dark:text-gray-300">${escapeHtml(user.role || 'User')}</span>
        </button>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

function applyNewMessageSearch() {
    const input = document.getElementById('new-message-search');
    const query = (input?.value || '').trim().toLowerCase();

    globalFilteredChatUsers = globalChatUsers.filter(user => {
        if (!query) return true;
        return (user.name || '').toLowerCase().includes(query) ||
               (user.email || '').toLowerCase().includes(query);
    });

    renderNewMessageResults();
}

async function loadChatUsers() {
    const currentUid = auth.currentUser?.uid;
    const results = document.getElementById('new-message-results');
    if (!currentUid || !results) return;

    results.innerHTML = `<div class="p-8 text-center text-gray-400 italic">Loading users...</div>`;

    try {
        const snapshot = await db.collection('users').get();
        globalChatUsers = snapshot.docs
            .map(doc => ({ uid: doc.id, ...(doc.data() || {}) }))
            .filter(user => user.uid !== currentUid)
            .map(user => {
                const role = normalizeRole(user.userType || user.type || '');
                return {
                    uid: user.uid,
                    name: user.name || user.fullName || user.displayName || user.email || 'Unknown User',
                    email: user.email || '',
                    role: role || 'USER',
                    avatar: buildUserAvatar(user)
                };
            })
            .filter(user => user.role !== 'ADMIN' && user.role !== 'SUPER ADMIN' && user.role !== 'SUPERADMIN')
            .sort((a, b) => a.name.localeCompare(b.name));

        globalFilteredChatUsers = [...globalChatUsers];
        renderNewMessageResults();
    } catch (e) {
        results.innerHTML = `<div class="p-8 text-center text-red-500 italic">Failed to load users.</div>`;
        console.error('Failed to load chat user list:', e);
    }
}

function renderInboxMessages() {
    const emptyState = document.getElementById('inbox-chat-empty');
    const shell = document.getElementById('inbox-chat-shell');
    const list = document.getElementById('inbox-message-list');
    const input = document.getElementById('inbox-message-input');
    const sendBtn = document.getElementById('inbox-send-btn');

    if (!emptyState || !shell || !list || !input || !sendBtn) return;

    if (!globalActiveChatThread) {
        emptyState.classList.remove('hidden');
        shell.classList.add('hidden');
        input.disabled = true;
        sendBtn.disabled = true;
        return;
    }

    emptyState.classList.add('hidden');
    shell.classList.remove('hidden');
    input.disabled = false;
    sendBtn.disabled = false;

    const avatarEl = document.getElementById('inbox-chat-avatar');
    const nameEl = document.getElementById('inbox-chat-name');
    const metaEl = document.getElementById('inbox-chat-meta');
    const timeEl = document.getElementById('inbox-chat-time');

    if (avatarEl) {
        avatarEl.innerHTML = globalActiveChatThread.participantAvatar
            ? `<img src="${escapeHtml(globalActiveChatThread.participantAvatar)}" class="h-full w-full rounded-2xl object-cover" alt="${escapeHtml(globalActiveChatThread.participantName)}">`
            : escapeHtml(getInitials(globalActiveChatThread.participantName));
    }
    if (nameEl) nameEl.innerText = globalActiveChatThread.participantName || 'Customer';
    if (metaEl) metaEl.innerText = `${globalActiveChatThread.status || 'Open'} Conversation`;
    if (timeEl) timeEl.innerText = formatConversationDate(globalActiveChatThread.lastMessageTime);

    if (globalActiveChatMessages.length === 0) {
        list.innerHTML = `
            <div class="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center text-gray-400">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                    <i data-lucide="message-circle" class="h-7 w-7"></i>
                </div>
                <p class="text-sm font-semibold text-slate-500 dark:text-gray-300">No messages yet.</p>
                <p class="mt-1 text-xs">Send the first reply to start this thread.</p>
            </div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const currentUid = auth.currentUser?.uid || '';
    list.innerHTML = globalActiveChatMessages.map(message => {
        const mine = message.senderId === currentUid;
        const bubbleClass = mine
            ? 'bg-primary text-white rounded-br-md'
            : 'bg-white text-slate-700 rounded-bl-md border border-gray-200 dark:bg-white/5 dark:text-gray-100 dark:border-white/10';

        return `
            <div class="flex ${mine ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[78%]">
                    <div class="rounded-3xl px-4 py-3 shadow-sm ${bubbleClass}">
                        <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">${escapeHtml(message.text)}</p>
                    </div>
                    <div class="mt-1 px-2 text-[11px] ${mine ? 'text-right text-slate-400' : 'text-left text-slate-400'}">
                        ${escapeHtml(message.senderName || (mine ? 'You' : globalActiveChatThread.participantName))} • ${escapeHtml(formatConversationDate(message.timestamp))}
                    </div>
                </div>
            </div>`;
    }).join('');

    list.scrollTop = list.scrollHeight;
}

function applyInboxSearch() {
    const searchInput = document.getElementById('inbox-search');
    const query = (searchInput?.value || '').trim().toLowerCase();

    globalFilteredChatThreads = globalChatThreads.filter(thread => {
        if (!query) return true;
        return (thread.participantName || '').toLowerCase().includes(query) ||
               (thread.lastMessage || '').toLowerCase().includes(query);
    });

    renderInboxThreads();
}

function subscribeToChatThreadsWithFallback(vendorUid, attempts) {
    const snapshotsByAttempt = new Map();

    const rebuildThreads = () => {
        const merged = new Map();

        snapshotsByAttempt.forEach(docs => {
            docs.forEach(doc => {
                merged.set(doc.id, normalizeConversation(doc, vendorUid));
            });
        });

        globalChatThreads = Array.from(merged.values()).sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        applyInboxSearch();

        if (globalActiveChatThread) {
            const fresh = globalChatThreads.find(thread => thread.id === globalActiveChatThread.id);
            if (fresh) {
                globalActiveChatThread = fresh;
                renderInboxMessages();
            } else {
                globalActiveChatThread = null;
                globalActiveChatMessages = [];
                renderInboxMessages();
            }
        }
    };

    const unsubscribers = attempts.map((createQuery, index) => createQuery().onSnapshot(snapshot => {
        snapshotsByAttempt.set(index, snapshot.docs);
        rebuildThreads();
    }, error => {
        console.warn(`chat_logs listener attempt ${index + 1} failed:`, error);
        snapshotsByAttempt.set(index, []);
        rebuildThreads();
    }));

    unsubscribeChatThreads = () => {
        unsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') unsubscribe();
        });
    };
}

function markConversationRead(thread) {
    if (!thread || !auth.currentUser) return;

    const updates = {};
    const currentUid = auth.currentUser.uid;

    if (thread.raw?.unreadCounts && typeof thread.raw.unreadCounts === 'object') {
        updates[`unreadCounts.${currentUid}`] = 0;
    } else if (typeof thread.raw?.vendorUnreadCount === 'number') {
        updates.vendorUnreadCount = 0;
    } else if (typeof thread.raw?.sellerUnreadCount === 'number') {
        updates.sellerUnreadCount = 0;
    } else if (typeof thread.raw?.staffUnreadCount === 'number') {
        updates.staffUnreadCount = 0;
    }

    if (Object.keys(updates).length === 0) return;
    db.collection('chat_logs').doc(thread.id).set(updates, { merge: true }).catch(err => {
        console.warn('Failed to mark conversation as read:', err);
    });
}

function subscribeToActiveChatMessages(threadId) {
    if (typeof unsubscribeChatMessages === 'function') {
        unsubscribeChatMessages();
        unsubscribeChatMessages = null;
    }

    globalActiveChatMessages = [];
    renderInboxMessages();

    unsubscribeChatMessages = db.collection('chat_logs')
        .doc(threadId)
        .collection('messages')
        .onSnapshot(snapshot => {
            if (snapshot.empty) {
                const fallbackThread = globalChatThreads.find(thread => thread.id === threadId);
                const embedded = Array.isArray(fallbackThread?.raw?.messages) ? fallbackThread.raw.messages : [];
                globalActiveChatMessages = embedded.map(message => normalizeMessage(message)).sort((a, b) => a.timestamp - b.timestamp);
            } else {
                globalActiveChatMessages = snapshot.docs.map(doc => normalizeMessage(doc)).sort((a, b) => a.timestamp - b.timestamp);
            }
            renderInboxMessages();
        }, error => {
            console.warn('Falling back to embedded message array for thread:', threadId, error);
            const fallbackThread = globalChatThreads.find(thread => thread.id === threadId);
            const embedded = Array.isArray(fallbackThread?.raw?.messages) ? fallbackThread.raw.messages : [];
            globalActiveChatMessages = embedded.map(message => normalizeMessage(message)).sort((a, b) => a.timestamp - b.timestamp);
            renderInboxMessages();
        });
}

function initChatInboxListener(vendorUid) {
    cleanupChatListeners();
    globalChatThreads = [];
    globalFilteredChatThreads = [];
    globalActiveChatThread = null;
    globalActiveChatMessages = [];
    globalChatUsers = [];
    globalFilteredChatUsers = [];
    renderInboxThreads();
    renderInboxMessages();

    const attempts = [
        () => db.collection('chat_logs').where('participantIds', 'array-contains', vendorUid),
        () => db.collection('chat_logs').where('participants', 'array-contains', vendorUid),
        () => db.collection('chat_logs').where('vendorId', '==', vendorUid),
        () => db.collection('chat_logs').where('sellerId', '==', vendorUid),
        () => db.collection('chat_logs').where('staffId', '==', vendorUid)
    ];

    subscribeToChatThreadsWithFallback(vendorUid, attempts);
}

window.openNewMessageModal = function() {
    openModal('newMessageModal');

    const input = document.getElementById('new-message-search');
    if (input) input.value = '';

    if (globalChatUsers.length > 0) {
        globalFilteredChatUsers = [...globalChatUsers];
        renderNewMessageResults();
    } else {
        loadChatUsers();
    }
};

window.startConversationWithUser = async function(targetUid) {
    if (!auth.currentUser) return;

    const targetUser = globalChatUsers.find(user => user.uid === targetUid);
    if (!targetUser) return;

    const existingThread = globalChatThreads.find(thread => {
        const recipientId = getThreadRecipientId(thread);
        return recipientId === targetUid || (Array.isArray(thread.raw?.participantIds) && thread.raw.participantIds.includes(targetUid));
    });

    if (existingThread) {
        closeModal('newMessageModal');
        selectInboxConversation(existingThread.id);
        return;
    }

    try {
        const currentUid = auth.currentUser.uid;
        const currentName = currentUserData?.name || currentVendorName || 'Vendor';
        const currentAvatar = currentUserData?.avatarUrl || buildUserAvatar({ name: currentName });
        const chatRef = db.collection('chat_logs').doc();
        const now = firebase.firestore.FieldValue.serverTimestamp();

        await chatRef.set({
            participantIds: [currentUid, targetUid],
            participantNames: {
                [currentUid]: currentName,
                [targetUid]: targetUser.name
            },
            participantDetails: {
                [currentUid]: {
                    uid: currentUid,
                    name: currentName,
                    profilePic: currentAvatar,
                    role: normalizeRole(currentUserData?.userType || currentUserData?.type || 'SELLER')
                },
                [targetUid]: {
                    uid: targetUid,
                    name: targetUser.name,
                    profilePic: targetUser.avatar,
                    role: targetUser.role
                }
            },
            participantAvatars: {
                [currentUid]: currentAvatar,
                [targetUid]: targetUser.avatar
            },
            lastMessage: '',
            lastMessageTime: now,
            unreadCounts: {
                [currentUid]: 0,
                [targetUid]: 0
            },
            status: 'Open',
            createdAt: now,
            updatedAt: now
        }, { merge: true });

        closeModal('newMessageModal');
        globalActiveChatThread = {
            id: chatRef.id,
            participantId: targetUid,
            participantName: targetUser.name,
            participantAvatar: targetUser.avatar,
            lastMessage: 'No messages yet',
            lastMessageTime: Date.now(),
            unreadCount: 0,
            status: 'Open',
            raw: {
                participantIds: [currentUid, targetUid],
                participantNames: {
                    [currentUid]: currentName,
                    [targetUid]: targetUser.name
                }
            }
        };
        renderInboxMessages();
        if (document.getElementById('view-inbox') && !document.getElementById('view-inbox').classList.contains('hidden')) {
            subscribeToActiveChatMessages(chatRef.id);
        }
    } catch (e) {
        alert('Failed to start conversation: ' + e.message);
    }
};

window.selectInboxConversation = function(threadId) {
    const thread = globalChatThreads.find(item => item.id === threadId);
    if (!thread) return;

    globalActiveChatThread = thread;
    renderInboxThreads();
    renderInboxMessages();
    markConversationRead(thread);
    subscribeToActiveChatMessages(thread.id);
};

window.sendChatMessage = async function() {
    const input = document.getElementById('inbox-message-input');
    const sendBtn = document.getElementById('inbox-send-btn');
    const text = (input?.value || '').trim();

    if (!auth.currentUser || !globalActiveChatThread || !text || !input || !sendBtn) return;

    sendBtn.disabled = true;

    try {
        const currentUid = auth.currentUser.uid;
        const currentName = currentUserData?.name || currentVendorName || 'Vendor';
        const currentAvatar = currentUserData?.avatarUrl || '';
        const threadRef = db.collection('chat_logs').doc(globalActiveChatThread.id);
        const now = firebase.firestore.FieldValue.serverTimestamp();

        await threadRef.collection('messages').add({
            text,
            message: text,
            senderId: currentUid,
            senderName: currentName,
            senderAvatar: currentAvatar,
            createdAt: now,
            timestamp: now
        });

        const parentUpdate = {
            lastMessage: text,
            lastMessageTime: now,
            updatedAt: now,
            lastSenderId: currentUid
        };

        if (globalActiveChatThread.participantId) {
            parentUpdate.participantIds = firebase.firestore.FieldValue.arrayUnion(currentUid, globalActiveChatThread.participantId);
            parentUpdate[`unreadCounts.${globalActiveChatThread.participantId}`] = firebase.firestore.FieldValue.increment(1);
            parentUpdate[`unreadCounts.${currentUid}`] = 0;
        }

        await threadRef.set(parentUpdate, { merge: true });
        input.value = '';
    } catch (e) {
        alert('Failed to send message: ' + e.message);
    } finally {
        sendBtn.disabled = false;
    }
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };
window.handleLogout = function() { auth.signOut().then(() => window.location.reload()); };

window.toggleProfileDropdown = function() {
    const dropdown = document.getElementById('profileDropdown');
    if(dropdown) {
        dropdown.classList.toggle('hidden');
    }
};

window.closeProfileDropdown = function() {
    const dropdown = document.getElementById('profileDropdown');
    if(dropdown) {
        dropdown.classList.add('hidden');
    }
};

window.openMyProfile = function() {
    switchView('profile');
    closeProfileDropdown();
    if (auth.currentUser) {
        loadProfileData(auth.currentUser.uid);
    }
};

window.loadProfileData = async function(uid) {
    try {
        const userDoc = await db.collection(currentUserCollection).doc(uid).get();
        if(!userDoc.exists) return;
        
        const userData = userDoc.data();
        currentUserData = { ...currentUserData, ...userData };
        
        // Update avatar
        const avatar = currentUserData.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserData.name || 'Vendor')}&background=852221&color=fff`;
        document.getElementById('profile-avatar').src = avatar;
        
        // Update form fields
        const authEmail = auth.currentUser?.email || '';
        const effectiveEmail = userData.email || authEmail;
        const username = effectiveEmail ? effectiveEmail.split('@')[0] : '---';
        document.getElementById('profile-username').innerText = username;
        document.getElementById('profile-name-input').value = userData.name || '';
        
        // Mask and display email
        const email = effectiveEmail;
        const maskedEmail = maskEmail(email);
        document.getElementById('profile-email-display').innerText = maskedEmail;
        
        // Mask and display phone
        const phone = userData.phone || '';
        const maskedPhone = maskPhone(phone);
        document.getElementById('profile-phone-display').innerText = maskedPhone;
        
        // Join date
        const joinDate = userData.createdAt ? new Date(userData.createdAt.toDate()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "---";
        document.getElementById('profile-join-date').innerText = joinDate;
        
        // Update settings account type if element exists
        const accountTypeEl = document.getElementById('account-type');
        if(accountTypeEl) {
            accountTypeEl.innerText = userData.userType || "Authorized Seller";
        }

        updateVendorUI(currentUserData);
        
    } catch (e) {
        console.error("Error loading profile:", e);
    }
};

window.maskEmail = function(email) {
    if(!email) return '---';
    const [local, domain] = email.split('@');
    const maskedLocal = local.substring(0, 2) + '*'.repeat(Math.max(0, local.length - 4)) + local.substring(local.length - 2);
    return `${maskedLocal}@${domain}`;
};

window.maskPhone = function(phone) {
    if(!phone) return '---';
    const lastDigits = phone.slice(-2);
    const masked = '*'.repeat(Math.max(0, phone.length - 2)) + lastDigits;
    return masked;
};

window.openChangeEmailModal = function() {
    openModal('changeEmailModal');
};

window.openChangePhoneModal = function() {
    openModal('changePhoneModal');
};

window.handleChangeEmail = async function() {
    const password = document.getElementById('email-verify-password').value;
    const newEmail = document.getElementById('new-email').value;
    
    if(!password || !newEmail) {
        alert("Please fill all fields!");
        return;
    }
    
    try {
        // Re-authenticate user
        const email = auth.currentUser.email;
        const credential = firebase.auth.EmailAuthProvider.credential(email, password);
        await auth.currentUser.reauthenticateWithCredential(credential);
        
        // Update email
        await auth.currentUser.updateEmail(newEmail);
        
        // Update in Firestore
        await db.collection(currentUserCollection).doc(auth.currentUser.uid).update({
            email: newEmail
        });
        
        alert("Email updated successfully!");
        closeModal('changeEmailModal');
        currentUserData = { ...currentUserData, email: newEmail };
        loadProfileData(auth.currentUser.uid);
        
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.handleChangePhone = async function() {
    const newPhone = document.getElementById('new-phone').value;
    
    if(!newPhone) {
        alert("Please enter a phone number!");
        return;
    }
    
    try {
        await db.collection(currentUserCollection).doc(auth.currentUser.uid).update({
            phone: newPhone
        });
        
        alert("Phone number updated successfully!");
        closeModal('changePhoneModal');
        currentUserData = { ...currentUserData, phone: newPhone };
        loadProfileData(auth.currentUser.uid);
        
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.saveProfileChanges = async function() {
    const name = document.getElementById('profile-name-input').value;
    
    if(!name.trim()) {
        alert("Please enter a name!");
        return;
    }
    
    try {
        await db.collection(currentUserCollection).doc(auth.currentUser.uid).update({
            name: name.trim()
        });
        
        currentUserData = { ...currentUserData, name: name.trim() };
        updateVendorUI(currentUserData);
        alert("Profile updated successfully!");
        
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.uploadAvatar = async function(file) {
    if(!file || !auth.currentUser) return;
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "e-marketplace");
        
        const res = await fetch(`https://api.cloudinary.com/v1_1/dokaqnqg6/image/upload`, { method: "POST", body: formData });
        const cloudData = await res.json();
        
        // Update user avatar URL in Firestore
        await db.collection(currentUserCollection).doc(auth.currentUser.uid).update({
            avatarUrl: cloudData.secure_url
        });
        
        currentUserData = { ...currentUserData, avatarUrl: cloudData.secure_url };
        updateVendorUI(currentUserData);
        alert("Profile picture updated successfully!");
        
    } catch (e) {
        alert("Error uploading image: " + e.message);
    }
};

window.handleChangePassword = async function() {
    const currentPass = document.getElementById('current-password').value;
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-password').value;
    
    if(newPass !== confirmPass) {
        alert("Passwords do not match!");
        return;
    }
    
    if(newPass.length < 6) {
        alert("Password must be at least 6 characters!");
        return;
    }
    
    try {
        // Re-authenticate user
        const email = auth.currentUser.email;
        const credential = firebase.auth.EmailAuthProvider.credential(email, currentPass);
        await auth.currentUser.reauthenticateWithCredential(credential);
        
        // Update password
        await auth.currentUser.updatePassword(newPass);
        alert("Password changed successfully!");
        
        // Clear form
        document.getElementById('current-password').value = "";
        document.getElementById('new-password').value = "";
        document.getElementById('confirm-password').value = "";
        
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.toggle2FA = function() {
    alert("Two-Factor Authentication setup coming soon!");
};

window.toggleTheme = function() {
    const html = document.documentElement;
    html.classList.toggle('dark');
    localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    const icon = document.getElementById('theme-icon');
    if(icon) icon.setAttribute('data-lucide', html.classList.contains('dark') ? 'sun' : 'moon');
    if(window.lucide) lucide.createIcons();
};

// ==========================================
// 4. INVENTORY DATA LOGIC
// ==========================================
function initVendorData(vendorUid) {
    cleanupVendorDataListener();
    unsubscribeVendorProducts = db.collection('Vendor-product').doc(vendorUid).collection('listings').onSnapshot(snap => {
        globalProducts = [];
        snap.forEach(doc => { globalProducts.push({ id: doc.id, ...doc.data() }); });
        globalProducts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderVendorProducts();
        updateVendorStats();
    });
}

function renderVendorProducts() {
    const dashTable = document.querySelector('#productsTable tbody');
    const invTable = document.getElementById('tbody-all-items');
    if (dashTable) dashTable.innerHTML = '';
    if (invTable) invTable.innerHTML = '';

    if (globalProducts.length === 0) {
        const empty = `<tr><td colspan="7" class="py-10 text-center text-gray-400 italic">No products listed yet.</td></tr>`;
        if (dashTable) dashTable.innerHTML = empty;
        if (invTable) invTable.innerHTML = empty;
        return;
    }

    globalProducts.forEach(p => {
        const name = p.Product || 'Unnamed Item';
        const status = p.Status || 'Pending';
        const price = p.Price || 0;
        const stock = p.Stock || 0;
        const departmentTag = p.DepartmentTag || 'All Departments';
        
        // Dashboard Row
        if (dashTable) {
            const barColor = stock < 5 ? 'bg-red-500' : 'bg-green-500';
            dashTable.innerHTML += `
            <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-all border-b dark:border-dark-border">
                <td class="px-8 py-5 flex items-center gap-4">
                    <img src="${p.Image}" class="w-12 h-12 rounded-xl object-cover shadow-sm">
                    <div><p class="font-bold text-slate-700 dark:text-white">${name}</p><p class="text-[10px] text-gray-400 uppercase font-mono">${p.Category}</p></div>
                </td>
                <td class="px-8 py-5"><div class="flex items-center gap-2"><div class="w-24 bg-gray-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden"><div class="h-full ${barColor}" style="width: ${Math.min(stock, 100)}%"></div></div><span class="font-bold">${stock}</span></div></td>
                <td class="px-8 py-5 text-right"><span class="px-3 py-1 rounded-lg text-[10px] font-black uppercase ${status === 'In Stock' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}">${status}</span></td>
            </tr>`;
        }

        // Inventory Tab Row
        if (invTable) {
            invTable.innerHTML += `
            <tr class="hover:bg-gray-50 dark:hover:bg-white/5 border-b dark:border-dark-border">
                <td class="px-6 py-4 flex items-center gap-4">
                    <img src="${p.Image}" class="w-12 h-12 rounded-xl object-cover shadow-sm">
                    <div><p class="font-bold text-slate-700 dark:text-white">${name}</p><p class="text-[10px] text-gray-400 uppercase font-mono">${p.Category}</p></div>
                </td>
                <td class="px-6 py-4 text-gray-500">${p.Category}</td>
                <td class="px-6 py-4 text-gray-500">${departmentTag}</td>
                <td class="px-6 py-4 font-black">₱${price.toLocaleString()}</td>
                <td class="px-6 py-4 font-mono">${stock}</td>
                <td class="px-6 py-4 text-right"><span class="text-[10px] font-black uppercase ${status === 'In Stock' ? 'text-green-500' : 'text-orange-500'}">${status}</span></td>
                <td class="px-6 py-4 text-right">
                    <button class="p-2 hover:text-primary"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
                    <button class="p-2 hover:text-red-500"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>`;
        }
    });
    if(window.lucide) lucide.createIcons();
}

function updateVendorStats() {
    const el = document.getElementById('dash-active-products');
    if(el) el.innerText = globalProducts.length;
}

window.filterProducts = function(searchTerm) {
    const filtered = globalProducts.filter(p => {
        const name = (p.Product || '').toLowerCase();
        const category = (p.Category || '').toLowerCase();
        const search = searchTerm.toLowerCase();
        return name.includes(search) || category.includes(search);
    });
    
    const invTable = document.getElementById('tbody-all-items');
    if (!invTable) return;
    
    if (filtered.length === 0) {
        invTable.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-gray-400 italic">No products found matching your search.</td></tr>`;
        return;
    }
    
    let html = '';
    filtered.forEach(p => {
        const name = p.Product || 'Unnamed Item';
        const status = p.Status || 'Pending';
        const price = p.Price || 0;
        const stock = p.Stock || 0;
        const departmentTag = p.DepartmentTag || 'All Departments';
        
        html += `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 border-b dark:border-dark-border">
            <td class="px-6 py-4 flex items-center gap-4">
                <img src="${p.Image}" class="w-12 h-12 rounded-xl object-cover shadow-sm">
                <div><p class="font-bold text-slate-700 dark:text-white">${name}</p><p class="text-[10px] text-gray-400 uppercase font-mono">${p.Category}</p></div>
            </td>
            <td class="px-6 py-4 text-gray-500">${p.Category}</td>
            <td class="px-6 py-4 text-gray-500">${departmentTag}</td>
            <td class="px-6 py-4 font-black">₱${price.toLocaleString()}</td>
            <td class="px-6 py-4 font-mono">${stock}</td>
            <td class="px-6 py-4 text-right"><span class="text-[10px] font-black uppercase ${status === 'In Stock' ? 'text-green-500' : 'text-orange-500'}">${status}</span></td>
            <td class="px-6 py-4 text-right">
                <button class="p-2 hover:text-primary"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
                <button class="p-2 hover:text-red-500"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </td>
        </tr>`;
    });
    
    invTable.innerHTML = html;
    if(window.lucide) lucide.createIcons();
}

// ==========================================
// 5. PRODUCT SUBMISSION (CRUD)
// ==========================================
window.saveNewProduct = async function() {
    if (!auth.currentUser) return;
    const btn = document.getElementById('saveProductBtn');
    btn.disabled = true; btn.innerHTML = "Processing...";

    try {
        // --- FIX: Get the official name from the users collection first ---
        const userDoc = await db.collection(currentUserCollection).doc(auth.currentUser.uid).get();
        const officialName = userDoc.exists ? userDoc.data().name : (currentVendorName || "Vendor");

        const name = document.getElementById('inp_name').value;
        const departmentTag = document.getElementById('DepartmentTag').value || '';
        const file = document.getElementById('inp_file').files[0];
        let imageUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=852221&color=fff`;
        
        if (file) {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("upload_preset", "e-marketplace");
            const res = await fetch(`https://api.cloudinary.com/v1_1/dokaqnqg6/image/upload`, { method: "POST", body: formData });
            const cloudData = await res.json();
            imageUrl = cloudData.secure_url;
        }

        await db.collection('Vendor-product').doc(auth.currentUser.uid).collection('listings').add({
            Product: name,
            Price: Number(document.getElementById('inp_price').value),
            Stock: Number(document.getElementById('inp_stock').value),
            Category: document.getElementById('inp_category').value,
            DepartmentTag: departmentTag,
            Description: document.getElementById('inp_desc').value,
            Image: imageUrl,
            Status: 'Pending',
            sellerId: auth.currentUser.uid,
            // ADDED THESE TWO LINES TO FIX YOUR ISSUE:
            vendorName: officialName,
            Recipient: officialName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`Product listed successfully for ${officialName}!`);
        closeModal('addItemModal');
        // Manual cleanup
        document.getElementById('inp_name').value = "";
        document.getElementById('inp_price').value = "";
        document.getElementById('inp_stock').value = "";
        document.getElementById('DepartmentTag').value = "";
        document.getElementById('inp_desc').value = "";
        document.getElementById('inp_file').value = "";
        document.getElementById('img-preview').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
    } catch (e) { alert(e.message); } finally { btn.disabled = false; btn.innerText = "Submit"; }
};

window.previewImage = function(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('img-preview').src = e.target.result;
            document.getElementById('img-preview').classList.remove('hidden');
            document.getElementById('upload-placeholder').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
};

// ==========================================
// 6. ORDER MANAGEMENT (Section 7 restored)
// ==========================================
function legacyInitOrderListener(vendorUid) {
    db.collection('Orders').where('vendorId', '==', vendorUid).orderBy('timestamp', 'desc').onSnapshot(snap => {
        const container = document.getElementById('orders-list');
        const orderCountEl = document.getElementById('dash-total-orders');
        if (!container) return;
        if (snap.empty) {
            if (orderCountEl) orderCountEl.innerText = '0';
            container.innerHTML = `<div class="p-10 text-center text-gray-400 italic">No orders yet.</div>`;
            return;
        }

        if(orderCountEl) orderCountEl.innerText = snap.size;

        let html = '';
        snap.forEach(doc => {
            const order = doc.data();
            const id = doc.id;
            let statusClass = order.status === 'Ready' ? "bg-blue-100 text-blue-600" : order.status === 'Claimed' ? "bg-green-100 text-green-600" : "bg-orange-100 text-orange-600";

            html += `
            <div onclick="viewOrderDetails('${id}')" class="bg-white dark:bg-dark-card p-6 rounded-3xl shadow-sm flex justify-between items-center mb-4 border-2 border-transparent hover:border-primary cursor-pointer transition-all">
                <div class="flex gap-4 items-center">
                    <div class="w-12 h-12 bg-slate-50 dark:bg-white/5 rounded-xl flex items-center justify-center text-primary"><i data-lucide="shopping-bag"></i></div>
                    <div><h4 class="font-bold">${order.studentName || 'Guest'}</h4><p class="text-[10px] text-gray-400 font-mono">ID: ${id.substring(0,8)}</p></div>
                </div>
                <div class="flex items-center gap-6">
                    <div class="text-right"><p class="font-black">₱${order.totalAmount}</p><span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusClass}">${order.status}</span></div>
                    <div class="flex gap-2">${legacyRenderActionButton(id, order.status)}</div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    });
}

function legacyRenderActionButton(id, status) {
    if (status === 'Preparing') return `<button onclick="event.stopPropagation(); updateOrderStatus('${id}', 'Ready')" class="bg-red-800 text-white px-4 py-2 rounded-xl text-xs font-bold">Mark Ready</button>`;
    if (status === 'Ready') return `<button onclick="event.stopPropagation(); updateOrderStatus('${id}', 'Claimed')" class="bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Claimed</button>`;
    return `<div class="text-green-500"><i data-lucide="check-circle"></i></div>`;
}

window.legacyUpdateOrderStatus = async function(orderId, newStatus) {
    try {
        const orderRef = db.collection('Orders').doc(orderId);
        const doc = await orderRef.get();
        if (!doc.exists) return;
        
        const updateData = { 
            status: newStatus,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp() 
        };

        if (newStatus === 'Claimed') {
            updateData.claimedAt = firebase.firestore.FieldValue.serverTimestamp();

            // --- NESTED PATH ARCHIVING ---
            // Path: Vendor-product/{vendorUid}/purchased-products/{orderId}
            await db.collection('Vendor-product')
                    .doc(vendorUid)
                    .collection('purchased-products')
                    .doc(orderId) 
                    .set({
                        ...orderData,
                        status: 'Claimed',
                        claimedAt: completionTime,
                        archivedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
            
            console.log("📂 Order archived to vendor sub-folder.");
        }

        // Update the main orders collection
        await orderRef.update(updateData);
        console.log(`✅ Status updated to ${newStatus}`);

    } catch (e) { 
        console.error("❌ Archiving failed:", e);
        alert("Error: " + e.message); 
    }
};

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        const orderRef = db.collection('Orders').doc(orderId);
        const doc = await orderRef.get();
        if (!doc.exists) return;

        const updateData = {
            status: newStatus,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (newStatus === 'Claimed') {
            updateData.claimedAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        await orderRef.update(updateData);
        console.log(`Status updated to ${newStatus}`);
    } catch (e) {
        console.error('Failed to update order status:', e);
        alert(`Error: ${e.message}`);
    }
};

function initIncomingOrdersListener(vendorUid) {
    cleanupIncomingOrdersListener();
    globalIncomingOrders = [];
    globalIncomingOrdersError = '';
    renderIncomingOrders();

    unsubscribeIncomingOrders = db.collection('Orders')
        .where('sellerId', '==', vendorUid)
        .where('sellerType', '==', 'vendor')
        .where('orderChannel', '==', 'official')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            globalIncomingOrdersError = '';
            globalIncomingOrders = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
            renderIncomingOrders();
        }, error => {
            console.error('Failed to load official vendor orders:', error);
            globalIncomingOrders = [];
            globalIncomingOrdersError = error?.message || 'Unable to load incoming checkout requests right now.';
            renderIncomingOrders();
        });
}

function renderIncomingOrderActions(order) {
    const actions = getAllowedIncomingOrderTransitions(order.status);
    if (!actions.length) {
        return `<div class="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <i data-lucide="check-circle-2" class="h-4 w-4"></i>
            Terminal
        </div>`;
    }

    const isUpdating = globalUpdatingOrderIds.has(order.id);
    const buttonStyles = {
        confirmed: 'bg-blue-600 text-white hover:bg-blue-700',
        rejected: 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/25',
        completed: 'bg-emerald-600 text-white hover:bg-emerald-700',
        cancelled: 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20'
    };
    const labels = {
        confirmed: 'Confirm',
        rejected: 'Reject',
        completed: 'Complete',
        cancelled: 'Cancel'
    };

    return actions.map(status => `
        <button
            onclick="event.stopPropagation(); updateIncomingOrderStatus('${order.id}', '${status}')"
            class="rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition ${buttonStyles[status] || 'bg-slate-800 text-white'} ${isUpdating ? 'cursor-not-allowed opacity-60' : ''}"
            ${isUpdating ? 'disabled' : ''}
        >
            ${labels[status] || status}
        </button>
    `).join('');
}

function renderIncomingOrders() {
    const container = document.getElementById('orders-list');
    const orderCountEl = document.getElementById('dash-total-orders');
    if (!container) return;

    if (orderCountEl) {
        orderCountEl.innerText = String(globalIncomingOrders.length);
    }

    if (globalIncomingOrdersError) {
        container.innerHTML = `
            <div class="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900/40 dark:bg-rose-950/20">
                <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-rose-500 shadow-sm dark:bg-white/5">
                    <i data-lucide="alert-triangle" class="h-7 w-7"></i>
                </div>
                <h3 class="text-lg font-black text-rose-700 dark:text-rose-300">Unable to load checkout requests</h3>
                <p class="mt-2 text-sm text-rose-600 dark:text-rose-200">${escapeHtml(globalIncomingOrdersError)}</p>
                <p class="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-400">Check Firestore rules and the required orders index.</p>
            </div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    if (!globalIncomingOrders.length) {
        container.innerHTML = `
            <div class="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-dark-border dark:bg-dark-card">
                <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
                    <i data-lucide="shopping-bag" class="h-8 w-8"></i>
                </div>
                <h3 class="text-xl font-black text-slate-700 dark:text-white">No incoming checkout requests</h3>
                <p class="mt-2 text-sm text-slate-400">Official department and facility orders from <span class="font-bold">orders</span> will appear here in realtime.</p>
            </div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = globalIncomingOrders.map(order => {
        const summary = getOrderItemSummary(order);
        const statusConfig = getIncomingOrderStatusConfig(order.status);
        const receiptConfig = getReceiptStatusConfig(order);

        return `
            <article onclick="viewOrderDetails('${order.id}')" class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-primary hover:shadow-md dark:border-dark-border dark:bg-dark-card">
                <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div class="flex gap-4">
                        <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-primary dark:bg-white/5">
                            <i data-lucide="package-check" class="h-6 w-6"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-3">
                                <h3 class="text-lg font-black text-slate-800 dark:text-white">${escapeHtml(getOrderBuyerName(order))}</h3>
                                <span class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${statusConfig.badgeClass}">${escapeHtml(statusConfig.label)}</span>
                            </div>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-300">${escapeHtml(getOrderBuyerEmail(order))}</p>
                            <div class="mt-3 flex flex-wrap gap-2">
                                <span class="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 dark:bg-white/5 dark:text-slate-300">${escapeHtml(getOrderContactNumber(order))}</span>
                                <span class="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 dark:bg-white/5 dark:text-slate-300">${escapeHtml(getOrderSchoolLevel(order))}</span>
                                <span class="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 dark:bg-white/5 dark:text-slate-300">${escapeHtml(order.paymentMethod || 'Payment not set')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="grid gap-2 text-left xl:min-w-[220px] xl:text-right">
                        <p class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Created</p>
                        <p class="text-sm font-semibold text-slate-600 dark:text-slate-200">${escapeHtml(formatTimestamp(order.createdAt))}</p>
                        <p class="text-sm font-black text-primary">${escapeHtml(formatCurrency(order.total))}</p>
                        <p class="text-xs text-slate-400">Subtotal ${escapeHtml(formatCurrency(order.subtotal))}</p>
                    </div>
                </div>

                <div class="mt-5 grid gap-4 rounded-2xl bg-slate-50 p-4 dark:bg-white/5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div>
                        <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Requested Items</p>
                        <p class="mt-2 text-sm font-bold text-slate-800 dark:text-white">${escapeHtml(summary.label)}</p>
                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-300">Total quantity: ${escapeHtml(summary.quantity)}</p>
                        <p class="mt-3 text-xs text-slate-500 dark:text-slate-300"><span class="font-black uppercase tracking-[0.12em] text-slate-400">Notes</span><br>${escapeHtml(getOrderNotes(order))}</p>
                    </div>
                    <div class="flex flex-col justify-between gap-4">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Order Info</p>
                            <div class="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-300">
                                <p>Department Tag: <span class="font-bold text-slate-700 dark:text-slate-100">${escapeHtml(order.departmentTag || 'Not set')}</span></p>
                                <p>Fulfillment: <span class="font-bold text-slate-700 dark:text-slate-100">${escapeHtml(order.fulfillmentType || 'Department Checkout')}</span></p>
                                <p>Order ID: <span class="font-mono font-bold text-slate-700 dark:text-slate-100">${escapeHtml(order.id.slice(0, 10))}</span></p>
                            </div>
                            <div class="mt-3 rounded-2xl border border-white/10 bg-white/60 px-3 py-3 dark:bg-white/5">
                                <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Receipt Email</p>
                                <div class="mt-2 flex flex-wrap items-center gap-2">
                                    <span class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${receiptConfig.badgeClass}">${escapeHtml(receiptConfig.label)}</span>
                                </div>
                                <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-300">${escapeHtml(receiptConfig.detail)}</p>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 xl:justify-end">
                            ${renderIncomingOrderActions(order)}
                        </div>
                    </div>
                </div>
            </article>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

window.legacyUpdateIncomingOrderStatus = async function(orderId, newStatus) {
    const order = globalIncomingOrders.find(item => item.id === orderId);
    if (!order) {
        alert('Order not found.');
        return;
    }

    if (!canTransitionIncomingOrder(order.status, newStatus)) {
        alert(`Invalid status change from ${order.status || 'unknown'} to ${newStatus}.`);
        return;
    }

    globalUpdatingOrderIds.add(orderId);
    renderIncomingOrders();

    try {
        await db.collection('Orders').doc(orderId).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error('Failed to update incoming order status:', e);
        alert(`Error: ${e.message}`);
    } finally {
        globalUpdatingOrderIds.delete(orderId);
        renderIncomingOrders();
    }
};

function legacyViewOrderDetails(id) {
    return window.viewOrderDetails(id);
    db.collection('Orders').doc(id).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        
        // Basic Info
        document.getElementById('od-student').innerText = data.studentName;
        document.getElementById('od-total').innerText = "₱" + data.totalAmount;
        
        // Mode of Payment Logic
        const mode = data.paymentMode || "Cash";
        const modeText = document.getElementById('od-payment-mode');
        const badge = document.getElementById('od-payment-badge');

        modeText.innerText = mode;

        // Dynamic Styling for the Badge
        if (mode.includes("Gcash")) {
            badge.className = "px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm bg-blue-100 text-blue-600 border border-blue-200";
        } else {
            badge.className = "px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm bg-green-100 text-green-600 border border-green-200";
        }

        const formatTime = (ts) => {
            if (!ts) return "---";
            const date = ts.toDate();
            return date.toLocaleString('en-US', { 
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            });
        };

        // Inject the dates
        document.getElementById('od-date-placed').innerText = formatTime(data.timestamp);
        document.getElementById('od-date-claimed').innerText = formatTime(data.claimedAt);

        // Render Items List
        const list = document.getElementById('od-items-list');
        list.innerHTML = data.items ? data.items.map(i => `
            <div class="flex justify-between text-sm py-2 border-b dark:border-white/5 last:border-0">
                <span class="text-slate-600 dark:text-gray-300">${i.name} <span class="text-[10px] text-gray-400">x${i.qty}</span></span>
                <span class="font-bold text-slate-800 dark:text-white">₱${i.price}</span>
            </div>`).join('') : '';

        openModal('orderDetailsModal');
        if(window.lucide) lucide.createIcons();
    });
};

window.createDemoOrder = async function() {
    if(!auth.currentUser) return;
    await db.collection('Orders').add({
        vendorId: auth.currentUser.uid,
        studentName: "Justin Venedict",
        totalAmount: 750,
        status: "Preparing",
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        items: [{name: "Official SCC Polo", price: 500, qty: 1}, {name: "P.E. Socks", price: 250, qty: 1}]
    });
};

function formatMoney(value) {
    return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTimestamp(ts) {
    if (!ts) return "---";
    const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (Number.isNaN(date.getTime())) return "---";
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getSaleSortTime(sale) {
    return toMillis(sale.claimedAt || sale.updatedAt || sale.createdAt || sale.timestamp);
}

function normalizeOfficialSale(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        source: 'official',
        ...data,
        studentName: data.buyerName || data.customerInfo?.fullName || 'Guest',
        paymentMode: data.paymentMethod || 'Cash',
        totalAmount: Number(data.total || data.subtotal || 0),
        claimedAt: data.updatedAt || data.createdAt
    };
}

function renderSalesHistoryTable() {
    const tbody = document.getElementById('tbody-sales-history');
    if (!tbody) return;

    globalSalesHistory = [...globalOfficialSalesHistory]
        .sort((a, b) => getSaleSortTime(b) - getSaleSortTime(a));

    if (globalSalesHistoryError) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-8 py-10 text-center">
            <div class="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                <p class="text-sm font-black uppercase tracking-[0.18em]">Sales History Query Failed</p>
                <p class="mt-3 text-sm">${escapeHtml(globalSalesHistoryError)}</p>
                <p class="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-rose-400">Open the browser console and use the Firebase index link if one is provided.</p>
            </div>
        </td></tr>`;
        updateSalesSummary(0);
        return;
    }

    if (!globalSalesHistory.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-20 text-center text-gray-400 italic">No completed sales recorded yet.</td></tr>`;
        updateSalesSummary(0);
        return;
    }

    let totalSales = 0;
    let html = '';

    globalSalesHistory.forEach(sale => {
        totalSales += Number(sale.totalAmount || 0);
        const saleDate = sale.claimedAt && typeof sale.claimedAt.toDate === 'function'
            ? sale.claimedAt.toDate()
            : new Date(getSaleSortTime(sale));
        const date = Number.isNaN(saleDate.getTime())
            ? '---'
            : saleDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

        html += `
            <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer" onclick="viewSalesHistoryDetails('${sale.id}')">
                <td class="px-8 py-5 font-mono text-xs text-slate-500">${escapeHtml(date)}</td>
                <td class="px-8 py-5">
                    <p class="font-bold text-slate-700 dark:text-gray-200">${escapeHtml(sale.studentName || 'Guest')}</p>
                    <p class="text-[10px] text-gray-400 uppercase">${escapeHtml(sale.paymentMode || 'Cash')}</p>
                </td>
                <td class="px-8 py-5 text-gray-500 text-xs">
                    ${(Array.isArray(sale.items) ? sale.items.length : 0)} items
                </td>
                <td class="px-8 py-5 text-right font-black text-primary dark:text-orange-400">
                    ${formatMoney(sale.totalAmount)}
                </td>
            </tr>`;
    });

    tbody.innerHTML = html;
    updateSalesSummary(totalSales);
}

function renderReviewsSummary() {
    const average = Number(globalSellerReputation?.averageRating || 0);
    const reviewCount = Number(globalSellerReputation?.reviewCount || globalProductReviews.length || 0);
    const ratingCount = Number(globalSellerReputation?.ratingCount || 0);
    const latestReview = globalProductReviews[0]?.createdAt || globalSellerReputation?.updatedAt;

    const summaryTargets = [
        ['dash-average-rating', formatRating(average)],
        ['reviews-average-rating', formatRating(average)],
        ['reviews-review-count', String(reviewCount)],
        ['reviews-rating-count', String(ratingCount)]
    ];

    summaryTargets.forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    });

    const dashReviewCount = document.getElementById('dash-review-count');
    if (dashReviewCount) {
        dashReviewCount.innerText = `${reviewCount} ${reviewCount === 1 ? 'Review' : 'Reviews'}`;
    }

    const latestReviewEl = document.getElementById('reviews-last-review');
    if (latestReviewEl) {
        latestReviewEl.innerText = latestReview ? formatTimestamp(latestReview) : '---';
    }
}

function renderReviewsList() {
    const container = document.getElementById('reviews-list');
    if (!container) return;

    renderReviewsSummary();

    if (globalReviewsError) {
        container.innerHTML = `
            <div class="p-8 text-center">
                <div class="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                    <p class="text-sm font-black uppercase tracking-[0.18em]">Review Feed Failed</p>
                    <p class="mt-3 text-sm">${escapeHtml(globalReviewsError)}</p>
                    <p class="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-rose-400">Check Firestore indexes for product_reviews and seller_reputation.</p>
                </div>
            </div>`;
        return;
    }

    if (!globalProductReviews.length) {
        container.innerHTML = `<div class="p-10 text-center text-gray-400 italic">No published reviews yet.</div>`;
        return;
    }

    container.innerHTML = globalProductReviews.map(review => `
        <article class="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
                <div class="flex flex-wrap items-center gap-3">
                    <h4 class="text-base font-black text-slate-800 dark:text-white">${escapeHtml(review.productName || 'Unnamed Product')}</h4>
                    <span class="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">${escapeHtml(getReviewStars(review.rating))}</span>
                    <span class="text-sm font-bold text-slate-500 dark:text-slate-300">${escapeHtml(formatRating(review.rating))}</span>
                </div>
                <p class="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-200">${escapeHtml(review.buyerName || 'Buyer')}</p>
                <p class="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-300">${escapeHtml(review.review || 'No written review provided.')}</p>
            </div>
            <div class="rounded-2xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm dark:border-dark-border dark:bg-white/5">
                <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Review Info</p>
                <p class="mt-3 text-slate-600 dark:text-slate-200">Seller: <span class="font-bold">${escapeHtml(review.sellerName || currentVendorName || 'Vendor')}</span></p>
                <p class="mt-1 text-slate-600 dark:text-slate-200">Status: <span class="font-bold">${escapeHtml(review.status || 'published')}</span></p>
                <p class="mt-1 text-slate-600 dark:text-slate-200">Date: <span class="font-bold">${escapeHtml(formatTimestamp(review.createdAt))}</span></p>
            </div>
        </article>
    `).join('');
}

function initReviewsListener(vendorUid) {
    cleanupReviewsListeners();
    globalReviewsError = '';
    globalProductReviews = [];
    globalSellerReputation = null;
    renderReviewsList();

    unsubscribeProductReviews = db.collection('product_reviews')
        .where('sellerId', '==', vendorUid)
        .where('status', '==', 'published')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            globalReviewsError = '';
            globalProductReviews = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
            renderReviewsList();
        }, error => {
            console.error('Failed to load product reviews:', error);
            globalProductReviews = [];
            globalReviewsError = error?.message || 'Unable to load published reviews right now.';
            renderReviewsList();
        });

    unsubscribeSellerReputation = db.collection('seller_reputation')
        .doc(vendorUid)
        .onSnapshot(doc => {
            globalSellerReputation = doc.exists ? { id: doc.id, ...(doc.data() || {}) } : null;
            renderReviewsList();
        }, error => {
            console.error('Failed to load seller reputation:', error);
            globalReviewsError = globalReviewsError || error?.message || 'Unable to load seller reputation right now.';
            renderReviewsList();
        });
}

function populateOrderDetails(data) {
    const mode = data.paymentMode || data.paymentMethod || 'Cash';
    const modeText = document.getElementById('od-payment-mode');
    const badge = document.getElementById('od-payment-badge');
    const items = Array.isArray(data.items) ? data.items : [];

    document.getElementById('od-student').innerText = data.studentName || data.buyerName || 'Guest';
    document.getElementById('od-email').innerText = data.buyerEmail || data.customerInfo?.studentEmail || 'No email provided';
    document.getElementById('od-contact').innerText = data.contactNumber || data.customerInfo?.contactNumber || 'No contact number';
    document.getElementById('od-level').innerText = data.schoolLevel || data.customerInfo?.schoolLevel || 'Not specified';
    document.getElementById('od-status').innerText = data.status || 'Completed';
    document.getElementById('od-department').innerText = data.departmentTag || 'Sales Record';
    document.getElementById('od-notes').innerText = data.notes || 'No notes provided.';
    document.getElementById('od-receipt-status').innerText = data.receiptSent ? 'Receipt Sent' : 'Not tracked';
    document.getElementById('od-receipt-detail').innerText = data.receiptSentAt ? `Sent ${formatTimestamp(data.receiptSentAt)}` : 'Legacy sales records may not include email receipt tracking.';
    document.getElementById('od-subtotal').innerText = formatCurrency(data.subtotal || data.totalAmount || data.total);
    document.getElementById('od-tax').innerText = formatCurrency(data.tax);
    document.getElementById('od-total').innerText = formatCurrency(data.totalAmount || data.total);
    document.getElementById('od-date-placed').innerText = formatTimestamp(data.timestamp || data.createdAt);
    document.getElementById('od-date-updated').innerText = formatTimestamp(data.claimedAt || data.updatedAt);

    if (modeText) modeText.innerText = mode;
    if (badge) {
        const paymentClass = mode.toLowerCase().includes('gcash')
            ? 'bg-blue-100 text-blue-700 border border-blue-200'
            : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
        badge.className = `px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm ${paymentClass}`;
    }

    const receiptBadge = document.getElementById('od-receipt-badge');
    if (receiptBadge) {
        receiptBadge.className = `px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm ${data.receiptSent ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-200 text-slate-700 border border-slate-300'}`;
    }

    const list = document.getElementById('od-items-list');
    if (list) {
        list.innerHTML = items.length ? items.map(item => `
            <div class="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-0 dark:border-white/5">
                <div>
                    <p class="font-bold text-slate-700 dark:text-gray-100">${escapeHtml(item.name || 'Unnamed item')}</p>
                    <p class="text-[11px] text-slate-400">Qty ${escapeHtml(item.qty || item.quantity || 0)}</p>
                </div>
                <span class="font-black text-slate-800 dark:text-white">${escapeHtml(formatCurrency(item.price))}</span>
            </div>`).join('') : `<p class="text-sm text-slate-400">No item lines available.</p>`;
    }

    openModal('orderDetailsModal');
    if(window.lucide) lucide.createIcons();
}

function populateIncomingOrderDetails(order) {
    const statusConfig = getIncomingOrderStatusConfig(order.status);
    const receiptConfig = getReceiptStatusConfig(order);
    const items = Array.isArray(order.items) ? order.items : [];
    const mode = order.paymentMethod || 'Not specified';
    const modeText = document.getElementById('od-payment-mode');
    const badge = document.getElementById('od-payment-badge');

    document.getElementById('od-student').innerText = getOrderBuyerName(order);
    document.getElementById('od-email').innerText = getOrderBuyerEmail(order);
    document.getElementById('od-contact').innerText = getOrderContactNumber(order);
    document.getElementById('od-level').innerText = getOrderSchoolLevel(order);
    document.getElementById('od-status').innerText = statusConfig.label;
    document.getElementById('od-department').innerText = order.departmentTag || 'Not set';
    document.getElementById('od-notes').innerText = getOrderNotes(order);
    document.getElementById('od-receipt-status').innerText = receiptConfig.label;
    document.getElementById('od-receipt-detail').innerText = receiptConfig.detail;
    document.getElementById('od-subtotal').innerText = formatCurrency(order.subtotal);
    document.getElementById('od-tax').innerText = formatCurrency(order.tax);
    document.getElementById('od-total').innerText = formatCurrency(order.total);
    document.getElementById('od-date-placed').innerText = formatTimestamp(order.createdAt);
    document.getElementById('od-date-updated').innerText = formatTimestamp(order.updatedAt);

    if (modeText) modeText.innerText = mode;
    if (badge) {
        const paymentClass = mode.toLowerCase().includes('gcash')
            ? 'bg-blue-100 text-blue-700 border border-blue-200'
            : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
        badge.className = `px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm ${paymentClass}`;
    }

    const receiptBadge = document.getElementById('od-receipt-badge');
    if (receiptBadge) {
        receiptBadge.className = `px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm ${receiptConfig.badgeClass}`;
    }

    const list = document.getElementById('od-items-list');
    if (list) {
        list.innerHTML = items.length ? items.map(item => `
            <div class="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-0 dark:border-white/5">
                <div>
                    <p class="font-bold text-slate-700 dark:text-gray-100">${escapeHtml(item.name || 'Unnamed item')}</p>
                    <p class="text-[11px] text-slate-400">${escapeHtml(item.category || 'No category')} • Qty ${escapeHtml(item.quantity || 0)}</p>
                </div>
                <span class="font-black text-slate-800 dark:text-white">${escapeHtml(formatCurrency(item.price))}</span>
            </div>`).join('') : `<p class="text-sm text-slate-400">No item lines available.</p>`;
    }

    openModal('orderDetailsModal');
    if(window.lucide) lucide.createIcons();
}

// Initial Start
document.addEventListener('DOMContentLoaded', () => { 
    if(window.lucide) lucide.createIcons();
    
    // Add search functionality
    const searchInput = document.getElementById('productSearch');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterProducts(e.target.value);
        });
    }

    const inboxSearch = document.getElementById('inbox-search');
    if (inboxSearch) {
        inboxSearch.addEventListener('input', applyInboxSearch);
    }

    const messageInput = document.getElementById('inbox-message-input');
    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    const newMessageSearch = document.getElementById('new-message-search');
    if (newMessageSearch) {
        newMessageSearch.addEventListener('input', applyNewMessageSearch);
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('profileDropdown');
        const avatar = document.getElementById('header-avatar');
        if(dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
    
    if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
});

function legacyInitSalesHistoryListener(vendorUid) {
    return initSalesHistoryListener(vendorUid);
    console.log("📜 Loading Sales History...");
    
    db.collection('Vendor-product')
      .doc(vendorUid)
      .collection('purchased-products')
      .orderBy('claimedAt', 'desc')
      .onSnapshot(snap => {
        globalSalesHistory = [];
        let totalSales = 0;
        const tbody = document.getElementById('tbody-sales-history');
        if (!tbody) return;

        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-20 text-center text-gray-400 italic">No completed sales recorded yet.</td></tr>`;
            const salesDisplay = document.getElementById('history-total-sales');
            const revDisplay = document.getElementById('history-total-revenue');
            if(salesDisplay) salesDisplay.innerText = '₱0.00';
            if(revDisplay) revDisplay.innerText = '₱0.00';
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const sale = { id: doc.id, ...doc.data() };
            globalSalesHistory.push(sale);
            totalSales += Number(sale.totalAmount || 0);
            
            const date = sale.claimedAt ? sale.claimedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '---';

            html += `
            <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer" onclick="viewSalesHistoryDetails('${doc.id}')">
                <td class="px-8 py-5 font-mono text-xs text-slate-500">${date}</td>
                <td class="px-8 py-5">
                    <p class="font-bold text-slate-700 dark:text-gray-200">${sale.studentName || 'Guest'}</p>
                    <p class="text-[10px] text-gray-400 uppercase">${sale.paymentMode || 'Cash'}</p>
                </td>
                <td class="px-8 py-5 text-gray-500 text-xs">
                    ${sale.items ? sale.items.length : 0} items
                </td>
                <td class="px-8 py-5 text-right font-black text-primary dark:text-orange-400">
                    ₱${Number(sale.totalAmount).toLocaleString()}
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;
        
        // Calculate 12% Lifetime Revenue from Total Sales
        const lifetimeRevenue = totalSales * 0.12;
        
        // Update Total Sales Display
        const salesDisplay = document.getElementById('history-total-sales');
        const formattedSales = `₱${totalSales.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if(salesDisplay) salesDisplay.innerText = formattedSales;
        
        // Update Lifetime Revenue Display (12%)
        const revDisplay = document.getElementById('history-total-revenue');
        const formattedRev = `₱${lifetimeRevenue.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if(revDisplay) revDisplay.innerText = formattedRev;
        
        // Also update dashboard total (use 12% for consistency)
        const dashRevDisplay = document.getElementById('dash-total-revenue');
        if(dashRevDisplay) dashRevDisplay.innerText = formattedRev;
        
    }, err => console.error("History Sync Failed:", err));
}

function initSalesHistoryListener(vendorUid) {
    console.log("Loading Sales History...");
    cleanupSalesHistoryListeners();
    globalSalesHistoryError = '';
    globalOfficialSalesHistory = [];
    renderSalesHistoryTable();

    unsubscribeOfficialSalesHistory = db.collection('Orders')
        .where('sellerId', '==', vendorUid)
        .where('sellerType', '==', 'vendor')
        .where('orderChannel', '==', 'official')
        .where('status', '==', 'completed')
        .orderBy('updatedAt', 'desc')
        .onSnapshot(snap => {
            globalSalesHistoryError = '';
            globalOfficialSalesHistory = snap.docs.map(normalizeOfficialSale);
            console.log('Sales history query matched documents:', snap.size);
            renderSalesHistoryTable();
        }, err => {
            globalSalesHistoryError = err?.message || 'Unable to load completed sales history.';
            globalOfficialSalesHistory = [];
            console.error("Official history sync failed:", err);
            console.info('Sales history query details:', {
                collection: 'Orders',
                sellerId: vendorUid,
                sellerType: 'vendor',
                orderChannel: 'official',
                status: 'completed',
                orderBy: 'updatedAt desc'
            });
            renderSalesHistoryTable();
        });
}

window.viewOrderDetails = function(id) {
    const order = globalIncomingOrders.find(item => item.id === id);
    if (!order) return;
    populateIncomingOrderDetails(order);
};

window.viewSalesHistoryDetails = function(id) {
    const sale = globalSalesHistory.find(item => item.id === id);
    if (!sale) return;
    populateOrderDetails(sale);
};


const EMAILJS_PUBLIC_KEY = '4l61Onr7dUVbK5-MP';
const EMAILJS_SERVICE_ID = 'service_70wjjs4';
const EMAILJS_TEMPLATE_ID = 'template_rhnwibe';

if (window.emailjs) {
    emailjs.init({
        publicKey: EMAILJS_PUBLIC_KEY
    });
}

function buildReceiptItemsText(items) {
    if (!Array.isArray(items) || !items.length) {
        return '';
    }

    return items.map(item => {
        const name = item?.name || 'Unnamed item';
        const quantity = Number(item?.quantity || 0);
        const price = Number(item?.price || 0);
        const quantityText = quantity > 0 ? ` x${quantity}` : '';
        const priceText = price > 0 ? ` - ${formatCurrency(price)}` : '';
        return `- ${name}${quantityText}${priceText}`;
    }).join('\n');
}

function getReceiptItemsText(order) {
    const fromItems = buildReceiptItemsText(order.items || []);
    if (fromItems) return fromItems;

    const fallbackName = order.itemName || order.productName || 'Unnamed item';
    const fallbackQuantity = Number(order.quantity || order.productQuantity || 1);
    const fallbackPrice = Number(order.productPrice || order.total || order.subtotal || 0);
    const quantityText = fallbackQuantity > 0 ? ` x${fallbackQuantity}` : '';
    const priceText = fallbackPrice > 0 ? ` - ${formatCurrency(fallbackPrice)}` : '';
    return `- ${fallbackName}${quantityText}${priceText}`;
}

async function sendReceiptEmail(order) {
    if (!window.emailjs) {
        throw new Error('EmailJS is not loaded.');
    }

    const toEmail = order.buyerEmail || order.customerInfo?.studentEmail || '';
    if (!toEmail) {
        throw new Error('No buyer email found.');
    }

    const templateParams = {
        to_email: toEmail,
        buyer_name: getOrderBuyerName(order),
        order_id: order.id,
        items_text: getReceiptItemsText(order),
        items_list: getReceiptItemsText(order),
        items_purchased: getReceiptItemsText(order),
        subtotal: formatCurrency(order.subtotal),
        total: formatCurrency(order.total)
    };

    console.log('Receipt order payload:', order);
    console.log('Receipt template params:', templateParams);

    await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        templateParams
    );
}

window.updateIncomingOrderStatus = async function(orderId, newStatus) {
    const order = globalIncomingOrders.find(item => item.id === orderId);
    if (!order) {
        alert('Order not found.');
        return;
    }

    if (!canTransitionIncomingOrder(order.status, newStatus)) {
        alert(`Invalid status change from ${order.status || 'unknown'} to ${newStatus}.`);
        return;
    }

    globalUpdatingOrderIds.add(orderId);
    renderIncomingOrders();

    try {
        await db.collection('Orders').doc(orderId).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        if (newStatus === 'completed') {
            const refreshedDoc = await db.collection('Orders').doc(orderId).get();
            const refreshedOrder = { id: refreshedDoc.id, ...(refreshedDoc.data() || {}) };

            try {
                await sendReceiptEmail(refreshedOrder);

                await db.collection('Orders').doc(orderId).update({
                    receiptSent: true,
                    receiptSentAt: firebase.firestore.FieldValue.serverTimestamp(),
                    receiptError: firebase.firestore.FieldValue.delete()
                });
            } catch (emailError) {
                await db.collection('Orders').doc(orderId).update({
                    receiptSent: false,
                    receiptError: emailError.message || 'Failed to send receipt'
                });
            }
        }
    } catch (e) {
        console.error('Failed to update incoming order status:', e);
        alert(`Error: ${e.message}`);
    } finally {
        globalUpdatingOrderIds.delete(orderId);
        renderIncomingOrders();
    }
};
