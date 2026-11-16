import { TMDB_API_BASE, TMDB_IMAGE_BASE } from '../constants';
import { getConfig } from './config';
import { Media, PaginatedResponse, MediaDetails, Genre, Language, Episode, WatchProviders } from '../types';
import { GenreOption, matchesGenre } from './genres';

// All TMDB traffic goes through the tmdblive worker, which adds the API key.
// The target is encoded so its own query string (e.g. `&page=2`) survives.
const proxied = (url: string) => getConfig().tmdbProxyUrl + encodeURIComponent(url);

const fetchData = async <T,>(endpoint: string): Promise<T> => {
  const response = await fetch(proxied(`${TMDB_API_BASE}/${endpoint}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch data from ${endpoint}`);
  }
  return response.json();
};

export const imageUrl = (path: string, size: 'w500' | 'w1280' = 'w500'): string =>
  proxied(`${TMDB_IMAGE_BASE}/${size}${path}`);

export const getTrending = (page = 1): Promise<PaginatedResponse<Media>> => {
  return fetchData<PaginatedResponse<Media>>(`trending/all/week?page=${page}`);
};

// ── Lists (home page, search, browse) ──────────────────────────────────────
// Every list keeps only movies and TV shows (trending/all and search/multi also
// return people), drops adult titles, dedupes by media_type + id and stamps
// media_type on each item (discover/* and search/{movie,tv} omit it).

export type HomeListKind = 'trending' | 'top_rated' | 'popular';

// Movies only, TV only, or both (null). Only the chosen type is fetched.
export type MediaTypeFilter = 'movie' | 'tv' | null;

// Multi-page loads call this before each TMDB page and stop once it returns
// false (e.g. the filters changed or the page unmounted).
type ShouldContinue = () => boolean;

// `page` is the LAST TMDB page this call consumed; the next call passes page + 1.
// Client-filtered lists may read several TMDB pages per call, so callers keep
// this cursor instead of counting pages themselves.
export interface MediaPage {
  results: Media[];
  page: number;
  hasMore: boolean;
}

type MediaType = 'movie' | 'tv';
type RawMedia = Omit<Media, 'media_type'> & { media_type?: string };

const MEDIA_TYPES: MediaType[] = ['movie', 'tv'];
// TMDB rejects page > 500 on list endpoints.
const MAX_TMDB_PAGE = 500;
// Client-filtered lists read up to this many TMDB pages per call, stopping
// early once they have at least FILTER_MIN_MATCHES new items.
const FILTER_MAX_PAGES = 5;
const FILTER_MIN_MATCHES = 12;

const toMedia = (items: RawMedia[] | undefined, forcedType?: MediaType): Media[] => {
  const out: Media[] = [];
  for (const item of items ?? []) {
    const type = forcedType ?? item.media_type;
    if (type !== 'movie' && type !== 'tv') continue;
    if (item.adult) continue;
    out.push({ ...item, media_type: type });
  }
  return out;
};

// Movie and TV ids are separate TMDB id spaces — dedupe by type + id.
export const dedupeMedia = (items: Media[]): Media[] => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.media_type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hasNextPage = (page: number, totalPages: number | undefined) =>
  page < Math.min(totalPages ?? 0, MAX_TMDB_PAGE);

const genreIdsFor = (genre: GenreOption, type: MediaType) =>
  type === 'movie' ? genre.movieIds : genre.tvIds;

// Media types to fetch: the chosen type (or both), minus any the genre option
// cannot match at all (TV-only genres skip movies, etc.).
const typesFor = (genre: GenreOption | null, mediaType: MediaTypeFilter = null): MediaType[] =>
  MEDIA_TYPES.filter(type =>
    (!mediaType || type === mediaType) && (!genre || genreIdsFor(genre, type).length > 0));

