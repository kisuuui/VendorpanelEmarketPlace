(function () {
    let users = [];

    async function init() {
        await AppAuth.requireAuth("UserManagement");
        AppLayout.renderLayout("UserManagement");
        applyRoleCreationLimits();
        document.getElementById("user-search")?.addEventListener("input", render);
        document.getElementById("create-user-form")?.addEventListener("submit", createUser);
        await loadUsers();
    }

    function applyRoleCreationLimits() {
        if (AppRoles.isSuperAdmin(AppState.profile)) return;
        const roleSelect = document.querySelector('select[name="roleRank"]');
        if (!roleSelect) return;
        Array.from(roleSelect.options).forEach(option => {
            if (Number(option.value) === 1) option.remove();
        });
        roleSelect.value = "4";
    }

    async function loadUsers() {
        const snap = await AppFirebase.db.collection("users").orderBy("createdAt", "desc").get().catch(async () => AppFirebase.db.collection("users").get());
        users = snap.docs.map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() }));
        render();
    }

    function render() {
        const tbody = document.getElementById("users-body");
        if (!tbody) return;
        const term = (document.getElementById("user-search")?.value || "").toLowerCase();
        const currentIsSuper = AppRoles.isSuperAdmin(AppState.profile);

        const filtered = users.filter(user => {
            if (!currentIsSuper && AppRoles.normalizeRoleRank(user) === 1) return false;
            const text = [
                user.UID,
                user.uid,
                user.firstName,
                user.lastName,
                user.name,
                user.email,
                user.studentNumber,
                user.phone
            ].join(" ").toLowerCase();
            return !term || text.includes(term);
        });

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="muted">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(user => {
            const rank = AppRoles.normalizeRoleRank(user);
            const role = AppRoles.roleFromRank(rank);
            const name = AppUtils.getDisplayName(user);
            const avatar = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=852221&color=fff`;
            return `
                <tr>
                    <td>${AppUtils.escapeHtml(user.UID || "--")}</td>
                    <td>
                        <div class="table-media">
                            <img src="${AppUtils.escapeAttr(avatar)}" alt="">
                            <div><strong>${AppUtils.escapeHtml(name)}</strong><span>${AppUtils.escapeHtml(user.uid || user.id)}</span></div>
                        </div>
                    </td>
                    <td>${AppUtils.escapeHtml(user.email || "--")}</td>
                    <td>${AppUtils.escapeHtml(user.studentNumber || "--")}</td>
                    <td>${AppUtils.escapeHtml(user.phone || "--")}</td>
                    <td><span class="badge badge-blue">${role.rank} - ${role.label}</span></td>
                    <td>${user.emailVerified ? "Yes" : "No"}</td>
                    <td><span class="badge ${AppUtils.getUserStatus(user).toLowerCase() === "active" ? "badge-green" : "badge-amber"}">${AppUtils.escapeHtml(AppUtils.getUserStatus(user))}</span></td>
                    <td class="muted">${AppUtils.formatDate(user.createdAt)}</td>
                </tr>
            `;
        }).join("");
    }

    async function createUser(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        const email = String(fd.get("email") || "").trim();
        const password = String(fd.get("password") || "").trim() || AppUtils.randomPassword();
        const firstName = String(fd.get("firstName") || "").trim();
        const lastName = String(fd.get("lastName") || "").trim();
        const roleRank = Number(fd.get("roleRank") || 4);
        if (!AppRoles.isSuperAdmin(AppState.profile) && roleRank === 1) {
            alert("Only Super Admin can create another Super Admin.");
            return;
        }
        const role = AppRoles.roleFromRank(roleRank);
        const passwordHash = await AppUtils.sha256(password);

        let secondary = null;
        try {
            secondary = firebase.initializeApp(AppConfig.firebase, "SecondaryCreateUser");
            const cred = await secondary.auth().createUserWithEmailAndPassword(email, password);
            const readableUid = await uniqueReadableUid();

            await AppFirebase.db.collection("users").doc(cred.user.uid).set({
                UID: readableUid,
                uid: cred.user.uid,
                authUid: cred.user.uid,
                firstName,
                lastName,
                name: `${firstName} ${lastName}`.trim(),
                email,
                emailVerified: false,
                studentNumber: String(fd.get("studentNumber") || "").trim(),
                passwordHash,
                photoURL: "",
                role: roleRank,
                roleRank,
                roleKey: role.key,
                roleName: role.label,
                accountLabel: role.accountLabel,
                status: "Unverified",
                phone: String(fd.get("phone") || "").trim(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await AppUtils.logAction("Created User", `${email} as ${role.label}`, "Audit");
            await secondary.auth().signOut();
            form.reset();
            await loadUsers();
            alert("User created. Password hash was saved for panel documentation.");
        } catch (error) {
            alert("Create user failed: " + error.message);
        } finally {
            if (secondary) secondary.delete();
        }
    }

    async function uniqueReadableUid() {
        const prefix = "SCC";
        for (let i = 0; i < 10; i++) {
            const candidate = `${prefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            const snap = await AppFirebase.db.collection("users").where("UID", "==", candidate).limit(1).get();
            if (snap.empty) return candidate;
        }
        return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
