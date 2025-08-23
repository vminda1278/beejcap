const { SESClient, SendEmailCommand } =require("@aws-sdk/client-ses");
const sesClient = new SESClient();

const sendEmail = async (toAddress, subject, body) => {
  const sendEmailCommand =  new SendEmailCommand({
    Destination: {
      /* required */
      CcAddresses: [
        /* more items */
      ],
      ToAddresses: [
        toAddress,
        /* more To-email addresses */
      ],
    },
    Message: {
      /* required */
      Body: {
        /* required */
        Html: {
          Charset: "UTF-8",
          Data: body,
        },
        Text: {
          Charset: "UTF-8",
          Data: body,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: process.env.DEFAULT_FROM_EMAIL || "The Beejcap Team <hello@beejcap.ai>",
    ReplyToAddresses: [
      /* more items */
    ],
  });
  try{
    const data = await sesClient.send(sendEmailCommand);
    console.log('Email sent successfully:', data.MessageId);
  }catch(e){
    console.error('Error sending Email:', e);
  }
  
};

module.exports = {
  sendEmail
}