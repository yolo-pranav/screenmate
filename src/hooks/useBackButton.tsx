"use client"
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Global modal close handler — set when a modal is open, null otherwise
let modalCloseHandler: (() => void) | null = null;

export const registerModalClose = (fn: () => void) => { modalCloseHandler = fn; };
export const unregisterModalClose = () => { modalCloseHandler = null; };
export const getModalCloseHandler = () => modalCloseHandler;

// Register a close handler while `active` is true so the Android hardware
// back button dismisses the modal instead of navigating (or exiting the app).
export function useModalBackClose(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    registerModalClose(() => onCloseRef.current());
    return () => unregisterModalClose();
  }, [active]);
}

export function useAndroidBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const navDepth = useRef(0);

  // Track navigation depth: increment on every route change away from home
  useEffect(() => {
    if (pathname === '/') {
      navDepth.current = 0;
    } else {
      navDepth.current += 1;
    }
  }, [pathname]);

  useEffect(() => {
    let removeListener: (() => void) | null = null;

    async function setup() {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', () => {
          if (modalCloseHandler) {
            modalCloseHandler();
          } else if (navDepth.current > 0) {
            router.back();
          } else {
            App.exitApp();
          }
        });
        removeListener = () => handle.remove();
      } catch {
        // Not running in Capacitor — no-op
      }
    }

    setup();
    return () => { removeListener?.(); };
  }, [router]);
}
