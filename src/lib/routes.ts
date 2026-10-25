// Tiny URL <-> view mapping. No router dependency: the app has four views and
// one active chat, so history.pushState plus these two pure functions is enough.
export type Route =
  | { kind: 'chat'; conversationId: string | null }
  | { kind: 'files' }
  | { kind: 'memory' }
  | { kind: 'project'; id: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function pathFor(route: Route): string {
  switch (route.kind) {
    case 'files': return '/files';
    case 'memory': return '/memory';
    case 'project': return `/p/${route.id}`;
    default: return route.conversationId ? `/c/${route.conversationId}` : '/';
  }
}

export function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'files' && parts.length === 1) return { kind: 'files' };
  if (parts[0] === 'memory' && parts.length === 1) return { kind: 'memory' };
  if (parts[0] === 'p' && parts.length === 2 && ID.test(parts[1])) return { kind: 'project', id: parts[1] };
  if (parts[0] === 'c' && parts.length === 2 && ID.test(parts[1])) return { kind: 'chat', conversationId: parts[1] };
  return { kind: 'chat', conversationId: null };
}
