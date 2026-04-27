(function () {
    async function init() {
        await AppAuth.requireAuth("Orders");
        AppLayout.renderLayout("Orders");
        await renderOrders();
    }

    async function renderOrders() {
        const tbody = document.getElementById("orders-body");
        const snap = await AppFirebase.db.collection("orders").orderBy("createdAt", "desc").limit(100).get().catch(async () => AppFirebase.db.collection("orders").get());
        const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const active = rows.filter(row => !["completed", "cancelled", "rejected"].includes(String(row.status || "").toLowerCase()));
        const complete = rows.filter(row => String(row.status || "").toLowerCase() === "completed");

        setText("orders-total", rows.length);
        setText("orders-active", active.length);
        setText("orders-completed", complete.length);

        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="muted">No orders found. This will populate when vendor/mobile orders are saved to the orders collection.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const status = String(row.status || "Active");
            const badge = status.toLowerCase() === "completed" ? "badge-green" : status.toLowerCase() === "cancelled" ? "badge-red" : "badge-amber";
            return `
                <tr>
                    <td>#${AppUtils.escapeHtml(row.orderId || row.id.slice(0, 8).toUpperCase())}</td>
                    <td>${AppUtils.escapeHtml(row.buyerName || row.customerName || "--")}</td>
                    <td>${AppUtils.escapeHtml(row.sellerName || row.vendorName || "--")}</td>
                    <td>${AppUtils.escapeHtml(row.itemName || row.productName || "--")}</td>
                    <td>${AppUtils.escapeHtml(String(row.quantity || 1))}</td>
                    <td>${AppUtils.formatPeso(row.amount || row.total || 0)}</td>
                    <td><span class="badge ${badge}">${AppUtils.escapeHtml(status)}</span></td>
                    <td>${AppUtils.formatDateTime(row.createdAt || row.date)}</td>
                </tr>
            `;
        }).join("");
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
