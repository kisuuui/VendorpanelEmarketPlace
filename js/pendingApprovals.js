(function () {
    async function init() {
        await AppAuth.requireAuth("PendingApprovals");
        AppLayout.renderLayout("PendingApprovals");
        await loadPending();
    }

    async function loadPending() {
        const tbody = document.getElementById("pending-body");
        const snap = await AppFirebase.db.collection("products_pending").get();
        const rows = snap.docs.map(doc => AppUtils.normalizeProduct(doc, "Pending"));
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="muted">No pending products.</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map(row => `
            <tr>
                <td>
                    <div class="table-media">
                        <img src="${AppUtils.escapeAttr(row.Image || AppUtils.imageFallback(row.Product))}" alt="">
                        <div><strong>${AppUtils.escapeHtml(row.Product)}</strong><span>${AppUtils.escapeHtml(row.id)}</span></div>
                    </div>
                </td>
                <td>${AppUtils.escapeHtml(row.Recipient || row.sellerName || "--")}</td>
                <td>${AppUtils.escapeHtml(row.Category)}</td>
                <td>${AppUtils.escapeHtml(row.Subcategory)}</td>
                <td>${AppUtils.formatPeso(row.Price)}</td>
                <td class="toolbar">
                    <button class="btn btn-primary" onclick="AppPending.approve('${AppUtils.escapeAttr(row.id)}')">Approve</button>
                    <button class="btn" onclick="AppPending.reject('${AppUtils.escapeAttr(row.id)}')">Reject</button>
                </td>
            </tr>
        `).join("");
    }

    async function approve(id) {
        const ref = AppFirebase.db.collection("products_pending").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return;
        const data = snap.data();
        await AppFirebase.db.collection("products_approved").doc(id).set({
            ...data,
            Status: "Approved",
            WorkflowStatus: "Approved",
            Availability: "On Stock",
            verified: true,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await ref.delete();
        await AppUtils.logAction("Approved Product", data.Product || data.name || id, "Audit");
        await loadPending();
    }

    async function reject(id) {
        await AppFirebase.db.collection("products_pending").doc(id).set({
            Status: "Rejected",
            WorkflowStatus: "Rejected",
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await AppUtils.logAction("Rejected Product", id, "Audit");
        await loadPending();
    }

    window.AppPending = { approve, reject };
    document.addEventListener("DOMContentLoaded", init);
})();
