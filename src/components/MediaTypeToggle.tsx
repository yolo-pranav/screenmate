"use client"
import React from 'react';
import type { MediaTypeFilter } from '../services/tmdb';

interface MediaTypeToggleProps {
  value: MediaTypeFilter;
  onChange: (v: MediaTypeFilter) => void;
  // 'chip' matches the home page's list buttons; 'field' matches FilterDropdown's height
  size?: 'chip' | 'field';
}

// Click order: Movies & TV (off) -> Movies -> TV -> Movies & TV.
const NEXT: Record<'off' | 'movie' | 'tv', MediaTypeFilter> = { off: 'movie', movie: 'tv', tv: null };
const LABELS: Record<'off' | 'movie' | 'tv', string> = { off: 'Movies & TV', movie: 'Movies', tv: 'TV' };

const iconProps = {
  className: 'w-3.5 h-3.5 shrink-0',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const FilmIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
  </svg>
);

const TvIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M17 2l-5 5-5-5" />
  </svg>
);

const StackIcon = () => (
  <svg {...iconProps}>
    <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
    <path d="M3 12l9 4.5 9-4.5" />
    <path d="M3 16.5l9 4.5 9-4.5" />
  </svg>
);

const MediaTypeToggle: React.FC<MediaTypeToggleProps> = ({ value, onChange, size = 'chip' }) => {
  const key = value ?? 'off';
  const label = LABELS[key];
  const active = value !== null;
  const Icon = value === 'movie' ? FilmIcon : value === 'tv' ? TvIcon : StackIcon;

  return (
    <button
      type="button"
      onClick={() => onChange(NEXT[key])}
      aria-label={`Type filter: ${label}. Click to change.`}
      title="Click to switch between Movies & TV, Movies and TV"
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors ${
        size === 'field' ? 'px-3 py-2 text-sm border border-transparent' : 'px-3 py-1.5 text-xs'
      } ${
        active
          ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      <Icon />
      <span>{label}</span>
    </button>
  );
};

export default MediaTypeToggle;
