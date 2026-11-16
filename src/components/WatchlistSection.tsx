"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getMediaDetails, imageUrl } from '@/services/tmdb';
import { Media } from '@/types';
import { useModalBackClose } from '@/hooks/useBackButton';

const SkeletonCard: React.FC = () => (
  <div className="shrink-0 w-32">
    <div className="rounded-lg overflow-hidden aspect-2/3 shimmer" />
    <div className="mt-1.5 px-0.5 space-y-1.5">
      <div className="h-3 rounded shimmer w-full" />
      <div className="h-3 rounded shimmer w-2/3" />
    </div>
  </div>
);

const WatchlistSection: React.FC = () => {
  const { watchlist, removeFromWatchlist } = useWatchlist();
  const [items, setItems] = useState<Media[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  useModalBackClose(confirmId !== null, () => setConfirmId(null));

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!isMounted) return;
    if (watchlist.length === 0) { setItems([]); setIsLoading(false); return; }
    setIsLoading(true);
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(
        watchlist.map(async (entry) => {
          try {
            const data = await getMediaDetails(entry.media_type, entry.id);
            return { ...data, media_type: entry.media_type } as Media;
          } catch { return null; }
        })
      );
      if (!cancelled) {
        setItems(results.filter((r): r is Media => r !== null));
        setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [watchlist, isMounted]);

  if (!isMounted || (!isLoading && items.length === 0)) return null;

  const confirmItem = items.find(i => i.id === confirmId);
  const visible = items.slice(0, 10);
  const hasMore = items.length > 10;

  return (
    <div className="mb-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">My Watchlist</h2>
        <Link href="/watchlist" className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">
          {hasMore ? 'See All ›' : 'View All ›'}
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto p-4 scrollbar-hide">
        {isLoading
          ? Array.from({ length: Math.min(watchlist.length || 4, 10) }).map((_, i) => <SkeletonCard key={i} />)
          : visible.map((item) => (
            <div key={item.id} className="shrink-0 w-32 group relative">
              <button
                onClick={(e) => { e.preventDefault(); setConfirmId(item.id); }}
                className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center"
                aria-label="Remove"
              >
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <Link href={`/player?mediaType=${item.media_type}&id=${item.id}`}>
                <div className="rounded-lg overflow-hidden shadow-sm">
                  <img
                    src={item.poster_path ? imageUrl(item.poster_path) : 'https://picsum.photos/500/750'}
                    alt={item.title ?? item.name}
                    className="w-full aspect-2/3 object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="mt-1.5 px-0.5">
                  <p className="text-gray-900 dark:text-white text-xs font-semibold truncate">{item.title ?? item.name}</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs uppercase">{item.media_type}</p>
                </div>
              </Link>
            </div>
          ))
        }
      </div>

      {confirmId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmId(null)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Remove from Watchlist?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              <span className="font-medium text-gray-700 dark:text-gray-200">{confirmItem?.title ?? confirmItem?.name}</span> will be removed from your watchlist.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { removeFromWatchlist(confirmId); setConfirmId(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WatchlistSection;
