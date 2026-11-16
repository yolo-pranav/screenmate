import { currentSupabase } from './supabase';
import type { ProgressEntry } from '@/hooks/useProgress';

// Thin data-access layer for the two sync tables. Sync is best-effort on top
// of localStorage, never a hard dependency: fetches return null on failure
// (callers must NOT treat that as "no remote data"), mutations report success
// so callers can keep retry state (pending-delete tombstones).

export interface RemoteWatchlistRow {
  media_id: number;
  media_type: 'movie' | 'tv';
  added_at: string;
}

export interface RemoteProgressRow {
  media_id: number;
  media_type: 'movie' | 'tv';
  season: number | null;
  episode: number | null;
  updated_at: string;
}

export const fetchRemoteWatchlist = async (): Promise<RemoteWatchlistRow[] | null> => {
  const supabase = currentSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('watchlist_items').select('media_id, media_type, added_at');
  if (error) { console.error('Failed to fetch remote watchlist', error); return null; }
  return data ?? [];
};

export const upsertWatchlistItems = async (
  userId: string,
  items: { media_id: number; media_type: 'movie' | 'tv' }[]
): Promise<boolean> => {
  const supabase = currentSupabase();
  if (!supabase || items.length === 0) return !!supabase;
  const rows = items.map(i => ({ user_id: userId, media_id: i.media_id, media_type: i.media_type }));
  const { error } = await supabase.from('watchlist_items').upsert(rows);
  if (error) console.error('Failed to upsert watchlist items', error);
  return !error;
};

export const deleteWatchlistItem = async (userId: string, mediaId: number, mediaType: 'movie' | 'tv'): Promise<boolean> => {
  const supabase = currentSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from('watchlist_items')
    .delete()
    .match({ user_id: userId, media_id: mediaId, media_type: mediaType });
  if (error) console.error('Failed to delete watchlist item', error);
  return !error;
};

export const fetchRemoteProgress = async (): Promise<RemoteProgressRow[] | null> => {
  const supabase = currentSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('watch_progress')
    .select('media_id, media_type, season, episode, updated_at');
  if (error) { console.error('Failed to fetch remote progress', error); return null; }
  return data ?? [];
};

export const upsertProgressEntries = async (
  userId: string,
  entries: { mediaId: number; entry: ProgressEntry }[]
): Promise<boolean> => {
  const supabase = currentSupabase();
  if (!supabase || entries.length === 0) return !!supabase;
  const rows = entries.map(({ mediaId, entry }) => ({
    user_id: userId,
    media_id: mediaId,
    media_type: entry.media_type,
    season: entry.season ?? null,
    episode: entry.episode ?? null,
    updated_at: new Date(entry.updatedAt ?? Date.now()).toISOString(),
  }));
  const { error } = await supabase.from('watch_progress').upsert(rows);
  if (error) console.error('Failed to upsert progress', error);
  return !error;
};

export const deleteProgressEntry = async (userId: string, mediaId: number, mediaType: 'movie' | 'tv'): Promise<boolean> => {
  const supabase = currentSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from('watch_progress')
    .delete()
    .match({ user_id: userId, media_id: mediaId, media_type: mediaType });
  if (error) console.error('Failed to delete progress entry', error);
  return !error;
};
