const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { fromIni } = require("@aws-sdk/credential-providers");
const dotenv = require("dotenv");
dotenv.config();
const { PutCommand, GetCommand, UpdateCommand, DeleteCommand, DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
const { logger } = require('./logger'); // Use the project's custom logger

// AWS X-Ray setup for DynamoDB
const AWSXRay = require('aws-xray-sdk-core');

// Debug logging for environment variables
console.log('=== DynamoDB Configuration Debug ===');
console.log('AWS_LOCAL_DB_ENDPOINT:', process.env.AWS_LOCAL_DB_ENDPOINT);
console.log('AWS_PROFILE:', process.env.AWS_PROFILE);
console.log('REGION:', process.env.REGION);
console.log('STAGE:', process.env.STAGE);
console.log('DYNAMODB_TABLE:', process.env.DYNAMODB_TABLE);

let clientInit = {};
if (process.env.AWS_LOCAL_DB_ENDPOINT) {
  console.log('Using LOCAL DynamoDB endpoint');
  clientInit = {
    endpoint: process.env.AWS_LOCAL_DB_ENDPOINT, 
    region: process.env.REGION || 'ap-south-1', 
    credentials: {  
      accessKeyId: 'ddfdfdfd',  
      secretAccessKey: 'sdsdsaa'
    }
  };
} else {
  console.log('Using REMOTE DynamoDB');
  clientInit = {
    region: process.env.REGION || 'ap-south-1'
  };
  
  // Add profile-based credentials if AWS_PROFILE is set
  if (process.env.AWS_PROFILE) {
    console.log('Using AWS Profile:', process.env.AWS_PROFILE);
    clientInit.credentials = fromIni({ profile: process.env.AWS_PROFILE });
  }
}

console.log('DynamoDB Client Configuration:', JSON.stringify(clientInit, null, 2));

// Create DynamoDB client with X-Ray tracing (only if not in local development)
let client;
if (process.env.STAGE !== 'local' && !process.env.AWS_LOCAL_DB_ENDPOINT) {
  client = AWSXRay.captureAWSv3Client(new DynamoDBClient(clientInit));
} else {
  client = new DynamoDBClient(clientInit);
}

const docClient = DynamoDBDocumentClient.from(client, 
  {marshallOptions: {
    removeUndefinedValues: true
  }});

async function queryItem(data, params = null) {
  let response = null;
  if (!params) {
    // Determine which PK to use based on index
    let pkField = 'PK';
    if (data.index === 'GSI1') {
      pkField = 'PK1';
    } else if (data.index === 'GSI2') {
      pkField = 'PK2';
    }

    params = {
      ...(data.index !== undefined ? { 'IndexName': data.index } : {}),
      KeyConditionExpression: `${pkField} = :pk` + (data.condition ? data.condition : ''),
      ExpressionAttributeValues: {
        ':pk': data.pk,
        ...(data.value !== undefined ? { ':sk': data.value } : {}),
        ...(data.filterValues ?? {})
      },
      ...(data.expressionAttributeNames ? { 'ExpressionAttributeNames': data.expressionAttributeNames } : {}),
      ScanIndexForward: false,
      ...(data.filter ? { 'FilterExpression': data.filter } : {}) // Add FilterExpression if provided
    };
  }
  params.TableName = data?.table ?? `beejcap_${process.env.STAGE}`;
  try {
    logger.info('=== DynamoDB QueryItem ===');
    logger.info('Full Query Params', { fullQueryParams: params });
    response = await docClient.send(new QueryCommand(params));
    console.log('Query successful, items returned:', response.Items?.length || 0);
  } catch (e) {
    logger.error('Caught exception in queryItem - ' + e);
    logger.error('Error details:', e);
  }
  return response;
}

/* This function needs both pk and sk */
async function getItem(data) {
    if (!data.pk || !data.sk) {
        throw new Error('Both PK and SK are required for getItem');
    }

    logger.info('=== DynamoDB GetItem ===');
    logger.info('Input data', { inputData: data });
    const tableName = data.table ?? `beejcap_${process.env.STAGE}`;
    let params = {
        TableName: tableName,
        Key: {
          PK: data.pk,
          SK: data.sk
        }
    };
    
    logger.info('Table Name', { tableName });
    logger.info('GetItem Params', { getItemParams: params });
    
    try {
        const response = await docClient.send(new GetCommand(params));
        logger.info('GetItem successful', { itemFound: !!response.Item });
        return response;
    } catch(e) {
        logger.error('Caught exception in getItem', { error: e.message }, e);
        logger.error('Error details', { errorDetails: e });
        // Handle AggregateError specifically
        if (e instanceof AggregateError) {
            const firstError = e.errors[0];
            throw new Error(`Failed to execute getItem: ${firstError.message}`);
        }
        throw new Error(`Failed to execute getItem: ${e.message}`);
    }
}

async function putItem(data, paramsOnly = false) {
  //console.log(data)
  try{
    const attr = { ...(data.attr === undefined ? {}: data.attr ), 'create_datetime': Date.now(), 'modified_datetime': Date.now() }
    const tableName = data.table ?? `beejcap_${process.env.STAGE}`;
    const params = {
        TableName: tableName,
        Item: {
          PK: data.pk,
          SK: data.sk,
          ...(attr)
        }
      }
    
      if(paramsOnly)
        return params
      
      console.log('=== DynamoDB PutItem ===');
      console.log('Table Name:', tableName);
      console.log('PutItem Params:', JSON.stringify(params, null, 2));
  
      const response = await docClient.send(new PutCommand(params, { removeUndefinedValues: true }));
      console.log('PutItem successful');
      return response;
  }catch(e){
    console.log("Caught exception in putItem - " + e)
    console.error('Error details:', e);
    throw new Error('Failed to execute putItem: ' + e.message);
  }
  
}

async function updateItem(data, paramsOnly = false) {
  // Create the parameters for the updateItem operation
  try{
      // Handle different types of update expressions
      let updateExpression;
      if (data.update_expression.trim().toUpperCase().startsWith('REMOVE')) {
        // For REMOVE operations, add SET modified_datetime separately
        updateExpression = `${data.update_expression} SET modified_datetime = :modified_datetime`;
      } else if (data.update_expression.trim().toUpperCase().includes('SET')) {
        // For SET operations, append to existing SET clause
        updateExpression = `${data.update_expression}, modified_datetime = :modified_datetime`;
      } else {
        // Default case (should not normally happen)
        updateExpression = `${data.update_expression} SET modified_datetime = :modified_datetime`;
      }
      
      const tableName = data.table ?? `beejcap_${process.env.STAGE}`;
      const params = {
        TableName: tableName,
        Key: {
          PK: data.pk,
          SK: data.sk
        },
        UpdateExpression: updateExpression,
      ExpressionAttributeValues: data.ex_attr_values === undefined ? { ':modified_datetime': Date.now() } : { ':modified_datetime': Date.now(), ...data.ex_attr_values },
      ...(data.expression_attribute_names ? { 'ExpressionAttributeNames': data.expression_attribute_names } : {}),
      ReturnValues: "ALL_NEW",
      RemoveUndefinedValues: true
    };
  
    if (paramsOnly) {
      return params;
    }
    
    console.log('=== DynamoDB UpdateItem ===');
    console.log('Table Name:', tableName);
    console.log('UpdateItem Params:', JSON.stringify(params, null, 2));
  
    const response = await docClient.send(new UpdateCommand(params));
    console.log('UpdateItem successful');
    return response;
  }catch(e){
    console.log("Caught exception in updateItem - " + e)
    console.error('Error details:', e);
    throw new Error('Failed to execute updateItem: ' + e.message);
  }
  
}

async function deleteItem(data, paramsOnly = false) {
  // Create the parameters for the deleteItem operation
  try{
    const tableName = data.table ?? `beejcap_${process.env.STAGE}`;
    const params = {
      TableName: tableName,
      Key: {
        PK: data.pk,
        SK: data.sk
      }
    };
    
    if(paramsOnly)
      return params
      
    console.log('=== DynamoDB DeleteItem ===');
    console.log('Table Name:', tableName);
    console.log('DeleteItem Params:', JSON.stringify(params, null, 2));
      
    // Use the Document Client to delete an item from the DynamoDB table
    const response = await docClient.send(new DeleteCommand(params));
    console.log("DeleteItem successful");
    return response;
  }catch(e){
    console.log("Caught exception in deleteItem - " + e)
    console.error('Error details:', e);
    throw new Error('Failed to execute deleteItem: ' + e.message);
  }
  
}

async function transactWriteItems(data) {
  if (data.length === 0) {
    return;
  }
  try {
    const params = await Promise.all(data.map(async (item) => {
      switch (item.op) {
        case "update":
          return { "Update": await updateItem(item, true) };
        case "add":
          return { "Put": await putItem(item, true) };
        case "delete":
          return { "Delete": await deleteItem(item, true) };
        default:
          throw new Error(`Unsupported operation: ${item.op}`);
      }
    }));
    
    console.log('=== DynamoDB TransactWrite ===');
    console.log('TransactWrite Params:', JSON.stringify({ "TransactItems": params }, null, 2));
    
    const response = await docClient.send(new TransactWriteCommand({ "TransactItems": params }));
    console.log("TransactWrite successful");
    return response;
  } catch (e) {
    console.error('Error in transactWriteItems:', e);
    throw new Error('Failed to execute transactWriteItems: ' + e.message);
  }
}

module.exports = {
    putItem, getItem, deleteItem,updateItem,queryItem, transactWriteItems
}
