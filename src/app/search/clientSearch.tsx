"use client"
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { searchMedia, discoverMedia, dedupeMedia, getLanguages, MediaPage, MediaTypeFilter } from '@/services/tmdb';
import { getGenreOptions, genreOptionsFor, genreAvailableFor, GenreOption } from '@/services/genres';
import { Media, Language } from '@/types';
import MovieCard from '@/components/MovieCard';
import Spinner from '@/components/Spinner';
import FilterDropdown from '@/components/FilterDropdown';
import MediaTypeToggle from '@/components/MediaTypeToggle';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

// What the page shows for the current text + filters:
// - browse:   no text, a genre and/or language picked -> discover (popular)
// - filtered: text + filters -> search/movie and/or search/tv filtered client-side
// - search:   text only -> search/multi (search/movie or search/tv with a type)
// - empty:    nothing to show yet
// The type toggle only narrows the other modes: a type alone stays empty.
type Mode = 'empty' | 'browse' | 'filtered' | 'search';

interface ListParams {
  query: string;
  genre: GenreOption | null;
  language: string;
  mediaType: MediaTypeFilter;
}

// After this many loads in a row that add nothing new (while TMDB still has
// pages), stop loading on scroll and let the user search further by hand.
const MAX_EMPTY_AUTO_LOADS = 3;

const modeFor = ({ query, genre, language }: ListParams): Mode => {
  const hasFilters = !!genre || !!language;
  if (query) return hasFilters ? 'filtered' : 'search';
  return hasFilters ? 'browse' : 'empty';
};

const fetchList = (params: ListParams, page: number, shouldContinue: () => boolean): Promise<MediaPage> => {
  const { query, genre, language, mediaType } = params;
  const lang = language || undefined;
  if (query) return searchMedia(query, page, { genre, language: lang, mediaType }, { shouldContinue });
  return discoverMedia({ page, genre, language: lang, sortBy: 'popularity.desc', mediaType, shouldContinue });
};

const TYPE_LABELS: Record<'movie' | 'tv', string> = { movie: 'Movies', tv: 'TV' };
const TYPE_NOUNS: Record<'movie' | 'tv' | 'all', string> = {
  movie: 'movies',
  tv: 'TV shows',
  all: 'movies and TV shows',
};

const mediaKey = (item: Media) => `${item.media_type}-${item.id}`;

