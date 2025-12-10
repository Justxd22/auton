import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'db.json');

class Database {
  constructor() {
    this.load();
  }

  createEmptyState() {
    return {
      creators: {},
      usernames: {}, // username -> creatorId mapping for fast lookups
      tips: {},
      content: {},
      paymentIntents: {},
      accessGrants: {},
      apiKeys: {}, // API key storage: keyId -> { id, creatorId, name, key, createdAt, lastUsedAt, isActive }
      users: {}, // User accounts: userId -> { walletAddress, email, googleId, twitterId, username, walletSource, createdAt, lastLoginAt }
      sponsoredUsers: {}, // Sponsored users: walletAddress -> { sponsoredAt, txSignature, amount, eligible }
    };
  }

  ensureShape() {
    this.data.creators = this.data.creators || {};
    this.data.usernames = this.data.usernames || {};
    this.data.tips = this.data.tips || {};
    this.data.content = this.data.content || {};
    this.data.paymentIntents = this.data.paymentIntents || {};
    this.data.accessGrants = this.data.accessGrants || {};
    this.data.apiKeys = this.data.apiKeys || {};
    this.data.users = this.data.users || {};
    this.data.sponsoredUsers = this.data.sponsoredUsers || {};
  }

  load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        this.data = JSON.parse(data);
      } else {
        this.data = this.createEmptyState();
        this.save();
      }
    } catch (error) {
      console.error('Error loading database:', error);
      this.data = this.createEmptyState();
    }

    this.ensureShape();
  }

  save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  // Creator operations
  getCreator(creatorId) {
    return this.data.creators[creatorId] || null;
  }

  getCreatorByUsername(username) {
    if (!username) return null;
    const normalizedUsername = username.toLowerCase();
    const creatorId = this.data.usernames[normalizedUsername];
    if (!creatorId) return null;
    return this.data.creators[creatorId] || null;
  }

  isUsernameAvailable(username) {
    if (!username) return false;
    const normalizedUsername = username.toLowerCase();
    return !this.data.usernames[normalizedUsername];
  }

  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: 'Username is required' };
    }
    if (username.length < 2) {
      return { valid: false, error: 'Username must be at least 2 characters' };
    }
    if (username.length > 50) {
      return { valid: false, error: 'Username must be 50 characters or less' };
    }
    // Allow unicode letters, numbers, underscores, and hyphens
    const usernameRegex = /^[\p{L}\p{N}_-]+$/u;
    if (!usernameRegex.test(username)) {
      return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    }
    return { valid: true };
  }

  createCreator(creatorId, walletAddress, username = null) {
    if (!this.data.creators[creatorId]) {
      const creator = {
        id: creatorId,
        walletAddress,
        username: null,
        displayName: null,
        bio: null,
        avatarUrl: null,
        socialLinks: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      // Set username if provided and valid
      if (username) {
        const validation = this.validateUsername(username);
        if (validation.valid && this.isUsernameAvailable(username)) {
          const normalizedUsername = username.toLowerCase();
          creator.username = username;
          this.data.usernames[normalizedUsername] = creatorId;
        }
      }
      
      this.data.creators[creatorId] = creator;
      this.save();
    }
    return this.data.creators[creatorId];
  }

  updateCreatorUsername(creatorId, newUsername) {
    const creator = this.data.creators[creatorId];
    if (!creator) {
      return { success: false, error: 'Creator not found' };
    }

    const validation = this.validateUsername(newUsername);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const normalizedNewUsername = newUsername.toLowerCase();
    
    // Check if username is taken by another creator
    const existingCreatorId = this.data.usernames[normalizedNewUsername];
    if (existingCreatorId && existingCreatorId !== creatorId) {
      return { success: false, error: 'Username is already taken' };
    }

    // Remove old username mapping if exists
    if (creator.username) {
      const oldNormalizedUsername = creator.username.toLowerCase();
      delete this.data.usernames[oldNormalizedUsername];
    }

    // Set new username
    creator.username = newUsername;
    creator.updatedAt = new Date().toISOString();
    this.data.usernames[normalizedNewUsername] = creatorId;
    this.save();

    return { success: true, creator };
  }

  updateCreatorProfile(creatorId, profileData) {
    const creator = this.data.creators[creatorId];
    if (!creator) {
      return { success: false, error: 'Creator not found' };
    }

    const allowedFields = ['displayName', 'bio', 'avatarUrl', 'socialLinks'];
    for (const field of allowedFields) {
      if (profileData[field] !== undefined) {
        creator[field] = profileData[field];
      }
    }
    creator.updatedAt = new Date().toISOString();
    this.save();

    return { success: true, creator };
  }

  listCreators() {
    return Object.values(this.data.creators || {});
  }

  // Tip operations (legacy tipping surface)
  addTip(creatorId, tipData) {
    const tipId = `${creatorId}_${Date.now()}`;
    const tip = {
      id: tipId,
      creatorId,
      ...tipData,
      timestamp: new Date().toISOString(),
    };

    if (!this.data.tips[creatorId]) {
      this.data.tips[creatorId] = [];
    }
    this.data.tips[creatorId].push(tip);
    this.save();
    return tip;
  }

  getTips(creatorId) {
    return this.data.tips[creatorId] || [];
  }

  getAllTips() {
    return this.data.tips;
  }

  // Content operations
  createContent(creatorId, payload) {
    const contentId = payload.id || this.generateId('content');
    const now = new Date().toISOString();
    const record = {
      id: contentId,
      creatorId,
      createdAt: now,
      updatedAt: now,
      ...payload,
    };

    this.data.content[contentId] = record;
    this.save();
    return record;
  }

  updateContent(contentId, updates) {
    if (!this.data.content[contentId]) {
      return null;
    }
    const updated = {
      ...this.data.content[contentId],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.data.content[contentId] = updated;
    this.save();
    return updated;
  }

  getContent(contentId) {
    return this.data.content[contentId] || null;
  }

  listContent(filter = {}) {
    const all = Object.values(this.data.content || {});
    if (!all.length) return [];

    return all.filter((item) => {
      if (filter.creatorId && item.creatorId !== filter.creatorId) {
        return false;
      }
      if (typeof filter.published === 'boolean' && item.published !== filter.published) {
        return false;
      }
      return true;
    });
  }

  // Payment intents
  createPaymentIntent(intent) {
    const id = intent.id || this.generateId('intent');
    const now = new Date().toISOString();
    const record = {
      id,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...intent,
    };

    this.data.paymentIntents[id] = record;
    this.save();
    return record;
  }

  getPaymentIntent(intentId) {
    return this.data.paymentIntents[intentId] || null;
  }

  updatePaymentIntent(intentId, updates) {
    if (!this.data.paymentIntents[intentId]) {
      return null;
    }
    const updated = {
      ...this.data.paymentIntents[intentId],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.data.paymentIntents[intentId] = updated;
    this.save();
    return updated;
  }

  // Access grants
  addAccessGrant(grant) {
    const tokenId = grant.tokenId || this.generateId('grant');
    const record = {
      tokenId,
      ...grant,
      createdAt: new Date().toISOString(),
    };

    this.data.accessGrants[tokenId] = record;
    this.save();
    return record;
  }

  getAccessGrant(tokenId) {
    return this.data.accessGrants[tokenId] || null;
  }

  listAccessGrantsForBuyer(contentId, buyerPubkey) {
    return Object.values(this.data.accessGrants || {}).filter(
      (grant) => grant.contentId === contentId && grant.buyerPubkey === buyerPubkey
    );
  }

  // API Key operations
  createApiKey(creatorId, name) {
    // Generate a secure random API key (64 hex characters = 32 bytes)
    const apiKey = crypto.randomBytes(32).toString('hex');
    const keyId = this.generateId('key');
    const now = new Date().toISOString();
    
    const keyRecord = {
      id: keyId,
      creatorId,
      name: name || 'Default API Key',
      key: apiKey, // Store the full key (shown only once on creation)
      createdAt: now,
      lastUsedAt: null,
      isActive: true,
    };
    
    this.data.apiKeys[keyId] = keyRecord;
    this.save();
    
    return { keyId, apiKey, keyRecord };
  }

  getApiKeyByKey(apiKey) {
    return Object.values(this.data.apiKeys || {}).find(
      (k) => k.key === apiKey && k.isActive
    ) || null;
  }

  getApiKeyById(keyId) {
    return this.data.apiKeys[keyId] || null;
  }

  listApiKeys(creatorId) {
    return Object.values(this.data.apiKeys || {}).filter(
      (k) => k.creatorId === creatorId
    );
  }

  revokeApiKey(keyId, creatorId) {
    const key = this.data.apiKeys[keyId];
    if (!key) {
      return { success: false, error: 'API key not found' };
    }
    
    if (key.creatorId !== creatorId) {
      return { success: false, error: 'Unauthorized' };
    }
    
    key.isActive = false;
    this.save();
    
    return { success: true };
  }

  updateApiKeyLastUsed(keyId) {
    const key = this.data.apiKeys[keyId];
    if (key) {
      key.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }

  // User operations
  createUser(userData) {
    const userId = userData.walletAddress || this.generateId('user');
    const now = new Date().toISOString();
    
    const user = {
      id: userId,
      walletAddress: userData.walletAddress,
      email: userData.email || null,
      googleId: userData.googleId || null,
      twitterId: userData.twitterId || null,
      username: userData.username || null,
      walletSource: userData.walletSource || 'traditional', // 'privy' or 'traditional'
      createdAt: now,
      lastLoginAt: now,
    };
    
    this.data.users[userId] = user;
    this.save();
    return user;
  }

  getUserByWallet(walletAddress) {
    return Object.values(this.data.users || {}).find(
      (u) => u.walletAddress === walletAddress
    ) || null;
  }

  getUserByEmail(email) {
    return Object.values(this.data.users || {}).find(
      (u) => u.email === email
    ) || null;
  }

  getUserByGoogleId(googleId) {
    return Object.values(this.data.users || {}).find(
      (u) => u.googleId === googleId
    ) || null;
  }

  getUserByTwitterId(twitterId) {
    return Object.values(this.data.users || {}).find(
      (u) => u.twitterId === twitterId
    ) || null;
  }

  updateUserLogin(userId) {
    const user = this.data.users[userId];
    if (user) {
      user.lastLoginAt = new Date().toISOString();
      this.save();
    }
  }

  linkAuthMethod(userId, authData) {
    const user = this.data.users[userId];
    if (!user) return null;
    
    if (authData.email) user.email = authData.email;
    if (authData.googleId) user.googleId = authData.googleId;
    if (authData.twitterId) user.twitterId = authData.twitterId;
    
    this.save();
    return user;
  }

  // Sponsored user operations
  markUserAsSponsored(walletAddress, txSignature, amount) {
    const now = new Date().toISOString();
    const record = {
      walletAddress,
      sponsoredAt: now,
      txSignature,
      amount,
      eligible: true,
    };
    
    this.data.sponsoredUsers[walletAddress] = record;
    this.save();
    return record;
  }

  isUserSponsored(walletAddress) {
    return !!this.data.sponsoredUsers[walletAddress];
  }

  getSponsoredUser(walletAddress) {
    return this.data.sponsoredUsers[walletAddress] || null;
  }
}

export default new Database();
