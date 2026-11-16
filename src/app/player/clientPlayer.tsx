"use client"
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { getMediaDetails, getRecommendations, getTvSeason, imageUrl } from '@/services/tmdb';
import { MediaDetails, CastMember, Media, Episode } from '@/types';
import Spinner from '@/components/Spinner';
import MovieCard from '@/components/MovieCard';
import SeasonSelector from '@/components/SeasonSelector';
import EpisodeList from '@/components/EpisodeList';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useProgress } from '@/hooks/useProgress';
import { useWatchlist } from '@/hooks/useWatchlist';
import { PlayerConfig } from '@/services/config';
import { usePlayerConfig } from '@/hooks/usePlayerConfig';
import PlayerView from '@/components/PlayerView';
import WhereToWatch from '@/components/WhereToWatch';

const ClientPlayer: React.FC = () => {
  const params = useSearchParams();
  const mediaType = params.get('mediaType') as "movie" | "tv";
  const id = params.get('id') as string;
  const { updateProgress, getProgress } = useProgress();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlist();
  const { player, isResolved: playerResolved } = usePlayerConfig();
  const [pinnedPlayer, setPinnedPlayer] = useState<{ key: string; player: PlayerConfig } | null>(null);
  const playerRef = React.useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [recommendations, setRecommendations] = useState<Media[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recHasMore, setRecHasMore] = useState(true);
  const [recIsLoading, setRecIsLoading] = useState(false);
  const readSavedProgress = () => (mediaType === 'tv' && id) ? getProgress(parseInt(id)) : null;
  const [selectedSeason, setSelectedSeason] = useState(() => readSavedProgress()?.season ?? 1);
  const [selectedEpisode, setSelectedEpisode] = useState(() => readSavedProgress()?.episode ?? 1);
  const hadSavedProgress = React.useRef(readSavedProgress() !== null);

  // Navigating player → player (e.g. tapping a recommendation) doesn't remount
  // this component — reset per-title state in render so the previous title's
  // season/episode aren't carried over and written into the new title's progress.
  const mediaKey = `${mediaType}-${id}`;
  const [currentKey, setCurrentKey] = useState(mediaKey);
  if (currentKey !== mediaKey) {
    setCurrentKey(mediaKey);
    const saved = readSavedProgress();
    hadSavedProgress.current = saved !== null;
    setSelectedSeason(saved?.season ?? 1);
    setSelectedEpisode(saved?.episode ?? 1);
    setRecommendations([]);
    setRecHasMore(true);
  }

  useEffect(() => {
    const fetchDetails = async () => {
      if (!mediaType || !id) return;
      setIsLoading(true);
      setError(null);
      try {
        const data = await getMediaDetails(mediaType, parseInt(id));
        setDetails(data);
        if (mediaType === 'tv' && data.seasons && data.seasons.length > 0 && !hadSavedProgress.current) {
          const validSeasons = data.seasons.filter(s => s.season_number > 0);
          if (validSeasons.length > 0) {
            setSelectedSeason(validSeasons[0].season_number);
          }
        }
      } catch (err) {
        setError("Failed to load details.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchDetails();
  }, [mediaType, id]);

  useEffect(() => {
    const fetchEpisodes = async () => {
      if (mediaType === 'tv' && id) {
        try {
          const data = await getTvSeason(parseInt(id), selectedSeason);
          setEpisodes(data.episodes);
        } catch (err) {
          console.error("Failed to fetch episodes", err);
          setEpisodes([]);
        }
      }
    };
    fetchEpisodes();
  }, [mediaType, id, selectedSeason]);

  useEffect(() => {
    if (!id || !mediaType) return;
    if (mediaType === 'tv') {
      updateProgress(parseInt(id), 'tv', selectedSeason, selectedEpisode);
    } else {
      updateProgress(parseInt(id), 'movie');
    }
  }, [mediaType, id, selectedSeason, selectedEpisode]);

  const fetchMoreRecommendations = useCallback(async (page: number) => {
    if (!mediaType || !id) return;
    setRecIsLoading(true);
    try {
      const data = await getRecommendations(mediaType, parseInt(id), page);
      setRecommendations(prev => {
        const merged = page === 1 ? data.results : [...prev, ...data.results];
        // Movie and TV ids are separate TMDB id spaces — dedupe by type + id
        return merged.filter((item, index, arr) =>
          arr.findIndex(x => x.id === item.id && x.media_type === item.media_type) === index);
      });
      setRecHasMore(data.page < data.total_pages);
    } catch (err) {
      console.error("Failed to load recommendations", err);
    } finally {
      setRecIsLoading(false);
    }
  }, [mediaType, id]);

  const { lastElementRef, resetPage } = useInfiniteScroll({
    fetcher: fetchMoreRecommendations,
    hasMore: recHasMore,
    isLoading: recIsLoading
  });

  useEffect(() => {
    // Reset the infinite-scroll page counter too, otherwise the next scroll on a
    // newly opened title continues from the previous title's page number.
    resetPage();
    fetchMoreRecommendations(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mediaType]);

  const scrollToPlayer = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNextEpisode = () => {
    const currentIndex = episodes.findIndex(e => e.episode_number === selectedEpisode);
    if (currentIndex !== -1 && currentIndex < episodes.length - 1) {
      setSelectedEpisode(episodes[currentIndex + 1].episode_number);
      scrollToPlayer();
    }
  };

  const isLastEpisode = episodes.length > 0 &&
    episodes.findIndex(e => e.episode_number === selectedEpisode) === episodes.length - 1;

  const validSeasons = details?.seasons?.filter(s => s.season_number > 0) ?? [];
  const nextSeason = validSeasons.find(s => s.season_number === selectedSeason + 1);

  const handleNextSeason = () => {
    if (nextSeason) {
      setSelectedSeason(nextSeason.season_number);
      setSelectedEpisode(1);
      scrollToPlayer();
    }
  };

  const handleSeasonChange = (season: number) => {
    setSelectedSeason(season);
    setSelectedEpisode(1);
  };

  if (isLoading) return <Spinner />;
  if (error) return <p className="text-red-500 text-center">{error}</p>;
  if (!details) return <p className="text-center">No details found.</p>;

  const title = details.title || details.name;
  const releaseDate = details.release_date || details.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';

  const currentEpisode = episodes.find(e => e.episode_number === selectedEpisode);

  const imdbId = mediaType === 'movie'
    ? (details.imdb_id || details.external_ids?.imdb_id)
    : details.external_ids?.imdb_id;
  // The player (embed, trailer or none) comes from the user's worker, so it can
  // change without a new build. It's pinned once an episode starts, so a
  // background refresh can't swap the iframe and restart playback; a change
  // applies from the next title or episode. Nothing is pinned until it's known
  // which player this user gets.
  const playbackKey = `${mediaKey}-${selectedSeason}-${selectedEpisode}`;
  if (playerResolved && pinnedPlayer?.key !== playbackKey) setPinnedPlayer({ key: playbackKey, player });
  const activePlayer = pinnedPlayer?.key === playbackKey ? pinnedPlayer.player : null;

  return (
    <div className="space-y-12">
      {/* Player Section */}
      <div ref={playerRef}>
        {/* Episode bar: season/episode only change what the platform's own
            player shows (embed mode); trailers are per show */}
        {mediaType === 'tv' && activePlayer?.mode === 'embed' && (
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <span className="text-gray-900 dark:text-white font-semibold">{title}</span>
              {' · '}Season {selectedSeason} · Episode {selectedEpisode}
              {currentEpisode && (
                <span className="text-gray-400 dark:text-gray-500"> — {currentEpisode.name}</span>
              )}
            </p>
            {!isLastEpisode && (
              <button
                onClick={handleNextEpisode}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white transition-colors"
              >
                Next Episode ▶▶
              </button>
            )}
            {isLastEpisode && nextSeason && (
              <button
                onClick={handleNextSeason}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-green-200 dark:bg-green-800 hover:bg-green-300 dark:hover:bg-green-700 text-green-900 dark:text-white transition-colors"
              >
                Next Season ▶▶
              </button>
            )}
            {isLastEpisode && !nextSeason && (
              <span className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-gray-700 text-gray-400 cursor-default">
                Last Episode
              </span>
            )}
          </div>
        )}

        {/* Full width, but never taller than the window: capped so the whole
            16:9 player fits on wide desktop screens */}
        <div className="aspect-video w-full max-w-[calc((100vh-9rem)*16/9)] mx-auto">
          {activePlayer ? (
            <PlayerView
              player={activePlayer}
              title={title ?? ''}
              mediaType={mediaType}
              imdbId={imdbId ?? null}
              season={selectedSeason}
              episode={selectedEpisode}
              videos={details.videos?.results}
              backdropPath={details.backdrop_path}
            />
          ) : (
            <div className="w-full h-full rounded-lg shadow-lg bg-gray-200 dark:bg-gray-800 animate-pulse" />
          )}
        </div>
      </div>

      {/* Details Section */}
      <div className="flex flex-col md:flex-row gap-8">
        {/* Poster: hidden on phones. Fixed width, so it keeps a sensible size next to the details at
            every window width instead of shrinking with the page */}
        <div className="hidden md:block md:w-64 lg:w-72 shrink-0">
          <img
            src={details.poster_path ? imageUrl(details.poster_path) : 'https://picsum.photos/500/750'}
            alt={title}
            className="w-full rounded-lg shadow-md"
          />
        </div>
        <div className="w-full md:flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-4xl font-bold">{title} ({year})</h1>
            <button
              onClick={() => isInWatchlist(details.id)
                ? removeFromWatchlist(details.id)
                : addToWatchlist({ id: details.id, media_type: mediaType })
              }
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors mt-1
                ${isInWatchlist(details.id)
                  ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-white hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-400'
                }`}
            >
              {isInWatchlist(details.id) ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Watchlisted
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add to Watchlist
                </>
              )}
            </button>
          </div>
          <div className="flex items-center gap-4 mt-2 text-gray-400">
            <span>{details.genres.map(g => g.name).join(', ')}</span>
            <span>&bull;</span>
            <span>⭐ {details.vote_average.toFixed(1)} / 10</span>
          </div>
          <WhereToWatch mediaType={mediaType} id={details.id} className="mt-4" />
          <p className="mt-6 text-lg leading-relaxed">{details.overview}</p>

          {details.credits.cast.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4">Cast</h2>
            <div className="flex overflow-x-auto space-x-4 pb-3 scrollbar-thin">
              {details.credits.cast.slice(0, 10).map((actor: CastMember) => (
                <div key={actor.id} className="shrink-0 text-center w-24">
                  <img
                    src={actor.profile_path ? imageUrl(actor.profile_path) : 'https://picsum.photos/200/300'}
                    alt={actor.name}
                    className="w-20 h-20 mx-auto rounded-full object-cover"
                  />
                  <p className="mt-2 text-sm font-semibold">{actor.name}</p>
                  <p className="text-xs text-gray-400">{actor.character}</p>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Episodes Section for TV */}
      {mediaType === 'tv' && details.seasons && details.seasons.length > 0 && (
        <div>
          <SeasonSelector
            seasons={details.seasons}
            selectedSeason={selectedSeason}
            onSeasonChange={handleSeasonChange}
          />
          <EpisodeList
            episodes={episodes}
            selectedEpisode={selectedEpisode}
            onEpisodeSelect={(ep) => { setSelectedEpisode(ep); scrollToPlayer(); }}
          />
        </div>
      )}

      {/* Recommendations Section */}
      <div>
        <h2 className="text-3xl font-bold mb-6">Recommendations</h2>
        {recommendations.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
              {recommendations.map((rec, index) => {
                const mediaWithMediaType = { ...rec, media_type: rec.media_type || mediaType };
                const key = `${mediaWithMediaType.media_type}-${rec.id}`;
                if (recommendations.length === index + 1) {
                  return <div ref={lastElementRef} key={key}><MovieCard media={mediaWithMediaType} /></div>;
                }
                return <MovieCard key={key} media={mediaWithMediaType} />;
              })}
            </div>
            {recIsLoading && <Spinner />}
          </>
        ) : (
          <p>No recommendations available.</p>
        )}
      </div>
    </div>
  );
};

export default ClientPlayer;
