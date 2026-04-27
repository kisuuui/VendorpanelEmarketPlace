(function () {
    let currentLevel = "Activity";

    async function init() {
        await AppAuth.requireAuth("SystemLogs");
        AppLayout.renderLayout("SystemLogs");
        document.querySelectorAll("[data-log-level]").forEach(btn => {
            btn.addEventListener("click", () => {
                currentLevel = btn.dataset.logLevel;
                document.querySelectorAll("[data-log-level]").forEach(item => item.classList.remove("btn-primary"));
                btn.classList.add("btn-primary");
                renderLogs();
            });
        });
        await renderLogs();
    }

    async function renderLogs() {
        const tbody = document.getElementById("logs-body");
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading logs...</td></tr>`;
        try {
            const snap = await AppFirebase.db.collection("logs")
                .where("level", "==", currentLevel)
                .orderBy("timestamp", "desc")
                .limit(80)
                .get();
            if (snap.empty) {
                tbody.innerHTML = `<tr><td colspan="4" class="muted">No ${AppUtils.escapeHtml(currentLevel)} records found.</td></tr>`;
                return;
            }
            tbody.innerHTML = snap.docs.map(doc => {
                const row = doc.data();
                const badge = currentLevel === "Audit" ? "badge-red" : currentLevel === "System" ? "badge-amber" : "badge-blue";
                return `
                    <tr>
                        <td>${AppUtils.formatDateTime(row.timestamp)}</td>
                        <td>${AppUtils.escapeHtml(row.adminName || "Admin")}</td>
                        <td><span class="badge ${badge}">${AppUtils.escapeHtml(row.action || "--")}</span></td>
                        <td>${AppUtils.escapeHtml(row.details || "")}</td>
                    </tr>
                `;
            }).join("");
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="4" class="muted">Unable to load logs. Firebase may need a composite index for level + timestamp.</td></tr>`;
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
