/**
 * AWS SNS Service - SMS and Push Notifications
 * Supports SMS messaging and iOS (APNs) and Android (FCM) push notifications
 */

const { 
  SNSClient, 
  PublishCommand, 
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
} = require('@aws-sdk/client-sns');
const dotenv = require("dotenv");
const axios = require("axios");
dotenv.config();

// Create an SNS service client
//const snsClient = new SNSClient({ region, credentials }); - Required if called from localhost / different region
const snsClient = new SNSClient();

/**
 * Platform Application ARNs from environment variables
 * These are automatically set by serverless deployment
 */
const PLATFORM_APPLICATIONS = {
  IOS: process.env.SNS_PLATFORM_APPLICATION_IOS, // APNs platform application ARN
  IOS_SANDBOX: process.env.SNS_PLATFORM_APPLICATION_IOS_SANDBOX, // APNs sandbox platform application ARN  
  ANDROID: process.env.SNS_PLATFORM_APPLICATION_ANDROID, // FCM platform application ARN
};

/**
 * Get the appropriate platform application ARN based on platform and environment
 * @param {string} platform - 'ios' or 'android'
 * @param {boolean} sandbox - whether to use sandbox for iOS (development)
 * @returns {string} Platform application ARN
 */
function getPlatformApplicationArn(platform, sandbox = false) {
  const normalizedPlatform = platform.toLowerCase();
  
  if (normalizedPlatform === 'ios') {
    // Use sandbox for development, production for release
    const isProduction = process.env.STAGE === 'production' || process.env.STAGE === 'prod';
    return (isProduction && !sandbox) ? PLATFORM_APPLICATIONS.IOS : PLATFORM_APPLICATIONS.IOS_SANDBOX;
  } else if (normalizedPlatform === 'android') {
    return PLATFORM_APPLICATIONS.ANDROID;
  }
  
  throw new Error(`Unsupported platform: ${platform}. Supported platforms: ios, android`);
}

// Function to send the SMS message
const sendSMS = async (message, phoneNumber) => {
  if(process.env.STAGE === 'local') {
    console.log(`[LOCAL] SMS would be sent to ${phoneNumber}: ${message}`);
    return { success: true, messageId: 'local-test' };
  }
  
  try {
    console.log("In sendSMS - " + JSON.stringify([message, phoneNumber]));
    const params = {
      Message: message,
      PhoneNumber: phoneNumber,
    };

    const publishCommand = new PublishCommand(params);
    const data = await snsClient.send(publishCommand);
    console.log('SMS sent successfully:', data.MessageId);
    return { success: true, messageId: data.MessageId };
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send OTP SMS using Kaleyra API
 * @param {string} phoneNumber - Phone number in international format (e.g., +919741008286)
 * @param {string} otp - OTP code to send
 * @param {string} webOtpText - Optional web OTP text (default: empty string)
 * @returns {Promise<Object>} API response with success status and message details
 */
const sendOtpSMS = async (phoneNumber, otp, webOtpText = "") => {
  if(process.env.STAGE === 'local') {
    console.log(`[LOCAL] OTP SMS would be sent to ${phoneNumber}: OTP ${otp}`);
    return { success: true, messageId: 'local-test-otp', otp };
  }

  try {
    console.log("In sendOtpSMS - " + JSON.stringify({ phoneNumber, otp, webOtpText }));
    
    // Hardcoded Kaleyra API configuration
    const KALEYRA_SID = 'HXIN1827833295IN';
    const KALEYRA_API_KEY = 'A7ebc47d1bfef3c66e71501670ac56b26';
    const KALEYRA_TEMPLATE_ID = '1107175144599751105';
    const KALEYRA_SENDER = 'PROROU';
    const WEBHOOK_URL = 'https://ondc-logistics.prorouting.in/vendor/webhook/kaleyra/sms';

    const url = `https://api.kaleyra.io/v2/${KALEYRA_SID}/messages`;
    
    const payload = {
      to: phoneNumber,
      sender: KALEYRA_SENDER,
      type: "OTP",
      channel: "SMS",
      template_id: KALEYRA_TEMPLATE_ID,
      template_data: {
        otp: otp,
        web_otp_text: webOtpText
      },
      callback: {
        url: WEBHOOK_URL,
        method: "POST"
      }
    };

    const config = {
      method: 'post',
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'api-key': KALEYRA_API_KEY
      },
      data: payload
    };

    console.log('Sending OTP SMS via Kaleyra API:', JSON.stringify(payload, null, 2));
    
    const response = await axios(config);
    
    console.log('OTP SMS sent successfully:', response.data);
    
    return {
      success: true,
      messageId: response.data.id,
      status: response.data.status,
      sender: response.data.sender,
      type: response.data.type,
      to: phoneNumber,
      otp: otp
    };

  } catch (error) {
    console.error('Error sending OTP SMS via Kaleyra:', error.response?.data || error.message);
    
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.data?.code || 'UNKNOWN_ERROR',
      phoneNumber
    };
  }
};

