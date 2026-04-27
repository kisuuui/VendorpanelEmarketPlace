(function () {
    let products = [];
    let categories = [];

    async function init() {
        await AppAuth.requireAuth("AllItems");
        AppLayout.renderLayout("AllItems");
        bindFilters();
        bindProductForm();
        await loadData();
    }

    function bindFilters() {
        ["product-search", "category-filter", "subcategory-filter"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", render);
            document.getElementById(id)?.addEventListener("change", render);
        });
    }

    function bindProductForm() {
        const addButton = document.getElementById("open-product-modal");
        if (addButton && !AppRoles.isSuperAdmin(AppState.profile)) {
            addButton.style.display = "none";
        }

        addButton?.addEventListener("click", openProductModal);
        document.getElementById("close-product-modal")?.addEventListener("click", closeProductModal);
        document.getElementById("cancel-product-modal")?.addEventListener("click", closeProductModal);
        document.getElementById("product-modal")?.addEventListener("click", event => {
            if (event.target.id === "product-modal") closeProductModal();
        });
        document.getElementById("product-upload-trigger")?.addEventListener("click", () => {
            document.getElementById("product-images")?.click();
        });
        document.getElementById("product-images")?.addEventListener("change", renderSelectedImagePreview);
        document.getElementById("product-form")?.addEventListener("submit", saveProduct);
    }

    function openProductModal() {
        const modal = document.getElementById("product-modal");
        if (!modal) return;
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        if (window.lucide) lucide.createIcons();
        setTimeout(() => document.querySelector('#product-form [name="name"]')?.focus(), 30);
    }

    function closeProductModal() {
        const modal = document.getElementById("product-modal");
        if (!modal) return;
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
    }

    function renderSelectedImagePreview() {
        const input = document.getElementById("product-images");
        const preview = document.getElementById("product-image-preview");
        if (!input || !preview) return;
        const files = Array.from(input.files || []).slice(0, 3);

        if (!files.length) {
            preview.innerHTML = "";
            return;
        }

        Promise.all(files.map(file => new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.readAsDataURL(file);
        }))).then(images => {
            preview.innerHTML = images.map(src => `
                <div class="preview-card">
                    <img src="${AppUtils.escapeAttr(src)}" alt="Product preview">
                </div>
            `).join("");
        });
    }

    async function saveProduct(event) {
        event.preventDefault();
        if (!AppRoles.isSuperAdmin(AppState.profile)) {
            alert("Only Super Admin can add products from this admin panel.");
            return;
        }
        const fd = new FormData(event.currentTarget);
        const name = String(fd.get("name") || "").trim();
        const price = Number(fd.get("price") || 0);
        const stock = Number(fd.get("stock") || 0);
        if (!name || !price) return;

        const saveBtn = document.getElementById("save-product-btn");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = "Uploading...";
        }

        const files = Array.from(document.getElementById("product-images")?.files || []).slice(0, 3);
        const imageUrls = [];
        try {
            for (const file of files) {
                imageUrls.push(await AppUtils.uploadToCloudinary(file));
            }
        } catch (error) {
            alert("Image upload failed: " + error.message);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = "Save Product";
            }
            return;
        }

        try {
            const ref = AppFirebase.db.collection("products_approved").doc();
            await ref.set({
                Product: name,
                name,
                Price: price,
                price,
                Stock: stock,
                stock,
                Stock_count: stock,
                Category: String(fd.get("category") || "General").trim(),
                category: String(fd.get("category") || "General").trim(),
                Subcategory: String(fd.get("subcategory") || "Unassigned").trim(),
                subcategory: String(fd.get("subcategory") || "Unassigned").trim(),
                Recipient: String(fd.get("recipient") || AppUtils.getDisplayName(AppState.profile)).trim(),
                Description: String(fd.get("description") || "").trim(),
                description: String(fd.get("description") || "").trim(),
                Image: imageUrls[0] || "",
                imageUrl: imageUrls[0] || "",
                photoURL: imageUrls[0] || "",
                Images: imageUrls,
                imageUrls,
                photoURLs: imageUrls,
                Status: "Approved",
                WorkflowStatus: "Approved",
                Availability: "On Stock",
                availability: "on-stock",
                verified: true,
                sellerId: AppState.user.uid,
                ownerId: AppState.user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await AppUtils.logAction("Created Product", name, "Audit");
            event.currentTarget.reset();
            document.getElementById("product-image-preview").innerHTML = "";
            closeProductModal();
            await loadData();
        } catch (error) {
            alert("Saving product failed: " + error.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = "Save Product";
            }
        }
    }

    async function loadData() {
        const db = AppFirebase.db;
        const [approvedSnap, pendingSnap, categorySnap] = await Promise.all([
            db.collection("products_approved").get(),
            db.collection("products_pending").get(),
            db.collection("categories").get().catch(() => ({ docs: [] }))
        ]);

        products = [
            ...approvedSnap.docs.map(doc => AppUtils.normalizeProduct(doc, "Approved")),
            ...pendingSnap.docs.map(doc => AppUtils.normalizeProduct(doc, "Pending"))
        ];
        categories = categorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        populateCategoryFilters();
        render();
    }

    function populateCategoryFilters() {
        const categoryFilter = document.getElementById("category-filter");
        const subcategoryFilter = document.getElementById("subcategory-filter");
        if (!categoryFilter || !subcategoryFilter) return;

        const names = Array.from(new Set([
            ...categories.map(c => c.name || c.Category).filter(Boolean),
            ...products.map(AppUtils.getProductCategory).filter(Boolean)
        ])).sort();
        categoryFilter.innerHTML = `<option value="">All Categories</option>` + names.map(name => `<option>${AppUtils.escapeHtml(name)}</option>`).join("");
        updateSubcategories();
        categoryFilter.addEventListener("change", updateSubcategories);
    }

    function updateSubcategories() {
        const category = document.getElementById("category-filter")?.value || "";
        const subcategoryFilter = document.getElementById("subcategory-filter");
        if (!subcategoryFilter) return;
        const fromCategoryDocs = categories
            .filter(item => !category || String(item.name || item.Category || "") === category)
            .flatMap(item => Array.isArray(item.subcategories) ? item.subcategories : []);
        const fromProducts = products
            .filter(product => !category || AppUtils.getProductCategory(product) === category)
            .map(AppUtils.getProductSubcategory);
        const names = Array.from(new Set([...fromCategoryDocs, ...fromProducts].filter(Boolean))).sort();
        subcategoryFilter.innerHTML = `<option value="">All Sub Categories</option>` + names.map(name => `<option>${AppUtils.escapeHtml(name)}</option>`).join("");
        render();
    }

    function render() {
        const tbody = document.getElementById("items-body");
        if (!tbody) return;
        const term = (document.getElementById("product-search")?.value || "").toLowerCase();
        const category = document.getElementById("category-filter")?.value || "";
        const subcategory = document.getElementById("subcategory-filter")?.value || "";

        const filtered = products.filter(product => {
            const haystack = [
                AppUtils.getProductName(product),
                AppUtils.getProductCategory(product),
                AppUtils.getProductSubcategory(product),
                product.Recipient
            ].join(" ").toLowerCase();
            return (!term || haystack.includes(term))
                && (!category || AppUtils.getProductCategory(product) === category)
                && (!subcategory || AppUtils.getProductSubcategory(product) === subcategory);
        });

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="muted">No products found.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(product => {
            const name = AppUtils.getProductName(product);
            const img = product.Image || AppUtils.imageFallback(name);
            return `
                <tr>
                    <td>
                        <div class="table-media">
                            <img src="${AppUtils.escapeAttr(img)}" onerror="this.src='${AppUtils.imageFallback(name)}'" alt="">
                            <div><strong>${AppUtils.escapeHtml(name)}</strong><span>${AppUtils.escapeHtml(product.id)}</span></div>
                        </div>
                    </td>
                    <td>${AppUtils.escapeHtml(AppUtils.getProductCategory(product))}</td>
                    <td>${AppUtils.escapeHtml(AppUtils.getProductSubcategory(product))}</td>
                    <td>${AppUtils.escapeHtml(product.Recipient || "--")}</td>
                    <td>${AppUtils.formatPeso(AppUtils.getProductPrice(product))}</td>
                    <td>${AppUtils.escapeHtml(String(AppUtils.getProductStock(product)))}</td>
                    <td><span class="badge ${product.Availability === "Out of Stock" ? "badge-red" : "badge-green"}">${AppUtils.escapeHtml(product.Availability || "On Stock")}</span></td>
                </tr>
            `;
        }).join("");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
