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
      if(!data || !data.email || !data.password || !data.business_name || !data.enterprise_type || !data.clientId){
          res.status(500).json({ 'status': 'error', 'message': 'Email, password, business_name, enterprise_type and clientId are required' });
          return;
      }
      if(!data.username){
          data.username = data.email.toLowerCase();
      }
      
    let {email, password, business_name, enterprise_type, clientId, mobile_number, username} = data; 
    if (!['lsp', 'superadmin', 'supplier', 'retailer', 'financier'].includes(enterprise_type)) {
          res.status(500).json({ 'status': 'error', 'message': 'Invalid enterprise type. Supported types: lsp, superadmin, supplier, retailer, financier' });
          return;
      }
      //email = email.toLowerCase();

      let userRes = await getItem({ "pk": "Authentication", "sk": "Username#" + username + "#Profile"})
      
      // Determine role based on existing user or new enterprise
      let role = (data.eid) ? enterprise_type + '_guest' : enterprise_type + '_admin';
      
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

const sendUserOTP = async (req, res, next) => {  
    const startTime = Date.now();
    const requestId = logger.logRequestStart('POST /v1/auth/send-otp', req);
    const requestLogger = logger.child({ requestId, operation: 'sendUserOTP' });

    try {
        requestLogger.debug('Starting OTP generation', {
            body: req.body,
            headers: {
                userAgent: req.headers['user-agent'],
                ip: req.ip || req.connection.remoteAddress
            }
        });
        
        // Input validation
        if (!req.body || !req.body.mobile_number || !req.body.eid) {
            requestLogger.warn('Input validation failed - missing required fields', {
                hasBody: !!req.body,
                hasMobileNumber: !!(req.body && req.body.mobile_number),
                hasEid: !!(req.body && req.body.eid)
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 400, duration, {
                result: 'validation_error',
                reason: 'missing_required_fields'
            });

            return res.status(400).json({
                'status': 'error', 
                'message': 'Mobile number and enterprise ID (eid) are required'
            });
        }
        
        // Sanitize and validate mobile number format (E.164)
        const mobileNumber = req.body.mobile_number.trim();
        if (!mobileNumber.match(/^\+[1-9]\d{1,14}$/)) {
            requestLogger.warn('Mobile number format validation failed', {
                mobileNumber: mobileNumber,
                format: 'E.164_required'
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 400, duration, {
                result: 'validation_error',
                reason: 'invalid_mobile_format'
            });

            return res.status(400).json({
                'status': 'error', 
                'message': 'Invalid mobile number format. Use E.164 format (+1234567890)'
            });
        }

        const username = mobileNumber + "@lsp-rider.local";
        
        requestLogger.info('Input validation successful', {
            mobileNumber: mobileNumber,
            eid: req.body.eid,
            username: username
        });

        try {
            requestLogger.logBusinessOperation('userExistenceCheck', {
                eid: req.body.eid,
                username: username
            }, 'start');

            // Check if user exists and is approved in the enterprise
            await checkUserExistsInEnterpriseModel({
                eid: req.body.eid,
                username: username
            });

            requestLogger.logBusinessOperation('userExistenceCheck', {
                eid: req.body.eid,
                username: username
            }, 'success');
        } catch (e) {
            requestLogger.warn('User existence check failed', {
                eid: req.body.eid,
                username: username,
                error: e.message
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 403, duration, {
                result: 'authorization_error',
                reason: e.message
            });

            return res.status(403).json({
                'status': 'error',
                'message': e.message
            });
        }
         
        // Use test OTP for test phone numbers, otherwise generate random OTP
        const isTestNumber = mobileNumber.startsWith('+9199999');
        const otp = isTestNumber ? '123456' : String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP as string
        //const otp = '123456'
        const otpExpiry = Date.now() + (5 * 60 * 1000); // OTP expires in 5 minutes
        
        requestLogger.debug('OTP generated', {
            mobileNumber: mobileNumber,
            isTestNumber: isTestNumber,
            otpLength: otp.length,
            expiryTime: new Date(otpExpiry).toISOString()
        });
        
        // Send SMS (skip for test numbers to avoid costs)
        if (!isTestNumber) {
            try {
                requestLogger.logExternalCall('Kaleyra', 'sendOtpSMS', {
                    mobileNumber: mobileNumber,
                    otpLength: otp.length
                }, 'start');

                const smsResult = await sendOtpSMS(mobileNumber, otp);
                
                if (!smsResult.success) {
                    throw new Error(smsResult.error || 'Failed to send OTP SMS');
                }

                requestLogger.logExternalCall('Kaleyra', 'sendOtpSMS', {
                    mobileNumber: mobileNumber,
                    messageId: smsResult.messageId,
                    status: smsResult.status
                }, 'success');

                requestLogger.info('OTP SMS sent via Kaleyra', {
                    mobileNumber: mobileNumber,
                    messageId: smsResult.messageId,
                    sender: smsResult.sender,
                    type: smsResult.type
                });
            } catch (smsError) {
                requestLogger.logExternalCall('Kaleyra', 'sendOtpSMS', {
                    mobileNumber: mobileNumber,
                    error: smsError.message
                }, 'error');

                requestLogger.error('OTP SMS sending failed', {
                    mobileNumber: mobileNumber,
                    error: smsError.message,
                    stack: smsError.stack
                }, smsError);

                const duration = Date.now() - startTime;
                logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 500, duration, {
                    result: 'sms_error',
                    error: smsError.message
                });

                return res.status(500).json({
                    'status': 'error', 
                    'message': 'Failed to send OTP. Please try again.'
                });
            }
        } else {
            requestLogger.info('Test mode OTP - skipping SMS', {
                mobileNumber: mobileNumber,
                testOtp: otp
            });
        }
    
        // Store OTP in database with expiry
        requestLogger.logExternalCall('DynamoDB', 'updateItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`
        }, 'start');

        const resp = await updateItem({
            "pk": "Authentication", 
            "sk": "Mobile#" + mobileNumber,
            'update_expression':'SET otp = :otp, otp_expiry = :expiry', 
            'ex_attr_values': {':otp': otp, ':expiry': otpExpiry}
        });

        requestLogger.logExternalCall('DynamoDB', 'updateItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`
        }, 'success');

        requestLogger.info('OTP sent successfully', {
            mobileNumber: mobileNumber,
            isTestNumber: isTestNumber,
            expiresIn: 300
        });

        const duration = Date.now() - startTime;
        logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 200, duration, {
            result: 'success',
            mobileNumber: mobileNumber,
            isTestNumber: isTestNumber
        });
        
        res.status(200).json({
            'status': 'success', 
            'message': 'OTP sent successfully',
            'expires_in': 300 // 5 minutes in seconds
        });
    } catch(e) {
        requestLogger.error('OTP sending failed with exception', {
            mobileNumber: req.body ? req.body.mobile_number : null,
            eid: req.body ? req.body.eid : null,
            error: e.message,
            stack: e.stack
        }, e);

        const duration = Date.now() - startTime;
        logger.logRequestEnd('POST /v1/auth/send-otp', requestId, 500, duration, {
            result: 'error',
            error: e.message
        });

        const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
        res.status(statusCode).json({'status': 'error', 'message': e.message || 'Failed to send OTP'});
        next(e);
    }
}
const verifyUserOTP = async (req, res, next) => {
    const startTime = Date.now();
    const requestId = logger.logRequestStart('POST /v1/auth/verify-otp', req);
    const requestLogger = logger.child({ requestId, operation: 'verifyUserOTP' });

    try{
        // Input validation
        requestLogger.debug('Starting OTP verification', {
            body: req.body,
            headers: {
                userAgent: req.headers['user-agent'],
                ip: req.ip || req.connection.remoteAddress
            }
        });
        
        if (!req.body || !req.body.mobile_number || !req.body.otp) {
            requestLogger.warn('Input validation failed - missing required fields', {
                hasBody: !!req.body,
                hasMobileNumber: !!(req.body && req.body.mobile_number),
                hasOtp: !!(req.body && req.body.otp)
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 400, duration, {
                result: 'validation_error',
                reason: 'missing_required_fields'
            });

            return res.status(400).json({'status': 'error', 'message': 'Mobile number and OTP are required'});
        }
        
        // Sanitize and validate mobile number format (E.164)
        const mobileNumber = req.body.mobile_number.trim();
        const otpInput = String(req.body.otp).trim();
        
        if (!mobileNumber.match(/^\+[1-9]\d{1,14}$/)) {
            requestLogger.warn('Mobile number format validation failed', {
                mobileNumber: mobileNumber,
                format: 'E.164_required'
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 400, duration, {
                result: 'validation_error',
                reason: 'invalid_mobile_format'
            });

            return res.status(400).json({'status': 'error', 'message': 'Invalid mobile number format. Use E.164 format (+1234567890)'});
        }
        
        // Validate OTP format (6 digits)
        if (!otpInput.match(/^\d{6}$/)) {
            requestLogger.warn('OTP format validation failed', {
                mobileNumber: mobileNumber,
                otpLength: otpInput.length,
                otpFormat: 'should_be_6_digits'
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 400, duration, {
                result: 'validation_error',
                reason: 'invalid_otp_format'
            });

            return res.status(400).json({'status': 'error', 'message': 'OTP must be 6 digits'});
        }

        requestLogger.info('Input validation successful', {
            mobileNumber: mobileNumber,
            otpLength: otpInput.length
        });
        
        // Get OTP from database
        requestLogger.logExternalCall('DynamoDB', 'getItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`
        }, 'start');

        const otpRecord = await getItem({"pk": "Authentication", "sk": "Mobile#" + mobileNumber});

        requestLogger.logExternalCall('DynamoDB', 'getItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`,
            found: !!otpRecord.Item
        }, 'success');
        
        if (!otpRecord.Item || !otpRecord.Item.otp) {
            requestLogger.warn('OTP record not found', {
                mobileNumber: mobileNumber,
                hasRecord: !!otpRecord.Item,
                hasOtp: !!(otpRecord.Item && otpRecord.Item.otp)
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 401, duration, {
                result: 'otp_not_found',
                mobileNumber: mobileNumber
            });

            return res.status(401).json({'status': 'error', 'message': 'OTP not found. Please request a new OTP.'});
        }
        
        // Check if OTP is expired
        if (otpRecord.Item.otp_expiry && Date.now() > otpRecord.Item.otp_expiry) {
            requestLogger.warn('OTP expired', {
                mobileNumber: mobileNumber,
                expiry: new Date(otpRecord.Item.otp_expiry).toISOString(),
                currentTime: new Date().toISOString()
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 401, duration, {
                result: 'otp_expired',
                mobileNumber: mobileNumber
            });

            return res.status(401).json({'status': 'error', 'message': 'OTP has expired. Please request a new OTP.'});
        }
        
        // Verify OTP (ensure both are strings for comparison)
        if (String(otpRecord.Item.otp) !== otpInput) {
            requestLogger.warn('OTP verification failed', {
                mobileNumber: mobileNumber,
                otpMatches: false
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 401, duration, {
                result: 'invalid_otp',
                mobileNumber: mobileNumber
            });

            return res.status(401).json({'status': 'error', 'message': 'Invalid OTP'});
        }

        requestLogger.info('OTP verification successful', {
            mobileNumber: mobileNumber
        });
        
        // Get user details from Authentication table (LSP rider)
        const username = mobileNumber + "@lsp-rider.local";
        requestLogger.logExternalCall('DynamoDB', 'getItem', {
            pk: 'Authentication',
            sk: `Username#${username}#Profile`
        }, 'start');

        const userRecord = await getItem({
            "pk": "Authentication", 
            "sk": "Username#" + username + "#Profile"
        });

        requestLogger.logExternalCall('DynamoDB', 'getItem', {
            pk: 'Authentication',
            sk: `Username#${username}#Profile`,
            found: !!userRecord.Item
        }, 'success');
        
        if (!userRecord.Item || !userRecord.Item.ATTR1) {
            requestLogger.warn('User profile not found', {
                mobileNumber: mobileNumber,
                username: username,
                hasRecord: !!userRecord.Item,
                hasAttr1: !!(userRecord.Item && userRecord.Item.ATTR1)
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 404, duration, {
                result: 'user_not_found',
                mobileNumber: mobileNumber
            });

            return res.status(404).json({'status': 'error', 'message': 'User not found. Please contact admin.'});
        }
        
        const userInfo = userRecord.Item.ATTR1;
        
        // Check if user is confirmed by admin
        if (userInfo.isConfirmedByAdmin !== 'true') {
            requestLogger.warn('User not approved by admin', {
                mobileNumber: mobileNumber,
                username: username,
                eid: userInfo.eid,
                isConfirmedByAdmin: userInfo.isConfirmedByAdmin
            });

            const duration = Date.now() - startTime;
            logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 403, duration, {
                result: 'not_approved',
                mobileNumber: mobileNumber,
                eid: userInfo.eid
            });

            return res.status(403).json({'status': 'error', 'message': 'Account not yet approved by admin'});
        }

        requestLogger.info('User validation successful', {
            mobileNumber: mobileNumber,
            username: username,
            eid: userInfo.eid,
            role: userInfo.role,
            enterpriseType: userInfo.enterprise_type
        });
        
        // Generate JWT payload similar to Cognito token structure
        const jwtPayload = {
            sub: userInfo.eid, // Subject - using enterprise ID as user ID
            email_verified: false, // OTP users don't have verified email
            iss: 'lsp-oms-otp', // Issuer
            'cognito:username': username,
            'custom:enterpriseType': userInfo.enterprise_type || 'lsp',
            'custom:eid': userInfo.eid,
            'custom:isConfirmedByAdmin': 'true',
            'custom:role': userInfo.role || 'lsp_rider',
            'custom:mobileNumber': mobileNumber,
            'custom:authMethod': 'otp',
            aud: 'lsp-oms-client', // Audience
            event_id: 'otp-' + Date.now(), // Event ID
            token_use: 'id',
            auth_time: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (4 * 60 * 60), // Expires in 4 hours
            iat: Math.floor(Date.now() / 1000), // Issued at
            jti: 'otp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9), // JWT ID
            username: username
        };
        
        requestLogger.logBusinessOperation('jwtGeneration', {
            mobileNumber: mobileNumber,
            eid: userInfo.eid,
            role: userInfo.role,
            expiresIn: '4_hours'
        }, 'start');

        // Generate JWT token
        const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET);

        requestLogger.logBusinessOperation('jwtGeneration', {
            mobileNumber: mobileNumber,
            eid: userInfo.eid,
            tokenLength: jwtToken.length
        }, 'success');
        
        // Create response similar to Cognito login response
        const display_name = "Lsp-" + mobileNumber;
        const tokenResponse = {
            'jwt': jwtToken,
            'eid': userInfo.eid,
            'username': username,
            'enterprise_type': userInfo.enterprise_type || 'lsp',
            'display_name': display_name,
            'role': userInfo.role || 'lsp_rider',
            'mobile_number': mobileNumber,
            'auth_method': 'otp'
        };
        
        // Clear OTP after successful verification
        requestLogger.logExternalCall('DynamoDB', 'updateItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`,
            operation: 'clear_otp'
        }, 'start');

        await updateItem({
            "pk": "Authentication", 
            "sk": "Mobile#" + mobileNumber,
            'update_expression':'REMOVE otp, otp_expiry'
        });

        requestLogger.logExternalCall('DynamoDB', 'updateItem', {
            pk: 'Authentication',
            sk: `Mobile#${mobileNumber}`,
            operation: 'clear_otp'
        }, 'success');

        requestLogger.info('OTP verification completed successfully', {
            mobileNumber: mobileNumber,
            username: username,
            eid: userInfo.eid,
            role: userInfo.role,
            authMethod: 'otp'
        });

        const duration = Date.now() - startTime;
        logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 200, duration, {
            result: 'success',
            mobileNumber: mobileNumber,
            eid: userInfo.eid,
            role: userInfo.role
        });
        
        res.status(200).json({
            'status': 'success', 
            'message': 'OTP verified successfully',
            'token': tokenResponse
        });
        
    }catch(e){
        requestLogger.error('OTP verification failed with exception', {
            mobileNumber: req.body ? req.body.mobile_number : null,
            error: e.message,
            stack: e.stack
        }, e);

        const duration = Date.now() - startTime;
        logger.logRequestEnd('POST /v1/auth/verify-otp', requestId, 500, duration, {
            result: 'error',
            error: e.message
        });

        const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
        res.status(statusCode).json({'status': 'error', 'message': e.message || 'OTP verification failed'});
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

      const eid = req.body?.meta?.eid || req.body?.data?.ATTR1?.eid || req.body?.data?.eid || req.body?.eid;
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
module.exports = {
    sendUserOTP, verifyUserOTP, checkToken, validateAWSToken, userSignUp, 
    confirmUserSignUp, initiateUserAuth, forgotUserPassword, confirmUserForgotPassword,
    resendVerificationCode, validateUnauthorisedAccess
}