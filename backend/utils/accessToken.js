import crypto from 'crypto';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'dev-secret-change-in-production';

/**
 * Create an access token for content download
 * Returns: { token, tokenId, exp }
 */
export function createAccessToken(payload, ttlSeconds = 300) {
  const exp = Date.now() + (ttlSeconds * 1000);
  const tokenId = crypto.randomBytes(16).toString('hex');
  
  const tokenPayload = {
    ...payload,
    exp,
    tokenId,
    iat: Date.now()
  };
  
  const token = signToken(tokenPayload);
  
  return {
    token,
    tokenId,
    exp: new Date(exp).toISOString()
  };
}

/**
 * Verify an access token
 * Returns: { valid: boolean, payload?: object, error?: string }
 */
export function verifyAccessToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now()) {
      return { valid: false, error: 'Token expired' };
    }
    
    // Verify signature
    const header = { alg: 'HS256', typ: 'JWT' };
    const expectedHeaderB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const expectedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const expectedSignature = crypto
      .createHmac('sha256', ACCESS_TOKEN_SECRET)
      .update(`${expectedHeaderB64}.${expectedPayloadB64}`)
      .digest('base64url');
    
    if (signatureB64 !== expectedSignature) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Sign a token payload (simplified JWT-like signing)
 */
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', ACCESS_TOKEN_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

