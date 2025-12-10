import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USE_LOCAL_STORAGE = process.env.USE_LOCAL_STORAGE !== 'false';
const STORAGE_DIR = path.join(__dirname, '../storage/files');

// Ensure storage directory exists
if (USE_LOCAL_STORAGE && !fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Save an object to storage
 * @param {Object} params - { key, buffer, contentType }
 */
export async function saveObject({ key, buffer, contentType }) {
  if (USE_LOCAL_STORAGE) {
    // Local filesystem storage
    const filePath = path.join(STORAGE_DIR, key);
    const dir = path.dirname(filePath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  } else {
    // S3 or other cloud storage (to be implemented)
    // For now, fallback to local
    const filePath = path.join(STORAGE_DIR, key);
    const dir = path.dirname(filePath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  }
}

/**
 * Read an object from storage
 * @param {string} key - Storage key
 * @returns {Promise<Buffer>}
 */
export async function readObject(key) {
  if (USE_LOCAL_STORAGE) {
    const filePath = path.join(STORAGE_DIR, key);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    
    return fs.readFileSync(filePath);
  } else {
    // S3 or other cloud storage (to be implemented)
    // For now, fallback to local
    const filePath = path.join(STORAGE_DIR, key);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    
    return fs.readFileSync(filePath);
  }
}

/**
 * Delete an object from storage
 * @param {string} key - Storage key
 */
export async function deleteObject(key) {
  if (USE_LOCAL_STORAGE) {
    const filePath = path.join(STORAGE_DIR, key);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } else {
    // S3 or other cloud storage (to be implemented)
    return { success: true };
  }
}






