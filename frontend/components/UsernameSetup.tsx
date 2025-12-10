'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { CheckCircle, XCircle, Loader2, AtSign, Sparkles } from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface UsernameSetupProps {
  onUsernameSet: (username: string) => void;
  onSkip?: () => void;
  existingUsername?: string | null;
}

export default function UsernameSetup({ onUsernameSet, onSkip, existingUsername }: UsernameSetupProps) {
  const { publicKey } = useWallet();
  const [username, setUsername] = useState(existingUsername || '');
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availability, setAvailability] = useState<{
    available: boolean;
    valid: boolean;
    error?: string;
  } | null>(null);
  const [error, setError] = useState('');

  // Debounced username availability check
  const checkAvailability = useCallback(async (usernameToCheck: string) => {
    if (!usernameToCheck || usernameToCheck.length < 2) {
      setAvailability(null);
      return;
    }

    setIsChecking(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/creators/check-username/${encodeURIComponent(usernameToCheck)}`
      );
      const data = await response.json();
      setAvailability(data);
    } catch (err) {
      console.error('Error checking username:', err);
      setAvailability({ available: false, valid: false, error: 'Failed to check availability' });
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Debounce the availability check
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (username && username !== existingUsername) {
        checkAvailability(username);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username, checkAvailability, existingUsername]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!publicKey || !username) {
      setError('Please connect your wallet and enter a username');
      return;
    }

    if (!availability?.available || !availability?.valid) {
      setError('Please choose an available username');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/creators/${publicKey.toBase58()}/username`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            walletAddress: publicKey.toBase58(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set username');
      }

      onUsernameSet(username);
    } catch (err: any) {
      console.error('Error setting username:', err);
      setError(err.message || 'Failed to set username');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusIcon = () => {
    if (isChecking) {
      return <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />;
    }
    if (!availability) {
      return null;
    }
    if (availability.available && availability.valid) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  const getStatusMessage = () => {
    if (isChecking) {
      return <span className="text-gray-500">Checking availability...</span>;
    }
    if (!availability) {
      return null;
    }
    if (availability.available && availability.valid) {
      return <span className="text-green-600 dark:text-green-400">Username is available!</span>;
    }
    if (!availability.valid) {
      return <span className="text-red-600 dark:text-red-400">{availability.error}</span>;
    }
    return <span className="text-red-600 dark:text-red-400">Username is already taken</span>;
  };

  return (
    <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
          <AtSign className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Choose Your Username
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          This will be your public profile URL:
          <br />
          <code className="text-blue-600 dark:text-blue-400 text-sm bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded mt-1 inline-block">
            auton.vercel.app/creators/{username || 'your_username'}
          </code>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Username
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase().replace(/\s/g, ''));
                setAvailability(null);
              }}
              placeholder="your_username"
              className="w-full rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-10 pr-12 py-3 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
              minLength={2}
              maxLength={50}
              required
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              {getStatusIcon()}
            </div>
          </div>
          <div className="mt-2 text-sm min-h-[20px]">
            {getStatusMessage()}
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-2 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
          <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Your username hides your wallet address from public URLs for privacy.
          </p>
        </div>

        <div className="flex gap-3">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 py-3 px-4 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
            >
              Skip for now
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !availability?.available || !availability?.valid}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Setting username...
              </>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

