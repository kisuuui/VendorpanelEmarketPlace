(function () {
    async function init() {
        await AppAuth.requireAuth("Dashboard");
        AppLayout.renderLayout("Dashboard");
        subscribeDashboard();
    }

    function subscribeDashboard() {
        const db = AppFirebase.db;
        Promise.all([
            db.collection("users").get(),
            db.collection("products_approved").get(),
            db.collection("orders").get(),
            db.collection("financials").get()
        ]).then(([usersSnap, productsSnap, ordersSnap, financialsSnap]) => {
            const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const orders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const financials = financialsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const sellers = users.filter(user => AppRoles.normalizeRoleRank(user) === 3);
            const activeOrders = orders.filter(order => !["completed", "cancelled", "rejected"].includes(String(order.status || "").toLowerCase()));
            const completedOrders = orders.filter(order => String(order.status || "").toLowerCase() === "completed");
            const gross = financials.reduce((sum, row) => sum + (String(row.type || "Income").toLowerCase() === "income" ? Number(row.amount || 0) : 0), 0);

            setText("metric-users", users.length);
            setText("metric-sellers", sellers.length);
            setText("metric-orders", orders.length);
            setText("metric-active-orders", activeOrders.length);
            setText("metric-completed-orders", completedOrders.length);
            setText("metric-products", productsSnap.size);
            setText("metric-revenue", AppUtils.formatPeso(gross * AppConfig.profitPercentage));

            renderRecentOrders(activeOrders.slice(0, 8));
            renderActivity();
        }).catch(error => {
            console.error(error);
            setText("dashboard-error", "Failed to load dashboard data. Check Firebase rules and indexes.");
        });
    }

    function renderRecentOrders(orders) {
        const tbody = document.getElementById("recent-orders-body");
        if (!tbody) return;
        if (!orders.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="muted">No active orders found.</td></tr>`;
            return;
        }

        tbody.innerHTML = orders.map(order => `
            <tr>
                <td>#${AppUtils.escapeHtml(order.orderId || order.id.slice(0, 8).toUpperCase())}</td>
                <td>${AppUtils.escapeHtml(order.buyerName || order.customerName || "Customer")}</td>
                <td>${AppUtils.escapeHtml(order.itemName || order.productName || "Order")}</td>
                <td>${AppUtils.formatPeso(order.amount || order.total || 0)}</td>
                <td><span class="badge badge-amber">${AppUtils.escapeHtml(order.status || "Active")}</span></td>
            </tr>
        `).join("");
    }

    function renderActivity() {
        const list = document.getElementById("activity-list");
        if (!list) return;
        AppFirebase.db.collection("logs").orderBy("timestamp", "desc").limit(6).get().then(snap => {
            if (snap.empty) {
                list.innerHTML = `<p class="muted">No recent activity.</p>`;
                return;
            }
            list.innerHTML = snap.docs.map(doc => {
                const row = doc.data();
                return `
                    <div class="activity-row">
                        <strong>${AppUtils.escapeHtml(row.action || "Activity")}</strong>
                        <span>${AppUtils.escapeHtml(row.adminName || "Admin")} - ${AppUtils.formatDateTime(row.timestamp)}</span>
                    </div>
                `;
            }).join("");
        });
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
