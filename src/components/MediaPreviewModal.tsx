"use client"
import React, { useEffect, useState } from 'react';
import { registerModalClose, unregisterModalClose } from '@/hooks/useBackButton';
import Link from 'next/link';
import { getMediaDetails, imageUrl } from '@/services/tmdb';
import { MediaDetails } from '@/types';
import { useWatchlist } from '@/hooks/useWatchlist';
import { usePlayerConfig } from '@/hooks/usePlayerConfig';
import { Capacitor } from '@capacitor/core';
import { pickTrailer, trailerSrc } from './PlayerView';
import WhereToWatch from './WhereToWatch';

interface MediaPreviewModalProps {
  id: number;
  mediaType: 'movie' | 'tv';
  prefetchedData: MediaDetails | null;
  onClose: () => void;
  onModalMouseEnter: () => void;
  onModalMouseLeave: () => void;
}

// Re-use the same module-level cache from MovieCard via the same map reference
// Data is stored by setCached in MovieCard; here we just use prefetchedData or fetch if missing
const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  id, mediaType, prefetchedData, onClose, onModalMouseEnter, onModalMouseLeave
}) => {
  const [details, setDetails] = useState<MediaDetails | null>(prefetchedData);
  const [isLoading, setIsLoading] = useState(!prefetchedData);
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlist();
  // The button says what the player page will actually show for this account
  const { player } = usePlayerConfig();
  // The trailer plays right here in the card, so in trailer mode the link to
  // the title page is just "Details"
  const openLabel = player.mode === 'embed' ? '▶ Play' : 'Details';
  const [showTrailer, setShowTrailer] = useState(false);
  const trailer = player.mode !== 'none' ? pickTrailer(details?.videos?.results) : null;
  const isAdded = details ? isInWatchlist(details.id) : false;

  useEffect(() => {
    registerModalClose(onClose);
    return () => unregisterModalClose();
  }, [onClose]);

  useEffect(() => {
    if (prefetchedData) { setDetails(prefetchedData); setIsLoading(false); return; }
    let cancelled = false;
    getMediaDetails(mediaType, id)
      .then((data) => { if (!cancelled) { setDetails(data); setIsLoading(false); } })
      .catch(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [id, mediaType, prefetchedData]);

  const title = details?.title ?? details?.name ?? '';
  const releaseDate = details?.release_date ?? details?.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-full overflow-y-auto scrollbar-hide bg-white dark:bg-gray-900 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onModalMouseEnter}
        onMouseLeave={onModalMouseLeave}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {isLoading ? (
          <div className="flex gap-5 p-5">
            <div className="shrink-0 w-36 h-52 rounded-xl shimmer" />
            <div className="grow space-y-3 pt-2">
              <div className="h-5 rounded shimmer w-3/4" />
              <div className="h-3 rounded shimmer w-1/3" />
              <div className="h-3 rounded shimmer w-full mt-4" />
              <div className="h-3 rounded shimmer w-full" />
              <div className="h-3 rounded shimmer w-2/3" />
            </div>
          </div>
        ) : details ? (
          <>
          {showTrailer && trailer && (
            <div className="aspect-video w-full bg-black">
              <iframe
                src={trailerSrc(trailer.key, Capacitor.isNativePlatform())}
                title={`${title} — ${trailer.name || 'Trailer'}`}
                // YouTube refuses to play embeds that arrive without a referrer
                referrerPolicy="strict-origin-when-cross-origin"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                className="w-full h-full"
                allowFullScreen
              />
            </div>
          )}
          <div className="flex flex-col sm:flex-row">
            {/* Poster: on phones it gives way to the trailer while that is open */}
            <div className={`shrink-0 sm:w-44 ${showTrailer && trailer ? 'hidden sm:block' : ''}`}>
              <img
                src={details.poster_path ? imageUrl(details.poster_path) : 'https://picsum.photos/500/750'}
                alt={title}
                className="w-full h-56 sm:h-full object-cover"
              />
            </div>

            {/* Info */}
            <div className="flex flex-col p-5 grow min-w-0">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight pr-8">{title}</h2>

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{year}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{mediaType}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-xs text-yellow-500 font-semibold">⭐ {(details.vote_average ?? 0).toFixed(1)}</span>
              </div>

              {details.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {details.genres.slice(0, 4).map(g => (
                    <span key={g.id} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {g.name}
                    </span>
                  ))}
                </div>
              )}

              <WhereToWatch mediaType={mediaType} id={id} className="mt-3" />

              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">
                {details.overview}
              </p>

              {details.credits.cast.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Cast</p>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {details.credits.cast.slice(0, 8).map(actor => (
                      <div key={actor.id} className="shrink-0 text-center w-12">
                        <img
                          src={actor.profile_path ? imageUrl(actor.profile_path) : 'https://picsum.photos/200/300'}
                          alt={actor.name}
                          className="w-10 h-10 mx-auto rounded-full object-cover border-2 border-gray-200 dark:border-gray-700"
                        />
                        <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 leading-tight line-clamp-2">{actor.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-auto pt-4">
                <Link
                  href={`/player?mediaType=${mediaType}&id=${id}`}
                  onClick={onClose}
                  className="flex-1 text-center py-2 rounded-lg text-sm font-semibold bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white transition-colors"
                >
                  {openLabel}
                </Link>
                {trailer && (
                  <button
                    onClick={() => setShowTrailer(v => !v)}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {showTrailer ? 'Hide trailer' : '▶ Trailer'}
                  </button>
                )}
                <button
                  onClick={() => details && (isAdded ? removeFromWatchlist(details.id) : addToWatchlist({ id: details.id, media_type: mediaType }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
                    ${isAdded
                      ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-white hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                >
                  {isAdded ? '✓ Watchlisted' : '+ Watchlist'}
                </button>
              </div>
            </div>
          </div>
          </>
        ) : (
          <p className="p-6 text-center text-gray-500">Failed to load details.</p>
        )}
      </div>
    </div>
  );
};

export default MediaPreviewModal;
