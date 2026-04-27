(function () {
    async function init() {
        await AppAuth.requireAuth("Profile");
        AppLayout.renderLayout("Profile");
        fillProfile();
        document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
    }

    function fillProfile() {
        const profile = AppState.profile || {};
        setValue("profile-first", profile.firstName || AppUtils.splitName(profile.name).firstName);
        setValue("profile-last", profile.lastName || AppUtils.splitName(profile.name).lastName);
        setValue("profile-email", profile.email || AppState.user.email);
        setValue("profile-phone", profile.phone || "");
        setValue("profile-student", profile.studentNumber || "");
        setText("profile-uid", profile.UID || profile.uid || AppState.user.uid);
        setText("profile-firebase-uid", AppState.user.uid);
        setText("profile-role", AppRoles.roleFromRank(AppRoles.normalizeRoleRank(profile)).label);
        setText("profile-status", AppUtils.getUserStatus(profile));
    }

    async function saveProfile(event) {
        event.preventDefault();
        const file = document.getElementById("profile-photo")?.files?.[0];
        const payload = {
            firstName: document.getElementById("profile-first").value.trim(),
            lastName: document.getElementById("profile-last").value.trim(),
            phone: document.getElementById("profile-phone").value.trim(),
            studentNumber: document.getElementById("profile-student").value.trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        payload.name = `${payload.firstName} ${payload.lastName}`.trim();
        if (file) payload.photoURL = await AppUtils.uploadToCloudinary(file);
        await AppFirebase.db.collection("users").doc(AppState.user.uid).set(payload, { merge: true });
        await AppUtils.logAction("Updated Profile", payload.name || AppState.user.email);
        alert("Profile updated.");
        window.location.reload();
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || "";
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value || "--";
    }

    document.addEventListener("DOMContentLoaded", init);
})();
