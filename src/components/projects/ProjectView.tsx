import { useMemo, useState } from 'react';
import { SquarePen, Settings2, Archive, ArchiveRestore, Trash2, MessageSquare, FileText, Brain, Plus, MoreHorizontal } from 'lucide-react';
import type { Conversation, KnowledgeFile, Memory, Project } from '../../types';
import { MEMORY_TYPES } from '../../types';
import type { KnowledgeController } from '../../hooks/useKnowledge';
import { FileList } from '../knowledge/FileList';
import { UploadDropzone } from '../knowledge/UploadDropzone';
import { Button, ConfirmDialog, IconButton, useToast } from '../ui';
import { toFriendlyError } from '../../lib/errors';
import { cn } from '../../lib/cn';

interface Props {
  project: Project;
  conversations: Conversation[];
  memories: Memory[];
  knowledge: KnowledgeController;
  onNewChat: () => void;
  onOpenConversation: (c: Conversation) => void;
  onOpenFile: (f: KnowledgeFile) => void;
  onEdit: () => void;
  onArchive: (archived: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenMemory: () => void;
}

type Tab = 'chats' | 'files' | 'memory';

/** Project home: its chats, files and memories, plus settings and lifecycle actions. */
export function ProjectView({ project, conversations, memories, knowledge, onNewChat, onOpenConversation, onOpenFile, onEdit, onArchive, onDelete, onOpenMemory }: Props) {
  const [tab, setTab] = useState<Tab>('chats');
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const projectChats = useMemo(() => conversations.filter(c => c.project_id === project.id && !c.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [conversations, project.id]);
  const projectFiles = useMemo(() => knowledge.files.filter(f => f.project_id === project.id), [knowledge.files, project.id]);
  const projectMemories = useMemo(() => memories.filter(m => m.project_id === project.id), [memories, project.id]);

  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      const outcome = await knowledge.uploadFiles(files, { projectId: project.id });
      const ready = outcome.files.filter(f => f.status === 'ready').length;
      const failed = outcome.files.filter(f => f.status === 'failed').length;
      if (ready) toast({ title: ready === 1 ? 'File added to project' : `${ready} files added to project`, tone: 'success' });
      if (failed) toast({ title: failed === 1 ? 'A file could not be processed' : `${failed} files could not be processed`, description: 'Open the file to see why.', tone: 'error' });
      for (const reason of outcome.rejected) toast({ title: 'File skipped', description: reason, tone: 'error' });
    } finally { setUploading(false); }
  };

  const archive = async () => {
    try { await onArchive(!project.archived); toast({ title: project.archived ? 'Project restored' : 'Project archived', tone: 'success' }); }
    catch (e) { const err = toFriendlyError(e); toast({ title: err.title, description: err.message, tone: 'error' }); }
  };

