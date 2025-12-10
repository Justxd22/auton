/**
 * Vault Utilities
 * 
 * Handles vault wallet operations and fee collection
 */

import { Keypair } from '@solana/web3.js';
import { logger } from './logger.js';
import crypto from 'crypto';

/**
 * Generate a new vault wallet keypair
 * Store the private key securely in production
 */
export function generateVaultWallet() {
  const keypair = Keypair.generate();
  
  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: Buffer.from(keypair.secretKey).toString('base64'),
    secretKey: keypair.secretKey,
  };
}

/**
 * Load vault wallet from environment variable
 */
export function loadVaultWallet() {
  const privateKeyBase64 = process.env.VAULT_WALLET_PRIVATE_KEY;
  const address = process.env.VAULT_WALLET_ADDRESS;

  if (!privateKeyBase64 || !address) {
    throw new Error('VAULT_WALLET_PRIVATE_KEY and VAULT_WALLET_ADDRESS must be set');
  }

  try {
    const secretKey = Buffer.from(privateKeyBase64, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);
    
    // Verify address matches
    if (keypair.publicKey.toBase58() !== address) {
      throw new Error('Vault wallet address does not match private key');
    }

    return {
      keypair,
      publicKey: keypair.publicKey,
      address: keypair.publicKey.toBase58(),
    };
  } catch (error) {
    logger.error('Error loading vault wallet', { error: error.message });
    throw new Error('Failed to load vault wallet');
  }
}

/**
 * Calculate platform fee
 */
export function calculatePlatformFee(amount, feePercentage = 0.75) {
  // feePercentage is in percentage (0.75 = 0.75%)
  const fee = (amount * feePercentage) / 100;
  return Math.floor(fee);
}

/**
 * Get vault statistics
 */
export async function getVaultStats(connection) {
  try {
    const vaultAddress = process.env.VAULT_WALLET_ADDRESS;
    if (!vaultAddress) {
      return null;
    }

    const { PublicKey } = await import('@solana/web3.js');
    const pubkey = new PublicKey(vaultAddress);
    const balance = await connection.getBalance(pubkey);

    return {
      address: vaultAddress,
      balance,
      balanceSOL: balance / 1_000_000_000, // Convert lamports to SOL
    };
  } catch (error) {
    logger.error('Error getting vault stats', { error: error.message });
    return null;
  }
}