// Reads TMDB pages from `startPage` until at least FILTER_MIN_MATCHES unique
// items pass `keep`, FILTER_MAX_PAGES pages were read, there are no more pages,
// or `shouldContinue` returns false (checked before every page). When it stops
// early, `page` is the last page actually read, so resuming re-reads nothing.
const collectFiltered = async (
  startPage: number,
  fetchPage: (page: number) => Promise<{ results: Media[]; totalPages: number }>,
  keep: (item: Media) => boolean,
  shouldContinue?: ShouldContinue,
): Promise<MediaPage> => {
  const matches: Media[] = [];
  const seen = new Set<string>();
  let page = startPage - 1;
  let hasMore = startPage >= 1 && startPage <= MAX_TMDB_PAGE;
  for (let read = 0; read < FILTER_MAX_PAGES && hasMore && matches.length < FILTER_MIN_MATCHES; read++) {
    if (shouldContinue && !shouldContinue()) break;
    page += 1;
    const { results, totalPages } = await fetchPage(page);
    for (const item of results) {
      const key = `${item.media_type}-${item.id}`;
      if (seen.has(key) || !keep(item)) continue;
      seen.add(key);
      matches.push(item);
    }
    hasMore = hasNextPage(page, totalPages);
  }
  return { results: matches, page, hasMore };
};

const byDesc = (key: 'popularity' | 'vote_average') => (a: Media, b: Media) =>
  (b[key] ?? 0) - (a[key] ?? 0);

export const discoverMedia = async (opts: {
  page: number;
  genre: GenreOption | null;
  language?: string;
  sortBy: 'popularity.desc' | 'vote_average.desc';
  mediaType?: MediaTypeFilter;
  // Accepted for a uniform API; discover reads a single TMDB page per call.
  shouldContinue?: ShouldContinue;
}): Promise<MediaPage> => {
  const { page, genre, language, sortBy, mediaType } = opts;
  const types = typesFor(genre, mediaType);
  if (types.length === 0 || page < 1 || page > MAX_TMDB_PAGE) {
    return { results: [], page, hasMore: false };
  }

  const responses = await Promise.all(types.map(async type => {
    const params = new URLSearchParams({
      page: String(page),
      include_adult: 'false',
      sort_by: sortBy,
    });
    // "|" = OR: e.g. Action on TV is the combined "Action & Adventure" genre.
    if (genre) params.set('with_genres', genreIdsFor(genre, type).join('|'));
    if (language) params.set('with_original_language', language);
    // Without a vote floor, vote_average.desc is topped by titles with one 10/10 vote.
    if (sortBy === 'vote_average.desc') params.set('vote_count.gte', type === 'movie' ? '300' : '200');
    const data = await fetchData<PaginatedResponse<RawMedia>>(`discover/${type}?${params}`);
    return { results: toMedia(data.results, type), totalPages: data.total_pages };
  }));

  const sortKey = sortBy === 'vote_average.desc' ? 'vote_average' : 'popularity';
  const results = dedupeMedia(responses.flatMap(r => r.results)).sort(byDesc(sortKey));
  return { results, page, hasMore: responses.some(r => hasNextPage(page, r.totalPages)) };
};

// trending/all/week when no type is chosen, else trending/{movie,tv}/week.
const trendingPageFetcher = (mediaType: MediaTypeFilter) => async (page: number) => {
  const data = await fetchData<PaginatedResponse<RawMedia>>(`trending/${mediaType ?? 'all'}/week?page=${page}`);
  return { results: toMedia(data.results, mediaType ?? undefined), totalPages: data.total_pages };
};

export const getHomeList = async (
  kind: HomeListKind,
  page: number,
  genre: GenreOption | null,
  opts: { mediaType?: MediaTypeFilter; shouldContinue?: ShouldContinue } = {},
): Promise<MediaPage> => {
  const { mediaType = null, shouldContinue } = opts;
  if (kind === 'top_rated') return discoverMedia({ page, genre, sortBy: 'vote_average.desc', mediaType, shouldContinue });
  if (kind === 'popular') return discoverMedia({ page, genre, sortBy: 'popularity.desc', mediaType, shouldContinue });

  const fetchTrendingPage = trendingPageFetcher(mediaType);

  // TMDB has no trending-by-genre endpoint: filter trending pages client-side.
  if (genre) {
    // The genre has no ids for the chosen type (e.g. Horror on TV): nothing can match.
    if (typesFor(genre, mediaType).length === 0) return { results: [], page, hasMore: false };
    return collectFiltered(page, fetchTrendingPage, item => matchesGenre(item, genre), shouldContinue);
  }

  if (page < 1 || page > MAX_TMDB_PAGE) return { results: [], page, hasMore: false };
  const { results, totalPages } = await fetchTrendingPage(page);
  return { results: dedupeMedia(results), page, hasMore: hasNextPage(page, totalPages) };
};

