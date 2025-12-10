/**
 * API Key Authentication Middleware
 * 
 * API key authentication for developer/agent access.
 * Checks database first, then falls back to environment variables.
 */

import database from '../database.js';

// Fallback: comma-separated list of keys in env (for backward compatibility)
const API_KEYS = (process.env.API_KEYS || '').split(',').filter(Boolean);

// Allow a default development key for local testing
const DEV_API_KEY = process.env.DEV_API_KEY || 'auton-dev-key-12345';

export function validateApiKey(req, res, next) {
  // Get API key from Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required. Pass it as: Authorization: Bearer <your-api-key>',
    });
  }

  const apiKey = authHeader.replace('Bearer ', '');

  // First, check database for user-created API keys
  const keyRecord = database.getApiKeyByKey(apiKey);
  if (keyRecord) {
    // Update last used timestamp
    database.updateApiKeyLastUsed(keyRecord.id);
    
    // Attach key info to request
    req.apiKeyValid = true;
    req.apiKeyId = keyRecord.id;
    req.creatorId = keyRecord.creatorId;
    req.apiKeyName = keyRecord.name;
    
    return next();
  }

  // Fallback: Check environment variables (for backward compatibility)
  if (API_KEYS.includes(apiKey) || apiKey === DEV_API_KEY) {
    req.apiKeyValid = true;
    req.apiKeyId = apiKey.slice(0, 8) + '...';
    req.creatorId = 'system'; // System-level key
    
    return next();
  }

  // Skip auth in development if no keys are configured (for local testing)
  if (process.env.NODE_ENV === 'development' && API_KEYS.length === 0 && !keyRecord) {
    req.apiKeyValid = true;
    req.apiKeyId = 'dev';
    req.creatorId = 'dev';
    return next();
  }

  // Invalid key
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid API key',
  });
}

// Optional: Rate limiting by API key (placeholder for future)
export function rateLimit(maxRequests = 100, windowMs = 60000) {
  const requestCounts = new Map();

  return (req, res, next) => {
    const keyId = req.apiKeyId || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or initialize request tracking for this key
    let requests = requestCounts.get(keyId) || [];
    
    // Remove old requests outside the window
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    if (requests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Max ${maxRequests} requests per ${windowMs / 1000}s`,
        retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000),
      });
    }

    // Add current request
    requests.push(now);
    requestCounts.set(keyId, requests);

    next();
  };
}

