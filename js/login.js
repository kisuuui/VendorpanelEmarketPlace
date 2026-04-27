(function () {
    async function init() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("denied") === "1") {
            await AppFirebase.auth.signOut().catch(() => {});
            const errorBox = document.getElementById("login-error");
            if (errorBox) {
                errorBox.textContent = "Your account is signed in, but it does not have access to the admin panel.";
                errorBox.classList.add("show");
            }
        }

        AppFirebase.auth.onAuthStateChanged(user => {
            if (user) window.location.href = AppConfig.defaultPage;
        });

        document.getElementById("login-form")?.addEventListener("submit", async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const errorBox = document.getElementById("login-error");
            const btn = document.getElementById("login-submit");
            errorBox?.classList.remove("show");
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Verifying...";
            }

            try {
                await AppAuth.login(form.email.value.trim(), form.password.value);
            } catch (error) {
                if (errorBox) {
                    errorBox.textContent = error.message;
                    errorBox.classList.add("show");
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "Sign In";
                }
            }
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
