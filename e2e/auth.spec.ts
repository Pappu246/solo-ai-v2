/**
 * Sign-in through the real auth-js client against the mocked GoTrue endpoints,
 * and the RLS boundary as seen from the browser: a session for another user
 * sees none of the seeded data.
 */
import { test, expect } from './support/fixtures';
import { PASSWORD, USER, OTHER_USER, SUPABASE_URL, makeAccessToken, seedConversation } from './support/mockBackend';

test.describe('sign in', () => {
  test.use({ backendOptions: { signedIn: false, conversations: [seedConversation('c1', 'My private chat', '2026-01-01T00:00:00.000Z')] } });

  test('wrong password shows a friendly error; correct one loads the user’s chats', async ({ page, app, backend }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Email').fill(USER.email);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(app.row('My private chat')).toBeVisible();
    const token = backend.log.find(r => r.url.startsWith('/auth/v1/token'))!;
    expect(token.url).toContain('grant_type=password');
    // Every authenticated call after sign-in carries the bearer token in a header.
    const rest = backend.log.filter(r => r.url.startsWith('/rest/v1/'));
    expect(rest.length).toBeGreaterThan(0);
    for (const r of rest) { expect(r.headers['authorization']).toMatch(/^Bearer /); expect(r.url).not.toMatch(/apikey=|token=/); }
  });
});

test.describe('another user', () => {
  test.use({ backendOptions: { signedIn: false, conversations: [seedConversation('c1', 'Alice only', '2026-01-01T00:00:00.000Z')] } });

  test('sees no rows that belong to someone else, and their writes match nothing', async ({ page, app, backend }) => {
    // Boot with a persisted session for OTHER_USER.
    const key = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    const session = { access_token: makeAccessToken(OTHER_USER), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r', user: { id: OTHER_USER.id, email: OTHER_USER.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' } };
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)] as const);
    await app.open();
    await expect(app.chats.getByText(/No chats yet/)).toBeVisible();
    await expect(app.chats.getByText('Alice only')).toHaveCount(0);

    // Even a hand-crafted request from this session cannot touch Alice's row.
    const result = await page.evaluate(async ([url, token]) => {
      const res = await fetch(`${url}/rest/v1/conversations?id=eq.c1`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, apikey: 'sb_publishable_e2e_mock_key', 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ title: 'hijacked' }) });
      return { status: res.status, body: await res.json() };
    }, [SUPABASE_URL, makeAccessToken(OTHER_USER)] as const);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]); // 0 rows matched — that is what RLS looks like over PostgREST
    expect(backend.tables.conversations[0].title).toBe('Alice only');
  });
});
