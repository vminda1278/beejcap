const { v4: uuidv4 } = require('uuid');
const {putItem, getItem, deleteItem,updateItem,queryItem, transactWriteItems} = require("../utility/db")
const {signUp, confirmSignUp, initiateAuth, forgotPassword, confirmForgotPassword, adminGetUser, resendConfirmationCode} = require('../utility/cognito');
const {sendSMS, sendOtpSMS, registerDevice} = require("../utility/sns")
const {ROLES_CLAIMS} = require('../config');
let jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const dotenv = require("dotenv");
const axios = require('axios');
const { checkUserExistsInEnterpriseModel } = require('../model/enterprise');
const { logger } = require('../utility/logger');
dotenv.config()

const userSignUp = async (req, res, next) => {  
  try{
      console.log(req.body.data);
      const data = req.body.data;
      
      // Validate required fields for standard roles
      if(!data || !data.email || !data.password ||  !data.enterprise_type || !data.clientId){
          res.status(500).json({ 'status': 'error', 'message': 'Email, password, enterprise_type and clientId are required' });
          return;
      }
      if(!data.username){
          data.username = data.email.toLowerCase();
      }
    if(!data.eid && !data.business_name){ // Business name is required for new enterprise setup
        res.status(500).json({ 'status': 'error', 'message': 'business_name is required' });
    }
          
    let {email, password, business_name, enterprise_type, clientId, username} = data; 
    if (!['superadmin', 'supplier', 'retailer', 'financier'].includes(enterprise_type)) {
          res.status(500).json({ 'status': 'error', 'message': 'Invalid enterprise type. Supported types: superadmin, supplier, retailer, financier' });
          return;
      }
      //email = email.toLowerCase();

      let userRes = await getItem({ "pk": "Authentication", "sk": "Username#" + username + "#Profile"})
      
      // Determine role based on existing user or new enterprise
      if(data.eid){ // Internal users getting added
        if(!data.role)
            res.status(500).json({ 'status': 'error', 'message': 'Role is required adding for internal users' });
        if(data.role && !ROLES_CLAIMS[data.role])
            res.status(500).json({ 'status': 'error', 'message': 'Invalid role for internal users' });
        if(data.eid !== req.user['custom:eid'])
            res.status(500).json({ 'status': 'error', 'message': 'Wrong eid provided' });
      }
      let role = (data.eid) ? data.role : enterprise_type + '_admin';

      let eid = data.eid || uuidv4(); // If eid is not provided, generate a new one
      // Initialize params as an empty array
      let params = [];
      if(userRes?.Item?.ATTR1?.eid){
         eid = userRes.Item.ATTR1.eid;
      }
      
      // Prepare enterprise attributes
      let enterpriseAttrs = {
          "eid": eid, 
          "enterprise_type": enterprise_type, 
          "create_datetime": Date.now(), 
          "admin": username, 
          "business_name": business_name, 
          "email_verified": "no"
      };
      
      // Prepare authentication attributes
      let authAttrs = {
          "eid": eid, 
          "username": username, 
          "enterprise_type": enterprise_type, 
          "create_datetime": Date.now(), 
          "role": role, 
          "isConfirmedByAdmin": "false"
      };
      
      params.push({ "op": "update", "pk": "Enterprise", "sk": "EnterpriseType#" + enterprise_type + ":Eid#" + eid,'update_expression':'SET ATTR1 = :val', 'ex_attr_values':{':val': enterpriseAttrs}});
      params.push({ "op": "update", "pk": "Enterprise", "sk": "Profile:" + "Eid#" + eid,'update_expression':'SET ATTR1 = :val', 'ex_attr_values':{':val': enterpriseAttrs}});
      params.push({ "op": "update", "pk": "Authentication", "sk": "Username#" + username + "#Profile",'update_expression':'SET ATTR1 = :val', 'ex_attr_values':{':val': authAttrs}});
      params.push({ "op": "update", "pk": "Eid#" + eid, "sk": "Username#" + username,'update_expression':'SET ATTR1 = :val', 'ex_attr_values':{':val': authAttrs}});

      await transactWriteItems(params);
      
      // Prepare user attributes for Cognito
      let userAttributes = [
          { Name: 'custom:isConfirmedByAdmin', Value: 'false' },
          { Name: 'custom:enterpriseType', Value: enterprise_type },
          { Name: 'custom:role', Value: role },
          { Name: 'custom:eid', Value: eid }
      ];
      
      const signUpResult = await signUp({ 
                                  'clientId': clientId, 
                                  'password': password, 
                                  'email': email, 
                                  'username': username,
                                  'userAttributes': userAttributes
                                });
      
      // Wait for the Cognito response to complete
      const cognitoResponse = await signUpResult.cognitoResponse;
      console.log('Cognito response:', cognitoResponse);
      
      res.status(200).json({'status': 'success'});
      
  }catch(e){
      console.error('Error details:', e);
      
      // Handle specific Cognito errors
      if (e.__type === 'UsernameExistsException' || e.name === 'UsernameExistsException') {
          return res.status(409).json({
              'status': 'error', 
              'message': 'User already exists with this email address'
          });
      }
      
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'User signup failed'});
      next(e);
  }    
}
const confirmUserSignUp = async (req, res, next) => {  
  try{
      console.log(req.body.data);
      const data = req.body.data;
      data.username = data.username.toLowerCase();
      const resp = await confirmSignUp({ 'clientId': data.clientId, 'username': data.username, 'code': data.code })
      console.log(resp);
      res.status(200).json({'status': 'success'});
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Confirm signup failed'});
      next(e);
  }
}
const resendVerificationCode = async (req, res, next) => {  
  try{
      const data = req.body.data;
      data.username = data.username.toLowerCase();
      const resp = await resendConfirmationCode({ 'clientId': data.clientId, 'username': data.username})
      console.log(resp);
      res.status(200).json({'status': 'success'});
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Confirm signup failed'});
      next(e);
  }
}

