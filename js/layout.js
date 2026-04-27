(function () {
    const navItems = [
        { page: "Dashboard", href: "Dashboard.html", label: "Dashboard", icon: "home", roles: [1, 2] },
        { page: "AllItems", href: "AllItems.html", label: "All Items", icon: "layers", roles: [1, 2] },
        { page: "Inbox", href: "Inbox.html", label: "Inbox", icon: "message-square", roles: [1, 2] },
        { page: "PendingApprovals", href: "PendingApprovals.html", label: "Pending Approvals", icon: "file-clock", roles: [1] },
        { page: "SchoolListings", href: "SchoolListings.html", label: "School Listings", icon: "graduation-cap", roles: [1, 2] },
        { page: "Orders", href: "Orders.html", label: "Ongoing Orders", icon: "shopping-bag", roles: [1, 2] },
        { page: "UserManagement", href: "UserManagement.html", label: "User Management", icon: "users", roles: [1, 2] },
        { page: "Categories", href: "Categories.html", label: "Categories", icon: "tags", roles: [1] },
        { page: "FinancialReports", href: "FinancialReports.html", label: "Financial Reports", icon: "bar-chart-3", roles: [1, 2] },
        { page: "TransactionHistory", href: "TransactionHistory.html", label: "Transaction History", icon: "credit-card", roles: [1, 2] },
        { page: "SystemLogs", href: "SystemLogs.html", label: "System Logs", icon: "scroll-text", roles: [1, 2] }
    ];

    function renderLayout(activePage) {
        const shell = document.getElementById("app-shell");
        if (!shell) return;

        const profile = window.AppState.profile || {};
        const rank = window.AppRoles.normalizeRoleRank(profile);
        const visibleItems = navItems.filter(item => item.roles.includes(rank));

        shell.insertAdjacentHTML("afterbegin", `
            <aside class="app-sidebar">
                <a href="Dashboard.html" class="brand-row">
                    <img src="logo.png" alt="SCC Logo">
                    <span>SCC <strong>E-COMMERCE</strong></span>
                </a>
                <nav class="sidebar-nav">
                    <span class="nav-section">Apps & Pages</span>
                    ${visibleItems.map(item => `
                        <a class="nav-link ${item.page === activePage ? "active" : ""}" href="${item.href}">
                            <i data-lucide="${item.icon}"></i>
                            <span>${item.label}</span>
                        </a>
                    `).join("")}
                </nav>
                <div class="sidebar-profile">
                    <img data-user-avatar src="" alt="Profile">
                    <div>
                        <strong data-user-name>Admin User</strong>
                        <span data-user-role>Admin</span>
                    </div>
                    <button type="button" title="Logout" onclick="AppAuth.logout()"><i data-lucide="log-out"></i></button>
                </div>
            </aside>
        `);

        const topbar = document.getElementById("topbar");
        if (topbar) {
            topbar.innerHTML = `
                <div>
                    <p class="eyebrow">Dashboards / <span>${pageTitle(activePage)}</span></p>
                    <h1>${pageTitle(activePage)}</h1>
                </div>
                <div class="topbar-actions">
                    <button type="button" class="icon-btn" onclick="AppLayout.toggleTheme()" title="Theme"><i id="theme-icon" data-lucide="moon"></i></button>
                    <a class="profile-pill" href="Profile.html">
                        <img data-user-avatar src="" alt="Profile">
                        <span data-user-name>Admin User</span>
                    </a>
                </div>
            `;
        }

        updateThemeIcon();
        window.AppAuth.updateProfileUI();
        if (window.lucide) lucide.createIcons();
    }

    function pageTitle(page) {
        return {
            Dashboard: "Dashboard Overview",
            AllItems: "All Items",
            Inbox: "Inbox",
            SchoolListings: "School Listings",
            PendingApprovals: "Pending Approvals",
            UserManagement: "User Management",
            FinancialReports: "Financial Reports",
            TransactionHistory: "Transaction History",
            SystemLogs: "System Logs",
            Orders: "Ongoing Orders",
            Categories: "Categories",
            Profile: "Profile"
        }[page] || page;
    }

    function toggleTheme() {
        document.documentElement.classList.toggle("dark");
        localStorage.setItem("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
        updateThemeIcon();
        if (window.lucide) lucide.createIcons();
    }

    function updateThemeIcon() {
        const icon = document.getElementById("theme-icon");
        if (icon) icon.setAttribute("data-lucide", document.documentElement.classList.contains("dark") ? "sun" : "moon");
    }

    if (localStorage.getItem("theme") === "dark") {
        document.documentElement.classList.add("dark");
    }

    window.AppLayout = {
        renderLayout,
        toggleTheme,
        pageTitle
    };
})();
