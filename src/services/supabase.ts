import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig, AppConfig } from './config';

// Supabase credentials come from the remote config, which may arrive after
// startup (first launch) or never (offline). Null until then — every consumer
// must handle that case so the app keeps working purely from localStorage.

let client: SupabaseClient | null = null;
let clientKey: string | null = null;

// One client per url+key pair; a rotated key replaces (and disposes) the old
// one so two auth clients never fight over the same stored session
export const getSupabaseClient = (supabase: AppConfig['supabase']): SupabaseClient | null => {
  const key = supabase ? `${supabase.url}|${supabase.anonKey}` : null;
  if (clientKey === key) return client;
  client?.auth.dispose();
  client = supabase ? createClient(supabase.url, supabase.anonKey) : null;
  clientKey = key;
  return client;
};

// For non-React code: the client for the current config, if any
export const currentSupabase = (): SupabaseClient | null => getSupabaseClient(getConfig().supabase);
