/**
 * Sponsorship Routes
 * 
 * Handles gas fee sponsorship for new users
 */

import express from 'express';
import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { checkSponsorshipEligibility, buildSponsoredTransaction, recordSponsorship, getSponsorshipStats } from '../utils/sponsor.js';
import { checkWalletAge, detectSuspiciousActivity, validateTransactionForSponsorship } from '../utils/abuseDetection.js';
import { strictRateLimit } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import database from '../database.js';

const router = express.Router();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

/**
 * GET /api/sponsor/check-eligibility/:walletAddress
 * Check if a wallet is eligible for sponsorship
 */
router.get('/check-eligibility/:walletAddress', strictRateLimit, async (req, res) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress is required',
      });
    }

    // Check for suspicious activity
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const suspicious = detectSuspiciousActivity(walletAddress, ip);
    
    if (suspicious.suspicious) {
      logger.warn('Suspicious activity detected', {
        walletAddress,
        ip,
        patterns: suspicious.patterns,
      });
    }

    // Check wallet age
    const walletAge = await checkWalletAge(walletAddress);
    if (!walletAge.isNew) {
      return res.json({
        success: true,
        eligible: false,
        reason: 'Wallet has prior transactions',
        walletAge,
      });
    }

    const eligibility = await checkSponsorshipEligibility(walletAddress);

    res.json({
      success: true,
      ...eligibility,
      suspicious: suspicious.suspicious,
      suspiciousPatterns: suspicious.patterns,
    });
  } catch (error) {
    logger.error('Error checking eligibility', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/sponsor/build-transaction
 * Build a sponsored transaction (vault pays fees)
 * Returns unsigned transaction for user to sign
 */
router.post('/build-transaction', async (req, res) => {
  try {
    const { walletAddress, instructions } = req.body;

    if (!walletAddress || !instructions) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress and instructions are required',
      });
    }

    // Check eligibility first
    const eligibility = await checkSponsorshipEligibility(walletAddress);
    if (!eligibility.eligible) {
      return res.status(403).json({
        error: 'Not Eligible',
        message: eligibility.reason,
      });
    }

    // Convert instruction data to TransactionInstruction objects
    // This is a simplified version - in production, you'd properly deserialize
    const transactionInstructions = instructions.map(ix => ({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(k => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    }));

    // Build sponsored transaction
    const { transaction, blockhash } = await buildSponsoredTransaction(
      walletAddress,
      transactionInstructions
    );

    // Serialize transaction (without signatures)
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    res.json({
      success: true,
      transaction: serialized.toString('base64'),
      blockhash,
      message: 'Transaction built. User must sign and submit.',
    });
  } catch (error) {
    logger.error('Error building sponsored transaction', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/sponsor/submit
 * Submit a sponsored transaction (signed by user, signed by vault)
 */
router.post('/submit', async (req, res) => {
  try {
    const { walletAddress, signedTransaction } = req.body;

    if (!walletAddress || !signedTransaction) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletAddress and signedTransaction are required',
      });
    }

    // Check eligibility
    const eligibility = await checkSponsorshipEligibility(walletAddress);
    if (!eligibility.eligible) {
      return res.status(403).json({
        error: 'Not Eligible',
        message: eligibility.reason,
      });
    }

    // Deserialize transaction
    const transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));

    // Load vault wallet
    let vaultWallet;
    try {
      vaultWallet = loadVaultWallet();
    } catch (error) {
      logger.error('Failed to load vault wallet', { error: error.message });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Vault wallet not configured',
      });
    }

    // Sign with vault wallet (as fee payer)
    transaction.partialSign(vaultWallet.keypair);

    // Submit transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Record sponsorship
    recordSponsorship(walletAddress, signature, eligibility.sponsorshipAmount);

    logger.info('Sponsored transaction submitted', {
      walletAddress,
      signature,
      amount: eligibility.sponsorshipAmount,
    });

    res.json({
      success: true,
      signature,
      message: 'Transaction sponsored and submitted successfully',
    });
  } catch (error) {
    logger.error('Error submitting sponsored transaction', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/sponsor/stats
 * Get sponsorship statistics (admin only)
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getSponsorshipStats();
    res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    logger.error('Error getting sponsorship stats', { error: error.message });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

export default router;

