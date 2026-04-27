(function () {
    async function init() {
        await AppAuth.requireAuth("SchoolListings");
        AppLayout.renderLayout("SchoolListings");
        await renderListings();
    }

    async function renderListings() {
        const tbody = document.getElementById("school-body");
        const snap = await AppFirebase.db.collection("products_approved").get();
        const departments = ["Library", "Virtual Lab", "Computer Lab", "Supply Department"];
        const rows = snap.docs
            .map(doc => AppUtils.normalizeProduct(doc, "Approved"))
            .filter(row => departments.some(dept => String(row.Recipient || "").toLowerCase() === dept.toLowerCase()));

        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="muted">No school listings found.</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map(row => `
            <tr>
                <td><span class="badge badge-blue">${AppUtils.escapeHtml(row.Recipient)}</span></td>
                <td>${AppUtils.escapeHtml(row.Product)}</td>
                <td>${AppUtils.escapeHtml(row.Category)}</td>
                <td>${AppUtils.escapeHtml(row.Subcategory)}</td>
                <td>${AppUtils.escapeHtml(String(row.Stock))}</td>
                <td><span class="badge badge-green">${AppUtils.escapeHtml(row.Availability || "On Stock")}</span></td>
            </tr>
        `).join("");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
