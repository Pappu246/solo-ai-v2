import { useState, useMemo, useEffect, useRef } from 'react';
import {
  SquarePen, Search, Settings, Pin, PinOff, Pencil, Archive, ArchiveRestore, Trash2,
  MoreHorizontal, X, PanelLeftClose, ChevronDown, ChevronRight, FolderKanban, FileText, Brain, Plus, FolderInput,
} from 'lucide-react';
import type { Conversation, Project } from '../../types';
import type { LoadStatus } from '../../hooks/useChat';
import { IconButton, Kbd, Logo, Wordmark, modKey } from '../ui';
import { cn } from '../../lib/cn';
import { useIsDesktop } from '../../hooks/useMediaQuery';

interface SidebarProps {
  conversations: Conversation[];
  status: LoadStatus;
  activeId: string | null;
  onSelect: (c: Conversation) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDeleteRequest: (c: Conversation) => void;
  onOpenSettings: () => void;
  onRetryLoad: () => void;
  /** Mobile drawer open state. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Desktop collapsed state. */
  collapsed: boolean;
  onCollapse: () => void;
  userEmail?: string;
  // ── Phase 2 ──
  projects?: Project[];
  /** Which top-level view is showing (drives the active state of Files / Memory / project rows). */
  view?: SidebarView;
  onOpenProject?: (project: Project) => void;
  onNewProject?: () => void;
  onOpenFiles?: () => void;
  onOpenMemory?: () => void;
  /** Open the global search palette (⌘K). */
  onOpenSearch?: () => void;
  /** Move a chat into a project (null = remove from its project). */
  onMoveToProject?: (conversationId: string, projectId: string | null) => void;
}

export type SidebarView = { kind: 'chat' } | { kind: 'files' } | { kind: 'memory' } | { kind: 'project'; id: string };

