'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AutonProgram } from '@/lib/anchor/auton_program';
import IDL from '@/lib/anchor/auton_program.json';

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const AUTON_PROGRAM_ID = process.env.NEXT_PUBLIC_AUTON_PROGRAM_ID;

if (!AUTON_PROGRAM_ID) {
  throw new Error('AUTON_PROGRAM_ID is not set in environment variables.');
}

const programId = new PublicKey(AUTON_PROGRAM_ID);

type ContentItem = {
  id: anchor.BN;
  title: string;
  description: string;
  price: anchor.BN;
  assetType: 'SOL' | 'USDC';
  contentKind: string;
  allowDownload: boolean;
  creatorWalletAddress: PublicKey;
  preview?: {
    enabled: boolean;
    mode: string;
    snippet?: string | null;
    previewUrl?: string | null;
    previewType?: string | null;
    previewContentType?: string | null;
  };
};

type CreatorAccountData = {
  creatorWallet: PublicKey;
  lastContentId: anchor.BN;
  content: ContentItem[];
};


type FormState = {
  title: string;
  description: string;
  price: string;
};

const defaultFormState: FormState = {
  title: '',
  description: '',
  price: '0.02',
};

const bytesToMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

export default function CreatorWorkspace() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [creatorId, setCreatorId] = useState('');
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ type: 'error' | 'success' | null; message: string }>({
    type: null,
    message: '',
  });
  const [creatorAccountData, setCreatorAccountData] = useState<CreatorAccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingContent, setFetchingContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);
  
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
    try {
      if (provider && programId) {
        // Ensure IDL is properly typed as an Idl
        const idl = IDL as anchor.Idl;
        return new anchor.Program(idl, provider) as anchor.Program<AutonProgram>;
      }
    } catch (error) {
      console.error('Failed to initialize program:', error);
      setStatus({ 
        type: 'error', 
        message: 'Failed to initialize program. Check IDL file and program ID.' 
      });
    }
    return null;
  }, [provider]);

  const creatorAccountPDA = useMemo(() => {
    if (!publicKey) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), publicKey.toBuffer()],
      programId
    );
    return pda;
  }, [publicKey]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (publicKey && connected && mounted) {
      setCreatorId(publicKey.toBase58());
      fetchCreatorContent();
    } else {
      setCreatorId('');
      setCreatorAccountData(null);
    }
  }, [publicKey, connected, mounted, creatorAccountPDA]);

  const handleInputChange = (field: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const resetForm = () => {
    setForm(defaultFormState);
    setPrimaryFile(null);
  };

  const fetchCreatorContent = async () => {
    if (!creatorAccountPDA || !program) return;

    setFetchingContent(true);
    try {
      const account = await program.account.creatorAccount.fetch(creatorAccountPDA);
      setCreatorAccountData(account);
    } catch (err: any) {
      console.error('Failed to fetch creator account:', err);
      setCreatorAccountData(null);
    } finally {
      setFetchingContent(false);
    }
  };

  const handleCreateContent = async () => {
    if (!publicKey || !connected || !program) {
      setStatus({ type: 'error', message: 'Connect your wallet to create content.' });
      return;
    }

    if (!form.title.trim()) {
      setStatus({ type: 'error', message: 'Please enter a title for your content.' });
      return;
    }

    if (!primaryFile) {
      setStatus({ type: 'error', message: 'Attach a file or media to gate' });
      return;
    }

    try {
      setLoading(true);
      setStatus({ type: null, message: '' });

      const formData = new FormData();
      formData.append('file', primaryFile);
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Failed to upload file to IPFS.');
      }
      const { encryptedCid }: { encryptedCid: string } = await uploadResponse.json();

      let currentCreatorAccount = creatorAccountData;
      if (!currentCreatorAccount) {
        setStatus({ type: 'success', message: 'Initializing creator account...' });
        const initTx = new Transaction().add(
          await program.methods
            .initializeCreator()
            .accounts({
              creatorAccount: creatorAccountPDA,
              creator: publicKey,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );
        const { blockhash } = await connection.getLatestBlockhash();
        initTx.recentBlockhash = blockhash;
        initTx.feePayer = publicKey;

        const initSignature = await sendTransaction(initTx, connection);
        await connection.confirmTransaction(initSignature, 'confirmed');
        
        // Add a delay to allow the RPC node to see the new account
        await new Promise(resolve => setTimeout(resolve, 2000)); 

        currentCreatorAccount = await program.account.creatorAccount.fetch(creatorAccountPDA);
        setCreatorAccountData(currentCreatorAccount);
        setStatus({ type: 'success', message: 'Creator account initialized. Adding content...' });
      }

      // 3. Build and send addContent transaction
      const priceBN = new anchor.BN(parseFloat(form.price) * anchor.web3.LAMPORTS_PER_SOL);
      const encryptedCidBuffer = Buffer.from(encryptedCid, 'hex');

      const addContentTx = new Transaction().add(
        await program.methods
          .addContent(form.title, priceBN, encryptedCidBuffer)
          .accounts({
            creatorAccount: creatorAccountPDA,
            creator: publicKey,
          })
          .instruction()
      );

      const { blockhash: addContentBlockhash } = await connection.getLatestBlockhash();
      addContentTx.recentBlockhash = addContentBlockhash;
      addContentTx.feePayer = publicKey;

      const addContentSignature = await sendTransaction(addContentTx, connection);
      await connection.confirmTransaction(addContentSignature, 'confirmed');

      setStatus({
        type: 'success',
        message: `Content "${form.title}" published on-chain!`,
      });
      resetForm();
      fetchCreatorContent();
    } catch (error: any) {
      console.error('Failed to create content:', error);
      setStatus({ type: 'error', message: error.message || 'Something went wrong' });
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setPrimaryFile(files[0]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        {/* Hero Header */}
        <div className="mb-12 text-center">
          <div className="inline-block mb-4">
            <span className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold uppercase tracking-wider rounded-full shadow-lg">
              x402 Pay-to-Access Protocol
            </span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white bg-clip-text text-transparent mb-4">
            Creator Hub
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
            Upload premium content, set your price, and earn directly.
            <br></br><span className="font-semibold text-blue-600 dark:text-blue-400"> Encrypted. Instant. On-chain.</span>
          </p>
        </div>

        {/* Wallet Connection */}
        <div className="flex justify-center mb-8">
          <WalletMultiButton className="!bg-gradient-to-r !from-blue-600 !to-purple-600 hover:!from-blue-700 hover:!to-purple-700 !rounded-xl !shadow-lg hover:!shadow-xl !transition-all !duration-200" />
        </div>

        {/* Status Messages */}
        {status.type && (
          <div
            className={`mb-8 rounded-xl border-2 px-6 py-4 text-sm font-medium shadow-lg backdrop-blur-sm transition-all ${status.type === 'success'
                ? 'border-green-400 bg-green-50/90 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'border-red-400 bg-red-50/90 dark:bg-red-900/20 text-red-800 dark:text-red-300'}`}
          >
            <div className="flex items-center gap-3">
              {status.type === 'success' ? (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <span>{status.message}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Create Content Form */}
          <section className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 space-y-6 hover:shadow-2xl transition-shadow">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Drop</h2>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="e.g., Exclusive Track Preview"
                className="w-full rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all outline-none" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                placeholder="Tell your audience what makes this content special..."
                className="w-full rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all outline-none resize-none" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Price (SOL) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">◎</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => handleInputChange('price', e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-10 pr-4 py-3 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all outline-none" />
              </div>
            </div>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed p-6 transition-all ${isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}`}
            >
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Upload Gated File <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col items-center justify-center py-6">
                <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 text-center">
                  Drag & drop your file here, or click to browse
                </p>
                <input
                  type="file"
                  onChange={(e) => setPrimaryFile(e.target.files?.[0] || null)}
                  className="items-center justify-center mt-2 w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 dark:file:bg-blue-900/20 file:text-blue-700 dark:file:text-blue-400 file:font-medium hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30 file:cursor-pointer" />
              </div>
              {primaryFile && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{primaryFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{bytesToMb(primaryFile.size)} MB</p>
                  </div>
                  <button
                    onClick={() => setPrimaryFile(null)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleCreateContent}
              disabled={loading || !connected}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 py-4 text-white font-bold shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 text-lg"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Encrypt & Publish Drop</span>
                </>
              )}
            </button>
          </section>

          {/* Published Content */}
          <section className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 space-y-6 hover:shadow-2xl transition-shadow">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Your Published Drops</h2>
                {creatorId && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Share:{' '}
                    <Link href={`/creators/${creatorId}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                      /creators/{creatorId.slice(0, 8)}...
                    </Link>
                  </p>
                )}
              </div>
            </div>

            {fetchingContent ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <svg className="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Loading your content...</p>
                </div>
              </div>
            ) : creatorAccountData && creatorAccountData.content.length > 0 ? (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                {creatorAccountData.content.map((content) => (
                  <div
                    key={content.id.toNumber()}
                    className="group rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 p-5 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                            {content.title}
                          </h3>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          ID: {content.id.toNumber()}
                        </p>
                      </div>
                      <Link
                        href={`/creators/${creatorId}`}
                        className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 group-hover:shadow-md"
                      >
                        <span>View</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        ◎ {(content.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL).toFixed(3)}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">SOL</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {connected ? 'You have not published any drops yet.' : 'Connect your wallet to see your drops.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}