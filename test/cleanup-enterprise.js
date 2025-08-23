/**
 * Enterprise Cleanup Script
 * 
 * This script provides functionality to clean up enterprises in the LSP-OMS system.
 * It can be used in two modes:
 * 
 * 1. All Enterprises: Retrieves all enterprises and deletes them one by one
 *    Usage: node cleanup-enterprise.js
 *           node cleanup-enterprise.js all
 * 
 * 2. Specific Enterprise: Deletes a specific enterprise by ID
 *    Usage: node cleanup-enterprise.js specific <enterprise-id>
 * 
 * The script connects to the local API server by default (http://localhost:4000)
 */

const axios = require('axios');
const baseUrl = 'http://localhost:4000';

async function makeApiRequest(method, endpoint, data = null) {
    try {
        const url = `${baseUrl}${endpoint}`;
        console.log(`[INFO] Making ${method} request to: ${url}`);
        const response = await axios({
            method,
            url,
            data,
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000,
            validateStatus: () => true // Accept all status codes
        });
        // Try to parse JSON, but print raw data if it fails
        console.log('[DEBUG] Raw response:', JSON.stringify(response.data));
        if (response.status >= 200 && response.status < 300) {
            console.log(`[SUCCESS] Request successful: ${response.status}`);
            console.log(response.data);
            return response.data;
        } else {
            console.log(`[ERROR] Request failed with status ${response.status}`);
            console.log(response.data);
            return { status: 'error', message: response.data?.message || 'Request failed' };
        }
    } catch (error) {
        if (error.response) {
            console.log(`[ERROR] Request failed: ${error.response.status}`);
            console.log(error.response.data);
            return error.response.data;
        } else {
            console.log(`[ERROR] Request failed: ${error.message}`);
            throw error;
        }
    }
}

async function cleanupSpecificEnterprise(enterpriseId) {
    try {
        // Use provided ID or fall back to the default one
        enterpriseId = enterpriseId || '5443bb58-045b-4296-bab2-37bd7f817da0';
        
        console.log('[INFO] 🧹 Cleanup Script for Specific Enterprise');
        console.log(`[INFO] Enterprise ID: ${enterpriseId}`);
        
        const cleanupData = {
            data: {
                ATTR1: {
                    eid: enterpriseId,
                    enterprise_type: 'lsp'
                }
            }
        };
        
        console.log('\n===== Deleting Enterprise =====');
        const deleteResponse = await makeApiRequest('post', '/v1/admin/deleteEnterprise', cleanupData);
        
        if (deleteResponse.status === 'success') {
            console.log('[SUCCESS] ✅ Enterprise deleted successfully');
        } else {
            console.log('[ERROR] ⚠️ Failed to delete enterprise');
            console.log('[INFO] Manual cleanup may be required');
        }
        
    } catch (error) {
        console.error('[ERROR] Cleanup failed:', error.message);
    }
}

async function cleanupAllEnterprises() {
    try {
        console.log('[INFO] 🧹 Cleanup Script for All Enterprises');
        
        // Step 1: Get all enterprises
        console.log('\n===== Getting All Enterprises =====');
        const getAllResponse = await makeApiRequest('get', '/v1/admin/getAllEnterprises');
        console.log('[DEBUG] getAllEnterprises response:', getAllResponse);

        if (!getAllResponse || !getAllResponse.data || !Array.isArray(getAllResponse.data)) {
            console.log('[ERROR] ⚠️ Failed to retrieve enterprises or no enterprises found');
            return;
        }
        
        const enterprises = getAllResponse.data;
        console.log(`[INFO] Found ${enterprises.length} enterprises to delete`);
        
        // Step 2: Delete each enterprise
        let successCount = 0;
        let failureCount = 0;
        
        for (const enterprise of enterprises) {
            const enterpriseId = enterprise.ATTR1?.eid;
            const enterpriseType = enterprise.ATTR1?.enterprise_type;
            
            if (!enterpriseId || !enterpriseType) {
                console.log('[WARNING] Enterprise missing ID or type, skipping...');
                failureCount++;
                continue;
            }
            
            console.log(`\n===== Deleting Enterprise: ${enterpriseId} =====`);
            
            const cleanupData = {
                data: {
                    ATTR1: {
                        eid: enterpriseId,
                        enterprise_type: enterpriseType
                    }
                }
            };
            
            try {
                const deleteResponse = await makeApiRequest('post', '/v1/admin/deleteEnterprise', cleanupData);
                
                if (deleteResponse.status === 'success') {
                    console.log(`[SUCCESS] ✅ Enterprise ${enterpriseId} deleted successfully`);
                    successCount++;
                } else {
                    console.log(`[ERROR] ⚠️ Failed to delete enterprise ${enterprise.id}`);
                    failureCount++;
                }
            } catch (err) {
                console.log(`[ERROR] ⚠️ Error while deleting enterprise ${enterprise.id}: ${err.message}`);
                failureCount++;
            }
        }
        
        console.log('\n===== Cleanup Summary =====');
        console.log(`[INFO] Total enterprises: ${enterprises.length}`);
        console.log(`[INFO] Successfully deleted: ${successCount}`);
        console.log(`[INFO] Failed to delete: ${failureCount}`);
        
    } catch (error) {
        console.error('[ERROR] Cleanup all enterprises failed:', error.message);
    }
}

