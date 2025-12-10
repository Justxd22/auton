/**
 * Versioned REST API Routes (v1)
 * 
 * Developer/agent-friendly endpoints for programmatic access to Auton.
 * Most endpoints require API key authentication.
 */

import express from 'express';
import crypto from 'crypto';
import database from '../database.js';
import { generatePaymentRequest, getFeeInfo, calculateAmounts } from '../utils/payment.js';
import { validateApiKey, rateLimit } from '../middleware/apiAuth.js';
import { logger } from '../utils/logger.js';

const NETWORK = process.env.SOLANA_NETWORK || 'devnet';

const router = express.Router();

// ============================================
// API KEY MANAGEMENT (No auth required - uses wallet signature)
// ============================================

/**
 * POST /api/v1/api-keys
 * Create a new API key for a creator
 * Requires wallet signature verification (simplified for now - can enhance later)
 */
router.post('/v1/api-keys', async (req, res) => {
  try {
    const { walletAddress, name } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress is required',
      });
    }

    // Verify creator exists
    const creator = database.getCreator(walletAddress);
    if (!creator) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Creator not found. Please register as a creator first.',
      });
    }

    // Create API key
    const { keyId, apiKey, keyRecord } = database.createApiKey(walletAddress, name);

    logger.info('API key created', {
      keyId,
      creatorId: walletAddress,
      name: keyRecord.name,
    });

    res.status(201).json({
      success: true,
      apiKey: {
        id: keyId,
        name: keyRecord.name,
        key: apiKey, // ⚠️ Show only once - client must store this
        createdAt: keyRecord.createdAt,
      },
      warning: 'Store this API key securely. It will not be shown again.',
    });
  } catch (error) {
    logger.error('API Error - POST /v1/api-keys', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/api-keys
 * List all API keys for the authenticated creator
 * Requires API key authentication
 */
router.get('/v1/api-keys', validateApiKey, (req, res) => {
  try {
    const creatorId = req.creatorId;
    
    if (!creatorId || creatorId === 'system' || creatorId === 'dev') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint requires a user-created API key',
      });
    }

    const keys = database.listApiKeys(creatorId);

    res.json({
      success: true,
      apiKeys: keys.map(k => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        isActive: k.isActive,
        // Never return the actual key value
      })),
    });
  } catch (error) {
    logger.error('API Error - GET /v1/api-keys', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/v1/api-keys/:keyId
 * Revoke an API key
 * Requires API key authentication
 */
router.delete('/v1/api-keys/:keyId', validateApiKey, (req, res) => {
  try {
    const { keyId } = req.params;
    const creatorId = req.creatorId;

    if (!creatorId || creatorId === 'system' || creatorId === 'dev') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint requires a user-created API key',
      });
    }

    const result = database.revokeApiKey(keyId, creatorId);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.error,
      });
    }

    logger.info('API key revoked', { keyId, creatorId });

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    logger.error('API Error - DELETE /v1/api-keys/:keyId', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

// Apply API key validation to all routes below
router.use(validateApiKey);

// Apply rate limiting
router.use(rateLimit(100, 60000)); // 100 requests per minute

// ============================================
// INFO ENDPOINTS
// ============================================

/**
 * GET /api/v1/info
 * Get platform information
 */
router.get('/v1/info', (req, res) => {
  const feeInfo = getFeeInfo();
  
  res.json({
    success: true,
    platform: {
      name: 'Auton',
      version: '1.0.0',
      description: 'Patreon-style x402 paywall infrastructure for humans and agents',
      network: process.env.SOLANA_NETWORK || 'devnet',
    },
    fees: feeInfo,
    endpoints: {
      creators: '/api/v1/creators',
      content: '/api/v1/content',
      paymentLinks: '/api/v1/payment-links',
      fees: '/api/v1/fees',
    },
  });
});

/**
 * GET /api/v1/fees
 * Get current fee information
 */
router.get('/v1/fees', (req, res) => {
  const feeInfo = getFeeInfo();
  res.json({
    success: true,
    fees: feeInfo,
  });
});

/**
 * GET /api/v1/fees/calculate
 * Calculate fee breakdown for a specific amount
 */
router.get('/v1/fees/calculate', (req, res) => {
  const { amount } = req.query;
  
  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Valid amount query parameter is required',
    });
  }

  const breakdown = calculateAmounts(parseFloat(amount));
  
  res.json({
    success: true,
    ...breakdown,
  });
});

