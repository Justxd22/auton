'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AutonProgram } from '@/lib/anchor/auton_program';
import IDL from '@/lib/anchor/auton_program.json';
import { ArrowLeft, Lock, CheckCircle, AlertTriangle, Info, Zap, User, ExternalLink, Download } from 'lucide-react';
import PaymentModal from './PaymentModal';
import { FeeBadge } from './FeeBreakdown';
import { getUserFriendlyErrorMessage, logWalletError, validateTransaction } from '@/lib/transaction-utils';

const AUTON_PROGRAM_ID = process.env.NEXT_PUBLIC_AUTON_PROGRAM_ID;
const IPFS_GATEWAY_URL = 'https://ipfs.io/ipfs/';

if (!AUTON_PROGRAM_ID) {
  throw new Error('AUTON_PROGRAM_ID is not set in environment variables.');
}

const programId = new PublicKey(AUTON_PROGRAM_ID);

type ContentItem = {
  id: anchor.BN;
  title: string;
  price: anchor.BN;
  encryptedCid: number[];
};

type CreatorAccountData = {
  creatorWallet: PublicKey;
  lastContentId: anchor.BN;
  content: ContentItem[];
  profileCid?: string;
};

type PaymentDetails = {
  price: number;
  assetType: string;
  creatorWalletAddress: string;
  contentId: number;
};

type CreatorProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  socialLinks: Record<string, string>;
  walletAddress: string;
};

type CreatorContentPageProps = {
    creatorId: string; // Can be either username or wallet address
};

