import { supabase } from './supabase';

export interface UsageToday {
  chats: number;
  imageSearches: number;
}

/** Today's request counts for the signed-in user, or null when they cannot be read. */
export async function fetchUsageToday(): Promise<UsageToday | null> {
  try {
    const { data, error } = await supabase.rpc('my_usage');
    if (error || !Array.isArray(data)) return null;
    const used = (scope: string) => Number((data as Array<{ scope: string; used: unknown }>).find(r => r.scope === scope)?.used ?? 0) || 0;
    return { chats: used('chat_day'), imageSearches: used('image_day') };
  } catch {
    return null;
  }
}
