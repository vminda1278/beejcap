const { v4: uuidv4 } = require('uuid');
const {ListUsersCommand, CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand, 
       InitiateAuthCommand, AuthFlowType, ForgotPasswordCommand, ConfirmForgotPasswordCommand, 
       AdminGetUserCommand, AdminUpdateUserAttributesCommand, AdminDeleteUserCommand, 
       ResendConfirmationCodeCommand, AdminConfirmSignUpCommand} = require("@aws-sdk/client-cognito-identity-provider");
const { fromIni } = require("@aws-sdk/credential-providers");
const { extractDomain, convertAttributesArray } = require("./helper");
const dotenv = require("dotenv");
dotenv.config()

/** snippet-start:[javascript.v3.cognito-idp.actions.ListUsers] */
const clientConfig = {
  region: process.env.COGNITO_REGION || process.env.REGION || 'ap-south-1'
};

// Add profile-based credentials if AWS_PROFILE is set
if (process.env.AWS_PROFILE) {
  clientConfig.credentials = fromIni({ profile: process.env.AWS_PROFILE });
}

const client = new CognitoIdentityProviderClient(clientConfig);
  const listUsers = () => {
    const command = new ListUsersCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID
    });
    console.log(command);
    return client.send(command);
  };
  const adminGetUser = ({ userPoolId, username }) => {
    const command = new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    });
  
    return client.send(command);
  };

  //userAttributes - Array of Objects
  const adminUpdateUserAttributes = ({ userPoolId, username, userAttributes }) => {
    const command = new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: userAttributes
    });
  
    return client.send(command);
  };
  // Will be used to get all admin users of enterprises who are not confirmed by admin
  const adminListUnconfirmedAdminUsers =  async ({userPoolId}) => {
    try {
      //console.log(userPoolId)
      const params = {
        UserPoolId: userPoolId,
        Limit: 60 // Adjust the limit as needed
      };
  
      const users = [];
      let response;
  
      do {
        const command = new ListUsersCommand(params);
        response = await client.send(command);
        //console.log(response);
        users.push(...response.Users);
        params.PaginationToken = response.PaginationToken;
      } while (response.PaginationToken);
      
      //console.log(users);
      const unconfirmedUsers = users.filter(user => {
        const u = convertAttributesArray(user.Attributes)
        console.log(u)
        return (u['custom:isConfirmedByAdmin'] === 'false' && ['lsp_admin', 'lsp_guest'].includes(u['custom:role']));
      }).map(user => {
        const u = convertAttributesArray(user.Attributes)
        return {
          username: u.email,
          enterprise_type : u['custom:enterpriseType'],
          domain: extractDomain(u.email),
          created_datetime: user.UserCreateDate,
          role: u['custom:role'],
          eid: u['custom:eid']
        }
      })

      console.log(unconfirmedUsers);
      return unconfirmedUsers;
    } catch (e) {
      console.error('Error details:', e);
      throw new Error('Failed to list unconfirmed users');
    }
  };
  

  
  const signUp = ({ clientId, password, email, username, userAttributes = [] }) => {
    const userUuid = uuidv4();
    
    const attributes = [
      { Name: "email", Value: email },
      { Name: "username", Value: username },
      ...userAttributes
    ];
    
    const command = new SignUpCommand({
      ClientId: clientId,
      Username: username,
      Password: password,
      UserAttributes: attributes,
    });
    
    return {
      cognitoResponse: client.send(command),
      Username: username
    };
  };
  
  
  const resendConfirmationCode = ({ clientId, username }) => {
    const command = new ResendConfirmationCodeCommand({
      ClientId: clientId,
      Username: username,
    });
    return client.send(command);
  };

  const confirmSignUp = ({ clientId, username, code }) => {
    const command = new ConfirmSignUpCommand({
      ClientId: clientId,
      Username: username,
      ConfirmationCode: code,
    });
  
    return client.send(command);
  };

  const forgotPassword = ({ clientId, username }) => {
    const command = new ForgotPasswordCommand({
      ClientId: clientId,
      Username: username
    });
    try{
      return client.send(command);
    }catch(e){
      console.error(e);
      throw e;
    } 
  };

  const confirmForgotPassword = ({ clientId, username, password, confirmationCode }) => {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: username,
      Password: password,
      ConfirmationCode: confirmationCode,
    });
    try{
      return client.send(command);
    }catch(e){
      console.error(e);
      throw e;
    } 
  };

  const initiateAuth = async ({ username, password, clientId }) => {
    const command = new InitiateAuthCommand({
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password
      },
      ClientId: clientId
    });
    const res = await client.send(command);
    //console.log(res);
    return res
  };
  const adminConfirmSignUp = ({ userPoolId, username }) => {
    const command = new AdminConfirmSignUpCommand({
      UserPoolId: userPoolId,
      Username: username,
    });
    return client.send(command);
  };

  const adminDeleteUser = ({ username }) => {
    try{
        const command = new AdminDeleteUserCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID,
          Username: username,
        });
        return client.send(command);
      }catch(e){
        console.error(`Failed to delete cognito user ${username}:`, e);
        throw e;
      }    
      
  };
  module.exports = {
    listUsers, signUp, confirmSignUp, initiateAuth, forgotPassword, confirmForgotPassword, 
    adminGetUser, adminUpdateUserAttributes, adminListUnconfirmedAdminUsers, adminDeleteUser, 
    resendConfirmationCode, adminConfirmSignUp
}
