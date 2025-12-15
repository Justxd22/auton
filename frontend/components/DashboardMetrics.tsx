'use client';

import { ContentItem } from '@/types/content';
import * as anchor from '@coral-xyz/anchor';
import { useCreatorReceipts } from './hooks/useCreatorReceipts';
import { useEffect, useState, useMemo } from 'react';
import { Connection } from '@solana/web3.js';
import type { AutonProgram } from '@/lib/anchor/auton_program';

interface DashboardMetricsProps {
  content: ContentItem[];
  loading: boolean;
  creatorId: string; // base58
  program: anchor.Program<AutonProgram> | null;
  connection: Connection;
}

export function DashboardMetrics({ content, loading, creatorId, program, connection }: DashboardMetricsProps) {
  // Local filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');

  // Receipt derived stats (read from shared hook)
  const { soldCounts, totalCollected, loading: receiptsLoading } = useCreatorReceipts({ program, creatorId, content, dateFilter });

  // Map content id -> price in SOL for quick lookup
  const priceMap = useMemo(() => {
    const map: Record<number, number> = {};
    for (const c of content) {
      map[c.id.toNumber()] = c.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
    }
    return map;
  }, [content]);

  const calculateMetrics = () => {
    const totalDrops = content.length;
    const totalValueSOL = content.reduce((sum, item) => {
      return sum + item.price.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
    }, 0);
    const avgPrice = totalDrops === 0 ? 0 : totalValueSOL / totalDrops;

    return {
      totalDrops,
      totalValue: totalValueSOL.toFixed(3),
      avgPrice: avgPrice.toFixed(3),
    };
  };

  const metrics = calculateMetrics();

  // receipts computed via shared hook

  return (
    <div>
      {/* Top Bar with Filter */}
      <div className="flex justify-end mb-6">
        <select 
          value={dateFilter} 
          onChange={(e) => setDateFilter(e.target.value as any)} 
          className="bg-black border border-border text-white font-mono text-sm px-4 py-2 uppercase focus:outline-none focus:border-neon-green"
        >
          <option value="all">ALL TIME</option>
          <option value="today">TODAY</option>
          <option value="7days">LAST 7 DAYS</option>
          <option value="30days">LAST 30 DAYS</option>
        </select>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="retro-card flex flex-col justify-between h-48 group hover:border-neon-yellow">
          <p className="font-mono text-zinc-500 text-sm tracking-widest uppercase">Total Units Sold</p>
          <p className="font-pixel text-7xl text-neon-yellow group-hover:scale-105 transition-transform origin-left">
            {Object.values(soldCounts).reduce((a, b) => a + b, 0)}
          </p>
        </div>
        <div className="retro-card flex flex-col justify-between h-48 group hover:border-neon-green">
          <p className="font-mono text-zinc-500 text-sm tracking-widest uppercase">Total Earnings (SOL)</p>
          <div className="flex items-baseline gap-2">
             <span className="font-pixel text-7xl text-neon-green group-hover:scale-105 transition-transform origin-left">
               {totalCollected.toFixed(2)}
             </span>
             <span className="font-mono text-xl text-zinc-600">SOL</span>
          </div>
        </div>
      </div>

      {/* Per-Drop Mini Stats (Horizontal Scroll or Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {content.map((c) => {
          const id = c.id.toNumber();
          const sold = soldCounts[id] || 0;
          const total = sold * (priceMap[id] || 0);
          return (
            <div key={id} className="retro-card p-4 min-h-[120px] flex flex-col justify-between group">
              <p className="font-mono text-xs text-zinc-400 truncate uppercase mb-2" title={c.title}>{c.title}</p>
              <div>
                <p className="font-pixel text-3xl text-white group-hover:text-neon-pink transition-colors">
                  {sold} <span className="text-sm font-mono text-zinc-600">SOLD</span>
                </p>
                <p className="font-mono text-xs text-zinc-500 mt-1">
                  ◎ {total.toFixed(3)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
