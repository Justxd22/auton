/**
 * Simple logging utility with structured logging support
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, meta = {}) {
  const logEntry = {
    timestamp: formatTimestamp(),
    level: level.toUpperCase(),
    message,
    ...meta,
  };
  
  // In production, output JSON for log aggregators
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(logEntry);
  }
  
  // In development, use readable format
  const metaStr = Object.keys(meta).length > 0 
    ? ` ${JSON.stringify(meta)}` 
    : '';
  return `[${logEntry.timestamp}] ${logEntry.level}: ${message}${metaStr}`;
}

export const logger = {
  debug(message, meta = {}) {
    if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, meta));
    }
  },

  info(message, meta = {}) {
    if (CURRENT_LEVEL <= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, meta));
    }
  },

  warn(message, meta = {}) {
    if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  error(message, meta = {}) {
    if (CURRENT_LEVEL <= LOG_LEVELS.error) {
      // Include stack trace if error object is provided
      if (meta.error instanceof Error) {
        meta.stack = meta.error.stack;
        meta.errorMessage = meta.error.message;
        delete meta.error;
      }
      console.error(formatMessage('error', message, meta));
    }
  },

  // Log API requests
  request(req, meta = {}) {
    this.info('API Request', {
      method: req.method,
      path: req.path,
      query: req.query,
      apiKeyId: req.apiKeyId,
      ...meta,
    });
  },

  // Log payment events
  payment(event, meta = {}) {
    this.info(`Payment: ${event}`, {
      category: 'payment',
      ...meta,
    });
  },

  // Log content events
  content(event, meta = {}) {
    this.info(`Content: ${event}`, {
      category: 'content',
      ...meta,
    });
  },
};

export default logger;

