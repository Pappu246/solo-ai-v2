import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

/** True when the browser-safe Supabase configuration is present. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export const CHAT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/chat`;

function createSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    // createClient throws on an empty URL. Use a syntactically valid placeholder
    // so the app can render a setup screen instead of a blank page. No network
    // call is ever made with this client because the UI gates on
    // `isSupabaseConfigured`.
    return createClient('https://placeholder.invalid', 'placeholder', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export const supabase = createSupabase();
