// config.js
module.exports = {
    // Server configuration
    PORT: process.env.PORT || 4000,    
    // API configuration
    API_URL_PREFIX: process.env.API_URL_PREFIX || '/v1',
    ROLES_CLAIMS: {
        supplier_sales_rm: [""],
        supplier_sales_head: [""],
        supplier_sales_manager: [""],
        supplier_sales_executive: [""],
        supplier_admin: ["supplier:manageUser"],
        superadmin_admin: [
            "superadmin:manage"
        ]
    }
};