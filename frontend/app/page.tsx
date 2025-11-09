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

const previewModes = [
  { label: 'Auto demo (first snippet for text)', value: 'auto' },
  { label: 'Custom teaser (text or file)', value: 'custom' },
  { label: 'No preview / fully gated', value: 'off' },
];

const contentKinds = [
  { label: 'Video', value: 'video' },
  { label: 'Audio', value: 'audio' },
  { label: 'Downloadable file', value: 'file' },
  { label: 'Text drop', value: 'text' },
];

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

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);
  
  const provider = useMemo(() => {
    const dummyWallet = {
      publicKey: anchor.web3.Keypair.generate().publicKey,
      signAllTransactions: async (txs: anchor.web3.Transaction[]) => txs,
      signTransaction: async (tx: anchor.web3.Transaction) => tx,
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-10 max-w-6xl">
        <header className="mb-8 flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold uppercase text-purple-500">x402 Pay-to-Access</p>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mt-2">
              Creator Workspace
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2 max-w-3xl">
              Upload any premium file, set a price, and let fans unlock it instantly. Funds route directly to your wallet.
            </p>
          </div>
        </header>

        <div className="mb-6">
          <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
        </div>

        {status.type && (
          <div
            className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
              status.type === 'success'
                ? 'border-green-300 bg-green-50 text-green-800'
                : 'border-red-300 bg-red-50 text-red-700'
            }`}
          >
            {status.message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-5">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Create New Drop</h2>
            
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Title
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="Name of your gated content"
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={3}
                placeholder="A short pitch for what buyers will receive."
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Price (in SOL)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => handleInputChange('price', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
              />
            </div>

            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Upload Gated File
              </label>
              <input
                type="file"
                onChange={(e) => setPrimaryFile(e.target.files?.[0] || null)}
                className="mt-2 w-full text-sm text-gray-600 dark:text-gray-300"
              />
              {primaryFile && (
                <p className="text-xs text-gray-500 mt-1">
                  {primaryFile.name} ({bytesToMb(primaryFile.size)} MB)
                </p>
              )}
            </div>

            <button
              onClick={handleCreateContent}
              disabled={loading || !connected}
              className="w-full rounded-lg bg-purple-600 py-3 text-white font-semibold shadow hover:bg-purple-700 disabled:bg-gray-400"
            >
              {loading ? 'Processing...' : 'Encrypt & Publish Drop'}
            </button>
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Your Published Drops
                </h2>
                {creatorId && (
                  <p className="text-sm text-gray-500">
                    Share your page:{' '}
                    <Link href={`/creators/${creatorId}`} className="text-purple-600 hover:underline">
                      /creators/{creatorId.slice(0, 8)}...
                    </Link>
                  </p>
                )}
              </div>
            </div>
            {fetchingContent ? (
              <p className="text-sm text-gray-500">Loading your content...</p>
            ) : creatorAccountData && creatorAccountData.content.length > 0 ? (
              <div className="space-y-4">
                {creatorAccountData.content.map((content) => (
                  <div
                    key={content.id.toNumber()}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {content.title}
                        </h3>
                        <p className="text-sm text-gray-500">ID: {content.id.toNumber()}</p>
                      </div>
                      <Link
                        href={`/creators/${creatorId}`}
                        className="text-sm text-purple-600 hover:underline"
                      >
                        View paywall →
                      </Link>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Price: {content.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL
                    </p>
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