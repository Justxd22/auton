import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET_KEY 
  ? Buffer.from(process.env.ENCRYPTION_SECRET_KEY, 'hex')
  : crypto.randomBytes(32); // Fallback for development

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a buffer using AES-256-GCM
 * Returns: { ciphertext, iv, authTag, key }
 */
export function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    ciphertext: encrypted,
    iv: iv,
    authTag: authTag,
    key: ENCRYPTION_KEY.toString('hex') // Store key reference
  };
}

/**
 * Decrypt a buffer using AES-256-GCM
 * Input: { ciphertext, key, iv, authTag }
 */
export function decryptBuffer({ ciphertext, key, iv, authTag }) {
  const keyBuffer = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'hex');
  const authTagBuffer = Buffer.isBuffer(authTag) ? authTag : Buffer.from(authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, ivBuffer);
  decipher.setAuthTag(authTagBuffer);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  
  return decrypted;
}

/**
 * Build a text preview from a buffer (first 500 chars)
 */
export function buildTextPreview(buffer) {
  try {
    const text = buffer.toString('utf-8');
    return text.substring(0, 500);
  } catch (e) {
    return null;
  }
}






