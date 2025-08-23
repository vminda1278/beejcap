const {putItem, getItem, deleteItem,updateItem,queryItem, transactWriteItems} = require("../utility/db")
const {adminDeleteUser} = require('../utility/cognito');

async function getAllEnterprisesModel(){
    try{
            const pk = "Enterprise";
            const resp = await queryItem({ "pk": pk, "condition": " and (begins_with(SK, :sk))", "value": "Profile:"});  
            console.log(resp)
            return (resp.Items)?resp.Items: []
        }catch(e){
            console.error(e)
            throw new Error(e.message || 'Failed to get all enterprises');
        }
}
async function getAllEnterprisesOfTypeModel({enterprise_type}){
    try{
            const pk = "Enterprise"
            const resp = await queryItem({ "pk": pk, "condition": " and (begins_with(SK, :sk))", "value": "EnterpriseType#" + enterprise_type});  
            return (resp && resp.Items) ? resp.Items : [];

        }catch(e){
            console.error(e)
            throw new Error(e.message || 'Failed to get all enterprises');
        }
}
async function getAllUsersOfEnterpriseModel({eid}){
    try{
            const pk = "Enterprise"
            const resp = await queryItem({ "pk": "Eid#" + eid, "condition": " and (begins_with(SK, :sk))", "value": "Username"});  
            return (resp.Items)?resp.Items: []
        }catch(e){
            console.error(e)
            throw new Error(e.message || 'Failed to get all enterprises');
        }
}
async function deleteEnterpriseModel({eid, enterprise_type}){
        try{
                if(!eid || !enterprise_type )
                        throw new Error("eid and enterprise_type are required")  
                    if(!['lsp'].includes(enterprise_type))
                        throw new Error("Invalid enterprise_type - Valid input is only 'lsp'")
          const pk = "Eid#" + eid;
          const resp = await queryItem({ "pk": pk, "condition": " and (begins_with(SK, :sk))", "value": "Username"});  
          const params = []
          //Delete all users of the enterprise
          let domain;
          for (const item of resp.Items) {
            try {
                // Delete user from Cognito pool as well
                const username = item.SK.replace("Username#", "")
                await adminDeleteUser({ "username":  username});
                params.push({ "op": "delete", "pk": item.PK, "sk": item.SK });
                params.push({ "op": "delete", "pk": "Authentication", "sk": `Username#${username}#Profile` });
                domain = item.ATTR1.domain;
            } catch (err) {
                if (err.code === 'UserNotFoundException') {
                    console.warn(`User not found: ${username}}`);
                } else {
                    throw err; // Re-throw the error if it's not a UserNotFoundException
                }
            }
          }
          params.push({"op": "delete", "pk":"Enterprise", "sk": `Profile:Eid#${eid}`})
          params.push({"op": "delete", "pk":"Enterprise", "sk": `EnterpriseType#${enterprise_type}:Eid#${eid}`})
          await transactWriteItems(params);
        }catch(e){
            console.error(e)
            throw new Error(e.message || 'Failed to get all enterprises');
        }
}

/**
 * Check if a user exists in an enterprise and is approved
 * 
 * @param {Object} params - Function parameters
 * @param {string} params.eid - Enterprise ID
 * @param {string} params.username - Username to check
 * @returns {Promise<Object>} - Returns user details if found and approved, null if not found
 * @throws {Error} If required parameters are missing or query fails
 */
async function checkUserExistsInEnterpriseModel({ eid, username }) {
    try {
        if (!eid || !username) {
            throw new Error("eid and username are required");
        }

        const resp = await queryItem({
            "pk": "Eid#" + eid,
            "condition": " and begins_with(SK, :sk)",
            "value": "Username#" + username
        });

        if (!resp.Items || resp.Items.length === 0) {
            throw new Error(`User ${username} not found in enterprise ${eid}`);
        }

        const userDetails = resp.Items[0].ATTR1;
        
        // Check if user is approved (isConfirmedByAdmin should be "true")
        if (userDetails.isConfirmedByAdmin !== "true") {
            throw new Error(`User ${username} exists but is not approved in enterprise ${eid}`);
        }

        return userDetails;

    } catch (e) {
        console.error('Error in checkUserExistsInEnterpriseModel:', e);
        throw new Error(e.message || 'Failed to check user in enterprise');
    }
}


  
  module.exports = {
    getAllEnterprisesModel, getAllEnterprisesOfTypeModel, getAllUsersOfEnterpriseModel, deleteEnterpriseModel, checkUserExistsInEnterpriseModel
  }
