
export interface Media {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv';
  vote_average: number;
  popularity?: number;
  original_language?: string;
  genre_ids?: number[];
  adult?: boolean;
}

export interface PaginatedResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface Genre {
  id: number;
  name: string;
}

export interface Language {
  iso_639_1: string;
  english_name: string;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export interface Episode {
  id: number;
  name: string;
  overview: string;
  still_path: string | null;
  episode_number: number;
  air_date: string;
}

export interface Season {
  id: number;
  name: string;
  poster_path: string | null;
  season_number: number;
  episode_count: number;
}

// A streaming/rental service a title is available on (TMDB data from JustWatch)
export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

// Availability in one country
export interface WatchProviders {
  link?: string;
  flatrate?: WatchProvider[];
  free?: WatchProvider[];
  ads?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

// TMDB video (trailers, teasers, clips) from append_to_response=videos
export interface Video {
  key: string;          // YouTube video id when site is 'YouTube'
  site: string;         // 'YouTube', 'Vimeo', ...
  type: string;         // 'Trailer', 'Teaser', 'Clip', ...
  official: boolean;
  iso_639_1: string;    // language
  name: string;
  published_at?: string;
}

export interface ExternalIds {
  imdb_id?: string | null;
}

export interface MediaDetails {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  release_date?: string;
  first_air_date?: string;
  genres: Genre[];
  vote_average: number;
  imdb_id?: string;
  seasons?: Season[];
  runtime?: number; // for movies
  episode_run_time?: number[]; // for tv
  credits: {
    cast: CastMember[];
  };
  external_ids?: ExternalIds;
  videos?: { results: Video[] };
}

export type Theme = 'light' | 'dark';
