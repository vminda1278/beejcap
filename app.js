const dotenv = require("dotenv");
dotenv.config();

// Set AWS profile if specified in environment
if (process.env.AWS_PROFILE) {
    process.env.AWS_PROFILE = process.env.AWS_PROFILE;
    console.log(`Using AWS Profile: ${process.env.AWS_PROFILE}`);
}

// AWS X-Ray setup - must be before other AWS SDK imports
const AWSXRay = require('aws-xray-sdk-core');
const xrayExpress = require('aws-xray-sdk-express');

// Note: AWS SDK v3 X-Ray integration is handled differently
// X-Ray tracing for AWS SDK v3 is configured per client, not globally

const http = require('http');
const serverless = require("serverless-http");
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

require('express-async-errors');
const app = express();
const bodyParser = require('body-parser');
const { adminRouter, authRouter, publicRouter } = require('./utility/routes');


// Add X-Ray middleware (should be first, only if not in local development)
if (process.env.STAGE !== 'local') {
    app.use(xrayExpress.openSegment('beejcap-api'));
}

// Request ID middleware - assigns unique ID to each request
app.use((req, res, next) => {
    // Try to get X-Ray trace ID first, then fallback to UUID
    const traceHeader = req.headers['x-amzn-trace-id'];
    let requestId;
    
    if (traceHeader) {
        // Extract trace ID from X-Ray header
        const traceMatch = traceHeader.match(/Root=([^;]+)/);
        requestId = traceMatch ? traceMatch[1] : uuidv4();
    } else {
        requestId = uuidv4();
    }
    
    // Add request ID to request object
    req.requestId = requestId;
    
    // Add to response headers for client tracking
    res.setHeader('X-Request-ID', requestId);
    
    // Add to X-Ray segment if available
    if (process.env.STAGE !== 'local') {
        const segment = AWSXRay.getSegment();
        if (segment) {
            segment.addAnnotation('requestId', requestId);
            segment.addAnnotation('endpoint', `${req.method} ${req.path}`);
            segment.addAnnotation('userAgent', req.headers['user-agent'] || 'unknown');
        }
    }
    
    console.log(`[${requestId}] ${req.method} ${req.path} - Request started`);
    next();
});

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
app.use(cors());
app.use(bodyParser.json({ strict: false }));

// Mount API routes under the configured base path
app.use('/v1/auth', authRouter);
app.use('/v1/admin', adminRouter);


app.use((req, res, next) => {
    const error = new Error('Not Found');
    error.status = 404;
    next(error);
});

app.use((err, req, res, next) => {
    console.error(err);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
        status: 'error',
        message: err.message || 'Something went wrong!',
    });
});

// Close X-Ray segment (should be last middleware, only if not in local development)
if (process.env.STAGE !== 'local') {
    app.use(xrayExpress.closeSegment());
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// This function is called by Cognito before token generation to add custom claims
const preTokenGenerationHandler = async (event) => {
    console.log('preTokenGenerationHandler event:', event);
    const userAttributes = event.request.userAttributes;
    
    event.response = {
        claimsOverrideDetails: {
            claimsToAddOrOverride: {
                'custom:isVerified': userAttributes['custom:isVerified'] || userAttributes.isVerified,
                'custom:organizationType': userAttributes['custom:organizationType'] || userAttributes.organizationType,
                'custom:role': userAttributes['custom:role'] || userAttributes.role,
                'custom:organizationId': userAttributes['custom:organizationId'] || userAttributes.organizationId
            }
        }
    };
    return event;
};

// Start the server if PORT is defined (either from environment or config default)
if(config.PORT){
    const httpServer = http.createServer(app);
    httpServer.listen(config.PORT, () => {
        console.log(`Server is running on port ${config.PORT}`);
    });
}

// For Lambda functions
module.exports.handler = serverless(app);
module.exports.preTokenGenerationHandler = preTokenGenerationHandler;
