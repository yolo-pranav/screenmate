import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yolopranav.screenmate',
  appName: 'ScreenMate',
  webDir: 'out',
  ios: {
    // Keeps the web content clear of the status bar and the notch.
    contentInset: 'automatic'
  }
};

export default config;
