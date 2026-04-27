(function () {
    async function init() {
        await AppAuth.requireAuth("Inbox");
        AppLayout.renderLayout("Inbox");
        await renderInbox();
    }

    async function renderInbox() {
        const list = document.getElementById("inbox-body");
        const [ticketsSnap, reportsSnap] = await Promise.all([
            AppFirebase.db.collection("tickets").orderBy("createdAt", "desc").limit(50).get().catch(async () => AppFirebase.db.collection("tickets").get()),
            AppFirebase.db.collection("product_reports").orderBy("createdAt", "desc").limit(50).get().catch(async () => AppFirebase.db.collection("product_reports").get())
        ]);
        const rows = [
            ...ticketsSnap.docs.map(doc => ({ id: doc.id, type: "Ticket", ...doc.data() })),
            ...reportsSnap.docs.map(doc => ({ id: doc.id, type: "Report", ...doc.data() }))
        ].sort((a, b) => (AppUtils.timestampToDate(b.updatedAt || b.createdAt)?.getTime() || 0) - (AppUtils.timestampToDate(a.updatedAt || a.createdAt)?.getTime() || 0));

        if (!list) return;
        if (!rows.length) {
            list.innerHTML = `<tr><td colspan="6" class="muted">Inbox is empty.</td></tr>`;
            return;
        }
        list.innerHTML = rows.map(row => {
            const status = row.status || "Open";
            const badge = ["resolved", "closed"].includes(String(status).toLowerCase()) ? "badge-green" : "badge-amber";
            return `
                <tr>
                    <td><span class="badge badge-blue">${row.type}</span></td>
                    <td>${AppUtils.escapeHtml(row.subject || row.productName || "Support item")}</td>
                    <td>${AppUtils.escapeHtml(row.senderName || row.reporterName || "User")}</td>
                    <td>${AppUtils.escapeHtml(row.message || row.description || row.reason || "")}</td>
                    <td><span class="badge ${badge}">${AppUtils.escapeHtml(status)}</span></td>
                    <td>${AppUtils.formatDateTime(row.updatedAt || row.createdAt)}</td>
                </tr>
            `;
        }).join("");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
