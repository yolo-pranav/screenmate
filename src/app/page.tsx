"use client"
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHomeList, dedupeMedia, HomeListKind, MediaTypeFilter } from '../services/tmdb';
import { getGenreOptions, genreOptionsFor, genreAvailableFor, GenreOption } from '../services/genres';
import { Media } from '../types';
import MovieCard from '../components/MovieCard';
import Spinner from '../components/Spinner';
import FilterDropdown from '../components/FilterDropdown';
import MediaTypeToggle from '../components/MediaTypeToggle';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import ContinueWatching from '../components/ContinueWatching';
import WatchlistSection from '../components/WatchlistSection';

const listOptions: { value: HomeListKind; label: string; heading: string }[] = [
  { value: 'trending', label: 'Trending', heading: 'Trending This Week' },
  { value: 'top_rated', label: 'Top Rated', heading: 'Top Rated' },
  { value: 'popular', label: 'Most Popular', heading: 'Most Popular' },
];

const typeLabels: Record<'movie' | 'tv', string> = { movie: 'Movies', tv: 'TV' };

// A client-filtered list (Trending + genre) can return batches that add
// nothing while TMDB still has pages. After this many consecutive empty
// batches, automatic loading stops and the user can search further by hand.
const MAX_EMPTY_LOADS = 3;

const neutralButton =
  'px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors';

const HomePage: React.FC = () => {
  const [media, setMedia] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // False until the current list's first load has finished, so the empty
  // state never flashes before anything was fetched.
  const [loaded, setLoaded] = useState(false);
  // True once MAX_EMPTY_LOADS consecutive loads added nothing.
  const [stalled, setStalled] = useState(false);
  const [listKind, setListKind] = useState<HomeListKind>('trending');
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(null);
  const [genreKey, setGenreKey] = useState('');
  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);

  // TMDB-page cursor: client-filtered lists may consume several TMDB pages per
  // call, so the next page comes from the last response, not a counter.
  const nextPageRef = useRef(1);
  // Bumped on every list/type/genre change and on unmount; loads from an older
  // id stop fetching and their responses are dropped.
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const mediaRef = useRef<Media[]>([]);
  const emptyLoadsRef = useRef(0);
  const mountedRef = useRef(true);

  const loadGenres = useCallback(() => {
    getGenreOptions()
      .then(options => { if (mountedRef.current) setGenreOptions(options); })
      .catch(() => { /* dropdown stays empty; opening it retries */ });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadGenres();
    return () => { mountedRef.current = false; };
  }, [loadGenres]);

  // The genre list for the chosen type only (all genres when no type is set).
  const visibleGenres = useMemo(() => genreOptionsFor(genreOptions, mediaType), [genreOptions, mediaType]);

  const genre = useMemo(
    () => visibleGenres.find(o => o.key === genreKey) ?? null,
    [visibleGenres, genreKey],
  );

  const changeMediaType = (next: MediaTypeFilter) => {
    setMediaType(next);
    // e.g. Horror has no TV ids: drop it rather than show an impossible filter.
    if (!genreAvailableFor(genre, next)) setGenreKey('');
  };

  const openGenres = () => {
    if (genreOptions.length === 0) loadGenres();
  };

  // `manual` = the "search further" button: read a single batch.
  const loadMore = useCallback(async (manual = false) => {
    if (inFlightRef.current) return;
    const requestId = requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    inFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      for (;;) {
        const res = await getHomeList(listKind, nextPageRef.current, genre, {
          mediaType,
          shouldContinue: isCurrent,
        });
        if (!isCurrent()) return;
        nextPageRef.current = res.page + 1;
        const before = mediaRef.current.length;
        mediaRef.current = dedupeMedia([...mediaRef.current, ...res.results]);
        const added = mediaRef.current.length - before;
        if (added > 0) setMedia(mediaRef.current);
        setHasMore(res.hasMore);
        if (added > 0) {
          emptyLoadsRef.current = 0;
          setStalled(false);
          break;
        }
        if (!res.hasMore) break;
        emptyLoadsRef.current += 1;
        if (manual || emptyLoadsRef.current >= MAX_EMPTY_LOADS) {
          setStalled(true);
          break;
        }
      }
    } catch {
      if (!isCurrent()) return;
      setError('Failed to load titles.');
      // Stop the observer from retrying in a loop; the Retry button resumes.
      setHasMore(false);
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false;
        setIsLoading(false);
        setLoaded(true);
      }
    }
  }, [listKind, genre, mediaType]);

  // The infinite-scroll hook passes a page number; automatic loads are never manual.
  const autoLoad = useCallback(() => loadMore(), [loadMore]);

  const { lastElementRef, resetPage } = useInfiniteScroll({
    fetcher: autoLoad,
    hasMore: hasMore && !stalled,
    isLoading,
  });

  // Any change of list, type or genre starts a fresh list from TMDB page 1.
  useEffect(() => {
    requestIdRef.current += 1;
    nextPageRef.current = 1;
    inFlightRef.current = false;
    mediaRef.current = [];
    emptyLoadsRef.current = 0;
    setMedia([]);
    setHasMore(true);
    setError(null);
    setLoaded(false);
    setStalled(false);
    resetPage();
    loadMore();
    // Superseded or unmounted: stop the in-flight load from fetching more pages.
    return () => { requestIdRef.current += 1; };
  }, [loadMore, resetPage]);

  const retry = () => {
    // Start the empty-batch count over, so one more empty batch after a
    // failed "search further" doesn't stall the list straight away
    emptyLoadsRef.current = 0;
    setStalled(false);
    setHasMore(true);
    loadMore();
  };

  const heading = listOptions.find(o => o.value === listKind)?.heading ?? '';
  const canSearchFurther = loaded && stalled && hasMore && !isLoading && !error;
  const showEmpty = loaded && !isLoading && !error && media.length === 0 && !canSearchFurther;

  return (
    <div>
      <ContinueWatching />
      <WatchlistSection />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          {heading}
          {mediaType && <span className="text-gray-500 dark:text-gray-400"> · {typeLabels[mediaType]}</span>}
          {genre && <span className="text-gray-500 dark:text-gray-400"> · {genre.label}</span>}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {listOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setListKind(opt.value)}
              aria-pressed={listKind === opt.value}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                listKind === opt.value
                  ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <MediaTypeToggle value={mediaType} onChange={changeMediaType} />
          <FilterDropdown
            label="All genres"
            value={genre ? genre.key : ''}
            options={visibleGenres.map(o => ({ value: o.key, label: o.label }))}
            onChange={setGenreKey}
            onOpen={openGenres}
          />
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-red-500">{error}</p>
          <button type="button" onClick={retry} className={neutralButton}>
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
        {media.map((item, index, arr) => {
          if (arr.length === index + 1) {
            // No sentinel while stalled: loading resumes only by hand.
            return (
              <div ref={stalled ? undefined : lastElementRef} key={`${item.media_type}-${item.id}`}>
                <MovieCard media={item} />
              </div>
            );
          }
          return <MovieCard key={`${item.media_type}-${item.id}`} media={item} />;
        })}
      </div>
      {showEmpty && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {genre ? 'No titles found for this genre.' : 'No titles found.'}
          </p>
        </div>
      )}
      {canSearchFurther && (
        <div className={`flex justify-center ${media.length === 0 ? 'py-12' : 'py-6'}`}>
          <button type="button" onClick={() => loadMore(true)} className={neutralButton}>
            {media.length === 0 ? 'No matches yet — search further' : 'No more matches yet — search further'}
          </button>
        </div>
      )}
      {isLoading && <Spinner />}
    </div>
  );
};

export default HomePage;
