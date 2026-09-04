import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { Conversation, KnowledgeFile, Project, SearchResult, KnowledgeSource, Attachment } from './types';
import { useAuth } from './hooks/useAuth';
import { useChat, type ContextResolver } from './hooks/useChat';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjects, type ProjectInput } from './hooks/useProjects';
import { useMemories } from './hooks/useMemories';
import { useKnowledge } from './hooks/useKnowledge';
import { isSupabaseConfigured } from './lib/supabase';
import { retrieveKnowledge, selectMemories, buildChatContext } from './lib/knowledge/retriever';
import { toFriendlyError } from './lib/errors';
import { AuthScreen } from './components/auth/AuthScreen';
import { SetupScreen } from './components/auth/SetupScreen';
import { Sidebar, type SidebarView } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MessageList } from './components/chat/MessageList';
import { EmptyState } from './components/chat/EmptyState';
import { Composer, type ComposerHandle, type KnowledgeUploader } from './components/chat/Composer';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { FilesView } from './components/knowledge/FilesView';
import { FileDetailDialog } from './components/knowledge/FileDetailDialog';
import { FilePickerDialog } from './components/knowledge/FilePickerDialog';
import { MemoryView } from './components/memory/MemoryView';
import { MemoryEditor, type MemoryDraft } from './components/memory/MemoryEditor';
import { ProjectView } from './components/projects/ProjectView';
import { ProjectDialog } from './components/projects/ProjectDialog';
import { SearchPalette } from './components/search/SearchPalette';
import { ConfirmDialog, Logo, ToastProvider, useToast } from './components/ui';

const SIDEBAR_KEY = 'solo-ai-sidebar-collapsed';

