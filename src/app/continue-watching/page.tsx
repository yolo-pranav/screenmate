"use client"
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useProgress } from '@/hooks/useProgress';
import { getMediaDetails, imageUrl } from '@/services/tmdb';
import { useModalBackClose } from '@/hooks/useBackButton';

interface ContinueItem {
  id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_path: string | null;
  season?: number;
  episode?: number;
}

const SkeletonCard: React.FC = () => (
  <div className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <div className="shrink-0 w-16 h-24 rounded-lg shimmer" />
    <div className="grow space-y-2">
      <div className="h-4 rounded shimmer w-3/4" />
      <div className="h-3 rounded shimmer w-1/3" />
    </div>
    <div className="shrink-0 w-20 h-8 rounded-lg shimmer" />
  </div>
);

const ContinueWatchingPage: React.FC = () => {
  const { progressOrder, getProgress, removeProgress } = useProgress();
  const [items, setItems] = useState<ContinueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  useModalBackClose(confirmId !== null, () => setConfirmId(null));

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!isMounted) return;
    if (progressOrder.length === 0) { setItems([]); setIsLoading(false); return; }
    setIsLoading(true);
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(
        progressOrder.map(async (id) => {
          const progress = getProgress(id);
          if (!progress) return null;
          try {
            const data = await getMediaDetails(progress.media_type, id);
            return {
              id,
              media_type: progress.media_type,
              title: data.name ?? data.title ?? '',
              poster_path: data.poster_path,
              season: progress.season,
              episode: progress.episode,
            } as ContinueItem;
          } catch { return null; }
        })
      );
      if (!cancelled) { setItems(results.filter((r): r is ContinueItem => r !== null)); setIsLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [progressOrder, isMounted]);

  const confirmItem = items.find(i => i.id === confirmId);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">Continue Watching</h1>

      {!isLoading && items.length === 0 && (
        <p className="text-lg text-gray-400 text-center mt-16">Nothing here yet. Start watching something!</p>
      )}

      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: progressOrder.length || 4 }).map((_, i) => <SkeletonCard key={i} />)
          : items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 group"
            >
              <Link href={`/player?mediaType=${item.media_type}&id=${item.id}`} className="shrink-0">
                <img
                  src={item.poster_path ? imageUrl(item.poster_path) : 'https://picsum.photos/500/750'}
                  alt={item.title}
                  className="w-16 h-24 object-cover rounded-lg shadow-sm"
                />
              </Link>

              <div className="grow min-w-0">
                <Link href={`/player?mediaType=${item.media_type}&id=${item.id}`}>
                  <h3 className="font-bold text-gray-900 dark:text-white truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    {item.title}
                  </h3>
                </Link>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {item.media_type === 'tv' && item.season != null
                    ? `Season ${item.season} · Episode ${item.episode}`
                    : 'Movie'}
                </p>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <Link
                  href={`/player?mediaType=${item.media_type}&id=${item.id}`}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white transition-colors"
                >
                  Resume
                </Link>
                <button
                  onClick={() => setConfirmId(item.id)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  aria-label="Remove"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
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
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Remove from Continue Watching?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              <span className="font-medium text-gray-700 dark:text-gray-200">{confirmItem?.title}</span> will be removed from your watch history.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { removeProgress(confirmId); setConfirmId(null); }}
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

export default ContinueWatchingPage;
