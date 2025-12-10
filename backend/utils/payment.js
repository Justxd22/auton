import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
// Default to 0.75% platform fee (vs traditional platforms' 5-8%)
const PLATFORM_FEE_PERCENTAGE = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '0.75');
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const connection = new Connection(RPC_URL, 'confirmed');

// Helper for retry logic
async function withRetry(fn, context = 'operation', maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      logger.warn(`${context} failed (attempt ${attempt}/${maxRetries})`, {
        error: error.message,
        attempt,
        maxRetries,
      });
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
  }
  
  logger.error(`${context} failed after ${maxRetries} attempts`, {
    error: lastError.message,
  });
  
  throw lastError;
}

// Generate payment request parameters for x402 protocol
export function generatePaymentRequest(creatorWalletAddress, amount, assetType = 'SOL') {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const paymentId = crypto.randomUUID();
  
  // Calculate platform fee (0.75% by default)
  const platformFee = (amount * PLATFORM_FEE_PERCENTAGE) / 100;
  const creatorAmount = amount - platformFee;

  // For SOL, assetAddress is empty. For USDC, it would be the USDC mint address
  // Use mainnet USDC address when on mainnet
  const assetAddress = assetType === 'USDC' 
    ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mint (same for devnet/mainnet)
    : '';

  return {
    maxAmountRequired: amount.toString(),
    assetType,
    assetAddress,
    paymentAddress: creatorWalletAddress,
    platformFeeAddress: process.env.VAULT_WALLET_ADDRESS || process.env.PLATFORM_WALLET_ADDRESS || '',
    platformFee: platformFee.toString(),
    platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
    creatorAmount: creatorAmount.toString(),
    creatorPercentage: 100 - PLATFORM_FEE_PERCENTAGE,
    network: NETWORK,
    nonce,
    paymentId,
    timestamp: Date.now(),
    // Fee breakdown for transparency
    feeBreakdown: {
      contentPrice: amount,
      platformFeeAmount: platformFee,
      platformFeePercent: `${PLATFORM_FEE_PERCENTAGE}%`,
      creatorReceives: creatorAmount,
      creatorReceivesPercent: `${(100 - PLATFORM_FEE_PERCENTAGE).toFixed(2)}%`,
      note: 'Transaction fees excluded',
    },
  };
}

// Verify payment transaction signature with retry logic
export async function verifyPayment(signature, expectedAmount, expectedRecipient, assetType = 'SOL') {
  logger.payment('Verifying payment', {
    signature: signature.slice(0, 16) + '...',
    expectedAmount,
    expectedRecipient: expectedRecipient.slice(0, 8) + '...',
    assetType,
  });

  try {
    // Get transaction details from Solana with retry
    const tx = await withRetry(
      async () => {
        const result = await connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (!result) {
          throw new Error('Transaction not found - may still be processing');
        }
        
        return result;
      },
      `Fetching transaction ${signature.slice(0, 16)}...`
    );

    if (!tx.meta) {
      logger.warn('Payment verification failed: no metadata', { signature });
      return { valid: false, error: 'Transaction metadata not available' };
    }

    if (tx.meta.err) {
      logger.warn('Payment verification failed: tx error', { signature, error: tx.meta.err });
      return { valid: false, error: `Transaction failed: ${tx.meta.err}` };
    }

    // Verify the transaction was successful
    const recipientPubkey = new PublicKey(expectedRecipient);
    
    // Check balance changes to verify payment
    const preBalances = tx.meta.preBalances;
    const postBalances = tx.meta.postBalances;
    const preTokenBalances = tx.meta.preTokenBalances || [];
    const postTokenBalances = tx.meta.postTokenBalances || [];

    if (assetType === 'SOL') {
      // Find the account index for the recipient
      const accountKeys = tx.transaction.message.accountKeys.map(key => 
        typeof key === 'object' ? key.pubkey.toString() : key.toString()
      );
      
      const recipientIndex = accountKeys.findIndex(key => key === expectedRecipient);
      
      if (recipientIndex === -1) {
        logger.warn('Payment verification failed: recipient not found', { signature, expectedRecipient });
        return { valid: false, error: 'Recipient not found in transaction' };
      }

      const balanceChange = postBalances[recipientIndex] - preBalances[recipientIndex];
      const expectedLamports = expectedAmount * 1e9; // Convert SOL to lamports

      // Allow some tolerance for fees
      if (balanceChange < expectedLamports * 0.95) {
        logger.warn('Payment verification failed: insufficient amount', {
          signature,
          expected: expectedAmount,
          received: balanceChange / 1e9,
        });
        return { valid: false, error: `Insufficient payment. Expected ${expectedAmount} SOL, received ${balanceChange / 1e9} SOL` };
      }
    } else if (assetType === 'USDC') {
      // For token transfers, check token balance changes
      const recipientTokenBalance = postTokenBalances.find(
        balance => balance.owner === expectedRecipient
      );

      if (!recipientTokenBalance) {
        logger.warn('Payment verification failed: token transfer not found', { signature });
        return { valid: false, error: 'Token transfer not found' };
      }

      const balanceChange = recipientTokenBalance.uiTokenAmount.uiAmount;
      const expectedAmountDecimal = parseFloat(expectedAmount);

      if (balanceChange < expectedAmountDecimal * 0.95) {
        logger.warn('Payment verification failed: insufficient USDC', {
          signature,
          expected: expectedAmountDecimal,
          received: balanceChange,
        });
        return { valid: false, error: `Insufficient payment. Expected ${expectedAmount} USDC, received ${balanceChange} USDC` };
      }
    }

    logger.payment('Payment verified successfully', {
      signature: signature.slice(0, 16) + '...',
      amount: expectedAmount,
      assetType,
    });

    return {
      valid: true,
      transaction: tx,
      signature,
    };
  } catch (error) {
    logger.error('Payment verification error', { signature, error: error.message });
    return { valid: false, error: error.message };
  }
}

// Calculate amounts with platform fee (0.75% by default)
export function calculateAmounts(totalAmount) {
  const platformFee = (totalAmount * PLATFORM_FEE_PERCENTAGE) / 100;
  const creatorAmount = totalAmount - platformFee;
  
  return {
    totalAmount,
    platformFee,
    creatorAmount,
    platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
    creatorPercentage: 100 - PLATFORM_FEE_PERCENTAGE,
    // Detailed breakdown for UI display
    breakdown: {
      contentPrice: totalAmount,
      platformFeeAmount: platformFee,
      platformFeePercent: `${PLATFORM_FEE_PERCENTAGE}%`,
      creatorReceives: creatorAmount,
      creatorReceivesPercent: `${(100 - PLATFORM_FEE_PERCENTAGE).toFixed(2)}%`,
      comparison: 'vs. 5-8% on traditional platforms',
      note: 'Transaction fees excluded',
    },
  };
}

// Get fee info for display
export function getFeeInfo() {
  return {
    platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
    platformFeeDisplay: `${PLATFORM_FEE_PERCENTAGE}%`,
    creatorKeepsPercentage: 100 - PLATFORM_FEE_PERCENTAGE,
    creatorKeepsDisplay: `${(100 - PLATFORM_FEE_PERCENTAGE).toFixed(2)}%`,
    comparison: 'vs. 5-8% on traditional platforms',
    note: 'Auton charges a flat 0.75% fee. This excludes Solana network transaction fees.',
  };
}
