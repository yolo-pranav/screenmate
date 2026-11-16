"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { NextPage } from 'next';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import AccountModal from './AccountModal';

const Header: NextPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [showAccount, setShowAccount] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === '/';
  useEffect(() => { setMounted(true); }, []);

  // Android back button handling lives in AndroidBackButtonHandler —
  // registering a second Capacitor listener here would double-fire on every press.

  return (
    <header style={{ paddingTop: 'env(safe-area-inset-top)' }} className="sticky top-0 z-50 bg-gray-100/90 dark:bg-gray-900/90 backdrop-blur-sm shadow-sm border-b border-gray-200 dark:border-gray-800">
      <div className="w-full px-4 lg:px-8 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {!isHome && (
            <button
              onClick={() => router.back()}
              aria-label="Go back"
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <Link href="/" className="text-2xl sm:text-3xl font-bold text-primary">
            ScreenMate
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/search"
            aria-label="Search"
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Link>
          <button
            onClick={() => setShowAccount(true)}
            aria-label="Account"
            className="relative p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {mounted && user && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 ring-2 ring-gray-100 dark:ring-gray-900" />
            )}
          </button>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="relative w-12 h-8 flex items-center justify-center overflow-hidden focus:outline-none"
          >
            {mounted && (
              <>
                <span className={`absolute text-lg transition-all duration-500 ease-in-out ${theme === 'light' ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 translate-x-6 scale-75'}`}>☀️</span>
                <span className={`absolute text-lg transition-all duration-500 ease-in-out ${theme === 'dark' ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-6 scale-75'}`}>🌙</span>
              </>
            )}
          </button>
        </div>
      </div>
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
    </header>
  );
};

export default Header;