const initiateUserAuth = async (req, res, next) => {  
  try{
    
      //console.log(req.body.data);
      if(!req.body.data || !req.body.data.username || !req.body.data.password || !req.body.data.clientId){
          return res.status(500).json({ 'status': 'error', 'message': 'Username, password and clientId are required' });
      }
      //const data = req.body.data;
        // Fetch user attributes
      //data.username = data.username.toLowerCase();
      let {username, password, clientId} = req.body.data;
      username = username.toLowerCase();
      const userParams = {
        userPoolId: process.env.COGNITO_USER_POOL_ID, // Replace with your User Pool ID
        username: username
      };
      const userData = await adminGetUser(userParams);
      //console.log(userData)
      
      if(userData.UserStatus !== 'CONFIRMED'){
        return res.status(500).json({ 'status': 'error', 'message': 'User is not confirmed. Please verify your email.' });
      }
      
      // Get user details from database to check role
      let dres = await getItem({ "pk": "Authentication", "sk": "Username#" + username + "#Profile"});
      if(!dres.Item){
          return res.status(500).json({ 'status': 'error', 'message': 'User not found - Please signup again' });
      }
      if(!dres.Item.ATTR1 || !dres.Item.ATTR1.eid || !dres.Item.ATTR1.enterprise_type || !dres.Item.ATTR1.role){
          return res.status(500).json({ 'status': 'error', 'message': 'User details not found' });
      }
      const {eid, enterprise_type, role} = dres.Item.ATTR1;
      
      // Check admin confirmation for all users
      const isConfirmedByAdmin = userData.UserAttributes.find(attr => attr.Name === 'custom:isConfirmedByAdmin');
      if (!isConfirmedByAdmin || isConfirmedByAdmin.Value !== 'true') {
        return res.status(500).json({ 'status': 'error', 'message': 'User is not confirmed by admin' });
      }

      // Removed getMenuForEnterpriseType call - not implemented in lsp-oms
      const resp = await initiateAuth({ 'clientId': clientId, 'username': username, 'password': password })
      const display_name = enterprise_type.charAt(0).toUpperCase() + enterprise_type.slice(1) +  '-' + username.split("@")[0].charAt(0).toUpperCase() + username.split("@")[0].slice(1);
      
      // Prepare response
      let tokenResponse = {
          'jwt': resp.AuthenticationResult.IdToken, 
          'eid': eid, 
          'username': username, 
          'enterprise_type': enterprise_type, 
          'display_name': display_name, 
          'role': role
      };
      
      res.status(200).json({'status': 'success', 'token': tokenResponse});
        //return {'menu': joinedData, }
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Authentication failed'});
      next(e);
  }
}
const forgotUserPassword = async (req, res, next) => {  
  try{
      const data = req.body.data;
      data.username = data.username.toLowerCase();
      console.log(data);
      const resp = await forgotPassword({ 'clientId': data.clientId, 'username': data.username })
      console.log(resp);
      res.status(200).json({'status': 'success'});
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Forgot Password failed'});
      next(e);
  }
}
const confirmUserForgotPassword = async (req, res, next) => {  
  try{
      const data = req.body.data;
      console.log(data);
      data.username = data.username.toLowerCase();
      const resp = await confirmForgotPassword({ 'clientId': data.clientId, 'username': data.username, 
                                                  'password':data.password, 'confirmationCode': data.confirmationCode 
                                              })
      console.log(resp);
      res.status(200).json({'status': 'success'});
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Confirm Forgot Password failed'});
      next(e);
  }
}