export default function App() {
  if (!isSupabaseConfigured) return <SetupScreen />;
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { user, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { toast } = useToast();

  // ── Phase 2 data ───────────────────────────────────────────────────────────
  const projectsCtl = useProjects(user);
  const memoriesCtl = useMemories(user);
  const knowledge = useKnowledge(user);
  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projectsCtl.projects;
  const memoriesRef = useRef(memoriesCtl.memories);
  memoriesRef.current = memoriesCtl.memories;

  /**
   * Knowledge lookup that runs before each generation: the chat's project
   * instructions, applicable memories, and only the file excerpts relevant to
   * the question. Returns nothing when nothing applies.
   */
  const resolveContext = useCallback<ContextResolver>(async ({ conversation, query, attachments }) => {
    const project = conversation.project_id ? projectsRef.current.find(p => p.id === conversation.project_id) ?? null : null;
    const attachedIds = (attachments ?? []).map(a => a.file_id).filter((id): id is string => Boolean(id));
    const scoped = knowledge.filesForChat(conversation.id, conversation.project_id ?? null);
    const byId = new Map(scoped.map(f => [f.id, f]));
    for (const id of attachedIds) if (!byId.has(id)) { const f = knowledge.files.find(x => x.id === id); if (f) byId.set(id, f); }
    const { chunks, sources } = await retrieveKnowledge({ query, files: [...byId.values()], attachedFileIds: attachedIds });
    const memories = selectMemories(memoriesRef.current, conversation.project_id ?? null);
    return { context: buildChatContext({ project, memories, knowledge: chunks }), sources };
  }, [knowledge]);

  const pendingAttachRef = useRef<string[]>([]);
  const chat = useChat(user, {
    settings,
    resolveContext,
    onConversationCreated: conversation => {
      // Files attached before the chat existed now get linked to it.
      if (pendingAttachRef.current.length) { knowledge.attachToConversation(pendingAttachRef.current, conversation.id); pendingAttachRef.current = []; }
    },
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  const [view, setView] = useState<SidebarView>({ kind: 'chat' });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [fileDetail, setFileDetail] = useState<KnowledgeFile | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [rememberDraft, setRememberDraft] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ resolve: (files: KnowledgeFile[]) => void } | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Keep the open file dialog in sync with live status changes (uploading → ready…).
  const liveFileDetail = useMemo(() => (fileDetail ? knowledge.files.find(f => f.id === fileDetail.id) ?? fileDetail : null), [fileDetail, knowledge.files]);

  const toggleSidebar = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, []);

  // Surface non-chat errors (e.g. a failed rename) as toasts; chat errors render inline.
  const lastToastedError = useRef<unknown>(null);
  useEffect(() => {
    const err = chat.error;
    if (!err || err === lastToastedError.current) return;
    if ((chat.messages.length === 0 && !chat.activeConversation) || view.kind !== 'chat') {
      lastToastedError.current = err;
      toast({ title: err.title, description: err.message, tone: 'error' });
      chat.clearError();
    }
  }, [chat, toast, view.kind]);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const openConversation = useCallback((c: Conversation) => { setView({ kind: 'chat' }); chat.selectConversation(c); }, [chat]);
  const openConversationById = useCallback((id: string) => {
    const c = chat.conversations.find(x => x.id === id);
    if (c) openConversation(c); else toast({ title: 'Chat not found', description: 'It may have been deleted.', tone: 'error' });
  }, [chat.conversations, openConversation, toast]);
  const openProject = useCallback((p: Project) => { setView({ kind: 'project', id: p.id }); chat.setActiveProject(p.id); }, [chat]);
  const openProjectById = useCallback((id: string) => {
    const p = projectsCtl.projects.find(x => x.id === id);
    if (p) openProject(p); else toast({ title: 'Project not found', tone: 'error' });
  }, [projectsCtl.projects, openProject, toast]);
  const startNewChat = useCallback((projectId: string | null = null) => {
    setView({ kind: 'chat' });
    chat.startNewChat(projectId);
    composerRef.current?.focus();
  }, [chat]);
  const openFileById = useCallback((id: string) => {
    const f = knowledge.files.find(x => x.id === id);
    if (f) setFileDetail(f); else toast({ title: 'File not found', description: 'It may have been deleted.', tone: 'error' });
  }, [knowledge.files, toast]);

  const openSearchResult = useCallback((r: SearchResult) => {
    switch (r.kind) {
      case 'conversation': openConversationById(r.id); break;
      case 'message': if (r.conversation_id) openConversationById(r.conversation_id); break;
      case 'project': openProjectById(r.id); break;
      case 'file': openFileById(r.id); break;
      case 'memory': setView({ kind: 'memory' }); break;
    }
  }, [openConversationById, openProjectById, openFileById]);

  const shortcuts = useMemo(() => [
    { key: 'o', mod: true, shift: true, handler: () => startNewChat(view.kind === 'project' ? view.id : chat.activeProjectId) },
    { key: 'k', mod: true, handler: () => setSearchOpen(true) },
    { key: 'b', mod: true, handler: () => toggleSidebar(!sidebarCollapsed) },
    { key: ',', mod: true, handler: () => setSettingsOpen(true) },
    { key: 'Escape', handler: () => { if (chat.isGenerating) chat.stopGeneration(); }, allowInInputs: true },
  ], [chat, sidebarCollapsed, toggleSidebar, startNewChat, view]);
  useKeyboardShortcuts(shortcuts);

  const handleSignOut = useCallback(async () => {
    try { setSettingsOpen(false); await signOut(); }
    catch (e) { toast({ title: 'Could not sign out', description: (e as Error).message, tone: 'error' }); }
  }, [signOut, toast]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const title = pendingDelete.title;
    setPendingDelete(null);
    await chat.deleteConversation(pendingDelete.id);
    toast({ title: 'Chat deleted', description: title, tone: 'success' });
  }, [pendingDelete, chat, toast]);

  // ── Phase 2 actions ────────────────────────────────────────────────────────
  const withToast = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try { await fn(); if (success) toast({ title: success, tone: 'success' }); }
    catch (e) { const err = toFriendlyError(e); toast({ title: err.title, description: err.message, tone: 'error' }); throw e; }
  }, [toast]);

  const saveProject = useCallback(async (input: ProjectInput) => {
    if (projectDialog.project) {
      await withToast(() => projectsCtl.updateProject(projectDialog.project!.id, input), 'Project updated');
    } else {
      const created = await projectsCtl.createProject(input);
      toast({ title: 'Project created', description: created.name, tone: 'success' });
      openProject(created);
    }
    setProjectDialog({ open: false, project: null });
  }, [projectDialog.project, projectsCtl, withToast, toast, openProject]);

  const deleteProject = useCallback(async (p: Project) => {
    await withToast(() => projectsCtl.deleteProject(p.id), 'Project deleted');
    // Conversations/files lose their project link server-side (ON DELETE SET NULL); mirror locally.
    chat.conversations.filter(c => c.project_id === p.id).forEach(c => chat.moveConversation(c.id, null));
    knowledge.reload();
    memoriesCtl.reload();
    setView({ kind: 'chat' });
    chat.setActiveProject(null);
  }, [withToast, projectsCtl, chat, knowledge, memoriesCtl]);

  const saveRemembered = useCallback(async (draft: MemoryDraft) => {
    await withToast(() => memoriesCtl.addMemory({ ...draft, source: 'chat', source_conversation_id: chat.activeConversation?.id ?? null }), 'Saved to memory');
    setRememberDraft(null);
  }, [withToast, memoriesCtl, chat.activeConversation]);

  const knowledgeUploader = useMemo<KnowledgeUploader>(() => ({
    upload: async (files, onChange) => {
      const conversationId = chat.activeConversation?.id ?? null;
      const projectId = chat.activeConversation?.project_id ?? chat.activeProjectId ?? null;
      const outcome = await knowledge.uploadFiles(files, { conversationId, projectId, onChange });
      if (!conversationId) pendingAttachRef.current.push(...outcome.files.filter(f => f.status === 'ready').map(f => f.id));
      for (const reason of outcome.rejected) toast({ title: 'File skipped', description: reason, tone: 'error' });
      return outcome.files;
    },
    pickFromLibrary: () => new Promise<KnowledgeFile[]>(resolve => setPicker({ resolve })),
  }), [chat.activeConversation, chat.activeProjectId, knowledge, toast]);

  const sendMessage = useCallback((text: string, attachments?: Attachment[]) => {
    const ids = (attachments ?? []).map(a => a.file_id).filter((id): id is string => Boolean(id));
    if (ids.length) {
      if (chat.activeConversation) knowledge.attachToConversation(ids, chat.activeConversation.id);
      else pendingAttachRef.current.push(...ids);
    }
    return chat.sendMessage(text, attachments);
  }, [chat, knowledge]);

  const openSource = useCallback((s: KnowledgeSource) => openFileById(s.file_id), [openFileById]);

  if (authLoading) {
    return (
      <div className="h-screen bg-bg flex items-center justify-center" aria-busy="true" aria-label="Loading Solo AI">
        <Logo size={40} className="animate-pulse" />
      </div>
    );
  }

  if (!user) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;

  const hasMessages = chat.messages.length > 0 || chat.isGenerating || chat.messagesStatus === 'loading';
  const activeModelName = chat.selectedModel
    ? chat.availableModels.find(m => m.id === chat.selectedModel)?.name ?? chat.selectedModel
    : null;
  const activeProject = view.kind === 'project' ? projectsCtl.projects.find(p => p.id === view.id) ?? null : null;
  const chatProject = chat.activeConversation?.project_id
    ? projectsCtl.projects.find(p => p.id === chat.activeConversation!.project_id) ?? null
    : chat.activeProjectId ? projectsCtl.projects.find(p => p.id === chat.activeProjectId) ?? null : null;
  const topbarTitle = view.kind === 'files' ? 'Files' : view.kind === 'memory' ? 'Memory' : view.kind === 'project' ? (activeProject?.name ?? 'Project') : chat.activeConversation?.title ?? null;
  const composerHint = activeModelName ? `Using ${activeModelName}` : chatProject ? `In ${chatProject.name} · Auto picks the best model` : 'Auto picks the best model for each message';

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar
        conversations={chat.conversations}
        status={chat.conversationsStatus}
        activeId={view.kind === 'chat' ? chat.activeConversation?.id ?? null : null}
        onSelect={openConversation}
        onNewChat={() => startNewChat(view.kind === 'project' ? view.id : null)}
        onRename={chat.renameConversation}
        onPin={chat.pinConversation}
        onArchive={(id, archived) => { chat.archiveConversation(id, archived); toast({ title: archived ? 'Chat archived' : 'Chat restored', tone: 'success' }); }}
        onDeleteRequest={setPendingDelete}
        onOpenSettings={() => setSettingsOpen(true)}
        onRetryLoad={chat.loadConversations}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapse={() => toggleSidebar(true)}
        userEmail={user.email}
        projects={projectsCtl.projects}
        view={view}
        onOpenProject={openProject}
        onNewProject={() => setProjectDialog({ open: true, project: null })}
        onOpenFiles={() => setView({ kind: 'files' })}
        onOpenMemory={() => setView({ kind: 'memory' })}
        onOpenSearch={() => setSearchOpen(true)}
        onMoveToProject={(id, projectId) => { chat.moveConversation(id, projectId); toast({ title: projectId ? 'Moved to project' : 'Removed from project', tone: 'success' }); }}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Topbar
          title={topbarTitle}
          models={chat.availableModels}
          selectedModel={chat.selectedModel}
          onSelectModel={chat.setSelectedModel}
          sidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={() => toggleSidebar(false)}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          disabled={chat.isGenerating}
        />

        {view.kind === 'files' && (
          <FilesView knowledge={knowledge} projects={projectsCtl.projects} onOpenFile={setFileDetail} />
        )}

        {view.kind === 'memory' && (
          <MemoryView memories={memoriesCtl} projects={projectsCtl.projects} projectId={chat.activeProjectId} onOpenConversation={openConversationById} />
        )}

        {view.kind === 'project' && activeProject && (
          <ProjectView
            project={activeProject}
            conversations={chat.conversations}
            memories={memoriesCtl.memories}
            knowledge={knowledge}
            onNewChat={() => startNewChat(activeProject.id)}
            onOpenConversation={openConversation}
            onOpenFile={setFileDetail}
            onEdit={() => setProjectDialog({ open: true, project: activeProject })}
            onArchive={archived => projectsCtl.archiveProject(activeProject.id, archived)}
            onDelete={() => deleteProject(activeProject)}
            onOpenMemory={() => setView({ kind: 'memory' })}
          />
        )}
        {view.kind === 'project' && !activeProject && (
          <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">This project no longer exists.</div>
        )}

        {view.kind === 'chat' && (
          <>
            {hasMessages ? (
              <MessageList
                messages={chat.messages}
                loading={chat.messagesStatus === 'loading'}
                isGenerating={chat.isGenerating}
                streamingContent={chat.streamingContent}
                streamingModel={chat.streamingModel}
                error={chat.error}
                canRetry={chat.canRetry}
                showModelBadge={settings.show_model_badges}
                ttsEnabled={settings.tts_enabled}
                ttsRate={settings.tts_rate}
                onRegenerate={chat.regenerate}
                onEdit={chat.editMessage}
                onRetry={chat.retry}
                onDismissError={chat.clearError}
                onRemember={content => setRememberDraft(content.length > 600 ? `${content.slice(0, 600).trimEnd()}…` : content)}
                onOpenSource={openSource}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <EmptyState onSuggestion={text => sendMessage(text)} userName={user.email} />
              </div>
            )}

            <Composer
              ref={composerRef}
              onSend={sendMessage}
              onStop={chat.stopGeneration}
              isGenerating={chat.isGenerating}
              sendOnEnter={settings.send_on_enter}
              hint={composerHint}
              knowledge={knowledgeUploader}
              autoFocus
            />
          </>
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={() => { resetSettings(); toast({ title: 'Settings reset', tone: 'success' }); }}
        models={chat.availableModels}
        userEmail={user.email}
        onSignOut={handleSignOut}
      />

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onOpenResult={openSearchResult} />

      <FileDetailDialog
        file={liveFileDetail}
        projects={projectsCtl.projects}
        onClose={() => setFileDetail(null)}
        onDelete={f => withToast(() => knowledge.deleteFile(f), 'File deleted')}
        onRetry={f => knowledge.retryProcessing(f)}
        onAssignProject={(f, projectId) => withToast(() => knowledge.assignProject(f, projectId), projectId ? 'Added to project' : 'Removed from project')}
        onOpenConversation={openConversationById}
        onOpenProject={openProjectById}
      />

      {picker && (
        <FilePickerDialog
          open
          files={knowledge.files}
          projects={projectsCtl.projects}
          alreadySelected={[]}
          onConfirm={files => { picker.resolve(files); setPicker(null); }}
          onClose={() => { picker.resolve([]); setPicker(null); }}
        />
      )}

      <ProjectDialog
        open={projectDialog.open}
        initial={projectDialog.project}
        onSave={saveProject}
        onClose={() => setProjectDialog({ open: false, project: null })}
      />

      <MemoryEditor
        open={rememberDraft !== null}
        initial={null}
        defaultContent={rememberDraft ?? ''}
        defaultProjectId={chat.activeConversation?.project_id ?? null}
        projects={projectsCtl.projects.filter(p => !p.archived)}
        onSave={saveRemembered}
        onClose={() => setRememberDraft(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this chat?"
        description={pendingDelete ? `“${pendingDelete.title}” and all of its messages will be permanently deleted.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
