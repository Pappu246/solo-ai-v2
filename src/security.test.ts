import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : [p];
  });

describe('secret-leak regression', () => {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'api'))].filter(f => /\.(ts|tsx|js)$/.test(f) && !/\.test\./.test(f));
  const patterns: [string, RegExp][] = [
    ['service-role key', /service_role/i],
    ['OpenAI-style secret key', /\bsk-[A-Za-z0-9_-]{20,}/],
    ['Tavily key', /\btvly-[A-Za-z0-9_-]{10,}/],
    ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ];
  it.each(patterns)('browser/API code contains no %s', (_name, re) => {
    const hits = files.filter(f => re.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('security headers (vercel.json)', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
  const h = Object.fromEntries(cfg.headers[0].headers.map(x => [x.key, x.value]));
  const csp = h['Content-Security-Policy'];
  it('sets the baseline headers', () => {
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBeTruthy();
    expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(h['Permissions-Policy']).toMatch(/geolocation=\(\)/);
  });
  it('has a strict CSP', () => {
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(/script-src ([^;]+)/.exec(csp)?.[1]).not.toMatch(/unsafe-inline/);
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? '';
    expect(connect).not.toMatch(/(^|\s)\*(\s|$)|https:(\s|$)/);
  });
});

describe('database isolation (migrations)', () => {
  const sql = readdirSync(join(root, 'supabase/migrations')).sort().map(f => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
  const tables = [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/gi)].map(m => m[1]).filter(t => !['users'].includes(t));
  it.each([...new Set(tables)])('table %s has row level security enabled', table => {
    expect(sql).toMatch(new RegExp(`alter table (?:if exists )?(?:only )?(?:public\\.)?${table}\\s+enable row level security`, 'i'));
  });
  it('rows can only point at parents the same user owns', () => {
    expect(sql).toMatch(/enforce_parent_ownership/);
    expect(sql).toMatch(/revoke all on function public\.enforce_parent_ownership\(\) from public, anon, authenticated/);
  });
  it('never revokes consume_usage from the server role', () => {
    expect(sql).not.toMatch(/revoke[^;]*execute[^;]*consume_usage[^;]*service_role/i);
  });
});
