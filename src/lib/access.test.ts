import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./supabase', () => ({
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) } },
}));

import { requestAccess, sendDecision, DecisionError } from './access';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('requestAccess', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the user token and returns the server status', async () => {
    fetchMock.mockResolvedValue(reply(200, { status: 'pending' }));
    expect(await requestAccess()).toBe('pending');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/functions/v1/request-access');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('shows the blocked state', async () => {
    fetchMock.mockResolvedValue(reply(200, { status: 'blocked' }));
    expect(await requestAccess()).toBe('blocked');
  });

  it('fails open when the function is missing or unreachable (the server still enforces)', async () => {
    fetchMock.mockResolvedValue(reply(404, {}));
    expect(await requestAccess()).toBe('approved');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await requestAccess()).toBe('approved');
    fetchMock.mockResolvedValue(reply(200, { status: 'weird' }));
    expect(await requestAccess()).toBe('approved');
  });
});

describe('sendDecision', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('previews without confirm and applies with confirm, without a user token', async () => {
    fetchMock.mockImplementation(async () => reply(200, { ok: true, decision: 'approve', email: 'a@b.com' }));
    expect(await sendDecision('tok', false)).toEqual({ decision: 'approve', email: 'a@b.com' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'tok', confirm: false });
    await sendDecision('tok', true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: 'tok', confirm: true });
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('turns server and network failures into a readable DecisionError', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'This link is invalid or has expired.', code: 'invalid_token' }));
    await expect(sendDecision('bad', false)).rejects.toThrow('invalid or has expired');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(sendDecision('bad', false)).rejects.toBeInstanceOf(DecisionError);
  });
});