export default function CreatorContentPage({ creatorId }: CreatorContentPageProps) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  
  const [creatorAccount, setCreatorAccount] = useState<CreatorAccountData | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [resolvedWalletAddress, setResolvedWalletAddress] = useState<string | null>(null);
  const [isUsername, setIsUsername] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [decryptedCids, setDecryptedCids] = useState<Map<number, string>>(new Map());
  const [contentTypes, setContentTypes] = useState<Map<number, string>>(new Map());
  const [paymentProcessing, setPaymentProcessing] = useState<Map<number, boolean>>(new Map());
  const [selectedContentForPayment, setSelectedContentForPayment] = useState<ContentItem | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Log connection endpoint for debugging
  useEffect(() => {
    if (connection) {
      console.log('Using connection endpoint:', (connection as any).rpcEndpoint || 'default');
    }
  }, [connection]);

  const provider = useMemo(() => {
    // Create a dummy wallet for read-only operations
    const dummyWallet = {
      publicKey: anchor.web3.Keypair.generate().publicKey,
      signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
      signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => tx,
    };
    return new anchor.AnchorProvider(connection, dummyWallet, {
      commitment: 'confirmed',
    });
  }, [connection]);

  const program = useMemo(() => {
    if (provider) {
        const idl = IDL as anchor.Idl;
        return new anchor.Program(idl, provider) as anchor.Program<AutonProgram>;
    }
    return null;
  }, [provider]);

  // Resolve creatorId (Username -> Wallet or Wallet -> Wallet)
  const resolveCreator = useCallback(async () => {
    if (!creatorId || !program) return;
    setLoading(true);
    setError('');

    try {
      // 1. Try as PublicKey first
      try {
        const pubkey = new PublicKey(creatorId);
        setResolvedWalletAddress(pubkey.toBase58());
        setIsUsername(false);
        return; // It's a valid key, proceed
      } catch {
        // Not a public key, treat as username
      }

      // 2. Treat as Username: Fetch UsernameAccount PDA
      setIsUsername(true);
      const [usernamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("username"), Buffer.from(creatorId)],
        program.programId
      );

      try {
        const usernameAccount = await program.account.usernameAccount.fetch(usernamePDA);
        setResolvedWalletAddress(usernameAccount.authority.toBase58());
      } catch (err) {
        console.error("Username lookup failed:", err);
        setError(`Creator @${creatorId} not found.`);
        setResolvedWalletAddress(null);
      }
    } catch (err) {
      console.error('Error resolving creator:', err);
      setError('Failed to resolve creator.');
    } finally {
        if (!resolvedWalletAddress) setLoading(false); 
    }
  }, [creatorId, program]);

  const creatorPubkey = useMemo(() => {
    if (!resolvedWalletAddress) return null;
    try {
      return new PublicKey(resolvedWalletAddress);
    } catch {
      return null;
    }
  }, [resolvedWalletAddress]);

  const creatorAccountPDA = useMemo(() => {
    if (!creatorPubkey || !programId) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), creatorPubkey.toBuffer()],
      program.programId
    );
    return pda;
  }, [creatorPubkey, programId]);

  // Trigger resolution
  useEffect(() => {
    resolveCreator();
  }, [resolveCreator]);

  // Fetch content once resolved
  useEffect(() => {
    if (program && creatorAccountPDA && resolvedWalletAddress) {
      fetchCreatorContent();
    }
  }, [program, creatorAccountPDA, resolvedWalletAddress]);

  // If the page is opened with ?focus=<contentId>, auto-attempt unlock/display
  const searchParams = useSearchParams();
  const [autoFocused, setAutoFocused] = useState<number | null>(null);

  useEffect(() => {
    const focus = searchParams?.get('focus');
    if (!focus) return;
    const id = Number(focus);
    if (!id || !creatorAccount) return;

    // Prevent repeated attempts
    if (autoFocused === id) return;

    const item = creatorAccount.content.find((c) => (c.id as anchor.BN).toNumber() === id);
    if (item) {
      setTimeout(() => handleUnlockContent(item), 300);
      setAutoFocused(id);
    }
  }, [searchParams, creatorAccount, autoFocused]);

  const fetchCreatorContent = async () => {
    if (!program || !creatorAccountPDA) return;
    setLoading(true);
    setError('');
    try {
      const account = await program.account.creatorAccount.fetch(creatorAccountPDA);
      setCreatorAccount(account);

      if (account.profileCid) {
        try {
          const response = await fetch(`${IPFS_GATEWAY_URL}${account.profileCid}`);
          if (response.ok) {
            const profileData = await response.json();
            setCreatorProfile({
                id: resolvedWalletAddress!,
                username: isUsername ? creatorId : undefined,
                displayName: profileData.displayName,
                bio: profileData.bio,
                avatarUrl: profileData.avatarUrl,
                socialLinks: profileData.socialLinks,
                walletAddress: resolvedWalletAddress!,
            });
          }
        } catch (e) {
          console.error("Failed to load profile metadata:", e);
        }
      }

    } catch (err: any) {
      console.error('Failed to fetch creator account:', err);
      const msg = err.message || err.toString();
      if (msg.includes("Account does not exist")) {
         setError('This creator has not initialized their account yet.');
      } else {
         setError('Failed to load content.');
      }
      setCreatorAccount(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchContentType = async (item: ContentItem, cid: string) => {
    try {
      const response = await fetch(`${IPFS_GATEWAY_URL}${cid}`, { method: 'HEAD' });
      if (response.ok) {
        const contentType = response.headers.get('Content-Type');
        if (contentType) {
          setContentTypes(prev => new Map(prev).set(item.id.toNumber(), contentType));
        }
      }
    } catch (err) {
      console.error('Failed to fetch content type:', err);
    }
  };

  const handleUnlockContent = async (contentItem: ContentItem) => {
    if (!publicKey || !connected || !program) {
      setError('Connect your wallet to unlock content.');
      return;
    }
    if (paymentProcessing.get(contentItem.id.toNumber())) return;

    setPaymentProcessing(prev => new Map(prev).set(contentItem.id.toNumber(), true));
    setError('');
    setSuccess('');

    try {
      const accessResponse = await fetch(
        `/api/content/${creatorPubkey!.toBase58()}/${contentItem.id.toNumber()}/access?buyerPubkey=${publicKey.toBase58()}`
      );

      if (accessResponse.status === 402) {
        console.log("Payment required. Building transaction...");
        
        const [configPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("config")],
            program.programId
        );
        const protocolConfig = await program.account.protocolConfig.fetch(configPDA);
        const adminWallet = protocolConfig.adminWallet;

        if (!creatorAccountPDA) throw new Error('Creator account PDA not found');

        const [paidAccessPDA] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("access"),
            publicKey.toBuffer(),
            new anchor.BN(contentItem.id.toNumber()).toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        const ix = await program.methods
          .processPayment(new anchor.BN(contentItem.id.toNumber()))
          .accounts({
            paidAccessAccount: paidAccessPDA,
            protocolConfig: configPDA,
            creatorAccount: creatorAccountPDA!,
            creatorWallet: creatorPubkey!,
            adminWallet: adminWallet,
            buyer: publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .instruction();
        
        const transaction = new Transaction().add(ix);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        const validation = validateTransaction(transaction);
        if (!validation.valid) throw new Error(`Transaction validation failed: ${validation.error}`);

        let signature: string;
        try {
            signature = await sendTransaction(transaction, connection);
        } catch (walletError: any) {
            logWalletError(walletError, 'Payment transaction');
            throw new Error(getUserFriendlyErrorMessage(walletError));
        }

        console.log("Payment sent:", signature);
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        
        setSuccess('Payment confirmed! Retrieving content...');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        await handleUnlockContent(contentItem);

      } else if (accessResponse.ok) {
        const { ipfsCid }: { ipfsCid: string } = await accessResponse.json();
        setDecryptedCids(prev => new Map(prev).set(contentItem.id.toNumber(), ipfsCid));
        setSuccess('Content unlocked!');
        await fetchContentType(contentItem, ipfsCid);
      } else {
        const errData = await accessResponse.json();
        throw new Error(errData.error || 'Failed to get access.');
      }
    } catch (err: any) {
      console.error('Unlock content error:', err);
      const errorMessage = err?.message || getUserFriendlyErrorMessage(err) || 'Failed to unlock content.';
      setError(errorMessage);
    } finally {
      setPaymentProcessing(prev => new Map(prev).set(contentItem.id.toNumber(), false));
    }
  };

  const renderUnlockedContent = (item: ContentItem) => {
    const cid = decryptedCids.get(item.id.toNumber());
    const contentType = contentTypes.get(item.id.toNumber());
    const url = `${IPFS_GATEWAY_URL}${cid}`;

    if (!cid) return null;

    if (!contentType) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin"></div>
        </div>
      );
    }

    if (contentType.startsWith('image/')) {
      return (
        <div className="relative group">
          <img
            src={url}
            alt={item.title}
            className="w-full h-64 object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
          />
          <div className="absolute top-2 right-2 bg-neon-green/20 text-neon-green px-3 py-1 border border-neon-green text-xs font-pixel flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            UNLOCKED
          </div>
        </div>
      );
    }

    if (contentType.startsWith('video/')) {
      return (
        <div className="relative">
          <video
            controls
            src={url}
            className="w-full h-64 object-cover"
          />
          <div className="absolute top-2 right-2 bg-neon-green/20 text-neon-green px-3 py-1 border border-neon-green text-xs font-pixel flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            UNLOCKED
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <Download className="w-12 h-12 text-neon-blue" />
        <a
          href={url}
          download
          className="retro-btn-primary flex items-center gap-2 text-xs"
        >
          <Download className="w-4 h-4" />
          DOWNLOAD_FILE
        </a>
        <p className="text-xs text-zinc-500 font-mono">TYPE: {contentType}</p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="font-pixel text-neon-blue text-xl">LOADING_PROFILE...</p>
        </div>
      </div>
    );
  }

  if (error && !creatorAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md mx-auto px-4 border border-neon-pink p-8 bg-neon-pink/5">
          <AlertTriangle className="w-16 h-16 text-neon-pink mx-auto" />
          <p className="text-neon-pink font-pixel text-xl">{error.toUpperCase()}</p>
          <Link href="/" className="retro-btn inline-flex items-center gap-2 mt-4">
            <ArrowLeft className="w-4 h-4" />
            RETURN TO HUB
          </Link>
        </div>
      </div>
    );
  }

  if (!creatorAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 border border-zinc-700 p-8">
          <Info className="w-16 h-16 text-zinc-500 mx-auto" />
          <p className="font-mono text-zinc-400">NO_CONTENT_FOUND</p>
          <Link href="/" className="retro-btn inline-flex items-center gap-2 mt-4">
            <ArrowLeft className="w-4 h-4" />
            RETURN TO HUB
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors font-mono uppercase text-sm">
            <ArrowLeft className="w-4 h-4" />
            BACK_TO_HUB
          </Link>
          <WalletMultiButton className="!bg-surface !border !border-border !font-pixel !uppercase hover:!bg-neon-green hover:!text-black" />
        </div>

        {/* Creator Info Card (Player Card Style) */}
        <div className="retro-card mb-8 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-2 opacity-50 font-mono text-[10px] text-zinc-600">ID: {creatorPubkey?.toBase58().slice(0,8)}</div>
          
          <div className="w-32 h-32 bg-black border-2 border-neon-blue flex-shrink-0 relative">
             {creatorProfile?.avatarUrl ? (
               <img src={creatorProfile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
             ) : (
               <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                 <User className="w-12 h-12 text-zinc-600" />
               </div>
             )}
             <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-neon-green border border-black"></div>
          </div>

          <div className="flex-1 text-center md:text-left space-y-2">
             <h1 className="font-pixel text-5xl text-white">
               {creatorProfile?.displayName || creatorProfile?.username || 'UNKNOWN_CREATOR'}
             </h1>
             {creatorProfile?.username && (
               <p className="font-mono text-neon-blue">@{creatorProfile.username}</p>
             )}
             {creatorProfile?.bio && (
               <p className="font-mono text-sm text-zinc-400 max-w-2xl border-l-2 border-zinc-700 pl-4 py-1">
                 {creatorProfile.bio}
               </p>
             )}
             
             {creatorProfile?.socialLinks && Object.keys(creatorProfile.socialLinks).length > 0 && (
                <div className="flex items-center justify-center md:justify-start gap-4 pt-2">
                  {Object.entries(creatorProfile.socialLinks).map(([platform, url]) => (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-zinc-500 hover:text-neon-yellow uppercase flex items-center gap-1"
                    >
                      {platform} <ExternalLink className="w-3 h-3" />
                    </a>
                  ))}
                </div>
             )}
          </div>

          <div className="flex flex-col items-end justify-center border-l border-dashed border-zinc-800 pl-8">
             <div className="text-right">
                <span className="font-pixel text-4xl text-neon-green">{creatorAccount.content.length}</span>
                <p className="font-mono text-xs text-zinc-500 uppercase">DROPS_ACTIVE</p>
             </div>
          </div>
        </div>

        {/* Alert Messages */}
        {success && (
          <div className="mb-6 p-4 border border-neon-green bg-neon-green/10 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-neon-green" />
            <p className="font-mono text-sm text-neon-green">{success}</p>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 border border-neon-pink bg-neon-pink/10 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-neon-pink" />
            <p className="font-mono text-sm text-neon-pink">{error}</p>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="border border-neon-orange/30 p-4 bg-neon-orange/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-neon-orange mt-1" />
              <div>
                <h3 className="font-pixel text-neon-orange mb-1">NO_REFUNDS_POLICY</h3>
                <p className="font-mono text-xs text-neon-orange/70 leading-relaxed">
                  BLOCKCHAIN TRANSACTIONS ARE FINAL. CONFIRM BEFORE UNLOCKING.
                </p>
              </div>
            </div>
          </div>

          <div className="border border-neon-blue/30 p-4 bg-neon-blue/5">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-neon-blue mt-1" />
              <div>
                <h3 className="font-pixel text-neon-blue mb-1">SYSTEM_INSTRUCTIONS</h3>
                <ol className="font-mono text-xs text-neon-blue/70 space-y-1 list-decimal list-inside">
                  <li>CONNECT_WALLET</li>
                  <li>SELECT_TARGET_DROP</li>
                  <li>APPROVE_TX</li>
                  <li>ACCESS_GRANTED</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {creatorAccount.content.map((item) => {
            const isUnlocked = decryptedCids.has(item.id.toNumber());
            const isProcessing = paymentProcessing.get(item.id.toNumber());

            return (
              <div
                key={item.id.toNumber()}
                className="retro-card p-0 overflow-hidden group flex flex-col h-full hover:border-neon-green transition-colors"
              >
                {/* Content Preview/Display */}
                <div className="relative h-64 bg-zinc-900 border-b border-border">
                  {isUnlocked ? (
                    renderUnlockedContent(item)
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center space-y-3">
                        <div className="w-12 h-12 border-2 border-zinc-700 flex items-center justify-center mx-auto">
                          <Lock className="w-6 h-6 text-zinc-500" />
                        </div>
                        <p className="font-pixel text-zinc-500">ENCRYPTED_DATA</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Content Info */}
                <div className="p-5 flex flex-col flex-1">
                  <h2 className="font-pixel text-xl text-white truncate mb-4 group-hover:text-neon-green transition-colors">
                    {item.title}
                  </h2>

                  {/* Price and Creator */}
                  <div className="space-y-4 mb-4 flex-1">
                    <div className="flex items-end justify-between border-b border-dashed border-zinc-800 pb-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-pixel text-3xl text-neon-yellow">
                          {(item.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL).toFixed(3)}
                        </span>
                        <span className="font-mono text-sm text-zinc-500">SOL</span>
                      </div>
                      <FeeBadge />
                    </div>
                  </div>

                  {/* Action Button */}
                  {!isUnlocked && (
                    <button
                      onClick={() => {
                        if (!connected) return;
                        setSelectedContentForPayment(item);
                        setShowPaymentModal(true);
                      }}
                      disabled={!connected || isProcessing}
                      className="w-full retro-btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {!connected ? (
                        <>
                          <Lock className="w-4 h-4" />
                          CONNECT_TO_UNLOCK
                        </>
                      ) : isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                          PROCESSING...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          UNLOCK_ACCESS
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Payment Modal */}
        {selectedContentForPayment && creatorPubkey && (
          <PaymentModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setSelectedContentForPayment(null);
            }}
            onConfirm={async () => {
              await handleUnlockContent(selectedContentForPayment);
              setShowPaymentModal(false);
              setSelectedContentForPayment(null);
            }}
            contentTitle={selectedContentForPayment.title}
            priceInSol={selectedContentForPayment.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL}
            creatorUsername={creatorProfile?.username || (isUsername ? creatorId : null)}
            creatorWallet={creatorPubkey.toBase58()}
          />
        )}
      </div>
    </div>
  );
}
