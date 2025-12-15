'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LayoutGrid, Image as ImageIcon, Plus } from 'lucide-react';

export type DashboardTab = 'dashboard' | 'gallery';

interface DashboardNavProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onCreateClick: () => void;
}

export function DashboardNav({ activeTab, onTabChange, onCreateClick }: DashboardNavProps) {
  return (
    <nav className="sticky top-0 z-40 bg-background border-b border-border py-4">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between">
          {/* Tabs */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => onTabChange('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 font-pixel text-lg uppercase tracking-wider transition-all border-b-2 ${
                activeTab === 'dashboard'
                  ? 'border-neon-green text-neon-green'
                  : 'border-transparent text-zinc-500 hover:text-white hover:border-zinc-700'
              }`}
            >
              <LayoutGrid className="w-5 h-5" />
              Dashboard
            </button>
            <button
              onClick={() => onTabChange('gallery')}
              className={`flex items-center gap-2 px-4 py-2 font-pixel text-lg uppercase tracking-wider transition-all border-b-2 ${
                activeTab === 'gallery'
                  ? 'border-neon-pink text-neon-pink'
                  : 'border-transparent text-zinc-500 hover:text-white hover:border-zinc-700'
              }`}
            >
              <ImageIcon className="w-5 h-5" />
              Gallery
            </button>
          </div>

          {/* Right side: Create button and wallet */}
          <div className="flex items-center gap-4">
            <button
              onClick={onCreateClick}
              className="retro-btn flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              NEW DROP
            </button>
            <WalletMultiButton className="!h-[44px] !font-pixel !uppercase !tracking-wider !bg-surface !border !border-border !rounded-none hover:!bg-neon-green hover:!text-black hover:!border-neon-green transition-all" />
          </div>
        </div>
      </div>
    </nav>
  );
}
