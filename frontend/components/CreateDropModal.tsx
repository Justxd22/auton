'use client';

import { useState, useRef } from 'react';
import { X, Upload, File as FileIcon, Loader2 } from 'lucide-react';

export type FormState = {
  title: string;
  description: string;
  price: string;
};

interface CreateDropModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  form: FormState;
  onFormChange: (field: keyof FormState, value: string) => void;
  primaryFile: File | null;
  onFileChange: (file: File | null) => void;
  loading: boolean;
  connected: boolean;
}

const bytesToMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

export function CreateDropModal({
  isOpen,
  onClose,
  onSubmit,
  form,
  onFormChange,
  primaryFile,
  onFileChange,
  loading,
  connected,
}: CreateDropModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

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
      onFileChange(files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit();
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      {/* Window Container */}
      <div className="w-full max-w-2xl bg-black border-2 border-zinc-700 shadow-[0_0_40px_rgba(0,0,0,0.8)] relative">
        
        {/* Window Title Bar */}
        <div className="bg-zinc-800 border-b-2 border-zinc-700 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-neon-pink rounded-sm" />
            <span className="font-pixel text-white uppercase tracking-widest text-lg">SYSTEM.CREATE_DROP.EXE</span>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-neon-pink hover:text-black text-zinc-400 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 bg-black bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:16px_16px]">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <label className="block font-mono text-xs text-neon-green mb-2 uppercase tracking-wider">
                &gt; Input_Title <span className="text-neon-pink">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => onFormChange('title', e.target.value)}
                placeholder="ENTER_TITLE..."
                className="retro-input"
                disabled={!connected}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block font-mono text-xs text-neon-green mb-2 uppercase tracking-wider">
                &gt; Input_Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => onFormChange('description', e.target.value)}
                rows={4}
                placeholder="ENTER_DESCRIPTION..."
                className="retro-input resize-none"
                disabled={!connected}
              />
            </div>

            {/* Price */}
            <div>
              <label className="block font-mono text-xs text-neon-green mb-2 uppercase tracking-wider">
                &gt; Input_Price (SOL) <span className="text-neon-pink">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neon-yellow font-pixel text-xl">◎</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => onFormChange('price', e.target.value)}
                  className="retro-input pl-10 text-neon-yellow font-pixel text-xl"
                  disabled={!connected}
                />
              </div>
            </div>

            {/* File Upload */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                isDragging
                  ? 'border-neon-green bg-neon-green/10'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
                className="hidden"
                disabled={!connected}
              />
              
              {primaryFile ? (
                <div className="flex flex-col items-center gap-2">
                  <FileIcon className="w-12 h-12 text-neon-blue" />
                  <p className="font-pixel text-white text-lg">{primaryFile.name}</p>
                  <p className="font-mono text-xs text-zinc-500">{bytesToMb(primaryFile.size)} MB</p>
                  <span className="text-xs text-neon-pink mt-2">[CLICK_TO_CHANGE]</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <Upload className="w-12 h-12 text-zinc-600" />
                  <div>
                    <p className="font-pixel text-zinc-400 text-lg">DRAG_DROP_FILE</p>
                    <p className="font-mono text-xs text-zinc-600 mt-1">OR CLICK TO BROWSE</p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-4 pt-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="retro-btn flex-1 bg-black hover:bg-zinc-900 border-zinc-700"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={loading || !connected}
                className="retro-btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>PROCESSING...</span>
                  </>
                ) : (
                  <span>INITIALIZE_DROP</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