// Parse command-line arguments
const args = process.argv.slice(2);

// Print help information if requested
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Enterprise Cleanup Script
=========================

Usage:
  node cleanup-enterprise.js [mode] [options]

Modes:
  all                  Clean up all enterprises (default)
  specific <id>        Clean up a specific enterprise by ID

Options:
  --dry-run, -d        Simulate the cleanup process without making actual API calls
  --help, -h           Show this help message

Examples:
  node cleanup-enterprise.js                     # Clean up all enterprises
  node cleanup-enterprise.js all                 # Same as above
  node cleanup-enterprise.js specific abc123     # Clean up enterprise with ID abc123
  node cleanup-enterprise.js all --dry-run       # Simulate cleaning up all enterprises
  node cleanup-enterprise.js specific abc123 -d  # Simulate cleaning up specific enterprise
`);
    process.exit(0);
}

// Check for dry-run mode
const isDryRun = args.includes('--dry-run') || args.includes('-d');
if (isDryRun) {
    console.log('[INFO] 🔍 DRY RUN MODE - No actual changes will be made');
    
    // Remove the dry-run flags from args
    const dryRunIndex = args.indexOf('--dry-run');
    if (dryRunIndex !== -1) args.splice(dryRunIndex, 1);
    
    const shortDryRunIndex = args.indexOf('-d');
    if (shortDryRunIndex !== -1) args.splice(shortDryRunIndex, 1);
    
    // Override the makeApiRequest function to simulate API calls
    const originalMakeApiRequest = makeApiRequest;
    makeApiRequest = async (method, endpoint, data = null) => {
        console.log(`[DRY RUN] Would make ${method.toUpperCase()} request to: ${baseUrl}${endpoint}`);
        if (data) console.log(`[DRY RUN] With data: ${JSON.stringify(data, null, 2)}`);
        
        // Simulate responses
        if (endpoint === '/v1/admin/getAllEnterprises') {
            console.log('[DRY RUN] Simulating GET all enterprises response');
            return {
                status: 'success',
                data: [
                    { id: 'enterprise-1', name: 'Test LSP 1', enterprise_type: 'lsp' },
                    { id: 'enterprise-2', name: 'Test LSP Retail', enterprise_type: 'lsp' },
                    { id: 'enterprise-3', name: 'Test LSP 2', enterprise_type: 'lsp' }
                ]
            };
        }
        
        if (endpoint === '/v1/admin/deleteEnterprise') {
            console.log('[DRY RUN] Simulating DELETE enterprise response');
            return { status: 'success', message: 'Enterprise would be deleted (dry run)' };
        }
        
        return { status: 'success', message: 'Dry run successful' };
    };
}

// Determine mode and run appropriate cleanup function
const mode = args[0] || 'all'; // Default to 'all' if no argument is provided

if (mode === 'specific') {
    const enterpriseId = args[1];
    if (!enterpriseId) {
        console.error('[ERROR] Enterprise ID is required for specific cleanup. Usage: node cleanup-enterprise.js specific <enterprise-id>');
        process.exit(1);
    }
    // Use the provided enterprise ID
    cleanupSpecificEnterprise(enterpriseId);
} else {
    // Clean up all enterprises
    cleanupAllEnterprises();
}
