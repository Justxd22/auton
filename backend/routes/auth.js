/**
 * Authentication Routes
 * 
 * Handles user authentication and wallet linking for social login users
 */

import express from 'express';
import database from '../database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/auth/link-wallet
 * Link a wallet address to social credentials (email, Google, Twitter)
 */
router.post('/link-wallet', async (req, res) => {
  try {
    const { walletAddress, email, googleId, twitterId, walletSource = 'privy' } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress is required',
      });
    }

    // Check if user already exists
    let user = database.getUserByWallet(walletAddress);

    if (user) {
      // Link additional auth methods
      user = database.linkAuthMethod(user.id, { email, googleId, twitterId });
      database.updateUserLogin(user.id);
    } else {
      // Check if user exists with same email/social ID
      if (email) {
        user = database.getUserByEmail(email);
      } else if (googleId) {
        user = database.getUserByGoogleId(googleId);
      } else if (twitterId) {
        user = database.getUserByTwitterId(twitterId);
      }

      if (user) {
        // Link wallet to existing user
        user.walletAddress = walletAddress;
        user.walletSource = walletSource;
        database.save();
      } else {
        // Create new user
        user = database.createUser({
          walletAddress,
          email,
          googleId,
          twitterId,
          walletSource,
        });

        // Automatically create creator record
        database.createCreator(walletAddress, walletAddress);
      }
    }

    logger.info('Wallet linked', {
      walletAddress,
      userId: user.id,
      walletSource,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        walletSource: user.walletSource,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error('Error linking wallet', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/auth/user/:walletAddress
 * Get user information by wallet address
 */
router.get('/user/:walletAddress', (req, res) => {
  try {
    const { walletAddress } = req.params;
    const user = database.getUserByWallet(walletAddress);

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        walletSource: user.walletSource,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    logger.error('Error getting user', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/auth/verify-privy
 * Verify Privy authentication token (for backend verification)
 */
router.post('/verify-privy', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token is required',
      });
    }

    // In production, verify token with Privy API
    // For now, return success (implement actual verification later)
    // const privyAppSecret = process.env.PRIVY_APP_SECRET;
    // Verify token with Privy...

    res.json({
      success: true,
      message: 'Token verified (placeholder - implement actual verification)',
    });
  } catch (error) {
    logger.error('Error verifying Privy token', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

export default router;

