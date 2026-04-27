(function () {
    const ROLES = {
        SUPER_ADMIN: { rank: 1, key: "owner", label: "Super Admin", accountLabel: "Owner" },
        ADMIN: { rank: 2, key: "manager", label: "Admin", accountLabel: "Manager" },
        SELLER: { rank: 3, key: "seller", label: "Seller", accountLabel: "Seller" },
        USER: { rank: 4, key: "student", label: "User", accountLabel: "Student" }
    };

    const PAGE_ACCESS = {
        Dashboard: [1, 2],
        AllItems: [1, 2],
        Inbox: [1, 2],
        SchoolListings: [1, 2],
        PendingApprovals: [1],
        UserManagement: [1, 2],
        FinancialReports: [1, 2],
        TransactionHistory: [1, 2],
        SystemLogs: [1, 2],
        Orders: [1, 2],
        Categories: [1],
        Profile: [1, 2]
    };

    function normalizeRoleRank(profile = {}) {
        const raw = profile.roleRank ?? profile.accountRole ?? profile.roleId ?? profile.role;
        if (Number(raw) >= 1 && Number(raw) <= 4) return Number(raw);

        const value = String(raw || profile.roleKey || profile.userType || profile.usertype || profile.type || "").toLowerCase();
        if (["super admin", "superadmin", "owner", "role 1"].includes(value)) return 1;
        if (["admin", "manager", "role 2"].includes(value)) return 2;
        if (["seller", "vendor", "staff", "role 3"].includes(value)) return 3;
        return 4;
    }

    function roleFromRank(rank) {
        return Object.values(ROLES).find(role => role.rank === Number(rank)) || ROLES.USER;
    }

    function canAccessPage(pageName, profile = {}) {
        const allowed = PAGE_ACCESS[pageName] || [1, 2];
        return allowed.includes(normalizeRoleRank(profile));
    }

    function isSuperAdmin(profile = {}) {
        return normalizeRoleRank(profile) === 1;
    }

    window.AppRoles = {
        ROLES,
        PAGE_ACCESS,
        normalizeRoleRank,
        roleFromRank,
        canAccessPage,
        isSuperAdmin
    };
})();
