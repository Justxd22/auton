/**
 * Sponsorship Utilities
 * 
 * Handles gas fee sponsorship for new users
 */

import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logger } from './logger.js';
import database from '../database.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const SPONSORSHIP_AMOUNT = parseInt(process.env.VAULT_SPONSORSHIP_AMOUNT || '10000000'); // 0.01 SOL default
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';

const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Check if a wallet is eligible for sponsorship
 * Eligibility criteria:
 * 1. Wallet has never been sponsored before
 * 2. Wallet has no prior on-chain transactions
 */
export async function checkSponsorshipEligibility(walletAddress) {
  try {
    // Check if already sponsored in database
    if (database.isUserSponsored(walletAddress)) {
      return {
        eligible: false,
        reason: 'User has already been sponsored',
      };
    }

    // Check if wallet has any prior transactions
    const pubkey = new PublicKey(walletAddress);
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 1 });
    
    if (signatures.length > 0) {
      return {
        eligible: false,
        reason: 'Wallet has prior transactions',
      };
    }

    // Check wallet balance (should be 0 or very low for new wallets)
    const balance = await connection.getBalance(pubkey);
    const hasBalance = balance > 5000; // More than 0.000005 SOL

    if (hasBalance) {
      return {
        eligible: false,
        reason: 'Wallet already has balance',
      };
    }

    return {
      eligible: true,
      sponsorshipAmount: SPONSORSHIP_AMOUNT,
    };
  } catch (error) {
    logger.error('Error checking sponsorship eligibility', {
      walletAddress,
      error: error.message,
    });
    return {
      eligible: false,
      reason: `Error checking eligibility: ${error.message}`,
    };
  }
}

/**
 * Build a sponsored transaction
 * The vault wallet will pay for fees and rent
 */
export async function buildSponsoredTransaction(
  userWalletAddress,
  instructions,
  feePayerAddress = VAULT_WALLET_ADDRESS
) {
  try {
    if (!feePayerAddress) {
      throw new Error('VAULT_WALLET_ADDRESS is not configured');
    }

    const feePayer = new PublicKey(feePayerAddress);
    const userPubkey = new PublicKey(userWalletAddress);

    // Create transaction
    const transaction = new Transaction();

    // Add compute budget instructions for sponsored transaction
    // Set compute unit limit to prevent expensive operations
    const computeBudgetIx = {
      programId: new PublicKey('ComputeBudget11111111111111111111111111111'),
      keys: [],
      data: Buffer.from([
        2, // SetComputeUnitLimit instruction
        ...Buffer.alloc(4), // Compute units (will be set by simulation)
      ]),
    };

    // Add all user instructions
    instructions.forEach(ix => transaction.add(ix));

    // Set fee payer (vault wallet)
    transaction.feePayer = feePayer;

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    return {
      transaction,
      feePayer,
      blockhash,
      lastValidBlockHeight,
    };
  } catch (error) {
    logger.error('Error building sponsored transaction', {
      walletAddress: userWalletAddress,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Record sponsorship in database
 */
export function recordSponsorship(walletAddress, txSignature, amount = SPONSORSHIP_AMOUNT) {
  try {
    const record = database.markUserAsSponsored(walletAddress, txSignature, amount);
    logger.info('Sponsorship recorded', {
      walletAddress,
      txSignature,
      amount,
    });
    return record;
  } catch (error) {
    logger.error('Error recording sponsorship', {
      walletAddress,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get sponsorship statistics
 */
export function getSponsorshipStats() {
  const sponsoredUsers = Object.values(database.data.sponsoredUsers || {});
  
  return {
    totalSponsored: sponsoredUsers.length,
    totalAmount: sponsoredUsers.reduce((sum, u) => sum + (u.amount || 0), 0),
    recentSponsorships: sponsoredUsers
      .sort((a, b) => new Date(b.sponsoredAt) - new Date(a.sponsoredAt))
      .slice(0, 10),
  };
}

