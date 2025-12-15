'use client';

import { useEffect, useState, useMemo } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import IDL from '@/lib/anchor/auton_program.json';
import { AutonProgram } from '@/lib/anchor/auton_program';
import { Download, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const AUTON_PROGRAM_ID = process.env.NEXT_PUBLIC_AUTON_PROGRAM_ID;
const IPFS_GATEWAY_URL = 'https://ipfs.io/ipfs/';

if (!AUTON_PROGRAM_ID) {
  throw new Error('AUTON_PROGRAM_ID is not set');
}

const programId = new PublicKey(AUTON_PROGRAM_ID);

type PurchaseItem = {
  creator: string;
  contentId: number;
  ipfsCid?: string;
  pda: string;
};

export function MyPurchases() {
  const { publicKey } = useWallet();
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentData, setContentData] = useState<Map<string, { cid: string }>>(new Map());
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  const provider = useMemo(() => {
    const dummyWallet = {
      publicKey: anchor.web3.Keypair.generate().publicKey,
      signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
        txs: T[]
      ): Promise<T[]> => txs,
      signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => tx,
    };
    return new anchor.AnchorProvider(connection, dummyWallet, {
      commitment: 'confirmed',
    });
  }, [connection]);

  const program = useMemo(() => {
    try {
      if (provider && programId) {
        const idl = IDL as anchor.Idl;
        return new anchor.Program(idl, provider) as anchor.Program<AutonProgram>;
      }
    } catch (error) {
      console.error('Failed to initialize program:', error);
    }
    return null;
  }, [provider]);

  useEffect(() => {
    if (!publicKey || !program) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const buyerFilter = [
          {
            memcmp: {
              offset: 8,
              bytes: publicKey.toBase58(),
            },
          },
        ];

        const receipts = await program.account.paidAccessAccount.all(buyerFilter);
        const resolved: PurchaseItem[] = [];
        const creators = await program.account.creatorAccount.all();

        for (const receipt of receipts) {
          const contentId =
            receipt.account.contentId?.toNumber?.() ||
            Number((receipt.account as any).contentId);

          const buyerAddr = receipt.account.buyer?.toBase58?.() || String((receipt.account as any).buyer);

          if (!contentId) continue;

          let ipfsCid: string | undefined;
          let creatorAddr = '';

          try {
            for (const ca of creators) {
              const items = (ca.account as any).content || [];
              const match = items.find((it: any) => {
                const id = it.id?.toNumber?.() || Number(it.id);
                return id === contentId;
              });
              if (match) {
                const creatorWallet = (ca.account as any).creatorWallet || (ca.account as any).creator_wallet;
                creatorAddr = creatorWallet?.toBase58?.() || String(creatorWallet) || ca.publicKey.toBase58();

                const encrypted = match.encrypted_cid || match.encryptedCid || match.encryptedCid?.toString?.() || match.encrypted_cid?.toString?.();
                if (encrypted) {
                  try {
                    if (typeof encrypted === 'string') ipfsCid = encrypted;
                    else if (Buffer.isBuffer(encrypted)) ipfsCid = encrypted.toString('utf8');
                    else ipfsCid = String(encrypted);
                  } catch (e) {
                    ipfsCid = String(encrypted);
                  }
                }
                break;
              }
            }
          } catch (err) {
            console.debug(`Error searching creator accounts for contentId ${contentId}:`, err);
          }

          resolved.push({
            creator: creatorAddr || buyerAddr || receipt.publicKey.toBase58(),
            contentId,
            ipfsCid,
            pda: receipt.publicKey.toBase58(),
          });
        }

        setPurchases(resolved);
        
        for (const item of resolved) {
          const key = `${item.creator}-${item.contentId}`;
          if (!contentData.has(key)) {
            try {
              const res = await fetch(
                `/api/content/${item.creator}/${item.contentId}/access?buyerPubkey=${publicKey?.toBase58?.()}`
              );
              if (res.ok) {
                const { ipfsCid } = await res.json();
                setContentData(prev => new Map(prev).set(key, { cid: ipfsCid }));
              }
            } catch (err) {
              console.debug(`Failed to fetch content for ${key}:`, err);
            }
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch purchases:', err);
        setError(err.message || 'Failed to load purchases');
      } finally {
        setLoading(false);
      }
    })();
  }, [publicKey, program]);

  const toggleExpandContent = (key: string) => {
    setExpandedContent(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!publicKey) {
    return (
      <div className="text-center py-12 border border-dashed border-zinc-700">
        <p className="font-mono text-zinc-500">CONNECT_WALLET_TO_VIEW_INVENTORY</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin"></div>
          <p className="font-mono text-sm text-neon-blue blink">RETRIEVING_ASSETS...</p>
        </div>
      </div>
    );
  }

  if (error && purchases.length === 0) {
    return (
      <div className="border border-neon-pink bg-neon-pink/10 p-4 text-neon-pink font-mono text-sm">
        <p>ERROR: {error}</p>
      </div>
    );
  }

  if (purchases.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-zinc-700">
        <p className="font-pixel text-zinc-500 text-xl mb-2">EMPTY INVENTORY</p>
        <p className="font-mono text-zinc-600 text-xs">VISIT THE GALLERY TO ACQUIRE DROPS</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {purchases.map((item) => {
        const key = `${item.creator}-${item.contentId}`;
        const data = contentData.get(key);
        const cid = data?.cid;
        const isExpanded = expandedContent.has(key);
        const url = cid ? `${IPFS_GATEWAY_URL}${cid}` : null;

        return (
          <div
            key={key}
            className="retro-card p-0 overflow-hidden hover:border-neon-pink transition-colors"
          >
            {/* Content Display */}
            <div className="h-48 bg-zinc-900 border-b border-border flex items-center justify-center relative overflow-hidden">
              {url ? (
                <img
                  src={url}
                  alt={`Drop #${item.contentId}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center space-y-2">
                  <div className="w-10 h-10 border border-zinc-700 flex items-center justify-center mx-auto">
                     <span className="font-pixel text-zinc-500 text-xl">!</span>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-500 uppercase">DECRYPTING...</p>
                </div>
              )}
              <div className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 border border-neon-pink">
                 <p className="font-pixel text-neon-pink text-xs">OWNED</p>
              </div>
            </div>

            {/* Info Section */}
            <div className="p-4 space-y-3">
              <div>
                <h3 className="font-pixel text-lg text-white mb-1">DROP #{item.contentId}</h3>
                <p className="font-mono text-[10px] text-zinc-500 uppercase truncate">CREATOR: {item.creator}</p>
              </div>

              {url && (
                <button
                  onClick={() => toggleExpandContent(key)}
                  className="w-full retro-btn text-xs px-2 py-2 flex items-center justify-center gap-2"
                >
                  {isExpanded ? 'MINIMIZE' : 'INSPECT'}
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>

            {/* Expanded Details */}
            {isExpanded && url && (
              <div className="border-t border-dashed border-zinc-700 p-4 space-y-3 bg-zinc-900/50">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="retro-btn-primary w-full text-xs py-2 flex items-center justify-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  DOWNLOAD / VIEW
                </a>
                {cid && (
                  <div className="bg-black border border-zinc-800 p-2">
                    <p className="font-mono text-[10px] text-zinc-500 mb-1">IPFS_CID:</p>
                    <code className="font-mono text-[10px] text-neon-green break-all">{cid}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
