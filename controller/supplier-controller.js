// controller/supplier-controller.js
const addUser = async (req, res, next) => {  
  try{
      console.log(req.body.data);
      res.status(200).json({'status': 'success'});
      
  }catch(e){
      console.error('Error details:', e); 
      const statusCode = e.$metadata && e.$metadata.httpStatusCode ? e.$metadata.httpStatusCode : 500;
      res.status(statusCode).json({'status': 'error', 'message': e.message || 'User signup failed'});
      next(e);
  }    
}
module.exports = {
    checkToken, validateAWSToken, userSignUp,
    confirmUserSignUp, initiateUserAuth, forgotUserPassword, confirmUserForgotPassword,
    resendVerificationCode, validateUnauthorisedAccess
}