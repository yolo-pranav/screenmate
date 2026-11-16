"use client"
import React, { useState } from 'react';
import { Media } from '../types';
import { useWatchlist } from '../hooks/useWatchlist';
import MediaPreviewModal from './MediaPreviewModal';
import { imageUrl } from '../services/tmdb';

interface MovieCardProps {
  media: Media;
}

const MovieCard: React.FC<MovieCardProps> = ({ media }) => {
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlist();
  const isAdded = isInWatchlist(media.id);
  const [showPreview, setShowPreview] = useState(false);

  const title = media.title || media.name;
  const releaseDate = media.release_date || media.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
  const posterUrl = media.poster_path ? imageUrl(media.poster_path) : 'https://picsum.photos/500/750';

  const handleToggleWatchlist = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isAdded) removeFromWatchlist(media.id);
    else addToWatchlist({ id: media.id, media_type: media.media_type });
  };

  return (
    <>
      <div
        className="block group cursor-pointer"
        onClick={() => setShowPreview(true)}
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-transparent transition-all duration-300 hover:scale-105 hover:shadow-md">
          <div className="relative">
            <img src={posterUrl} alt={title} className="w-full aspect-2/3 object-cover" />
            <button
              onClick={handleToggleWatchlist}
              className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 shadow
                ${isAdded
                  ? 'bg-green-500 opacity-100'
                  : 'bg-black/50 opacity-0 group-hover:opacity-100 hover:bg-black/70'
                }`}
              aria-label={isAdded ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              {isAdded
                ? <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              }
            </button>
          </div>
          <div className="px-3 py-3">
            <p className="text-gray-900 dark:text-white text-sm font-semibold truncate group-hover:text-primary transition-colors leading-snug">{title}</p>
            <div className="flex items-center justify-between text-xs mt-2">
              <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <span>{year}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="uppercase tracking-wide">{media.media_type}</span>
              </div>
              <div className="flex items-center gap-1.5 text-yellow-500 font-semibold">
                <span>★</span>
                <span>{(media.vote_average ?? 0).toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPreview && (
        <MediaPreviewModal
          id={media.id}
          mediaType={media.media_type}
          prefetchedData={null}
          onClose={() => setShowPreview(false)}
          onModalMouseEnter={() => {}}
          onModalMouseLeave={() => {}}
        />
      )}
    </>
  );
};

export default MovieCard;