/**
 * Register device for push notifications
 * @param {string} platform - 'ios' or 'android'
 * @param {string} deviceToken - Device token from app
 * @param {string} userId - User identifier
 * @param {boolean} sandbox - Use sandbox for iOS (development)
 * @returns {Promise<Object>} Registration result with endpoint ARN
 */
const registerDevice = async (platform, deviceToken, userId, sandbox = false) => {
  try {
    console.log(`Registering device for platform: ${platform}, userId: ${userId}`);
    
    const platformArn = getPlatformApplicationArn(platform, sandbox);
    
    if (!platformArn) {
      const availablePlatforms = Object.keys(PLATFORM_APPLICATIONS)
        .filter(key => PLATFORM_APPLICATIONS[key])
        .map(key => key.toLowerCase())
        .join(', ');
      
      throw new Error(
        `Platform ${platform} not configured. Please set up platform application in AWS SNS. ` +
        `Available platforms: ${availablePlatforms || 'none'}`
      );
    }

    console.log(`Using platform application ARN: ${platformArn}`);

    const params = {
      PlatformApplicationArn: platformArn,
      Token: deviceToken,
      CustomUserData: JSON.stringify({ 
        userId,
        registeredAt: new Date().toISOString(),
        platform,
        sandbox 
      })
    };

    const command = new CreatePlatformEndpointCommand(params);
    const result = await snsClient.send(command);
    
    console.log(`Device registered successfully. Endpoint ARN: ${result.EndpointArn}`);
    
    return {
      success: true,
      endpointArn: result.EndpointArn,
      platform,
      userId,
      deviceToken: deviceToken.substring(0, 10) + '...', // Masked for security
      registeredAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error registering device for push notifications:', error);
    
    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.name === 'InvalidParameter') {
      errorMessage = `Invalid device token or platform configuration for ${platform}`;
    } else if (error.name === 'NotFound') {
      errorMessage = `Platform application not found for ${platform}. Please configure SNS platform application.`;
    }
    
    return {
      success: false,
      error: errorMessage,
      platform,
      userId
    };
  }
};

/**
 * Send push notification to specific device
 * @param {string} endpointArn - SNS endpoint ARN
 * @param {Object} notification - Notification payload
 * @returns {Promise<Object>} Send result
 */
const sendPushNotification = async (endpointArn, notification) => {
  try {
    console.log(`Sending push notification to endpoint: ${endpointArn}`);
    
    const { title, body, data = {}, platform } = notification;
    
    // Create platform-specific payload
    let message = {};
    
    // Always include a default message
    message.default = `${title}: ${body}`;
    
    // Add platform-specific formatting
    if (platform === 'ios' || !platform) {
      // APNs payload for iOS
      const apnsPayload = {
        aps: {
          alert: {
            title,
            body
          },
          badge: 1,
          sound: 'default',
          'content-available': 1
        }
      };
      
      // Add custom data to root level for iOS
      Object.keys(data).forEach(key => {
        apnsPayload[key] = data[key];
      });
      
      message.APNS = JSON.stringify(apnsPayload);
      message.APNS_SANDBOX = JSON.stringify(apnsPayload); // For development
    }
    
    if (platform === 'android' || !platform) {
      // FCM payload for Android
      const fcmPayload = {
        notification: {
          title,
          body,
          sound: 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        }
      };
      
      message.GCM = JSON.stringify(fcmPayload);
    }

    const params = {
      TargetArn: endpointArn,
      Message: JSON.stringify(message),
      MessageStructure: 'json'
    };

    console.log('SNS message payload:', JSON.stringify(params, null, 2));

    const command = new PublishCommand(params);
    const result = await snsClient.send(command);
    
    console.log('Push notification sent successfully:', result.MessageId);
    
    return {
      success: true,
      messageId: result.MessageId,
      endpointArn
    };
    
  } catch (error) {
    console.error('Error sending push notification:', error);
    
    // Handle specific SNS errors
    let errorMessage = error.message;
    if (error.name === 'EndpointDisabled') {
      errorMessage = 'Device endpoint is disabled. Device may have uninstalled the app.';
    } else if (error.name === 'InvalidParameter') {
      errorMessage = 'Invalid notification payload or endpoint ARN.';
    }
    
    return {
      success: false,
      error: errorMessage,
      endpointArn
    };
  }
};

/**
 * Unregister device from push notifications
 * @param {string} endpointArn - SNS endpoint ARN
 * @returns {Promise<Object>} Unregistration result
 */
const unregisterDevice = async (endpointArn) => {
  try {
    const params = {
      EndpointArn: endpointArn
    };

    const command = new DeleteEndpointCommand(params);
    await snsClient.send(command);
    
    console.log('Device unregistered successfully:', endpointArn);
    
    return {
      success: true,
      endpointArn
    };
  } catch (error) {
    console.error('Error unregistering device:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  // SMS functionality (preserved existing feature)
  sendSMS,
  sendOtpSMS,
  registerDevice,
  sendPushNotification,
  unregisterDevice
};