  const tabs: { id: Tab; label: string; icon: typeof MessageSquare; count: number }[] = [
    { id: 'chats', label: 'Chats', icon: MessageSquare, count: projectChats.length },
    { id: 'files', label: 'Files', icon: FileText, count: projectFiles.length },
    { id: 'memory', label: 'Memory', icon: Brain, count: projectMemories.length },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <header className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-fg truncate">{project.name}</h2>
              {project.archived && <span className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle border border-border rounded-md px-1.5 py-0.5">Archived</span>}
            </div>
            {project.description && <p className="text-sm text-fg-muted mt-1">{project.description}</p>}
            {project.instructions ? (
              <p className="text-xs text-fg-subtle mt-2 line-clamp-2"><span className="font-medium text-fg-muted">Instructions:</span> {project.instructions}</p>
            ) : (
              <button type="button" onClick={onEdit} className="text-xs text-accent hover:underline mt-2">Add instructions so Solo knows how to help in this project</button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!project.archived && (
              <Button variant="primary" size="sm" leftIcon={<SquarePen className="w-3.5 h-3.5" />} onClick={onNewChat}>New chat</Button>
            )}
            <div className="relative">
              <IconButton label="Project options" onClick={() => setMenuOpen(v => !v)} aria-haspopup="menu" aria-expanded={menuOpen}><MoreHorizontal className="w-4 h-4" /></IconButton>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div role="menu" className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-border bg-surface shadow-lg p-1 z-50 animate-scale-in">
                    <MenuItem icon={<Settings2 className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); onEdit(); }}>Settings</MenuItem>
                    <MenuItem icon={project.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} onClick={() => { setMenuOpen(false); archive(); }}>
                      {project.archived ? 'Restore' : 'Archive'}
                    </MenuItem>
                    <div className="my-1 border-t border-border" />
                    <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} danger onClick={() => { setMenuOpen(false); setConfirm('delete'); }}>Delete project</MenuItem>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div role="tablist" aria-label="Project sections" className="flex gap-1 border-b border-border">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn('inline-flex items-center gap-1.5 h-9 px-3 -mb-px border-b-2 text-sm transition-colors', tab === t.id ? 'border-fg text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg')}
            >
              <t.icon className="w-3.5 h-3.5" aria-hidden />
              {t.label}
              <span className="text-[11px] tabular-nums text-fg-subtle">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'chats' && (
            projectChats.length === 0 ? (
              <EmptyPanel icon={MessageSquare} title="No chats in this project yet." action={!project.archived ? <Button size="sm" variant="secondary" onClick={onNewChat}>Start the first chat</Button> : undefined} />
            ) : (
              <ul className="rounded-xl border border-border bg-surface divide-y divide-border" aria-label="Project chats">
                {projectChats.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpenConversation(c)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/70 transition-colors">
                      <MessageSquare className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0 text-sm text-fg truncate">{c.title}</span>
                      <time dateTime={c.updated_at} className="text-[11px] text-fg-subtle shrink-0">{new Date(c.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'files' && (
            <div className="space-y-3">
              {!project.archived && <UploadDropzone onFiles={upload} disabled={uploading} compact hint={`Added to “${project.name}” and available in all of its chats`} />}
              <div className="rounded-xl border border-border bg-surface px-2">
                <FileList files={projectFiles} onOpen={onOpenFile} showProject={false} emptyMessage="No files in this project yet." />
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div className="space-y-3">
              {projectMemories.length === 0 ? (
                <EmptyPanel icon={Brain} title="No project memories yet." description="Project memories apply only to chats inside this project." action={<Button size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={onOpenMemory}>Add memory</Button>} />
              ) : (
                <>
                  <ul className="rounded-xl border border-border bg-surface divide-y divide-border" aria-label="Project memories">
                    {projectMemories.map(m => (
                      <li key={m.id} className="px-4 py-3">
                        <p className="text-sm text-fg whitespace-pre-wrap break-words">{m.content}</p>
                        <p className="text-[11px] text-fg-subtle mt-1">{MEMORY_TYPES[m.type].label} · importance {m.importance}/5</p>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" variant="ghost" onClick={onOpenMemory}>Manage in Memory</Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this project?"
        description={`“${project.name}” will be deleted. Its ${projectChats.length} chat${projectChats.length === 1 ? '' : 's'} and ${projectFiles.length} file${projectFiles.length === 1 ? '' : 's'} are kept and simply leave the project; its ${projectMemories.length} project ${projectMemories.length === 1 ? 'memory is' : 'memories are'} removed.`}
        confirmLabel="Delete project"
        destructive
        onConfirm={async () => {
          try { await onDelete(); setConfirm(null); }
          catch (e) { setConfirm(null); const err = toFriendlyError(e); toast({ title: err.title, description: err.message, tone: 'error' }); }
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof MessageSquare; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface flex flex-col items-center gap-2 py-10 px-6 text-center">
      <Icon className="w-5 h-5 text-fg-subtle" aria-hidden />
      <p className="text-sm text-fg">{title}</p>
      {description && <p className="text-xs text-fg-muted max-w-sm">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn('w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-sm text-left transition-colors', danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-surface-2')}>
      {icon}{children}
    </button>
  );
}
