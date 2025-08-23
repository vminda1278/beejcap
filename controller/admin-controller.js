const {adminListUnconfirmedAdminUsers, adminUpdateUserAttributes, listUsers, adminConfirmSignUp} = require('../utility/cognito');
const {getAllEnterprisesModel, getAllEnterprisesOfTypeModel, getAllUsersOfEnterpriseModel, deleteEnterpriseModel} = require('../model/enterprise');
const {transactWriteItems, getItem } = require('../utility/db');
const { convertAttributesArray } = require("../utility/helper");

const dotenv = require("dotenv");
dotenv.config()

const getAllEnterprises = async (req, res, next) => {
    try {
        const resp = await getAllEnterprisesModel();
        console.log('[DEBUG] getAllEnterprisesModel() response:', resp);
        res.status(200).json({'status': 'success', 'data': resp});
    } catch (e) {
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({ status: 'error', message: e.message || 'Failed to get all enterprises' });
      next(e);
    }
};
const getAllEnterprisesOfType = async (req, res, next) => {
    try {
        const resp = await getAllEnterprisesOfTypeModel({"enterprise_type": req.body.data.enterprise_type});
        console.log(resp)
        const cognitoUsers = await listUsers();
        //console.log(cognitoUsers)
        // Create a map for quick lookup of Cognito users by email
        const cognitoUserMap = new Map();
        cognitoUsers.Users.forEach((user) => {
          const cuser = convertAttributesArray(user.Attributes);
          cognitoUserMap.set(cuser.email, cuser);
        });
       //console.log(cognitoUserMap);
        // Update enterprises with Cognito user data
        resp.forEach((enterprise) => {
          const cuser = cognitoUserMap.get(enterprise.ATTR1.admin);
          if (cuser) {
            console.log(cuser);
            enterprise['ATTR1']['isConfirmedByAdmin'] = cuser['custom:isConfirmedByAdmin'];
            enterprise['ATTR1']['email_verified'] = cuser.email_verified;
          }
          //console.log(enterprise);
        });
        res.status(200).json({'status': 'success', 'data': resp });
    } catch (e) {
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({ status: 'error', message: e.message || 'Failed to list unconfirmed users' });
      next(e);
    }
};
const getAllUsersOfEnterprise = async (req, res, next) => {
    try {
        const resp = await getAllUsersOfEnterpriseModel({"eid": req.body.data.eid});
        res.status(200).json({'status': 'success', 'data': resp });
    } catch (e) {
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({ status: 'error', message: e.message || 'Failed to list unconfirmed users' });
      next(e);
    }
};
const deleteEnterprise = async (req, res, next) => {
    try {
      console.log(req.body.data)
      await deleteEnterpriseModel({'eid': req.body.data.ATTR1.eid, 'enterprise_type': req.body.data.ATTR1.enterprise_type});
      res.status(200).json({ status: 'success'});
    } catch (e) {
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({ status: 'error', message: e.message || 'Failed to list unconfirmed users' });
      next(e);
    }
};

const listUnconfirmedUsers = async (req, res, next) => {
    try {
      const userParams = {
        userPoolId: process.env.COGNITO_USER_POOL_ID, // Replace with your User Pool ID
      };
      const users = await adminListUnconfirmedAdminUsers(userParams);
      const data = users.map(user => ({'ATTR1': user}))
      res.status(200).json({ status: 'success', data: data });
    } catch (e) {
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({ status: 'error', message: e.message || 'Failed to list unconfirmed users' });
      next(e);
    }
};
const adminConfirmUserSignUp = async (req, res, next) => {  
  try{
      console.log(req.body);
      if (!req.body || !req.body.otherProps ) {
        throw new Error("otherProps is required in the request body");
      }
      const {username} = req.body.otherProps;
      let {eid} = req.body.otherProps; // This might be provided or we'll look it up
      
      if (!username) {
        throw new Error("username is required in otherProps");
      } 
      
      // Fetch current ATTR1 for Authentication record
      const authData = {
        pk: "Authentication",
        sk: "Username#" + username + "#Profile"
      };
      const authResult = await getItem(authData);
      if (!authResult.Item || !authResult.Item.ATTR1) {
        throw new Error(`No authentication record found for user: ${username}`);
      }
      
      const authATTR1 = authResult.Item.ATTR1;
      
      // Use EID from authentication record if not provided or if provided EID is a placeholder
      if (!eid || eid === "placeholder-eid" || eid === "test-eid") {
        eid = authATTR1.eid;
        if (!eid) {
          throw new Error(`No EID found in authentication record for user: ${username}`);
        }
        console.log(`Using EID from authentication record: ${eid}`);
      }
      
      const updatedAuthATTR1 = { ...authATTR1, isConfirmedByAdmin: "true" };
      
      // Fetch current ATTR1 for Eid record
      const eidData = {
        pk: "Eid#" + eid,
        sk: "Username#" + username
      };
      const eidResult = await getItem(eidData);
      const eidATTR1 = eidResult.Item ? eidResult.Item.ATTR1 : {};
      const updatedEidATTR1 = { ...eidATTR1, isConfirmedByAdmin: "true" };
      
      const userParams = {
        userPoolId: process.env.COGNITO_USER_POOL_ID, // Replace with your User Pool ID
        username: username,
        userAttributes: [
          { Name: 'custom:isConfirmedByAdmin', Value: 'true' },
          { Name: 'email_verified', Value: 'true' }  // Also verify the email
        ]
      };
      
      let params = []
      params.push({ 
        "op": "update", 
        "pk": "Authentication", 
        "sk": "Username#" + username + "#Profile",
        'update_expression':'SET ATTR1 = :val', 
        'ex_attr_values':{':val': updatedAuthATTR1}
      });
      params.push({ 
        "op": "update", 
        "pk": "Eid#" + eid, 
        "sk": "Username#" + username,
        'update_expression':'SET ATTR1 = :val', 
        'ex_attr_values':{':val': updatedEidATTR1}
      });
      
      await transactWriteItems(params);
      await adminUpdateUserAttributes(userParams);
      
      // Also confirm the user in Cognito (skip email verification)
      try {
        await adminConfirmSignUp({
          userPoolId: process.env.COGNITO_USER_POOL_ID,
          username: username
        });
        console.log(`User ${username} confirmed in Cognito`);
      } catch (cognitoError) {
        // If user is already confirmed, that's fine
        if (cognitoError.name === 'NotAuthorizedException' || 
            cognitoError.message?.includes('already confirmed')) {
          console.log(`User ${username} was already confirmed in Cognito`);
        } else {
          console.error('Error confirming user in Cognito:', cognitoError);
          // Don't throw here, as the main confirmation might still succeed
        }
      }
      
      //console.log(resp);
      res.status(200).json({'status': 'success'});
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Admin Confirm signup failed'});
      next(e);
  }
}

const express = require('express');
const adminRouter = express.Router();

adminRouter.post('/confirmuserSignup', adminConfirmUserSignUp);

module.exports = {
    listUnconfirmedUsers, adminConfirmUserSignUp, getAllEnterprises, 
    getAllEnterprisesOfType, getAllUsersOfEnterprise, deleteEnterprise,
    adminRouter,
}