const ClientSearch = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [submittedQuery, setSubmittedQuery] = useState((searchParams.get('q') || '').trim());

  const [results, setResults] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-loading paused after repeated loads that found nothing new.
  const [stalled, setStalled] = useState(false);

  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedGenre, setSelectedGenre] = useState('');     // GenreOption.key
  const [selectedLanguage, setSelectedLanguage] = useState(''); // iso_639_1
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(null);

  const genre = useMemo(
    () => genreOptions.find(g => g.key === selectedGenre) ?? null,
    [genreOptions, selectedGenre],
  );

  const params = useMemo<ListParams>(
    () => ({ query: submittedQuery, genre, language: selectedLanguage, mediaType }),
    [submittedQuery, genre, selectedLanguage, mediaType],
  );
  const mode = modeFor(params);

  // Bumped on every reset (and on unmount) — responses for an older key are
  // discarded, and multi-page loads for an older key stop fetching.
  const requestKey = useRef(0);
  // TMDB-page cursor: client-filtered lists can read several TMDB pages per
  // call, so the next page comes from the last response, not a counter.
  const nextPage = useRef(1);
  const inFlight = useRef(false);
  const paramsRef = useRef(params);
  // Keys already shown, to tell whether a load added anything new.
  const seenKeys = useRef(new Set<string>());
  const emptyLoads = useRef(0);

  const load = useCallback(async (key: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const page = nextPage.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchList(paramsRef.current, page, () => key === requestKey.current);
      if (key !== requestKey.current) return;
      nextPage.current = data.page + 1;
      const fresh = dedupeMedia(data.results).filter(item => !seenKeys.current.has(mediaKey(item)));
      fresh.forEach(item => seenKeys.current.add(mediaKey(item)));
      if (fresh.length > 0) setResults(prev => [...prev, ...fresh]);
      if (fresh.length === 0 && data.hasMore) {
        emptyLoads.current += 1;
        if (emptyLoads.current >= MAX_EMPTY_AUTO_LOADS) setStalled(true);
      } else {
        emptyLoads.current = 0;
        setStalled(false);
      }
      setHasMore(data.hasMore);
    } catch {
      if (key !== requestKey.current) return;
      // Stop the observer from retrying in a loop; the user can retry by hand.
      setHasMore(false);
      setError(page === 1 ? 'Failed to fetch results.' : 'Failed to load more results.');
    } finally {
      if (key === requestKey.current) {
        inFlight.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  // Reset whenever the query or a filter changes, then load the first page.
  useEffect(() => {
    const key = ++requestKey.current;
    paramsRef.current = params;
    nextPage.current = 1;
    inFlight.current = false;
    seenKeys.current = new Set();
    emptyLoads.current = 0;
    setResults([]);
    setHasMore(false);
    setError(null);
    setStalled(false);
    setIsLoading(false);
    if (modeFor(params) !== 'empty') load(key);
    // Superseded or unmounted: stop any multi-page load still running.
    return () => { requestKey.current++; };
  }, [params, load]);

  // The hook's own page counter is ignored — `load` reads the cursor ref.
  const fetchMore = useCallback(async () => {
    await load(requestKey.current);
  }, [load]);

  const { lastElementRef } = useInfiniteScroll({ fetcher: fetchMore, hasMore: hasMore && !stalled, isLoading });

  const retry = () => {
    setError(null);
    load(requestKey.current);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  };

  useEffect(() => {
    router.replace(`/search?q=${encodeURIComponent(submittedQuery)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedQuery]);

  const loadGenreOptions = useCallback(() => {
    // Failures aren't cached by getGenreOptions — opening the dropdown retries.
    getGenreOptions().then(setGenreOptions).catch(() => {});
  }, []);

  useEffect(() => {
    loadGenreOptions();
    getLanguages()
      .then(langs => setLanguages(
        langs.filter(l => l.english_name).sort((a, b) => a.english_name.localeCompare(b.english_name))))
      .catch(() => {});
  }, [loadGenreOptions]);

  const handleGenreOpen = () => {
    if (genreOptions.length === 0) loadGenreOptions();
  };

  const handleMediaTypeChange = (next: MediaTypeFilter) => {
    setMediaType(next);
    // Drop a genre the new type doesn't have (e.g. Horror on TV).
    if (selectedGenre) {
      const current = genreOptions.find(g => g.key === selectedGenre) ?? null;
      if (!current || !genreAvailableFor(current, next)) setSelectedGenre('');
    }
  };

  const visibleGenreOptions = useMemo(
    () => genreOptionsFor(genreOptions, mediaType),
    [genreOptions, mediaType],
  );

  const activeFilterCount = [selectedGenre, selectedLanguage, mediaType].filter(Boolean).length;

  const languageLabel = selectedLanguage
    ? languages.find(l => l.iso_639_1 === selectedLanguage)?.english_name ?? selectedLanguage.toUpperCase()
    : '';
  const typeLabel = mediaType ? TYPE_LABELS[mediaType] : '';
  const typeNoun = TYPE_NOUNS[mediaType ?? 'all'];
  const filterSummary = [genre?.label, languageLabel].filter(Boolean).join(' · ');
  // e.g. "Animation · Japanese · TV"
  const browseSummary = [filterSummary, typeLabel].filter(Boolean).join(' · ');
  const typeSuffix = typeLabel ? ` · ${typeLabel}` : '';

  return (
    <Suspense>
      {/* Search bar */}
      <div className="mb-6">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies, TV shows..."
              className="w-full pl-12 pr-10 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-primary text-base shadow-sm"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSubmittedQuery(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-5 py-3 rounded-xl bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white font-semibold text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search
          </button>
        </form>

        {/* Filters row */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Filters:</span>
          <MediaTypeToggle value={mediaType} onChange={handleMediaTypeChange} size="field" />
          <FilterDropdown
            label="All Genres"
            value={selectedGenre}
            options={visibleGenreOptions.map(g => ({ value: g.key, label: g.label }))}
            onChange={setSelectedGenre}
            onOpen={handleGenreOpen}
          />
          <FilterDropdown
            label="All Languages"
            value={selectedLanguage}
            options={languages.map(l => ({ value: l.iso_639_1, label: l.english_name }))}
            onChange={setSelectedLanguage}
          />
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => { setSelectedGenre(''); setSelectedLanguage(''); setMediaType(null); }}
              className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Heading */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {mode === 'browse' && <>Popular in <span className="text-primary">{browseSummary}</span></>}
          {(mode === 'search' || mode === 'filtered') && (
            <>Results for <span className="text-primary">&quot;{submittedQuery}&quot;</span>{typeSuffix}</>
          )}
          {mode === 'empty' && `Search for ${typeNoun}`}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {mode === 'browse' && `Popular ${typeNoun} matching your filters. Type a search to narrow them down.`}
          {mode === 'filtered' && <>Filtered by {filterSummary}</>}
          {mode === 'empty' && 'Type a title, or pick a genre or language to browse.'}
        </p>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
          {results.map((item) => <MovieCard key={mediaKey(item)} media={item} />)}
        </div>
      )}

      {/* Infinite-scroll sentinel (removed while auto-loading is paused) */}
      {hasMore && !error && !stalled && <div ref={lastElementRef} className="h-10" />}

      {isLoading && <Spinner />}

      {hasMore && stalled && !isLoading && !error && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => load(requestKey.current)}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {results.length === 0 ? 'No matches yet — search further' : 'No more matches yet — search further'}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <p className="text-red-500">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !hasMore && !error && mode !== 'empty' && results.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 text-center mt-12">
          {mode === 'browse' && <>No titles found for {browseSummary}.</>}
          {mode === 'filtered' && <>No {mediaType ? typeNoun : 'results'} found for &quot;{submittedQuery}&quot; with these filters.</>}
          {mode === 'search' && <>No {mediaType ? typeNoun : 'results'} found for &quot;{submittedQuery}&quot;.</>}
        </p>
      )}
    </Suspense>
  );
};

export default ClientSearch;
