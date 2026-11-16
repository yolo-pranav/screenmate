"use client"
import React, { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { PlayerConfig, buildEmbedUrl, DEFAULT_WORKER_ORIGIN } from '@/services/config';
import { imageUrl } from '@/services/tmdb';
import { Video } from '@/types';

// Best YouTube trailer for a title: official trailers first, then any trailer,
// then teasers; English before other languages; newest first within a tier.
export const pickTrailer = (videos: Video[] | undefined): Video | null => {
  const youtube = (videos ?? []).filter(v => v.site === 'YouTube' && v.key);
  const score = (v: Video) =>
    (v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 2 : 0) +
    (v.official ? 1 : 0) +
    (v.iso_639_1 === 'en' ? 0.5 : 0);
  const candidates = youtube.filter(v => v.type === 'Trailer' || v.type === 'Teaser');
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) =>
    (score(b) - score(a)) || (b.published_at ?? '').localeCompare(a.published_at ?? '')
  )[0];
};

interface PlayerViewProps {
  player: PlayerConfig;
  title: string;
  mediaType: 'movie' | 'tv';
  imdbId: string | null;
  season: number;
  episode: number;
  videos?: Video[];
  backdropPath?: string | null;
}

const frameClass = "w-full h-full rounded-lg shadow-lg";

// Android/iOS WebViews (http://localhost, capacitor://localhost) don't give
// YouTube a usable Referer, so embeds fail with "Error 153". There the trailer
// is loaded through the worker's /trailer page, which embeds YouTube from a
// real https origin. Electron fixes the Referer itself (main/youtubeEmbeds.js)
// and plain web has a real origin, so both embed YouTube directly.
const noopSubscribe = () => () => {};
const useIsNativeApp = (): boolean =>
  useSyncExternalStore(noopSubscribe, () => Capacitor.isNativePlatform(), () => false);

export const trailerSrc = (key: string, nativeApp: boolean): string =>
  nativeApp
    ? `${DEFAULT_WORKER_ORIGIN}/trailer?v=${encodeURIComponent(key)}`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?rel=0&playsinline=1`;

const Placeholder: React.FC<{ message?: string; backdropPath?: string | null }> = ({ message, backdropPath }) => (
  <div className={`${frameClass} relative overflow-hidden bg-gray-200 dark:bg-gray-800 flex items-center justify-center`}>
    {backdropPath && (
      <img src={imageUrl(backdropPath, 'w1280')} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
    )}
    {message && (
      <p className="relative text-gray-600 dark:text-gray-300 text-center px-4">{message}</p>
    )}
  </div>
);

// The video area of the player page. The worker-provided player decides what
// goes here: an embed, the title's trailer, or nothing.
const PlayerView: React.FC<PlayerViewProps> = ({ player, title, mediaType, imdbId, season, episode, videos, backdropPath }) => {
  const nativeApp = useIsNativeApp();

  if (player.mode === 'embed') {
    if (!imdbId) return <Placeholder message="Playback isn't available for this title yet (no IMDb reference found)." />;
    return (
      <iframe
        src={buildEmbedUrl(player.embed, mediaType, imdbId, season, episode)}
        title={title}
        referrerPolicy="origin"
        className={frameClass}
        allowFullScreen
      />
    );
  }

  if (player.mode === 'trailer') {
    const trailer = pickTrailer(videos);
    if (!trailer) return <Placeholder message="No trailer available for this title." backdropPath={backdropPath} />;
    return (
      <iframe
        src={trailerSrc(trailer.key, nativeApp)}
        title={`${title} — ${trailer.name || 'Trailer'}`}
        // YouTube refuses to play embeds that arrive without a referrer
        // (on native apps the worker page sets its own Referrer-Policy)
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        className={frameClass}
        allowFullScreen
      />
    );
  }

  return <Placeholder backdropPath={backdropPath} />;
};

export default PlayerView;
