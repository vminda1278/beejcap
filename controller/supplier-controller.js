const {adminDeleteUser, adminUpdateUserAttributes} = require('../utility/cognito');
const {transactWriteItems} = require("../utility/db")
const confirmSupplierUserSignUp = async (req, res, next) => {
    try{
        console.log(req.body);
        if (!req.body || !req.body.data) {
          throw new Error("Request body with data is required");
        }
        const {eid, username} = req.body.data; 
        if (!eid || !username) {
          throw new Error("eid and username are required");
        }
        const userParams = {
          userPoolId: process.env.COGNITO_USER_POOL_ID, // Replace with your User Pool ID
          username: username,
          userAttributes: [
            { Name: 'custom:isConfirmedByAdmin', Value: 'true' }
          ]
        };
        let params = []
        params.push({ "op": "update", "pk": "Authentication", "sk": "Username#" + username + "#Profile",'update_expression':'SET ATTR1.isConfirmedByAdmin = :val', 'ex_attr_values':{':val': "true"}});
        params.push({ "op": "update", "pk": "Eid#" + eid, "sk": "Username#" + username,'update_expression':'SET ATTR1.isConfirmedByAdmin = :val', 'ex_attr_values':{':val': "true"}});
        console.log(params)
        await transactWriteItems(params);
        const resp = await adminUpdateUserAttributes(userParams)
        console.log(resp);
        res.status(200).json({'status': 'success'});
    }catch(e){
        console.error('Error details:', e);
        const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
        res.status(statusCode).json({'status': 'error', 'message': e.message || 'Admin Confirm signup failed'});
        next(e);
    }
}
const deleteSupplierUser = async (req, res, next) => {
    try{
        console.log('Delete Supplier User ', req.body)
        const { eid, username } = req.body.data.ATTR1;
        if(!eid || !username )
            throw new Error("eid and username are required")
        await adminDeleteUser({ "username":  username});
        let params = []
        params.push({ "op": "delete", "pk": `Eid#${eid}`, "sk": `Username#${username}` });
        params.push({ "op": "delete", "pk": "Authentication", "sk": `Username#${username}#Profile` });
        await transactWriteItems(params);
        res.status(200).json({'status': 'success'}); 
    }catch(e){
        console.error(e);
        next(e);
    }   
}
module.exports = {
    confirmSupplierUserSignUp,
    deleteSupplierUser
}