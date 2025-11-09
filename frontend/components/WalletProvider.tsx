'use client';

import dynamic from 'next/dynamic';
import React, { FC, ReactNode } from 'react';

// Dynamically import the WalletContextProvider, correctly handling the named export.
const WalletContextProvider = dynamic(
    () => import('@/components/WalletContextProvider').then((mod) => mod.WalletContextProvider),
    { ssr: false }
);

const WalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
    return (
        <WalletContextProvider>
            {children}
        </WalletContextProvider>
    );
};

export default WalletProvider;
