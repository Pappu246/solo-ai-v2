import { describe, it, expect } from 'vitest';
import { pathFor, parsePath } from './routes';

describe('routes', () => {
  it('round-trips every route', () => {
    for (const r of [
      { kind: 'chat', conversationId: null },
      { kind: 'chat', conversationId: 'abc-123' },
      { kind: 'files' },
      { kind: 'memory' },
      { kind: 'project', id: 'p_1' },
    ] as const) expect(parsePath(pathFor(r))).toEqual(r);
  });
  it('falls back to a new chat for unknown or malformed paths', () => {
    for (const p of ['/nope', '/c/', '/c/a/b', '/c/<script>', '/files/x', '']) {
      expect(parsePath(p)).toEqual({ kind: 'chat', conversationId: null });
    }
  });
});
