(function () {
    let categories = [];

    async function init() {
        await AppAuth.requireAuth("Categories");
        AppLayout.renderLayout("Categories");
        document.getElementById("category-form")?.addEventListener("submit", saveCategory);
        await loadCategories();
    }

    async function loadCategories() {
        const snap = await AppFirebase.db.collection("categories").orderBy("name", "asc").get().catch(async () => AppFirebase.db.collection("categories").get());
        categories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        render();
    }

    function render() {
        const tbody = document.getElementById("categories-body");
        if (!tbody) return;
        if (!categories.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="muted">No categories found.</td></tr>`;
            return;
        }
        tbody.innerHTML = categories.map(row => `
            <tr>
                <td>${AppUtils.escapeHtml(row.name || "--")}</td>
                <td>${AppUtils.escapeHtml((row.subcategories || []).join(", ") || "--")}</td>
                <td>${AppUtils.formatDateTime(row.updatedAt || row.createdAt)}</td>
                <td><button class="btn" onclick="AppCategories.deleteCategory('${AppUtils.escapeAttr(row.id)}')">Delete</button></td>
            </tr>
        `).join("");
    }

    async function saveCategory(event) {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const name = String(fd.get("name") || "").trim();
        if (!name) return;
        const subcategories = String(fd.get("subcategories") || "")
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);

        await AppFirebase.db.collection("categories").add({
            name,
            subcategories,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await AppUtils.logAction("Created Category", `${name}: ${subcategories.join(", ")}`, "Audit");
        event.currentTarget.reset();
        await loadCategories();
    }

    async function deleteCategory(id) {
        if (!confirm("Delete this category?")) return;
        await AppFirebase.db.collection("categories").doc(id).delete();
        await AppUtils.logAction("Deleted Category", id, "Audit");
        await loadCategories();
    }

    window.AppCategories = { deleteCategory };
    document.addEventListener("DOMContentLoaded", init);
})();
