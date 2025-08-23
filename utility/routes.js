const express = require('express');
const authController = require('../controller/auth-controller');
const adminController = require('../controller/admin-controller');

// Create a simple router for the root path
const adminRouter = express.Router();
const authRouter = express.Router();

// Retailer router removed; all endpoints consolidated under LSP router

authRouter.post('/signup', authController.userSignUp);
authRouter.post('/confirm', authController.confirmUserSignUp);
authRouter.post('/login', authController.initiateUserAuth);
authRouter.post('/forgot-password', authController.forgotUserPassword);
authRouter.post('/confirm-forgot-password', authController.confirmUserForgotPassword);
authRouter.post('/resend-code', authController.resendVerificationCode);
authRouter.post('/sendOTP', authController.sendUserOTP);
authRouter.post('/verifyOTP', authController.verifyUserOTP);
authRouter.post('/validate-token', authController.validateAWSToken);

adminRouter.post('/confirmuserSignup', adminController.adminConfirmUserSignUp);
adminRouter.post('/deleteEnterprise', adminController.deleteEnterprise);
adminRouter.get('/getAllEnterprises', adminController.getAllEnterprises);


module.exports = {
  adminRouter,
  authRouter
};

