"use client";

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ContentItem } from '@/types/content';
import { useCreatorReceipts } from './hooks/useCreatorReceipts';
import * as anchor from '@coral-xyz/anchor';
import { Download, ExternalLink, Eye } from 'lucide-react';

interface PublishedDropsListProps {
  content: ContentItem[];
  loading: boolean;
  creatorId: string;
  connected: boolean;
  program?: anchor.Program<any> | null;
}

export function PublishedDropsList({
  content,
  loading,
  creatorId,
  connected,
  program = null,
}: PublishedDropsListProps) {
  const { publicKey } = useWallet();
  const [contentData, setContentData] = useState<Map<string, { cid: string }>>(new Map());

  // Use receipts hook to obtain sold counts & total collected (so we can show per-drop counts)
  const { soldCounts } = useCreatorReceipts({ program, creatorId, content });

  // Preload IPFS CIDs for displayed content so previews can render inline
  useEffect(() => {
    if (!content || content.length === 0) return;

    (async () => {
      const entries = await Promise.all(
        content.map(async (item) => {
          const key = `${creatorId}-${item.id.toNumber()}`;
          if (contentData.has(key)) return [key, contentData.get(key) as { cid: string }];

          try {
            const res = await fetch(
              `/api/content/${creatorId}/${item.id.toNumber()}/access?buyerPubkey=${publicKey?.toBase58?.()}`
            );
            if (res.ok) {
              const json = await res.json();
              return [key, { cid: json.ipfsCid }];
            }
          } catch (err) {
            console.debug(`Failed to preload content ${key}:`, err);
          }
          return [key, undefined];
        })
      );

      setContentData((prev) => {
        const next = new Map(prev);
        for (const [k, v] of entries) {
          if (v) next.set(k as string, v as { cid: string });
        }
        return next;
      });
    })();
  }, [content, creatorId, publicKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin"></div>
          <p className="font-mono text-sm text-neon-green blink">LOADING_DATA...</p>
        </div>
      </div>
    );
  }

  if (!content || content.length === 0) {
    return (
      <div className="py-12 text-center border border-dashed border-zinc-800 rounded-lg">
        <p className="font-mono text-zinc-500">
          {connected ? 'NO DROPS DETECTED.' : 'CONNECT_WALLET_TO_VIEW.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {content.map((item) => {
        const key = `${creatorId}-${item.id.toNumber()}`;
        const cid = contentData.get(key)?.cid;
        const url = cid ? `https://ipfs.io/ipfs/${cid}` : null;

        return (
          <div
            key={item.id.toNumber()}
            className="retro-card p-0 overflow-hidden group flex flex-col h-full"
          >
            {/* Preview Area */}
            <div className="h-48 bg-zinc-900 border-b border-border flex items-center justify-center relative overflow-hidden">
              {url ? (
                <img src={url} alt={item.title} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
              ) : (
                <div className="text-center p-6 flex flex-col items-center gap-2">
                  <div className="w-12 h-12 border border-zinc-700 flex items-center justify-center">
                     <span className="font-pixel text-zinc-700 text-2xl">?</span>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">Preview Locked</p>
                </div>
              )}
              
              {/* Overlay Stats */}
              <div className="absolute top-2 right-2 bg-black/80 border border-neon-green px-2 py-1">
                 <p className="font-pixel text-neon-green text-xs">ID:{item.id.toString()}</p>
              </div>
            </div>

            {/* Content Info */}
            <div className="p-5 flex flex-col flex-1">
              <div className="mb-4 flex-1">
                <h3 className="font-pixel text-xl text-white truncate mb-1 group-hover:text-neon-blue transition-colors">{item.title}</h3>
                <div className="flex justify-between items-end border-b border-dashed border-zinc-800 pb-4">
                   <div className="flex items-baseline gap-1">
                      <span className="font-pixel text-2xl text-neon-yellow">
                        {(item.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL).toFixed(3)}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">SOL</span>
                   </div>
                   <div className="font-mono text-xs text-zinc-400">
                      {soldCounts[item.id.toNumber()] || 0} SOLD
                   </div>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3 mt-auto">
                <Link
                  href={`/creators/${creatorId}`}
                  className="retro-btn text-xs px-2 py-2 flex items-center justify-center gap-2 hover:bg-neon-blue hover:border-neon-blue"
                >
                  <Eye className="w-3 h-3" />
                  VIEW
                </Link>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="retro-btn text-xs px-2 py-2 flex items-center justify-center gap-2 hover:bg-white hover:text-black">
                    <ExternalLink className="w-3 h-3" />
                    OPEN
                  </a>
                ) : (
                  <button disabled className="retro-btn text-xs px-2 py-2 opacity-50 cursor-not-allowed border-zinc-700 text-zinc-700 hover:bg-transparent hover:border-zinc-700 hover:text-zinc-700">
                     LOCKED
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
