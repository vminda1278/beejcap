const express = require('express');
const authController = require('../controller/auth-controller');
const adminController = require('../controller/admin-controller');
const supplierController = require('../controller/supplier-controller');

const { checkClaims } = require('../controller/auth-controller')

// Create a simple router for the root path
const adminRouter = express.Router();
const authRouter = express.Router();
const supplierRouter = express.Router();
// Retailer router removed; all endpoints consolidated under LSP router

authRouter.post('/signup', authController.userSignUp);
authRouter.post('/confirm', authController.confirmUserSignUp);
authRouter.post('/login', authController.initiateUserAuth);
authRouter.post('/forgot-password', authController.forgotUserPassword);
authRouter.post('/confirm-forgot-password', authController.confirmUserForgotPassword);
authRouter.post('/resend-code', authController.resendVerificationCode);

adminRouter.post('/confirmUserSignup', adminController.adminConfirmUserSignUp);
adminRouter.post('/deleteEnterprise', adminController.deleteEnterprise);
adminRouter.get('/getAllEnterprises', adminController.getAllEnterprises);

supplierRouter.route('/addUser').post(checkClaims(['supplier:manageUser']), authController.userSignUp)
supplierRouter.route('/confirmUser').post(checkClaims(['supplier:manageUser']), supplierController.confirmSupplierUserSignUp);
supplierRouter.route('/deleteUser').post(checkClaims(['supplier:manageUser']), supplierController.deleteSupplierUser);

module.exports = {
  adminRouter,
  authRouter,
  supplierRouter
};

