import { Genre } from '../types';
import { getGenres } from './tmdb';
import type { MediaTypeFilter } from './tmdb';

// TMDB keeps separate genre lists (and ids) for movies and TV, and TV merges
// some genres into one entry ("Action & Adventure", "Sci-Fi & Fantasy",
// "War & Politics"). The UI shows a single list matched by name: every
// option carries the ids it maps to on each side, so "Action" is movie 28
// plus tv 10759, and a movie-only genre has no tv ids (and vice versa).
export interface GenreOption {
  key: string;
  label: string;
  movieIds: number[];
  tvIds: number[];
}

// Names TMDB uses on one side for a genre the other side spells differently.
const ALIASES: Record<string, string> = {
  'sci-fi': 'Science Fiction',
};

const slug = (label: string): string =>
  label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// "Sci-Fi & Fantasy" -> ["Science Fiction", "Fantasy"]
const splitName = (name: string): string[] =>
  name
    .split(' & ')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => ALIASES[part.toLowerCase()] ?? part);

export const buildGenreOptions = (movie: Genre[], tv: Genre[]): GenreOption[] => {
  const byKey = new Map<string, GenreOption>();

  const add = (genres: Genre[], side: 'movieIds' | 'tvIds') => {
    for (const genre of genres) {
      if (!genre || typeof genre.id !== 'number' || !genre.name) continue;
      for (const label of splitName(genre.name)) {
        const key = slug(label);
        if (!key) continue;
        let option = byKey.get(key);
        if (!option) {
          option = { key, label, movieIds: [], tvIds: [] };
          byKey.set(key, option);
        }
        if (!option[side].includes(genre.id)) option[side].push(genre.id);
      }
    }
  };

  // Movie names first so a shared genre keeps the movie list's spelling.
  add(movie, 'movieIds');
  add(tv, 'tvIds');

  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
};

let cached: Promise<GenreOption[]> | null = null;

export const getGenreOptions = (): Promise<GenreOption[]> => {
  if (!cached) {
    cached = Promise.all([getGenres('movie'), getGenres('tv')])
      .then(([m, t]) => buildGenreOptions(m.genres ?? [], t.genres ?? []))
      .catch(err => {
        // Don't memoize a failure — the next caller retries.
        cached = null;
        throw err;
      });
  }
  return cached;
};

// Whether an option has ids for the chosen type (any type when null). No
// genre (null) is always available.
export const genreAvailableFor = (option: GenreOption | null, mediaType: MediaTypeFilter): boolean => {
  if (!option) return true;
  if (mediaType === 'movie') return option.movieIds.length > 0;
  if (mediaType === 'tv') return option.tvIds.length > 0;
  return option.movieIds.length > 0 || option.tvIds.length > 0;
};

// The options to list for the chosen type: movie genres for Movies, TV genres
// for TV, everything when no type is chosen.
export const genreOptionsFor = (options: GenreOption[], mediaType: MediaTypeFilter): GenreOption[] =>
  mediaType ? options.filter(option => genreAvailableFor(option, mediaType)) : options;

export const matchesGenre = (
  item: { media_type?: string; genre_ids?: number[] },
  option: GenreOption | null,
): boolean => {
  if (!option) return true;
  const ids = item.media_type === 'movie' ? option.movieIds : item.media_type === 'tv' ? option.tvIds : [];
  if (ids.length === 0 || !item.genre_ids) return false;
  return item.genre_ids.some(id => ids.includes(id));
};
