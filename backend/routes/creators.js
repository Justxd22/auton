import express from 'express';
import database from '../database.js';

const router = express.Router();

// GET /api/creators/:creatorId - Get creator by ID
router.get('/creators/:creatorId', (req, res) => {
  try {
    const { creatorId } = req.params;
    const creator = database.getCreator(creatorId);
    
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // Return creator without exposing wallet address in the response for privacy
    res.json({
      success: true,
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        bio: creator.bio,
        avatarUrl: creator.avatarUrl,
        socialLinks: creator.socialLinks,
        createdAt: creator.createdAt,
        profileUrl: creator.username ? `/creators/${creator.username}` : `/creators/${creator.id}`,
      },
    });
  } catch (error) {
    console.error('Error in GET /creators/:creatorId endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/creators/by-username/:username - Get creator by username
router.get('/creators/by-username/:username', (req, res) => {
  try {
    const { username } = req.params;
    const creator = database.getCreatorByUsername(username);
    
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    res.json({
      success: true,
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        bio: creator.bio,
        avatarUrl: creator.avatarUrl,
        socialLinks: creator.socialLinks,
        createdAt: creator.createdAt,
        profileUrl: `/creators/${creator.username}`,
      },
    });
  } catch (error) {
    console.error('Error in GET /creators/by-username/:username endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/creators/check-username/:username - Check if username is available
router.get('/creators/check-username/:username', (req, res) => {
  try {
    const { username } = req.params;
    
    const validation = database.validateUsername(username);
    if (!validation.valid) {
      return res.json({
        available: false,
        valid: false,
        error: validation.error,
      });
    }

    const isAvailable = database.isUsernameAvailable(username);
    
    res.json({
      available: isAvailable,
      valid: true,
      username: username,
    });
  } catch (error) {
    console.error('Error in GET /creators/check-username/:username endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// POST /api/creators/:creatorId/username - Set or update username for a creator
router.post('/creators/:creatorId/username', (req, res) => {
  try {
    const { creatorId } = req.params;
    const { username, walletAddress } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Check if creator exists, create if not (with wallet address)
    let creator = database.getCreator(creatorId);
    if (!creator) {
      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress is required for new creators' });
      }
      creator = database.createCreator(creatorId, walletAddress, username);
      return res.status(201).json({
        success: true,
        message: 'Creator created with username',
        creator: {
          id: creator.id,
          username: creator.username,
          displayName: creator.displayName,
          bio: creator.bio,
          avatarUrl: creator.avatarUrl,
          socialLinks: creator.socialLinks,
          profileUrl: `/creators/${creator.username}`,
        },
      });
    }

    // Update existing creator's username
    const result = database.updateCreatorUsername(creatorId, username);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Username updated successfully',
      creator: {
        id: result.creator.id,
        username: result.creator.username,
        displayName: result.creator.displayName,
        bio: result.creator.bio,
        avatarUrl: result.creator.avatarUrl,
        socialLinks: result.creator.socialLinks,
        profileUrl: `/creators/${result.creator.username}`,
      },
    });
  } catch (error) {
    console.error('Error in POST /creators/:creatorId/username endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PATCH /api/creators/:creatorId/profile - Update creator profile
router.patch('/creators/:creatorId/profile', (req, res) => {
  try {
    const { creatorId } = req.params;
    const { displayName, bio, avatarUrl, socialLinks } = req.body;

    const creator = database.getCreator(creatorId);
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // Validate bio length
    if (bio && bio.length > 500) {
      return res.status(400).json({ error: 'Bio must be 500 characters or less' });
    }

    // Validate displayName length
    if (displayName && displayName.length > 100) {
      return res.status(400).json({ error: 'Display name must be 100 characters or less' });
    }

    // Validate socialLinks structure
    if (socialLinks && typeof socialLinks !== 'object') {
      return res.status(400).json({ error: 'socialLinks must be an object' });
    }

    const result = database.updateCreatorProfile(creatorId, {
      displayName,
      bio,
      avatarUrl,
      socialLinks,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      creator: {
        id: result.creator.id,
        username: result.creator.username,
        displayName: result.creator.displayName,
        bio: result.creator.bio,
        avatarUrl: result.creator.avatarUrl,
        socialLinks: result.creator.socialLinks,
        profileUrl: result.creator.username 
          ? `/creators/${result.creator.username}` 
          : `/creators/${result.creator.id}`,
      },
    });
  } catch (error) {
    console.error('Error in PATCH /creators/:creatorId/profile endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/creators/:creatorId/wallet - Get wallet address (for internal use only)
// This endpoint returns the wallet address for payment purposes
router.get('/creators/:creatorId/wallet', (req, res) => {
  try {
    const { creatorId } = req.params;
    const creator = database.getCreator(creatorId);
    
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    res.json({
      success: true,
      walletAddress: creator.walletAddress,
    });
  } catch (error) {
    console.error('Error in GET /creators/:creatorId/wallet endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// GET /api/resolve/:identifier - Resolve username or wallet address to creator
// This is used for routing - accepts either username or creatorId/wallet
router.get('/resolve/:identifier', (req, res) => {
  try {
    const { identifier } = req.params;
    
    // First try to find by username
    let creator = database.getCreatorByUsername(identifier);
    
    // If not found, try to find by creatorId (which may be wallet address)
    if (!creator) {
      creator = database.getCreator(identifier);
    }
    
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    res.json({
      success: true,
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        bio: creator.bio,
        avatarUrl: creator.avatarUrl,
        socialLinks: creator.socialLinks,
        walletAddress: creator.walletAddress, // Needed for payment
        profileUrl: creator.username 
          ? `/creators/${creator.username}` 
          : `/creators/${creator.id}`,
      },
    });
  } catch (error) {
    console.error('Error in GET /resolve/:identifier endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;

