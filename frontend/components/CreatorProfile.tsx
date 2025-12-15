'use client';

import { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { AutonProgram } from '@/lib/anchor/auton_program';
import IDL from '@/lib/anchor/auton_program.json';
import { User, Save, X, Link as LinkIcon, Loader2, Camera, Plus, Trash2 } from 'lucide-react';
import { getUserFriendlyErrorMessage, logWalletError } from '@/lib/transaction-utils';

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const AUTON_PROGRAM_ID = process.env.NEXT_PUBLIC_AUTON_PROGRAM_ID;

if (!AUTON_PROGRAM_ID) {
  throw new Error('AUTON_PROGRAM_ID is not set in environment variables.');
}

const programId = new PublicKey(AUTON_PROGRAM_ID);

interface CreatorProfileProps {
  onClose: () => void;
  onUpdate: (profile: ProfileData) => void;
  initialProfile?: ProfileData | null;
}

interface ProfileData {
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  socialLinks: Record<string, string>;
}

const SOCIAL_PLATFORMS = [
  { key: 'twitter', label: 'Twitter/X', placeholder: 'https://twitter.com/username' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/username' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@channel' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/username' },
  { key: 'website', label: 'Website', placeholder: 'https://yourwebsite.com' },
];

export default function CreatorProfile({ onClose, onUpdate, initialProfile }: CreatorProfileProps) {
  const { publicKey, sendTransaction } = useWallet();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [displayName, setDisplayName] = useState(initialProfile?.displayName || '');
  const [bio, setBio] = useState(initialProfile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(initialProfile?.avatarUrl || '');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>(
    initialProfile?.socialLinks || {}
  );
  const [activeSocialInputs, setActiveSocialInputs] = useState<string[]>(
    Object.keys(initialProfile?.socialLinks || {})
  );

  useEffect(() => {
    if (initialProfile) {
      setDisplayName(initialProfile.displayName || '');
      setBio(initialProfile.bio || '');
      setAvatarUrl(initialProfile.avatarUrl || '');
      setSocialLinks(initialProfile.socialLinks || {});
      setActiveSocialInputs(Object.keys(initialProfile.socialLinks || {}));
    }
  }, [initialProfile]);

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  const program = useMemo(() => {
    const provider = new anchor.AnchorProvider(connection, {
      publicKey: PublicKey.default,
      signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
      signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => tx,
    }, { commitment: 'confirmed' });
    const idl = IDL as anchor.Idl;
    return new anchor.Program(idl, provider) as anchor.Program<AutonProgram>;
  }, [connection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Filter out empty social links
      const filteredSocialLinks: Record<string, string> = {};
      for (const [key, value] of Object.entries(socialLinks)) {
        if (value && value.trim()) {
          filteredSocialLinks[key] = value.trim();
        }
      }

      const profileData = {
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        socialLinks: filteredSocialLinks,
      };

      // 1. Upload Profile Data to IPFS (Public)
      const profileBlob = new Blob([JSON.stringify(profileData)], { type: 'application/json' });
      const formData = new FormData();
      formData.append('file', profileBlob, 'profile.json');

      const uploadResponse = await fetch('/api/upload?public=true', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload profile data to IPFS');
      }

      const { cid } = await uploadResponse.json();
      console.log('Profile uploaded to IPFS:', cid);

      // 2. Call Smart Contract to update profile CID
      const [creatorAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator"), publicKey.toBuffer()],
        programId
      );

      // Check if creator account exists
      try {
        await program.account.creatorAccount.fetch(creatorAccountPDA);
      } catch (e) {
        throw new Error("You must initialize your creator account (publish first drop) before setting a profile.");
      }

      const ix = await program.methods
        .updateProfile(cid)
        .accounts({
          creatorAccount: creatorAccountPDA,
          creator: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      setSuccess('Profile updated successfully!');
      onUpdate(profileData);
      
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(getUserFriendlyErrorMessage(err) || 'Failed to update profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addSocialLink = (platform: string) => {
    if (!activeSocialInputs.includes(platform)) {
      setActiveSocialInputs([...activeSocialInputs, platform]);
    }
  };

  const removeSocialLink = (platform: string) => {
    setActiveSocialInputs(activeSocialInputs.filter(p => p !== platform));
    const newLinks = { ...socialLinks };
    delete newLinks[platform];
    setSocialLinks(newLinks);
  };

  const availablePlatforms = SOCIAL_PLATFORMS.filter(
    p => !activeSocialInputs.includes(p.key)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-black border-2 border-zinc-700 shadow-[0_0_40px_rgba(0,0,0,0.8)] relative">
        
        {/* Title Bar */}
        <div className="bg-zinc-800 border-b-2 border-zinc-700 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-neon-blue" />
            <span className="font-pixel text-white uppercase tracking-widest text-lg">SYSTEM.EDIT_PROFILE</span>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-neon-pink hover:text-black text-zinc-400 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 bg-black bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:16px_16px] max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Avatar URL */}
            <div>
              <label className="block font-mono text-xs text-neon-blue mb-2 uppercase tracking-wider">
                &gt; Profile_Picture_URL
              </label>
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 bg-zinc-900 border border-zinc-700 flex-shrink-0 flex items-center justify-center">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Avatar preview"
                      className="w-full h-full object-cover"
                      onError={() => setAvatarUrl('')}
                    />
                  ) : (
                    <Camera className="w-6 h-6 text-zinc-600" />
                  )}
                </div>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  className="retro-input text-sm"
                />
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block font-mono text-xs text-neon-blue mb-2 uppercase tracking-wider">
                &gt; Display_Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="YOUR NAME"
                maxLength={100}
                className="retro-input"
              />
              <p className="mt-1 text-[10px] font-mono text-zinc-600 text-right">{displayName.length}/100</p>
            </div>

            {/* Bio */}
            <div>
              <label className="block font-mono text-xs text-neon-blue mb-2 uppercase tracking-wider">
                &gt; Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="TELL YOUR STORY..."
                rows={3}
                maxLength={500}
                className="retro-input resize-none"
              />
              <p className="mt-1 text-[10px] font-mono text-zinc-600 text-right">{bio.length}/500</p>
            </div>

            {/* Social Links */}
            <div>
              <label className="block font-mono text-xs text-neon-blue mb-3 uppercase tracking-wider">
                &gt; Social_Connections
              </label>
              
              <div className="space-y-3">
                {activeSocialInputs.map((platformKey) => {
                  const platform = SOCIAL_PLATFORMS.find(p => p.key === platformKey);
                  if (!platform) return null;
                  
                  return (
                    <div key={platform.key} className="flex items-center gap-2">
                      <div className="flex-shrink-0 w-24">
                        <span className="font-mono text-xs text-zinc-400 uppercase">
                          {platform.label}:
                        </span>
                      </div>
                      <input
                        type="url"
                        value={socialLinks[platform.key] || ''}
                        onChange={(e) => setSocialLinks({ ...socialLinks, [platform.key]: e.target.value })}
                        placeholder={platform.placeholder}
                        className="retro-input text-sm py-2"
                      />
                      <button
                        type="button"
                        onClick={() => removeSocialLink(platform.key)}
                        className="p-2 text-neon-pink hover:bg-neon-pink hover:text-black border border-transparent hover:border-neon-pink transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add Social Link */}
              {availablePlatforms.length > 0 && (
                <div className="mt-3">
                  <div className="relative">
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          addSocialLink(e.target.value);
                          e.target.value = '';
                        }
                      }}
                      className="w-full bg-black border border-dashed border-zinc-700 px-4 py-2 text-zinc-500 font-mono text-xs uppercase cursor-pointer hover:border-neon-blue hover:text-neon-blue transition-colors outline-none appearance-none"
                    >
                      <option value="">+ ADD CONNECTION...</option>
                      {availablePlatforms.map((platform) => (
                        <option key={platform.key} value={platform.key}>
                          {platform.label}
                        </option>
                      ))}
                    </select>
                    <Plus className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 pointer-events-none" />
                  </div>
                </div>
              )}
            </div>

            {/* Status Messages */}
            {error && (
              <div className="bg-neon-pink/10 border border-neon-pink p-3 text-neon-pink font-mono text-xs">
                ERROR: {error}
              </div>
            )}
            
            {success && (
              <div className="bg-neon-green/10 border border-neon-green p-3 text-neon-green font-mono text-xs">
                SUCCESS: {success}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4 pt-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="retro-btn flex-1 bg-black border-zinc-700 text-zinc-400"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="retro-btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    SAVING...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    SAVE PROFILE
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

