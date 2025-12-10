/**
 * Generate Vault Wallet Script
 * 
 * Generates a new Solana keypair for the vault wallet.
 * Store the output securely and add to .env file.
 * 
 * Usage: node scripts/generate-vault-wallet.js
 */

import { Keypair } from '@solana/web3.js';

console.log('Generating vault wallet...\n');

// Generate new keypair
const keypair = Keypair.generate();
const publicKey = keypair.publicKey.toBase58();
const privateKey = Buffer.from(keypair.secretKey).toString('base64');

console.log('Vault wallet generated successfully!\n');
console.log('Add these to your .env file:\n');
console.log(`VAULT_WALLET_ADDRESS=${publicKey}`);
console.log(`VAULT_WALLET_PRIVATE_KEY=${privateKey}\n`);
console.log('⚠️  IMPORTANT: Keep the private key secure!');
console.log('⚠️  Do not commit this to version control!');
console.log('\nNext steps:');
console.log('1. Fund the vault wallet with 10-15 SOL');
console.log('2. Initialize the vault governance program on-chain');
console.log('3. Set up monitoring for vault balance');

