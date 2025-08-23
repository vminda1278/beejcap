/**
 * Enhanced Logger Utility for LSP-OMS with AWS X-Ray Integration
 * Provides structured logging with different levels for field debugging and request tracing
 */

const AWSXRay = require('aws-xray-sdk-core');

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

const LOG_LEVEL_NAMES = {
  0: 'ERROR',
  1: 'WARN',
  2: 'INFO',
  3: 'DEBUG',
  4: 'TRACE'
};

class Logger {
  constructor() {
    // Get log level from environment or default to INFO
    this.currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.INFO;
    this.serviceName = process.env.SERVICE_NAME || 'lsp-oms';
    this.stage = process.env.STAGE || 'dev';
  }

  /**
   * Get current X-Ray trace and request context
   */
  getRequestContext() {
    let traceId = null;
    let requestId = null;

    // Only try to get X-Ray context if not in local development
    if (process.env.STAGE !== 'local') {
      try {
        const segment = AWSXRay.getSegment();
        if (segment) {
          traceId = segment.trace_id;
          // Try to get request ID from annotations
          requestId = segment.annotations?.requestId;
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }

    return { traceId, requestId };
  }

  /**
   * Create structured log entry
   * @param {number} level - Log level
   * @param {string} message - Log message
   * @param {Object} context - Additional context data
   * @param {Error} error - Error object (optional)
   */
  log(level, message, context = {}, error = null) {
    if (level > this.currentLevel) {
      return; // Skip if level is below current threshold
    }

    const timestamp = new Date().toISOString();
    const { traceId, requestId } = this.getRequestContext();
    
    const logEntry = {
      timestamp,
      level: LOG_LEVEL_NAMES[level],
      service: this.serviceName,
      stage: this.stage,
      message,
      ...(traceId && { traceId }),
      ...(requestId && { requestId }),
      ...context
    };

    // Add error details if provided
    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    }

    // Add request context if available
    if (context.requestId) {
      logEntry.requestId = context.requestId;
    }

    // Add user context if available
    if (context.userId || context.eid) {
      logEntry.user = {
        id: context.userId,
        eid: context.eid,
        role: context.userRole
      };
    }

    // Output to console (Lambda CloudWatch will capture this)
    console.log(JSON.stringify(logEntry));

    // Add to X-Ray segment as metadata (only if not in local development)
    if (process.env.STAGE !== 'local') {
      try {
        const segment = AWSXRay.getSegment();
        if (segment) {
          segment.addMetadata('log', logEntry);
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }
  }

  /**
   * Log error level messages
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   * @param {Error} error - Error object
   */
  error(message, context = {}, error = null) {
    this.log(LOG_LEVELS.ERROR, message, context, error);
  }

  /**
   * Log warning level messages
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    this.log(LOG_LEVELS.WARN, message, context);
  }

  /**
   * Log info level messages
   * @param {string} message - Info message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    this.log(LOG_LEVELS.INFO, message, context);
  }

  /**
   * Log debug level messages
   * @param {string} message - Debug message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    this.log(LOG_LEVELS.DEBUG, message, context);
  }

  /**
   * Log trace level messages (most verbose)
   * @param {string} message - Trace message
   * @param {Object} context - Additional context
   */
  trace(message, context = {}) {
    this.log(LOG_LEVELS.TRACE, message, context);
  }

  /**
   * Log API request start
   * @param {string} endpoint - API endpoint
   * @param {Object} req - Express request object
   */
  logRequestStart(endpoint, req) {
    const requestId = req.requestId || req.headers['x-request-id'] || this.generateRequestId();
    const { traceId } = this.getRequestContext();
    
    // Create subsegment for this request (only if not in local development)
    if (process.env.STAGE !== 'local') {
      try {
        const subsegment = AWSXRay.getSegment()?.addNewSubsegment(`request-${requestId}`);
        if (subsegment) {
          subsegment.addAnnotation('endpoint', endpoint);
          subsegment.addAnnotation('requestId', requestId);
          subsegment.addAnnotation('method', req.method);
          subsegment.addAnnotation('path', req.path);
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }

    const context = {
      requestId,
      endpoint,
      method: req.method,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      eid: req.user ? req.user['custom:eid'] : null,
      userId: req.user ? req.user.username : null,
      userRole: req.user ? req.user['custom:role'] : null,
      ...(traceId && { traceId })
    };

    this.info(`API Request Started: ${endpoint}`, context);
    return requestId;
  }

  /**
   * Log API request end
   * @param {string} endpoint - API endpoint
   * @param {string} requestId - Request ID
   * @param {number} statusCode - Response status code
   * @param {number} duration - Request duration in ms
   * @param {Object} additionalContext - Additional context
   */
  logRequestEnd(endpoint, requestId, statusCode, duration, additionalContext = {}) {
    const { traceId } = this.getRequestContext();
    
    // Close subsegment (only if not in local development)
    if (process.env.STAGE !== 'local') {
      try {
        const segment = AWSXRay.getSegment();
        if (segment) {
          const subsegment = segment.subsegments?.find(s => s.name === `request-${requestId}`);
          if (subsegment) {
            subsegment.addAnnotation('statusCode', statusCode);
            subsegment.addAnnotation('duration', duration);
            subsegment.close();
          }
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }

    const context = {
      requestId,
      endpoint,
      statusCode,
      duration: `${duration}ms`,
      ...(traceId && { traceId }),
      ...additionalContext
    };

    if (statusCode >= 400) {
      this.warn(`API Request Failed: ${endpoint}`, context);
    } else {
      this.info(`API Request Completed: ${endpoint}`, context);
    }
  }

  /**
   * Log business logic operations
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context
   * @param {string} status - Operation status (start, success, error)
   */
  logBusinessOperation(operation, context = {}, status = 'start') {
    const message = `Business Operation ${status}: ${operation}`;
    
    switch (status) {
      case 'error':
        this.error(message, context);
        break;
      case 'success':
        this.info(message, context);
        break;
      default:
        this.debug(message, context);
    }
  }

  /**
   * Log external service calls
   * @param {string} service - External service name
   * @param {string} operation - Operation being performed
   * @param {Object} context - Call context
   * @param {string} status - Call status
   */
  logExternalCall(service, operation, context = {}, status = 'start') {
    const { traceId, requestId } = this.getRequestContext();
    
    // Create subsegment for external call (only if not in local development)
    if (status === 'start' && process.env.STAGE !== 'local') {
      try {
        const subsegment = AWSXRay.getSegment()?.addNewSubsegment(`${service}-${operation}`);
        if (subsegment) {
          subsegment.addAnnotation('service', service);
          subsegment.addAnnotation('operation', operation);
          subsegment.namespace = 'remote';
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }

    const message = `External Service ${status}: ${service}.${operation}`;
    const logContext = {
      service,
      operation,
      status,
      ...(requestId && { requestId }),
      ...(traceId && { traceId }),
      ...context
    };
    
    switch (status) {
      case 'error':
        this.error(message, logContext);
        break;
      case 'timeout':
        this.warn(message, logContext);
        break;
      case 'success':
        this.debug(message, logContext);
        break;
      default:
        this.trace(message, logContext);
    }

    // Close subsegment on completion (only if not in local development)
    if (status !== 'start' && process.env.STAGE !== 'local') {
      try {
        const segment = AWSXRay.getSegment();
        if (segment) {
          const subsegment = segment.subsegments?.find(s => s.name === `${service}-${operation}`);
          if (subsegment) {
            subsegment.addAnnotation('status', status);
            if (status === 'error' && context.error) {
              subsegment.addError(new Error(context.error));
            }
            subsegment.close();
          }
        }
      } catch (error) {
        // X-Ray not available, continue without it
      }
    }
  }

  /**
   * Generate unique request ID
   * @returns {string} Unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create child logger with additional context
   * @param {Object} additionalContext - Context to add to all logs
   * @returns {Object} Child logger
   */
  child(additionalContext) {
    const parentLogger = this;
    return {
      error: (message, context = {}, error = null) => 
        parentLogger.error(message, { ...additionalContext, ...context }, error),
      warn: (message, context = {}) => 
        parentLogger.warn(message, { ...additionalContext, ...context }),
      info: (message, context = {}) => 
        parentLogger.info(message, { ...additionalContext, ...context }),
      debug: (message, context = {}) => 
        parentLogger.debug(message, { ...additionalContext, ...context }),
      trace: (message, context = {}) => 
        parentLogger.trace(message, { ...additionalContext, ...context }),
      logBusinessOperation: (operation, context = {}, status = 'start') =>
        parentLogger.logBusinessOperation(operation, { ...additionalContext, ...context }, status),
      logExternalCall: (service, operation, context = {}, status = 'start') =>
        parentLogger.logExternalCall(service, operation, { ...additionalContext, ...context }, status)
    };
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = {
  logger,
  LOG_LEVELS,
  LOG_LEVEL_NAMES
};
