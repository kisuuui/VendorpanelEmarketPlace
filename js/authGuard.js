(function () {
    window.AppState = window.AppState || {
        user: null,
        profile: null
    };

    async function fetchProfile(user) {
        const db = window.AppFirebase.db;
        const [userSnap, adminSnap] = await Promise.all([
            db.collection("users").doc(user.uid).get(),
            db.collection("admin").doc(user.uid).get()
        ]);

        const userProfile = userSnap.exists ? { id: userSnap.id, uid: user.uid, email: user.email, ...userSnap.data() } : null;
        let adminProfile = null;

        if (adminSnap.exists) {
            const adminData = adminSnap.data();
            adminProfile = {
                id: adminSnap.id,
                uid: user.uid,
                email: user.email,
                roleRank: window.AppRoles.normalizeRoleRank(adminData),
                roleKey: window.AppRoles.roleFromRank(window.AppRoles.normalizeRoleRank(adminData)).key,
                status: "Active",
                ...adminData
            };
        }

        if (userProfile && adminProfile) {
            const userRank = window.AppRoles.normalizeRoleRank(userProfile);
            const adminRank = window.AppRoles.normalizeRoleRank(adminProfile);
            return adminRank < userRank ? { ...userProfile, ...adminProfile, roleRank: adminRank } : userProfile;
        }

        const allowed = (window.AppConfig.allowedAdminEmails || []).map(email => email.toLowerCase());
        const email = String(user.email || "").toLowerCase();
        if (adminProfile) return adminProfile;
        if (userProfile && allowed.includes(email) && window.AppRoles.normalizeRoleRank(userProfile) > 2) {
            const fallbackRank = email === "admin@scc.com" ? 1 : 2;
            return {
                ...userProfile,
                roleRank: fallbackRank,
                roleKey: window.AppRoles.roleFromRank(fallbackRank).key,
                roleName: window.AppRoles.roleFromRank(fallbackRank).label,
                status: userProfile.status || "Active"
            };
        }
        if (userProfile) return userProfile;

        if (allowed.includes(email)) {
            const fallbackRank = email === "admin@scc.com" ? 1 : 2;
            const fallbackRole = window.AppRoles.roleFromRank(fallbackRank);
            return {
                id: user.uid,
                uid: user.uid,
                email: user.email,
                name: user.email,
                roleRank: fallbackRank,
                roleKey: fallbackRole.key,
                roleName: fallbackRole.label,
                status: "Active",
                emailVerified: user.emailVerified
            };
        }

        return null;
    }

    function updateProfileUI() {
        const profile = window.AppState.profile || {};
        const role = window.AppRoles.roleFromRank(window.AppRoles.normalizeRoleRank(profile));
        const name = window.AppUtils.getDisplayName(profile);
        const photo = profile.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=852221&color=fff`;

        document.querySelectorAll("[data-user-name]").forEach(el => { el.textContent = name; });
        document.querySelectorAll("[data-user-role]").forEach(el => { el.textContent = role.label; });
        document.querySelectorAll("[data-user-email]").forEach(el => { el.textContent = profile.email || window.AppState.user?.email || ""; });
        document.querySelectorAll("[data-user-avatar]").forEach(el => { el.src = photo; });
    }

    async function requireAuth(pageName) {
        const auth = window.AppFirebase.auth;
        document.documentElement.classList.add("auth-loading");

        return new Promise(resolve => {
            auth.onAuthStateChanged(async user => {
                if (!user) {
                    window.location.href = window.AppConfig.loginPage;
                    return;
                }

                try {
                    const profile = await fetchProfile(user);
                    if (!profile) {
                        await auth.signOut();
                        window.location.href = window.AppConfig.loginPage;
                        return;
                    }

                    const status = window.AppUtils.getUserStatus(profile).toLowerCase();
                    if (["disabled", "suspended", "blocked"].includes(status)) {
                        await auth.signOut();
                        window.location.href = window.AppConfig.loginPage;
                        return;
                    }

                    if (!window.AppRoles.canAccessPage(pageName, profile)) {
                        await auth.signOut();
                        window.location.href = `${window.AppConfig.loginPage}?denied=1`;
                        return;
                    }

                    window.AppState.user = user;
                    window.AppState.profile = profile;
                    updateProfileUI();
                    document.documentElement.classList.remove("auth-loading");
                    resolve({ user, profile });
                } catch (error) {
                    console.error("Auth guard failed:", error);
                    await auth.signOut();
                    window.location.href = window.AppConfig.loginPage;
                }
            });
        });
    }

    async function login(email, password) {
        await window.AppFirebase.auth.signInWithEmailAndPassword(email, password);
        window.location.href = window.AppConfig.defaultPage;
    }

    async function logout() {
        await window.AppFirebase.auth.signOut();
        window.location.href = window.AppConfig.loginPage;
    }

    window.AppAuth = {
        requireAuth,
        login,
        logout,
        updateProfileUI
    };
})();