// ============================================
// CREATOR ENDPOINTS
// ============================================

/**
 * POST /api/v1/creators
 * Register or get a creator
 */
router.post('/v1/creators', (req, res) => {
  try {
    const { walletAddress, username } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress is required',
      });
    }

    // Use wallet address as creator ID
    const creatorId = walletAddress;
    
    // Check if creator exists
    let creator = database.getCreator(creatorId);
    
    if (!creator) {
      // Create new creator
      creator = database.createCreator(creatorId, walletAddress, username || null);
    } else if (username && !creator.username) {
      // Update username if not set
      const result = database.updateCreatorUsername(creatorId, username);
      if (result.success) {
        creator = result.creator;
      }
    }

    res.status(201).json({
      success: true,
      creator: {
        id: creator.id,
        walletAddress: creator.walletAddress,
        username: creator.username,
        displayName: creator.displayName,
        bio: creator.bio,
        avatarUrl: creator.avatarUrl,
        socialLinks: creator.socialLinks,
        profileUrl: creator.username 
          ? `/creators/${creator.username}` 
          : `/creators/${creator.id}`,
        createdAt: creator.createdAt,
      },
    });
  } catch (error) {
    console.error('API Error - POST /v1/creators:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/creators/:identifier
 * Get creator by ID, username, or wallet address
 */
router.get('/v1/creators/:identifier', (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Try by username first
    let creator = database.getCreatorByUsername(identifier);
    
    // Then try by ID
    if (!creator) {
      creator = database.getCreator(identifier);
    }

    if (!creator) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Creator not found',
      });
    }

    res.json({
      success: true,
      creator: {
        id: creator.id,
        walletAddress: creator.walletAddress,
        username: creator.username,
        displayName: creator.displayName,
        bio: creator.bio,
        avatarUrl: creator.avatarUrl,
        socialLinks: creator.socialLinks,
        profileUrl: creator.username 
          ? `/creators/${creator.username}` 
          : `/creators/${creator.id}`,
        createdAt: creator.createdAt,
      },
    });
  } catch (error) {
    console.error('API Error - GET /v1/creators/:identifier:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/v1/creators/:creatorId
 * Update creator profile
 */
router.patch('/v1/creators/:creatorId', (req, res) => {
  try {
    const { creatorId } = req.params;
    const { username, displayName, bio, avatarUrl, socialLinks } = req.body;

    const creator = database.getCreator(creatorId);
    if (!creator) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Creator not found',
      });
    }

    // Update username if provided
    if (username !== undefined) {
      const usernameResult = database.updateCreatorUsername(creatorId, username);
      if (!usernameResult.success) {
        return res.status(400).json({
          error: 'Bad Request',
          message: usernameResult.error,
        });
      }
    }

    // Update profile fields
    const profileResult = database.updateCreatorProfile(creatorId, {
      displayName,
      bio,
      avatarUrl,
      socialLinks,
    });

    if (!profileResult.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: profileResult.error,
      });
    }

    const updatedCreator = database.getCreator(creatorId);

    res.json({
      success: true,
      creator: {
        id: updatedCreator.id,
        walletAddress: updatedCreator.walletAddress,
        username: updatedCreator.username,
        displayName: updatedCreator.displayName,
        bio: updatedCreator.bio,
        avatarUrl: updatedCreator.avatarUrl,
        socialLinks: updatedCreator.socialLinks,
        profileUrl: updatedCreator.username 
          ? `/creators/${updatedCreator.username}` 
          : `/creators/${updatedCreator.id}`,
      },
    });
  } catch (error) {
    console.error('API Error - PATCH /v1/creators/:creatorId:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

// ============================================
// CONTENT ENDPOINTS
// ============================================

/**
 * GET /api/v1/content
 * List all content, optionally filtered by creator
 */
router.get('/v1/content', (req, res) => {
  try {
    const { creatorId, username, limit = 50, offset = 0 } = req.query;

    let filter = {};
    
    if (username) {
      const creator = database.getCreatorByUsername(username);
      if (creator) {
        filter.creatorId = creator.id;
      } else {
        return res.json({ success: true, content: [], total: 0 });
      }
    } else if (creatorId) {
      filter.creatorId = creatorId;
    }

    const allContent = database.listContent(filter);
    const paginatedContent = allContent.slice(
      parseInt(offset), 
      parseInt(offset) + parseInt(limit)
    );

    res.json({
      success: true,
      content: paginatedContent.map(c => ({
        id: c.id,
        creatorId: c.creatorId,
        title: c.title,
        description: c.description,
        price: c.price,
        assetType: c.assetType,
        categories: c.categories,
        contentKind: c.contentKind,
        status: c.status,
        preview: c.preview ? {
          enabled: c.preview.enabled,
          mode: c.preview.mode,
          snippet: c.preview.snippet,
        } : null,
        createdAt: c.createdAt,
      })),
      total: allContent.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('API Error - GET /v1/content:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/content/:contentId
 * Get content details
 */
router.get('/v1/content/:contentId', (req, res) => {
  try {
    const { contentId } = req.params;
    const content = database.getContent(contentId);

    if (!content) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Content not found',
      });
    }

    res.json({
      success: true,
      content: {
        id: content.id,
        creatorId: content.creatorId,
        title: content.title,
        description: content.description,
        price: content.price,
        assetType: content.assetType,
        categories: content.categories,
        contentKind: content.contentKind,
        allowDownload: content.allowDownload,
        status: content.status,
        preview: content.preview ? {
          enabled: content.preview.enabled,
          mode: content.preview.mode,
          snippet: content.preview.snippet,
        } : null,
        disclaimers: content.disclaimers,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
      },
    });
  } catch (error) {
    console.error('API Error - GET /v1/content/:contentId:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

// ============================================
// PAYMENT LINK ENDPOINTS
// ============================================

/**
 * POST /api/v1/payment-links
 * Generate a payment link/intent for content
 */
router.post('/v1/payment-links', (req, res) => {
  try {
    const { contentId, buyerPubkey } = req.body;

    if (!contentId || !buyerPubkey) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'contentId and buyerPubkey are required',
      });
    }

    const content = database.getContent(contentId);
    if (!content) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Content not found',
      });
    }

    // Generate payment request
    const paymentRequest = generatePaymentRequest(
      content.creatorWalletAddress,
      content.price,
      content.assetType
    );

    const PAYMENT_TTL_MINUTES = parseInt(process.env.PAYMENT_TTL_MINUTES || '10', 10);
    const expiresAt = new Date(Date.now() + PAYMENT_TTL_MINUTES * 60 * 1000).toISOString();

    // Store payment intent
    database.createPaymentIntent({
      id: paymentRequest.paymentId,
      contentId,
      buyerPubkey,
      amount: content.price,
      assetType: content.assetType,
      creatorWalletAddress: content.creatorWalletAddress,
      expiresAt,
    });

    res.status(201).json({
      success: true,
      paymentLink: {
        paymentId: paymentRequest.paymentId,
        contentId,
        buyerPubkey,
        amount: content.price,
        assetType: content.assetType,
        paymentAddress: content.creatorWalletAddress,
        expiresAt,
        feeBreakdown: paymentRequest.feeBreakdown,
        disclaimers: content.disclaimers,
      },
      // x402 compatible response
      x402: {
        paymentRequired: true,
        maxAmountRequired: paymentRequest.maxAmountRequired,
        assetType: paymentRequest.assetType,
        paymentAddress: paymentRequest.paymentAddress,
        network: paymentRequest.network,
        nonce: paymentRequest.nonce,
      },
    });
  } catch (error) {
    console.error('API Error - POST /v1/payment-links:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/payment-links/:paymentId
 * Get payment link status
 */
router.get('/v1/payment-links/:paymentId', (req, res) => {
  try {
    const { paymentId } = req.params;
    const intent = database.getPaymentIntent(paymentId);

    if (!intent) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Payment link not found',
      });
    }

    res.json({
      success: true,
      paymentLink: {
        paymentId: intent.id,
        contentId: intent.contentId,
        buyerPubkey: intent.buyerPubkey,
        amount: intent.amount,
        assetType: intent.assetType,
        status: intent.status,
        expiresAt: intent.expiresAt,
        createdAt: intent.createdAt,
        ...(intent.signature && {
          confirmedAt: intent.updatedAt,
          signature: intent.signature,
        }),
      },
    });
  } catch (error) {
    console.error('API Error - GET /v1/payment-links/:paymentId:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

// ============================================
// x402 COMPATIBLE ENDPOINTS (Pinata-style)
// ============================================

/**
 * GET /api/v1/x402/payment-instructions
 * List payment instructions (x402-compatible, Pinata-style)
 */
router.get('/v1/x402/payment-instructions', (req, res) => {
  try {
    const { limit = 10, pageToken, cid, name, id } = req.query;
    
    // Get all content that can be paid for
    let allContent = database.listContent({});
    
    // Filter by CID if provided (CID would map to contentId in our system)
    if (cid) {
      allContent = allContent.filter(c => c.id === cid);
    }
    
    // Filter by name if provided
    if (name) {
      allContent = allContent.filter(c => 
        c.title.toLowerCase().includes(name.toLowerCase())
      );
    }
    
    // Filter by ID if provided
    if (id) {
      allContent = allContent.filter(c => c.id === id);
    }
    
    // Pagination
    const limitNum = Math.min(parseInt(limit), 1000);
    const offset = pageToken ? parseInt(pageToken) : 0;
    const paginatedContent = allContent.slice(offset, offset + limitNum);
    
    // Format as Pinata-compatible payment instructions
    const paymentInstructions = paginatedContent.map(content => ({
      id: content.id,
      version: 1,
      payment_requirements: [{
        asset: content.assetType,
        pay_to: content.creatorWalletAddress,
        network: NETWORK === 'mainnet-beta' ? 'solana' : NETWORK,
        description: content.title,
        max_amount_required: content.price.toString(),
      }],
      name: content.title,
      description: content.description || '',
      created_at: content.createdAt,
    }));
    
    const nextPageToken = offset + limitNum < allContent.length 
      ? (offset + limitNum).toString() 
      : null;
    
    res.json({
      data: {
        payment_instructions: paymentInstructions,
        ...(nextPageToken && { next_page_token: nextPageToken }),
      },
    });
  } catch (error) {
    logger.error('API Error - GET /v1/x402/payment-instructions', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/x402/payment-instructions/:contentId
 * Get a specific payment instruction by content ID
 */
router.get('/v1/x402/payment-instructions/:contentId', (req, res) => {
  try {
    const { contentId } = req.params;
    const content = database.getContent(contentId);
    
    if (!content) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Payment instruction not found',
      });
    }
    
    res.json({
      data: {
        payment_instruction: {
          id: content.id,
          version: 1,
          payment_requirements: [{
            asset: content.assetType,
            pay_to: content.creatorWalletAddress,
            network: NETWORK === 'mainnet-beta' ? 'solana' : NETWORK,
            description: content.title,
            max_amount_required: content.price.toString(),
          }],
          name: content.title,
          description: content.description || '',
          created_at: content.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('API Error - GET /v1/x402/payment-instructions/:contentId', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/x402/payment-instructions
 * Create a payment instruction (x402-compatible)
 * This maps to creating content in Auton
 */
router.post('/v1/x402/payment-instructions', (req, res) => {
  try {
    const { 
      name, 
      description, 
      payment_requirements,
      creatorId,
      walletAddress,
    } = req.body;
    
    if (!name || !payment_requirements || !payment_requirements[0]) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name and payment_requirements are required',
      });
    }
    
    const req_0 = payment_requirements[0];
    if (!req_0.pay_to || !req_0.max_amount_required) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'payment_requirements must include pay_to and max_amount_required',
      });
    }
    
    // Create content record (simplified - in production, you'd also handle file upload)
    const contentId = database.generateId('content');
    const content = database.createContent(creatorId || walletAddress, {
      id: contentId,
      title: name,
      description: description || '',
      price: parseFloat(req_0.max_amount_required),
      assetType: req_0.asset || 'SOL',
      creatorWalletAddress: req_0.pay_to,
      status: 'active',
    });
    
    res.status(201).json({
      data: {
        payment_instruction: {
          id: content.id,
          version: 1,
          payment_requirements: [{
            asset: content.assetType,
            pay_to: content.creatorWalletAddress,
            network: NETWORK === 'mainnet-beta' ? 'solana' : NETWORK,
            description: content.title,
            max_amount_required: content.price.toString(),
          }],
          name: content.title,
          description: content.description,
          created_at: content.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('API Error - POST /v1/x402/payment-instructions', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

export default router;