export function Sidebar({
  conversations, status, activeId, onSelect, onNewChat, onRename, onPin, onArchive, onDeleteRequest,
  onOpenSettings, onRetryLoad, mobileOpen, onCloseMobile, collapsed, onCollapse, userEmail,
  projects = [], view = { kind: 'chat' }, onOpenProject, onNewProject, onOpenFiles, onOpenMemory, onOpenSearch, onMoveToProject,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showProjects, setShowProjects] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const isDesktop = useIsDesktop();

  // Expose a way for the ⌘K shortcut to focus search.
  useEffect(() => {
    const handler = () => searchRef.current?.focus();
    window.addEventListener('solo:focus-search', handler);
    return () => window.removeEventListener('solo:focus-search', handler);
  }, []);

  const activeProjects = projects.filter(p => !p.archived);
  const projectName = (id: string | null | undefined) => (id ? projects.find(p => p.id === id)?.name ?? null : null);

  const { pinned, recent, archived } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: Conversation) => !q || c.title.toLowerCase().includes(q);
    const visible = conversations.filter(match);
    return {
      pinned: visible.filter(c => c.pinned && !c.archived),
      recent: visible.filter(c => !c.pinned && !c.archived),
      archived: visible.filter(c => c.archived),
    };
  }, [conversations, query]);

  const itemProps = { activeId, onSelect: (c: Conversation) => { onSelect(c); onCloseMobile(); }, onRename, onPin, onArchive, onDeleteRequest, projects: activeProjects, onMoveToProject, projectName };

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-3 shrink-0">
        <div className="flex items-center gap-2 pl-1">
          <Logo size={26} />
          <Wordmark className="text-[15px]" />
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Collapse sidebar" size="sm" onClick={onCollapse} className="hidden md:inline-flex">
            <PanelLeftClose className="w-4 h-4" />
          </IconButton>
          <IconButton label="Close menu" size="sm" onClick={onCloseMobile} className="md:hidden">
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Primary actions */}
      <div className="px-3 space-y-1">
        <button
          type="button"
          onClick={() => { onNewChat(); onCloseMobile(); }}
          className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm font-medium text-fg hover:bg-surface-2 transition-colors"
        >
          <SquarePen className="w-4 h-4 text-fg-muted" />
          <span className="flex-1 text-left">New chat</span>
          <span className="hidden md:inline-flex items-center gap-0.5"><Kbd>{modKey}</Kbd><Kbd>⇧</Kbd><Kbd>O</Kbd></span>
        </button>
        <label className="relative block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Filter chats"
            aria-label="Filter chats"
            className="w-full h-9 pl-8 pr-14 rounded-lg bg-transparent text-sm text-fg placeholder:text-fg-subtle hover:bg-surface-2 focus:bg-surface-2 outline-none transition-colors"
          />
          {!query && !onOpenSearch && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 pointer-events-none"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>}
        </label>
        {onOpenSearch && (
          <button
            type="button"
            onClick={() => { onOpenSearch(); onCloseMobile(); }}
            className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search everything</span>
            <span className="hidden md:inline-flex items-center gap-0.5"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
          </button>
        )}
        {(onOpenFiles || onOpenMemory) && (
          <div className="pt-1">
            {onOpenFiles && (
              <NavButton icon={<FileText className="w-4 h-4" />} active={view.kind === 'files'} onClick={() => { onOpenFiles(); onCloseMobile(); }}>Files</NavButton>
            )}
            {onOpenMemory && (
              <NavButton icon={<Brain className="w-4 h-4" />} active={view.kind === 'memory'} onClick={() => { onOpenMemory(); onCloseMobile(); }}>Memory</NavButton>
            )}
          </div>
        )}
      </div>

      {/* Projects */}
      {onOpenProject && (
        <div className="px-3 mt-3">
          <div className="flex items-center justify-between pr-1">
            <button
              type="button"
              onClick={() => setShowProjects(v => !v)}
              aria-expanded={showProjects}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-muted"
            >
              {showProjects ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Projects
            </button>
            {onNewProject && (
              <IconButton label="New project" size="sm" onClick={() => { onNewProject(); onCloseMobile(); }} className="w-6 h-6"><Plus className="w-3.5 h-3.5" /></IconButton>
            )}
          </div>
          {showProjects && (
            <ul className="space-y-0.5 mt-0.5" aria-label="Projects">
              {activeProjects.length === 0 && (
                <li className="px-2.5 py-1.5 text-xs text-fg-subtle">
                  {onNewProject ? <button type="button" onClick={() => { onNewProject(); onCloseMobile(); }} className="hover:text-fg-muted">Create a project to group chats and files.</button> : 'No projects yet.'}
                </li>
              )}
              {activeProjects.slice(0, 8).map(p => (
                <li key={p.id}>
                  <NavButton icon={<FolderKanban className="w-4 h-4" />} active={view.kind === 'project' && view.id === p.id} onClick={() => { onOpenProject(p); onCloseMobile(); }}>{p.name}</NavButton>
                </li>
              ))}
              {activeProjects.length > 8 && <li className="px-2.5 py-1 text-[11px] text-fg-subtle">{activeProjects.length - 8} more — use search to find them.</li>}
            </ul>
          )}
        </div>
      )}

      {/* Conversation list */}
      <nav aria-label="Chats" className="flex-1 min-h-0 overflow-y-auto px-3 mt-3 pb-2">
        {onOpenProject && (pinned.length + recent.length + archived.length > 0) && <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Chats</p>}
        {status === 'loading' && conversations.length === 0 && (
          <ul className="space-y-1" aria-label="Loading chats">
            {[0, 1, 2, 3, 4].map(i => <li key={i} className="h-8 rounded-lg bg-surface-2 animate-pulse" style={{ opacity: 1 - i * 0.15 }} />)}
          </ul>
        )}
        {status === 'error' && (
          <div className="px-2 py-4 text-center">
            <p className="text-xs text-fg-muted">Couldn’t load your chats.</p>
            <button type="button" onClick={onRetryLoad} className="mt-1.5 text-xs font-medium text-accent hover:underline">Retry</button>
          </div>
        )}
        {status === 'ready' && conversations.length === 0 && (
          <p className="px-2 py-6 text-xs text-fg-subtle text-center">No chats yet. Start one above.</p>
        )}
        {status === 'ready' && conversations.length > 0 && pinned.length + recent.length + archived.length === 0 && (
          <p className="px-2 py-6 text-xs text-fg-subtle text-center">No chats match “{query}”.</p>
        )}

        {pinned.length > 0 && (
          <Section label="Pinned">
            {pinned.map(c => <ConversationItem key={c.id} conversation={c} {...itemProps} />)}
          </Section>
        )}
        {recent.length > 0 && (
          <Section label={pinned.length ? 'Recent' : undefined}>
            {recent.map(c => <ConversationItem key={c.id} conversation={c} {...itemProps} />)}
          </Section>
        )}
        {archived.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowArchived(v => !v)}
              aria-expanded={showArchived}
              className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-muted"
            >
              {showArchived ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Archived <span className="font-normal normal-case tracking-normal">({archived.length})</span>
            </button>
            {showArchived && <ul className="space-y-0.5 mt-1">{archived.map(c => <ConversationItem key={c.id} conversation={c} {...itemProps} />)}</ul>}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border shrink-0">
        <button
          type="button"
          onClick={() => { onOpenSettings(); onCloseMobile(); }}
          className="w-full flex items-center gap-2.5 h-10 px-2.5 rounded-lg hover:bg-surface-2 transition-colors text-left"
        >
          <span className="w-7 h-7 rounded-full bg-surface-3 text-fg-muted text-xs font-semibold flex items-center justify-center uppercase shrink-0">
            {userEmail?.[0] ?? '?'}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-fg truncate">{userEmail?.split('@')[0] ?? 'Account'}</span>
            <span className="block text-[11px] text-fg-subtle">Settings</span>
          </span>
          <Settings className="w-4 h-4 text-fg-subtle" />
        </button>
      </div>
    </div>
  );

  const hidden = isDesktop ? collapsed : !mobileOpen;

  return (
    <>
      {mobileOpen && !isDesktop && <div className="fixed inset-0 z-40 bg-overlay/50 animate-fade-in" onClick={onCloseMobile} aria-hidden />}
      <aside
        aria-label="Sidebar"
        aria-hidden={hidden}
        // `inert` keeps off-screen/collapsed content out of the tab order.
        {...({ inert: hidden ? '' : undefined } as Record<string, unknown>)}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[280px] bg-surface border-r border-border overflow-hidden transition-[transform,width] duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:z-auto md:translate-x-0 md:shrink-0',
          collapsed ? 'md:w-0 md:border-r-0' : 'md:w-[272px]',
        )}
      >
        <div className="w-[280px] md:w-[272px] h-full">{content}</div>
      </aside>
    </>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      {label && <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

interface ItemProps {
  conversation: Conversation;
  activeId: string | null;
  onSelect: (c: Conversation) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDeleteRequest: (c: Conversation) => void;
  projects?: Project[];
  onMoveToProject?: (conversationId: string, projectId: string | null) => void;
  projectName?: (id: string | null | undefined) => string | null;
}

function NavButton({ icon, active, onClick, children }: { icon: React.ReactNode; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('w-full flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-sm transition-colors text-left', active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-2/70')}
    >
      <span className="text-fg-muted shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function ConversationItem({ conversation: c, activeId, onSelect, onRename, onPin, onArchive, onDeleteRequest, projects = [], onMoveToProject, projectName }: ItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(c.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const isActive = activeId === c.id;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  useEffect(() => { if (!menuOpen) setMoveOpen(false); }, [menuOpen]);
  const currentProject = projectName?.(c.project_id) ?? null;

  const commitRename = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== c.title) onRename(c.id, draft);
    else setDraft(c.title);
  };

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraft(c.title); setRenaming(false); } }}
          aria-label="Rename chat"
          className="w-full h-8 px-2.5 rounded-lg bg-surface-2 border border-accent/50 text-sm text-fg outline-none"
        />
      </li>
    );
  }

  return (
    <li className={cn('group relative flex items-center rounded-lg', isActive ? 'bg-surface-2' : 'hover:bg-surface-2/70', menuOpen && 'bg-surface-2/70')}>
      <button
        type="button"
        onClick={() => onSelect(c)}
        aria-current={isActive ? 'page' : undefined}
        className={cn('flex-1 min-w-0 flex items-center gap-2 h-8 pl-2.5 pr-8 text-sm text-left transition-colors', isActive ? 'text-fg' : 'text-fg-muted hover:text-fg')}
      >
        {c.pinned && !c.archived && <Pin className="w-3 h-3 text-fg-subtle shrink-0" aria-label="Pinned" />}
        <span className="truncate">{c.title}</span>
        {currentProject && <FolderKanban className="w-3 h-3 text-fg-subtle shrink-0 ml-auto" aria-label={`In project ${currentProject}`} />}
      </button>

      <div ref={menuRef} className={cn('absolute right-1 top-1/2 -translate-y-1/2', menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
        <IconButton label={`Options for ${c.title}`} size="sm" onClick={() => setMenuOpen(v => !v)} aria-haspopup="menu" aria-expanded={menuOpen} className="w-6 h-6">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </IconButton>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-border bg-surface shadow-lg p-1 z-50 animate-scale-in">
            <MenuItem icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); setDraft(c.title); setRenaming(true); }}>Rename</MenuItem>
            {!c.archived && (
              <MenuItem icon={c.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); onPin(c.id, !c.pinned); }}>
                {c.pinned ? 'Unpin' : 'Pin'}
              </MenuItem>
            )}
            <MenuItem icon={c.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); onArchive(c.id, !c.archived); }}>
              {c.archived ? 'Unarchive' : 'Archive'}
            </MenuItem>
            {onMoveToProject && (projects.length > 0 || c.project_id) && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={moveOpen}
                  onClick={() => setMoveOpen(v => !v)}
                  className="w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-sm text-left text-fg hover:bg-surface-2 transition-colors"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                  <span className="flex-1">Move to project</span>
                  <ChevronRight className={cn('w-3 h-3 text-fg-subtle transition-transform', moveOpen && 'rotate-90')} />
                </button>
                {moveOpen && (
                  <div role="menu" aria-label="Choose a project" className="ml-3 pl-2 border-l border-border my-0.5 max-h-40 overflow-y-auto">
                    {c.project_id && <MenuItem icon={<X className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); onMoveToProject(c.id, null); }}>Remove from project</MenuItem>}
                    {projects.filter(p => p.id !== c.project_id).map(p => (
                      <MenuItem key={p.id} icon={<FolderKanban className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); onMoveToProject(c.id, p.id); }}>{p.name}</MenuItem>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="my-1 border-t border-border" />
            <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} danger onClick={() => { setMenuOpen(false); onDeleteRequest(c); }}>Delete</MenuItem>
          </div>
        )}
      </div>
    </li>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn('w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-sm text-left transition-colors', danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-surface-2')}
    >
      {icon}{children}
    </button>
  );
}