const checkToken = async(req, res, next) => {
    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    if (token !== undefined && token.startsWith('Bearer ')) {
        // Remove Bearer from string
        token = token.slice(7, token.length);
    }
    if (token) {
          jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (err) {
            return res.json({
              status: 'error',
              message: 'Token is not valid',
              code:'TOKEN_INVALID'
            });
          } else {
            req.decoded = decoded;
            console.log("Decoded token:", decoded)
            //How to handle token expiry
            if(decoded.exp < Date.now().valueOf() / 1000){
                return res.json({
                    status: 'error',
                    message: 'Token has expired',
                    code:'TOKEN_EXPIRED'
                });
            }else{
                req.user = decoded;
                next();
            }    
          }
        });
    } else {
        return res.json({
            status: 'error',
            message: 'Auth token is not supplied',
            code:'TOKEN_NOT_SUPPLIED'
        });
    }
    //next(); 
}

const validateUnauthorisedAccess = async (req, res, next) => {  
  try{
      const decoded_eid = req.user['custom:eid'];
      if(!decoded_eid)
          res.status(403).json({ 'status': 'error', message: 'Forbidden - Enterprise ID not set' });

      const eid = req.body?.data?.eid || req.body?.eid;
      if(eid && eid !== decoded_eid)
          res.status(403).json({ 'status': 'error', message: 'Forbidden - Not authorised to perform this action' });
      next()     
  }catch(e){
      console.error('Error details:', e);
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'Forgot Password failed'});
      next(e);
  }
}

//This validates the JWT token sent by the user usign cognito public key. This is normally not required when 
//using AWS API gateway which is using cognito user pool authorisers
const validateAWSToken = async (req, res, next) => {
    //const token = req.headers.authorization?.split(' ')[1]; // Assuming token is sent as a Bearer token

    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    console.log("In validateAWSToken", token);
    
        // Strictly check for missing/invalid tokens
    if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
        console.log('❌ No token provided or token is undefined/null/empty');
        return res.status(401).json({
            status: 'error',
            message: 'Access Token Required'
        });
    }
    if (token !== undefined && token.startsWith('Bearer ')) {
        token = token.slice(7, token.length);
    }
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'Access Token Required' });
    }
  
    try {
      console.log("COGNITO_ISSUER:", process.env.COGNITO_ISSUER);
      const response = await axios.get(process.env.COGNITO_ISSUER + "/.well-known/jwks.json");
      const pems = {};
      const keys = response.data.keys;
      for (let key of keys) {
        pems[key.kid] = jwkToPem({ kty: key.kty, n: key.n, e: key.e });
      }
  
      const decodedToken = jwt.decode(token, { complete: true });
      console.log("Decoded Token:", decodedToken);
      if (!decodedToken) {
        console.log("Failed to decode token");
        return res.status(401).json({ status: 'error', message: 'Invalid Access Token - 1' });
      }
  
      const pem = pems[decodedToken.header.kid];
      if (!pem) {
        console.log("No matching PEM found for kid:", decodedToken.header.kid);
        return res.status(401).json({ status: 'error', message: 'Invalid Access Token - 2' });
      }
  
      jwt.verify(token, pem, { issuer: process.env.COGNITO_ISSUER }, (err, decoded) => {
        if (err) {
          console.log("JWT verification failed:", err.message);
          return res.status(401).json({ status: 'error', message: 'Invalid Access Token - 3' });
        }
        console.log("JWT verification successful");
        req.user = decoded;
        next();
      });
    } catch (error) {
      console.error("validateAWSToken error:", error);
      return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
  };
  function checkClaims(requiredClaims) {
    //console.log("requiredClaims - ", requiredClaims)
    return function (req, res, next) {
        //console.log("In checkClaims - ", req.user['custom:claims'])
        const userRole = req.user['custom:role'];

        if(!userRole){
            console.error("Role not found in token")
            return res.status(403).json({ message: 'Forbidden - Not authorised to perform this action' });
        }
        if (!ROLES_CLAIMS[userRole]) {
            console.error("Role claims not found for user role:", userRole);
            return res.status(403).json({ message: 'Forbidden - Not authorised to perform this action' });
        }
        //console.log('Role Claims - ',ROLES_CLAIMS[userRole])
        const hasRequiredClaims = requiredClaims.some(claim => ROLES_CLAIMS[userRole].includes(claim));
        if (hasRequiredClaims) {
            //console.log("Has required claims")
            next();
        } else {
            console.error("Does not have required claims")
            res.status(403).json({ message: 'Forbidden - Not authorised to perform this action' });
        }
    };
  }
module.exports = {
    checkToken, validateAWSToken, userSignUp,
    confirmUserSignUp, initiateUserAuth, forgotUserPassword, confirmUserForgotPassword,
    resendVerificationCode, validateUnauthorisedAccess, checkClaims
}