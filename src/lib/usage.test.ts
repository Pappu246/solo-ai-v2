import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { fetchUsageToday } from './usage';

describe('fetchUsageToday', () => {
  beforeEach(() => { rpc.mockReset(); });

  it('maps the daily counters and treats missing scopes as zero', async () => {
    rpc.mockResolvedValue({ data: [{ scope: 'chat_day', used: '12' }], error: null });
    expect(await fetchUsageToday()).toEqual({ chats: 12, imageSearches: 0 });
    expect(rpc).toHaveBeenCalledWith('my_usage');
  });

  it('returns null instead of throwing when the call fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await fetchUsageToday()).toBeNull();
    rpc.mockRejectedValue(new Error('offline'));
    expect(await fetchUsageToday()).toBeNull();
  });
});
