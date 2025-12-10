/**
 * Abuse Detection Utilities
 * 
 * Detects and prevents abuse of sponsorship system
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from './logger.js';
import database from '../database.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Rate limiting storage (in-memory, use Redis in production)
const rateLimitStore = new Map();

/**
 * Check if IP is rate limited
 */
export function checkRateLimit(ip, maxRequests = 5, windowMs = 3600000) {
  const now = Date.now();
  const key = `rate_limit:${ip}`;
  
  const record = rateLimitStore.get(key);
  
  if (!record) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (record.count >= maxRequests) {
    return { 
      allowed: false, 
      remaining: 0,
      resetAt: record.resetAt,
    };
  }

  record.count += 1;
  rateLimitStore.set(key, record);
  
  return { 
    allowed: true, 
    remaining: maxRequests - record.count,
  };
}

/**
 * Check if wallet has prior transactions (indicates not a new user)
 */
export async function checkWalletAge(walletAddress) {
  try {
    const pubkey = new PublicKey(walletAddress);
    
    // Get first transaction signature
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 1 });
    
    if (signatures.length > 0) {
      return {
        isNew: false,
        firstTx: signatures[0].signature,
        firstTxTime: signatures[0].blockTime,
      };
    }

    // Check balance
    const balance = await connection.getBalance(pubkey);
    
    return {
      isNew: true,
      balance,
      hasTransactions: false,
    };
  } catch (error) {
    logger.error('Error checking wallet age', {
      walletAddress,
      error: error.message,
    });
    return {
      isNew: false,
      error: error.message,
    };
  }
}

/**
 * Validate transaction before sponsorship
 */
export async function validateTransactionForSponsorship(transaction, allowedPrograms = []) {
  try {
    // In a real implementation, you would:
    // 1. Deserialize the transaction
    // 2. Check all instructions are from allowed programs
    // 3. Verify compute budget is reasonable
    // 4. Check transaction size
    
    // For now, return basic validation
    return {
      valid: true,
      reason: 'Transaction validation passed',
    };
  } catch (error) {
    logger.error('Error validating transaction', { error: error.message });
    return {
      valid: false,
      reason: error.message,
    };
  }
}

/**
 * Detect suspicious patterns
 */
export function detectSuspiciousActivity(walletAddress, ip) {
  const suspiciousPatterns = [];

  // Check if multiple wallets from same IP
  const walletsFromIP = Object.values(database.data.sponsoredUsers || {})
    .filter(u => u.ip === ip).length;

  if (walletsFromIP > 3) {
    suspiciousPatterns.push('Multiple wallets from same IP');
  }

  // Check if wallet was created very recently (potential bot)
  const user = database.getUserByWallet(walletAddress);
  if (user) {
    const createdAt = new Date(user.createdAt);
    const now = new Date();
    const ageMinutes = (now - createdAt) / (1000 * 60);
    
    if (ageMinutes < 1) {
      suspiciousPatterns.push('Wallet created less than 1 minute ago');
    }
  }

  return {
    suspicious: suspiciousPatterns.length > 0,
    patterns: suspiciousPatterns,
  };
}

/**
 * Clean up old rate limit records
 */
export function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up every hour
setInterval(cleanupRateLimits, 3600000);

