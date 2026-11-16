import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import AndroidBackButtonHandler from "@/components/AndroidBackButtonHandler";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { SyncAccountProvider } from "@/hooks/useSyncAccount";
import { PlayerConfigProvider } from "@/hooks/usePlayerConfig";
import { WatchlistProvider } from "@/hooks/useWatchlist";
import { ProgressProvider } from "@/hooks/useProgress";
import DeviceDataChoice from "@/components/DeviceDataChoice";
import UpdateBanner from "@/components/UpdateBanner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ScreenMate",
  description: "A movie and TV discovery app and OTT front-end demo: browse trending titles, search with filters, keep a synced watchlist and watch history, and watch trailers. The player can be connected to a platform's own streaming server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Apply the saved theme before first paint — applying it in a useEffect
  // (post-hydration) flashes the light theme on every launch for dark users.
  const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.add(t);}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider><AuthProvider><PlayerConfigProvider><SyncAccountProvider><WatchlistProvider><ProgressProvider>
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-200">
          <AndroidBackButtonHandler />
          <Header />
          <main className="w-full px-4 lg:px-8 py-8">{children}</main>
          <DeviceDataChoice />
          <UpdateBanner />
        </div>
        </ProgressProvider></WatchlistProvider></SyncAccountProvider></PlayerConfigProvider></AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
