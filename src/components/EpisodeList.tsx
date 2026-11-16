import React, { useState } from 'react';
import { Episode } from '@/types';
import { imageUrl } from '@/services/tmdb';

interface EpisodeListProps {
  episodes: Episode[];
  selectedEpisode: number;
  onEpisodeSelect: (episodeNumber: number) => void;
}

const EpisodeList: React.FC<EpisodeListProps> = ({ episodes, selectedEpisode, onEpisodeSelect }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="font-semibold text-gray-900 dark:text-white">
          Episodes
          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">— E{selectedEpisode} selected</span>
        </span>
        <span className="text-gray-500 dark:text-gray-400 text-lg">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="max-h-96 overflow-y-auto scrollbar-thin space-y-1 p-2 bg-gray-50 dark:bg-gray-900">
          {episodes.map(episode => {
            const isActive = episode.episode_number === selectedEpisode;
            return (
              <div
                key={episode.id}
                onClick={() => onEpisodeSelect(episode.episode_number)}
                className={`flex items-start p-3 rounded-lg cursor-pointer transition-colors
                  ${isActive ? 'bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700' : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                <div className={`shrink-0 w-6 text-sm font-bold text-center ${isActive ? 'text-blue-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                  {episode.episode_number}
                </div>
                <img
                  src={episode.still_path ? imageUrl(episode.still_path) : 'https://picsum.photos/177/100'}
                  alt={episode.name}
                  className="w-32 h-20 object-cover rounded-md mx-3 shrink-0"
                />
                <div className="grow min-w-0">
                  <h4 className={`font-bold truncate ${isActive ? 'text-blue-900 dark:text-white' : 'text-gray-900 dark:text-gray-100'}`}>{episode.name}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{episode.overview}</p>
                </div>
                {isActive && (
                  <span className="ml-2 shrink-0 text-xs bg-blue-800 dark:bg-white text-white dark:text-blue-600 font-bold px-2 py-0.5 rounded-full self-start mt-1">
                    SELECTED
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EpisodeList;
