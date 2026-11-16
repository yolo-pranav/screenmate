import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yolopranav.screenmate',
  appName: 'ScreenMate',
  webDir: 'out',
  plugins: {
    // Draw edge to edge on Android with no padding for the status bar, navigation
    // bar or notch; the page offsets only what it needs (see Header.tsx and
    // layout.tsx) using CSS env(safe-area-inset-*).
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
  ios: {
    // Keeps the web content clear of the status bar and the notch.
    contentInset: 'automatic'
  }
};

export default config;
