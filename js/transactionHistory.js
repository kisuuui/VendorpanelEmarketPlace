(function () {
    async function init() {
        await AppAuth.requireAuth("TransactionHistory");
        AppLayout.renderLayout("TransactionHistory");
        await renderTransactions();
    }

    async function renderTransactions() {
        const tbody = document.getElementById("transactions-body");
        const snap = await AppFirebase.db.collection("financials").orderBy("date", "desc").limit(100).get();
        const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const gross = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const commission = gross * AppConfig.profitPercentage;

        setText("trans-gross", AppUtils.formatPeso(gross));
        setText("trans-commission", AppUtils.formatPeso(commission));
        setText("trans-payout", AppUtils.formatPeso(gross - commission));

        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="muted">No transactions found.</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map(row => `
            <tr>
                <td>${AppUtils.formatDate(row.date)}</td>
                <td>${AppUtils.escapeHtml(row.buyerName || "Walk-in")}</td>
                <td>${AppUtils.escapeHtml(row.itemName || "--")}</td>
                <td>${AppUtils.escapeHtml(row.category || "General")}</td>
                <td>${AppUtils.formatPeso(row.amount || 0)}</td>
                <td>${AppUtils.escapeHtml(row.description || "")}</td>
                <td>${AppUtils.escapeHtml(row.recipient || "Admin")}</td>
                <td>${AppUtils.escapeHtml(row.refId || row.id.slice(0, 8).toUpperCase())}</td>
            </tr>
        `).join("");
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