// No genre/language -> search/multi (or search/{movie,tv} when a type is chosen).
// With a genre and/or language -> search/movie and/or search/tv filtered
// client-side: search/* has no genre or original-language filter (TMDB's
// `language` param only localizes metadata).
export const searchMedia = async (
  query: string,
  page: number,
  filters: { genre: GenreOption | null; language?: string; mediaType?: MediaTypeFilter },
  opts: { shouldContinue?: ShouldContinue } = {},
): Promise<MediaPage> => {
  const q = query.trim();
  if (!q) return { results: [], page, hasMore: false };
  const { genre, language, mediaType = null } = filters;

  if (!genre && !language) {
    if (page < 1 || page > MAX_TMDB_PAGE) return { results: [], page, hasMore: false };
    const params = new URLSearchParams({ query: q, page: String(page), include_adult: 'false' });
    const data = await fetchData<PaginatedResponse<RawMedia>>(`search/${mediaType ?? 'multi'}?${params}`);
    return {
      results: dedupeMedia(toMedia(data.results, mediaType ?? undefined)),
      page,
      hasMore: hasNextPage(page, data.total_pages),
    };
  }

  const types = typesFor(genre, mediaType);
  if (types.length === 0) return { results: [], page, hasMore: false };

  const fetchPage = async (p: number) => {
    const params = new URLSearchParams({ query: q, page: String(p), include_adult: 'false' });
    const responses = await Promise.all(types.map(async type => {
      const data = await fetchData<PaginatedResponse<RawMedia>>(`search/${type}?${params}`);
      return { results: toMedia(data.results, type), totalPages: data.total_pages };
    }));
    return {
      results: responses.flatMap(r => r.results).sort(byDesc('popularity')),
      totalPages: Math.max(...responses.map(r => r.totalPages ?? 0)),
    };
  };

  return collectFiltered(page, fetchPage, item =>
    matchesGenre(item, genre) && (!language || item.original_language === language), opts.shouldContinue);
};

export const getMediaDetails = (mediaType: 'movie' | 'tv', id: number): Promise<MediaDetails> => {
  return fetchData<MediaDetails>(`${mediaType}/${id}?append_to_response=credits,external_ids,videos`);
};

// Where a title can be watched, by country (TMDB data from JustWatch). Kept
// out of getMediaDetails so the title page never waits on, or fails with, it.
// Successful answers are cached for the session; failures are not, so a later
// view retries.
const watchProvidersCache = new Map<string, Record<string, WatchProviders>>();
export const getWatchProviders = async (mediaType: 'movie' | 'tv', id: number): Promise<Record<string, WatchProviders>> => {
  const key = `${mediaType}-${id}`;
  const cached = watchProvidersCache.get(key);
  if (cached) return cached;
  const data = await fetchData<{ results?: Record<string, WatchProviders> }>(`${mediaType}/${id}/watch/providers`);
  const results = data.results ?? {};
  watchProvidersCache.set(key, results);
  return results;
};

export const getRecommendations = (mediaType: 'movie' | 'tv', id: number, page = 1): Promise<PaginatedResponse<Media>> => {
  return fetchData<PaginatedResponse<Media>>(`${mediaType}/${id}/recommendations?page=${page}`);
};

export const getGenres = (mediaType: 'movie' | 'tv'): Promise<{ genres: Genre[] }> => {
  return fetchData<{ genres: Genre[] }>(`genre/${mediaType}/list`);
};

export const getLanguages = (): Promise<Language[]> => {
  return fetchData<Language[]>(`configuration/languages`);
};

export const getTvSeason = (tvId: number, seasonNumber: number): Promise<{ episodes: Episode[] }> => {
  return fetchData<{ episodes: Episode[] }>(`tv/${tvId}/season/${seasonNumber}`);
};
