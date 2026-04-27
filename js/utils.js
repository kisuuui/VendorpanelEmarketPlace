(function () {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, "&#96;");
    }

    function formatPeso(value) {
        return "PHP " + Number(value || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function timestampToDate(value) {
        if (!value) return null;
        if (typeof value.toDate === "function") return value.toDate();
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatDate(value) {
        const date = timestampToDate(value);
        return date ? date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" }) : "--";
    }

    function formatDateTime(value) {
        const date = timestampToDate(value);
        return date ? date.toLocaleString("en-PH") : "--";
    }

    function getDisplayName(profile = {}) {
        const first = profile.firstName || "";
        const last = profile.lastName || "";
        return String(profile.name || `${first} ${last}`.trim() || profile.email || "Admin User");
    }

    function splitName(fullName) {
        const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
        return {
            firstName: parts.shift() || "",
            lastName: parts.join(" ")
        };
    }

    function getUserStatus(profile = {}) {
        return String(profile.status || (profile.emailVerified || profile.verified === true || profile.verified === "verified" ? "Active" : "Unverified"));
    }

    function getProductName(product = {}) {
        return product.Product || product.name || "Unnamed Item";
    }

    function getProductCategory(product = {}) {
        return product.Category || product.category || "Uncategorized";
    }

    function getProductSubcategory(product = {}) {
        return product.Subcategory || product.subcategory || product.subCategory || "Unassigned";
    }

    function getProductStock(product = {}) {
        const raw = product.Stock ?? product.stock ?? product.Stock_count ?? product.stockCount ?? product.stock_count;
        return raw === undefined || raw === null || raw === "" ? 0 : Number(raw) || 0;
    }

    function getProductPrice(product = {}) {
        return Number(product.Price ?? product.price ?? 0) || 0;
    }

    function normalizeProduct(doc, source) {
        const data = doc.data ? doc.data() : doc;
        const imageList = Array.isArray(data.imageUrls) ? data.imageUrls : (Array.isArray(data.photoURLs) ? data.photoURLs : []);
        const image = data.Image || data.imageUrl || data.photoURL || imageList[0] || "";
        const rawStatus = String(data.WorkflowStatus || data.Status || data.status || "").toLowerCase();
        const workflowStatus = rawStatus.includes("pending") ? "Pending" : rawStatus.includes("reject") ? "Rejected" : "Approved";
        const availabilityRaw = String(data.Availability || data.availability || data.Status || "On Stock").toLowerCase();
        const availability = availabilityRaw.includes("out") ? "Out of Stock" : availabilityRaw.includes("low") ? "Low Stock" : "On Stock";

        return {
            ...data,
            id: doc.id || data.id || data.productId || "",
            path: doc.ref ? doc.ref.path : data.path || "",
            source,
            Product: getProductName(data),
            Category: getProductCategory(data),
            Subcategory: getProductSubcategory(data),
            Price: getProductPrice(data),
            Stock: getProductStock(data),
            WorkflowStatus: workflowStatus,
            Availability: availability,
            Recipient: data.Recipient || data.recipientName || data.vendorName || data.sellerName || "--",
            Image: image,
            imageUrls: imageList.length ? imageList : (image ? [image] : [])
        };
    }

    function imageFallback(name) {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Item")}&background=eee&color=852221`;
    }

    async function sha256(text) {
        const encoded = new TextEncoder().encode(String(text || ""));
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
        return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function randomPassword(length = 18) {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
        const values = new Uint32Array(length);
        crypto.getRandomValues(values);
        return Array.from(values, value => alphabet[value % alphabet.length]).join("");
    }

    async function uploadToCloudinary(file) {
        const config = window.AppConfig.cloudinary;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", config.uploadPreset);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
            method: "POST",
            body: formData
        });
        if (!res.ok) throw new Error("Cloudinary upload failed.");
        const data = await res.json();
        return data.secure_url;
    }

    async function logAction(action, details, level = "Activity") {
        const auth = window.AppFirebase.auth;
        const db = window.AppFirebase.db;
        const user = auth.currentUser;
        if (!user) return;
        const profile = window.AppState?.profile || {};
        await db.collection("logs").add({
            adminId: user.uid,
            adminName: getDisplayName(profile),
            adminEmail: user.email,
            action,
            details,
            level,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    window.AppUtils = {
        escapeHtml,
        escapeAttr,
        formatPeso,
        formatDate,
        formatDateTime,
        timestampToDate,
        getDisplayName,
        splitName,
        getUserStatus,
        getProductName,
        getProductCategory,
        getProductSubcategory,
        getProductStock,
        getProductPrice,
        normalizeProduct,
        imageFallback,
        sha256,
        randomPassword,
        uploadToCloudinary,
        logAction
    };
})();
