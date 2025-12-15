'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react'; // Only Loader2 is needed now
import { PublicKey } from '@solana/web3.js';
import { useHasPrivyWallet } from '@/lib/privy-solana-adapter';

interface SocialLoginProps {
  onSuccess?: (walletAddress: string) => void;
  onError?: (error: Error) => void;
}

export function SocialLogin({ onSuccess, onError }: SocialLoginProps) {
  const { login, authenticated, user, ready } = usePrivy();
  const hasSolanaWallet = useHasPrivyWallet();
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated && user) {
      const checkWallet = setTimeout(() => {
        if (hasSolanaWallet && user?.wallet?.address) {
          try {
            const pubkey = new PublicKey(user.wallet.address);
            if (onSuccess) {
              onSuccess(user.wallet.address);
            }
          } catch (e) {
            const error = new Error('Only Solana wallets are supported. Please configure Privy to use Solana as the default chain.');
            console.error('Invalid wallet type:', error);
            if (onError) {
              onError(error);
            }
          }
        } else if (authenticated && !hasSolanaWallet) {
          const error = new Error('Solana wallet not found. Please ensure Solana is configured as the default chain in Privy Dashboard.');
          console.error('Solana wallet missing:', error);
          if (onError) {
            onError(error);
          }
        }
      }, 2000);
      return () => clearTimeout(checkWallet);
    }
  }, [authenticated, user, hasSolanaWallet, onSuccess, onError]);

  const handleLogin = async () => {
    try {
      setLoading('privy');
      await login();
    } catch (error: any) {
      console.error(`Login error:`, error);
      const errorMessage = error?.message || `Failed to login`;
      if (onError) {
        onError(new Error(errorMessage));
      }
      setLoading(null);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 text-neon-green animate-spin" />
      </div>
    );
  }

  if (authenticated && hasSolanaWallet && user?.wallet?.address) {
    return (
      <div className="p-6 bg-neon-green/10 border-2 border-neon-green">
        <p className="font-mono text-neon-green font-medium uppercase tracking-wider text-sm">
          ✓ WALLET CONNECTED: {user.wallet.address.slice(0, 8)}...{user.wallet.address.slice(-6)}
        </p>
      </div>
    );
  } else if (authenticated && !hasSolanaWallet) {
      return (
        <div className="p-6 bg-neon-pink/10 border-2 border-neon-pink">
          <p className="font-mono text-neon-pink font-medium uppercase tracking-wider text-sm">
            ⚠ INVALID WALLET TYPE DETECTED
          </p>
        </div>
      );
  }

  return (
    <div className="w-full">
      <button
        onClick={handleLogin}
        disabled={loading !== null}
        className="retro-btn w-full flex items-center justify-center gap-3 bg-black border-zinc-700 text-zinc-300 hover:text-white hover:border-white"
      >
        {loading === 'privy' ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            {/* Using a generic Shield icon to represent Privy/Security as requested */}
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>SOCIAL LOGIN</span>
          </>
        )}
      </button>
    </div>
  );
}

