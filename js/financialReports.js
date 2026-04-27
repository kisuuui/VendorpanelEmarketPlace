(function () {
    let rows = [];

    async function init() {
        await AppAuth.requireAuth("FinancialReports");
        AppLayout.renderLayout("FinancialReports");
        document.getElementById("finance-form")?.addEventListener("submit", saveFinancialRecord);
        await loadFinancials();
    }

    async function loadFinancials() {
        const snap = await AppFirebase.db.collection("financials").orderBy("date", "desc").get();
        rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderSummary();
        renderRecent();
    }

    function renderSummary() {
        const incomeRows = rows.filter(row => String(row.type || "Income").toLowerCase() === "income");
        const gross = incomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const commission = gross * AppConfig.profitPercentage;
        const netPayout = gross - commission;

        setText("finance-gross", AppUtils.formatPeso(gross));
        setText("finance-commission", AppUtils.formatPeso(commission));
        setText("finance-payout", AppUtils.formatPeso(netPayout));
        setText("finance-count", incomeRows.length);
    }

    function renderRecent() {
        const tbody = document.getElementById("finance-recent-body");
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="muted">No financial records found.</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.slice(0, 12).map(row => `
            <tr>
                <td>${AppUtils.formatDate(row.date)}</td>
                <td>${AppUtils.escapeHtml(row.buyerName || "Walk-in")}</td>
                <td>${AppUtils.escapeHtml(row.itemName || "--")}</td>
                <td>${AppUtils.escapeHtml(row.category || "General")}</td>
                <td>${AppUtils.formatPeso(row.amount || 0)}</td>
                <td>${AppUtils.escapeHtml(row.refId || row.id.slice(0, 8).toUpperCase())}</td>
            </tr>
        `).join("");
    }

    async function saveFinancialRecord(event) {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const amount = Number(fd.get("amount") || 0);
        if (!amount || !fd.get("buyerName") || !fd.get("itemName")) {
            alert("Please fill amount, buyer, and item name.");
            return;
        }

        const payload = {
            type: "Income",
            date: fd.get("date") ? new Date(fd.get("date")) : new Date(),
            refId: String(fd.get("refId") || "").trim() || `AUTO-${Date.now().toString().slice(-6)}`,
            buyerName: String(fd.get("buyerName") || "").trim(),
            recipient: String(fd.get("recipient") || "General Fund").trim(),
            itemName: String(fd.get("itemName") || "").trim(),
            category: String(fd.get("category") || "General").trim(),
            amount,
            description: String(fd.get("description") || "").trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: AppState.user.email
        };

        await AppFirebase.db.collection("financials").add(payload);
        await AppUtils.logAction("Recorded Income", `${payload.itemName} for ${AppUtils.formatPeso(amount)}`, "Audit");
        event.currentTarget.reset();
        await loadFinancials();
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
