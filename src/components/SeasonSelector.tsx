
import React, { useState, useRef, useEffect } from 'react';
import { Season } from '../types';

interface SeasonSelectorProps {
  seasons: Season[];
  selectedSeason: number;
  onSeasonChange: (seasonNumber: number) => void;
}

const SeasonSelector: React.FC<SeasonSelectorProps> = ({ seasons, selectedSeason, onSeasonChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const validSeasons = seasons.filter(s => s.season_number > 0);
  const selectedLabel = validSeasons.find(s => s.season_number === selectedSeason)?.name ?? 'Select Season';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="my-6">
      <p className="text-xl font-semibold mb-2">Seasons</p>
      <div className="relative w-auto inline-block min-w-48" ref={ref}>
        <button
          onClick={() => setIsOpen(prev => !prev)}
          className="w-full flex items-center justify-between gap-4 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <span className="font-medium">{selectedLabel}</span>
          <svg
            className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute left-0 mt-1 w-full z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
            {validSeasons.map(season => {
              const isActive = season.season_number === selectedSeason;
              return (
                <button
                  key={season.id}
                  onClick={() => { onSeasonChange(season.season_number); setIsOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors
                    ${isActive
                      ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-white font-semibold'
                      : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  {season.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SeasonSelector;
