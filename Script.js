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
let unsubscribeChatThreads = null;
let unsubscribeChatMessages = null;

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
        // Try Users Collection
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
            // Check Admin Fallback
            const adminDoc = await db.collection('admin').doc(user.uid).get();
            if (adminDoc.exists) {
                currentUserCollection = 'admin';
                setupVendorSession(user.uid, adminDoc.data());
            } else { auth.signOut(); }
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
        cleanupChatListeners();
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
    initOrderListener(uid);
    initSalesHistoryListener(uid);
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
            'orders': 'Pickup Requests', 
            'inbox': 'Customer Inbox',
            'salesHistory': 'Sales History',
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
    db.collection('Vendor-product').doc(vendorUid).collection('listings').onSnapshot(snap => {
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
        const empty = `<tr><td colspan="6" class="py-10 text-center text-gray-400 italic">No products listed yet.</td></tr>`;
        if (dashTable) dashTable.innerHTML = empty;
        if (invTable) invTable.innerHTML = empty;
        return;
    }

    globalProducts.forEach(p => {
        const name = p.Product || 'Unnamed Item';
        const status = p.Status || 'Pending';
        const price = p.Price || 0;
        const stock = p.Stock || 0;
        
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
        invTable.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-gray-400 italic">No products found matching your search.</td></tr>`;
        return;
    }
    
    let html = '';
    filtered.forEach(p => {
        const name = p.Product || 'Unnamed Item';
        const status = p.Status || 'Pending';
        const price = p.Price || 0;
        const stock = p.Stock || 0;
        
        html += `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 border-b dark:border-dark-border">
            <td class="px-6 py-4 flex items-center gap-4">
                <img src="${p.Image}" class="w-12 h-12 rounded-xl object-cover shadow-sm">
                <div><p class="font-bold text-slate-700 dark:text-white">${name}</p><p class="text-[10px] text-gray-400 uppercase font-mono">${p.Category}</p></div>
            </td>
            <td class="px-6 py-4 text-gray-500">${p.Category}</td>
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
function initOrderListener(vendorUid) {
    db.collection('orders').where('vendorId', '==', vendorUid).orderBy('timestamp', 'desc').onSnapshot(snap => {
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
                    <div class="flex gap-2">${renderActionButton(id, order.status)}</div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    });
}

function renderActionButton(id, status) {
    if (status === 'Preparing') return `<button onclick="event.stopPropagation(); updateOrderStatus('${id}', 'Ready')" class="bg-red-800 text-white px-4 py-2 rounded-xl text-xs font-bold">Mark Ready</button>`;
    if (status === 'Ready') return `<button onclick="event.stopPropagation(); updateOrderStatus('${id}', 'Claimed')" class="bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Claimed</button>`;
    return `<div class="text-green-500"><i data-lucide="check-circle"></i></div>`;
}

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        const orderRef = db.collection('orders').doc(orderId);
        const doc = await orderRef.get();
        if (!doc.exists) return;
        
        const orderData = doc.data();
        const vendorUid = orderData.vendorId;

        const updateData = { 
            status: newStatus,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp() 
        };

        if (newStatus === 'Claimed') {
            const completionTime = firebase.firestore.FieldValue.serverTimestamp();
            updateData.claimedAt = completionTime;

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

function legacyViewOrderDetails(id) {
    return window.viewOrderDetails(id);
    db.collection('orders').doc(id).get().then(doc => {
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
    await db.collection('orders').add({
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

function populateOrderDetails(data) {
    document.getElementById('od-student').innerText = data.studentName || 'Guest';
    document.getElementById('od-total').innerText = formatMoney(data.totalAmount);

    const mode = data.paymentMode || "Cash";
    const modeText = document.getElementById('od-payment-mode');
    const badge = document.getElementById('od-payment-badge');
    if (modeText) modeText.innerText = mode;

    if (badge) {
        badge.className = mode.toLowerCase().includes("gcash")
            ? "px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm bg-blue-100 text-blue-600 border border-blue-200"
            : "px-3 py-1 rounded-lg text-[10px] font-black uppercase shadow-sm bg-green-100 text-green-600 border border-green-200";
    }

    document.getElementById('od-date-placed').innerText = formatTimestamp(data.timestamp);
    document.getElementById('od-date-claimed').innerText = formatTimestamp(data.claimedAt);

    const list = document.getElementById('od-items-list');
    if (list) {
        list.innerHTML = data.items ? data.items.map(i => `
            <div class="flex justify-between text-sm py-2 border-b dark:border-white/5 last:border-0">
                <span class="text-slate-600 dark:text-gray-300">${i.name} <span class="text-[10px] text-gray-400">x${i.qty}</span></span>
                <span class="font-bold text-slate-800 dark:text-white">${formatMoney(i.price)}</span>
            </div>`).join('') : '';
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
            updateSalesSummary(0);
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const sale = { id: doc.id, ...doc.data() };
            globalSalesHistory.push(sale);
            totalSales += Number(sale.totalAmount || 0);

            const date = sale.claimedAt ? sale.claimedAt.toDate().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            }) : '---';

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
                    ${formatMoney(sale.totalAmount)}
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;
        updateSalesSummary(totalSales);
    }, err => console.error("History Sync Failed:", err));
}

window.viewOrderDetails = function(id) {
    db.collection('orders').doc(id).get().then(doc => {
        if (!doc.exists) return;
        populateOrderDetails(doc.data());
    });
};

window.viewSalesHistoryDetails = function(id) {
    const sale = globalSalesHistory.find(item => item.id === id);
    if (!sale) return;
    populateOrderDetails(sale);
};
