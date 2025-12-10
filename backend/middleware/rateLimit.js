/**
 * Rate Limiting Middleware
 * 
 * Enhanced rate limiting for API endpoints
 */

import { checkRateLimit } from '../utils/abuseDetection.js';
import { logger } from '../utils/logger.js';

/**
 * Rate limit middleware
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 */
export function rateLimit(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    // Get client IP
    const ip = req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0] || 
               req.connection.remoteAddress ||
               'unknown';

    const result = checkRateLimit(ip, maxRequests, windowMs);

    if (!result.allowed) {
      logger.warn('Rate limit exceeded', {
        ip,
        endpoint: req.path,
        resetAt: new Date(result.resetAt).toISOString(),
      });

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again after ${new Date(result.resetAt).toISOString()}`,
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Reset': new Date(result.resetAt || Date.now() + windowMs).toISOString(),
    });

    next();
  };
}

/**
 * Strict rate limit for sponsorship endpoints
 */
export function strictRateLimit(req, res, next) {
  return rateLimit(5, 3600000)(req, res, next); // 5 requests per hour
}

