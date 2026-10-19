/**
 * Approval-based access (client side).
 *
 * The server decides: `request-access` returns the caller's status and, for a
 * first-time non-owner, emails the owner. When the function is missing (older
 * deployment, tests, demo mode) we fail OPEN here — the AI functions enforce
 * access on the server regardless, so this only affects which screen is shown.
 */
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase';

export type AccessStatus = 'approved' | 'pending' | 'blocked';

async function post(path: string, body: unknown, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SUPABASE_PUBLISHABLE_KEY) headers.apikey = SUPABASE_PUBLISHABLE_KEY;
  if (withAuth) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('no session');
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

export async function requestAccess(): Promise<AccessStatus> {
  try {
    const res = await post('request-access', {}, true);
    if (!res.ok) return 'approved';
    const data = await res.json() as { status?: unknown };
    return data.status === 'pending' || data.status === 'blocked' ? data.status : 'approved';
  } catch {
    return 'approved';
  }
}

export interface DecisionPreview { decision: 'approve' | 'reject'; email: string }

export class DecisionError extends Error {}

/** Owner-side: look at what a link would do (`confirm: false`) or apply it (`confirm: true`). */
export async function sendDecision(token: string, confirm: boolean): Promise<DecisionPreview> {
  let res: Response;
  try { res = await post('access-approve', { token, confirm }, false); }
  catch { throw new DecisionError('Could not reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({})) as { error?: string; decision?: 'approve' | 'reject'; email?: string };
  if (!res.ok || !data.decision) throw new DecisionError(data.error || 'This link is invalid or has expired.');
  return { decision: data.decision, email: data.email ?? '' };
}
