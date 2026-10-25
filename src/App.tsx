import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import { WifiOff } from 'lucide-react';
import type { Conversation, KnowledgeFile, Project, SearchResult, KnowledgeSource, Attachment, MemoryType } from './types';
import { detectMemorySuggestion } from './lib/memory/suggest';
import { useAuth } from './hooks/useAuth';
import { useChat, type ContextResolver } from './hooks/useChat';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjects, type ProjectInput } from './hooks/useProjects';
import { useMemories } from './hooks/useMemories';
import { useKnowledge } from './hooks/useKnowledge';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useAccess } from './hooks/useAccess';
import { isSupabaseConfigured } from './lib/supabase';
import { retrieveKnowledge, selectMemories, buildChatContext } from './lib/knowledge/retriever';
import { toFriendlyError } from './lib/errors';
import { AuthScreen } from './components/auth/AuthScreen';
import { SetupScreen } from './components/auth/SetupScreen';
import { PendingApprovalScreen } from './components/auth/PendingApprovalScreen';
import { ApproveScreen } from './components/auth/ApproveScreen';
import { Sidebar as SidebarBase, type SidebarView } from './components/layout/Sidebar';
import { Topbar as TopbarBase } from './components/layout/Topbar';
import { MessageList } from './components/chat/MessageList';
import { EmptyState } from './components/chat/EmptyState';
import { Composer as ComposerBase, type ComposerHandle, type KnowledgeUploader } from './components/chat/Composer';
import { conversationToMarkdown, exportFilename, downloadText } from './lib/exportChat';
import { pathFor, parsePath, type Route } from './lib/routes';
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

// Streaming tokens re-render Shell (streamingContent lives here). These memo
// wrappers, plus the stable callback identities created inside Shell, let the
// heavy children skip that work instead of redrawing on every token.
const Sidebar = memo(SidebarBase);
const Topbar = memo(TopbarBase);
const Composer = memo(ComposerBase);

export default function App() {
  if (!isSupabaseConfigured) return <SetupScreen />;
  // Opened from the owner's approval email: the signed token in the link authorizes it.
  const approveToken = new URLSearchParams(window.location.search).get('approve');
  if (approveToken) return <ApproveScreen token={approveToken} />;
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { user, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const { settings, updateSettings, resetSettings } = useSettings(user);
  const { toast } = useToast();

  // ── Phase 2 data ───────────────────────────────────────────────────────────
  const projectsCtl = useProjects(user);
  const memoriesCtl = useMemories(user);
  const knowledge = useKnowledge(user);
  // Method handles are stable useCallback identities. Destructuring them lets
  // dependent callbacks depend on exactly those: `chat.someMethod()` calls make
  // react-hooks/exhaustive-deps demand the whole `chat` object, which is a new
  // object on every streaming render and would churn every memoized child.
  const { uploadFiles, cancelUpload, retryProcessing, attachToConversation } = knowledge;
  const { progress: uploadProgress, files: knowledgeFiles } = knowledge;
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

  // ── Phase 8: memory suggestions ───────────────────────────────────────
  // One prompt per distinct statement; dismissed or saved text is never
  // re-suggested in this session.
  const lastSuggestedRef = useRef<string | null>(null);
  const maybeSuggestMemory = useCallback((text: string) => {
    if (!settings.suggest_memories) return;
    const suggestion = detectMemorySuggestion(text);
    if (!suggestion || suggestion.content === lastSuggestedRef.current) return;
    lastSuggestedRef.current = suggestion.content;
    toast({
      title: 'Remember this for future chats?',
      description: suggestion.reason,
      duration: 8000,
      action: { label: 'Save memory', onClick: () => setRememberDraft(suggestion) },
    });
  }, [settings.suggest_memories, toast]);

  const chat = useChat(user, {
    settings,
    resolveContext,
    onConversationCreated: conversation => {
      // Files attached before the chat existed now get linked to it.
      if (pendingAttachRef.current.length) { knowledge.attachToConversation(pendingAttachRef.current, conversation.id); pendingAttachRef.current = []; }
    },
  });

  const { selectConversation, deleteConversation, archiveConversation, moveConversation, setActiveProject, startNewChat: chatStartNewChat, sendMessage: chatSend } = chat;

  // ── UI state ───────────────────────────────────────────────────────────────
  const [view, setView] = useState<SidebarView>({ kind: 'chat' });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [fileDetail, setFileDetail] = useState<KnowledgeFile | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [rememberDraft, setRememberDraft] = useState<{ content: string; type: MemoryType } | null>(null);
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
  const openConversation = useCallback((c: Conversation) => { setView({ kind: 'chat' }); selectConversation(c); }, [selectConversation]);
  const openConversationById = useCallback((id: string) => {
    const c = chat.conversations.find(x => x.id === id);
    if (c) openConversation(c); else toast({ title: 'Chat not found', description: 'It may have been deleted.', tone: 'error' });
  }, [chat.conversations, openConversation, toast]);
  const openProject = useCallback((p: Project) => { setView({ kind: 'project', id: p.id }); setActiveProject(p.id); }, [setActiveProject]);
  const openProjectById = useCallback((id: string) => {
    const p = projectsCtl.projects.find(x => x.id === id);
    if (p) openProject(p); else toast({ title: 'Project not found', tone: 'error' });
  }, [projectsCtl.projects, openProject, toast]);
  const startNewChat = useCallback((projectId: string | null = null) => {
    setView({ kind: 'chat' });
    chatStartNewChat(projectId);
    composerRef.current?.focus();
  }, [chatStartNewChat]);
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
    await deleteConversation(pendingDelete.id);
    toast({ title: 'Chat deleted', description: title, tone: 'success' });
  }, [pendingDelete, deleteConversation, toast]);

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
      const outcome = await uploadFiles(files, { conversationId, projectId, onChange });
      if (!conversationId) pendingAttachRef.current.push(...outcome.files.filter(f => f.status === 'ready').map(f => f.id));
      for (const reason of outcome.rejected) toast({ title: 'File skipped', description: reason, tone: 'error' });
      if (outcome.cancelled.length) toast({ title: outcome.cancelled.length === 1 ? 'Upload cancelled' : `${outcome.cancelled.length} uploads cancelled`, tone: 'info' });
      return outcome.files;
    },
    pickFromLibrary: () => new Promise<KnowledgeFile[]>(resolve => setPicker({ resolve })),
    cancelUpload,
    progress: uploadProgress,
    files: knowledgeFiles,
    retryProcessing: async (fileId) => {
      const f = knowledgeFiles.find(x => x.id === fileId);
      if (!f) throw new Error('File not found');
      await retryProcessing(f);
    },
  }), [chat.activeConversation, chat.activeProjectId, uploadFiles, cancelUpload, uploadProgress, knowledgeFiles, retryProcessing, toast]);

  const sendMessage = useCallback((text: string, attachments?: Attachment[], opts?: { research?: boolean; agent?: boolean }) => {
    const ids = (attachments ?? []).map(a => a.file_id).filter((id): id is string => Boolean(id));
    if (ids.length) {
      if (chat.activeConversation) attachToConversation(ids, chat.activeConversation.id);
      else pendingAttachRef.current.push(...ids);
    }
    maybeSuggestMemory(text);
    return chatSend(text, attachments, opts);
  }, [chat.activeConversation, chatSend, attachToConversation, maybeSuggestMemory]);

  // Stable action identities for the memoized shell: fresh closures here would
  // defeat memo(Sidebar/Topbar/Composer) on every streaming token.
  const sidebarNewChat = useCallback(() => startNewChat(view.kind === 'project' ? view.id : null), [startNewChat, view]);
  const archiveWithToast = useCallback((id: string, archived: boolean) => { archiveConversation(id, archived); toast({ title: archived ? 'Chat archived' : 'Chat restored', tone: 'success' }); }, [archiveConversation, toast]);
  const moveWithToast = useCallback((id: string, projectId: string | null) => { moveConversation(id, projectId); toast({ title: projectId ? 'Moved to project' : 'Removed from project', tone: 'success' }); }, [moveConversation, toast]);
  const exportActiveChat = useCallback(() => {
    const title = chat.activeConversation?.title ?? null;
    downloadText(exportFilename(title), conversationToMarkdown(title, chat.messages));
  }, [chat.activeConversation, chat.messages]);
  const openSettingsPanel = useCallback(() => setSettingsOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const collapseSidebar = useCallback(() => toggleSidebar(true), [toggleSidebar]);
  const expandSidebar = useCallback(() => toggleSidebar(false), [toggleSidebar]);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const openNewProjectDialog = useCallback(() => setProjectDialog({ open: true, project: null }), []);
  const openFilesView = useCallback(() => setView({ kind: 'files' }), []);
  const openMemoryView = useCallback(() => setView({ kind: 'memory' }), []);
  const openSearchPalette = useCallback(() => setSearchOpen(true), []);
  const handleRemember = useCallback((content: string) => { setRememberDraft(content.length > 600 ? { content: `${content.slice(0, 600).trimEnd()}…`, type: 'fact' } : { content, type: 'fact' }); }, []);

  const openSource = useCallback((s: KnowledgeSource) => openFileById(s.file_id), [openFileById]);

  // ── URL sync ───────────────────────────────────────────────────────────────
  // Every view has its own URL so refresh, back/forward and shared links work.
  const route: Route = view.kind === 'chat' ? { kind: 'chat', conversationId: chat.activeConversation?.id ?? null } : view.kind === 'project' ? { kind: 'project', id: view.id } : { kind: view.kind };
  const routePath = pathFor(route);
  const dataReady = Boolean(user) && chat.conversationsStatus === 'ready' && projectsCtl.status === 'ready';
  const appliedRef = useRef(false);
  const applyRoute = useCallback((r: Route) => {
    if (r.kind === 'files') setView({ kind: 'files' });
    else if (r.kind === 'memory') setView({ kind: 'memory' });
    else if (r.kind === 'project') { const p = projectsCtl.projects.find(x => x.id === r.id); if (p) openProject(p); else startNewChat(); }
    else if (r.conversationId) { const c = chat.conversations.find(x => x.id === r.conversationId); if (c) openConversation(c); else startNewChat(); }
    else startNewChat();
  }, [projectsCtl.projects, chat.conversations, openProject, openConversation, startNewChat]);
  useEffect(() => {
    if (!dataReady || appliedRef.current) return;
    appliedRef.current = true;
    const initial = parsePath(window.location.pathname);
    if (pathFor(initial) !== '/') applyRoute(initial);
  }, [dataReady, applyRoute]);
  useEffect(() => {
    if (!dataReady || !appliedRef.current || window.location.pathname === routePath) return;
    window.history.pushState(null, '', routePath);
  }, [dataReady, routePath]);
  useEffect(() => {
    const onPop = () => applyRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyRoute]);

  // Connectivity drives the offline banner and the composer hint. It must be
  // called before any early return so the hook order never changes.
  const online = useOnlineStatus();
  const access = useAccess(user);

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center" aria-busy="true" aria-label="Loading Solo AI">
        <Logo size={40} className="animate-pulse" />
      </div>
    );
  }

  if (!user) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;

  if (access.status === 'checking') {
    return (
      <div className="h-screen flex items-center justify-center" aria-busy="true" aria-label="Checking access">
        <Logo size={40} className="animate-pulse" />
      </div>
    );
  }
  if (access.status === 'pending' || access.status === 'blocked') {
    return <PendingApprovalScreen blocked={access.status === 'blocked'} email={user.email} onRecheck={access.recheck} onSignOut={handleSignOut} />;
  }

  const hasMessages = chat.messages.length > 0 || chat.isGenerating || chat.messagesStatus === 'loading';
  const activeModelName = chat.selectedModel
    ? chat.availableModels.find(m => m.id === chat.selectedModel)?.name ?? chat.selectedModel
    : null;
  const activeProject = view.kind === 'project' ? projectsCtl.projects.find(p => p.id === view.id) ?? null : null;
  const chatProject = chat.activeConversation?.project_id
    ? projectsCtl.projects.find(p => p.id === chat.activeConversation!.project_id) ?? null
    : chat.activeProjectId ? projectsCtl.projects.find(p => p.id === chat.activeProjectId) ?? null : null;
  const topbarTitle = view.kind === 'files' ? 'Files' : view.kind === 'memory' ? 'Memory' : view.kind === 'project' ? (activeProject?.name ?? 'Project') : chat.activeConversation?.title ?? null;
  const composerHint = !online
    ? 'You’re offline — reconnect to send'
    : activeModelName ? `Using ${activeModelName}` : chatProject ? `In ${chatProject.name} · Auto picks the best model` : 'Auto picks the best model for each message';

  // The shell must not paint an opaque background: the ambient glow layer
  // lives behind it (body::before, z -1) and every frosted surface above
  // blurs it. z-10 keeps the whole app above that glow layer.
  return (
    <div className="relative z-10 flex h-screen overflow-hidden text-fg">
      <Sidebar
        conversations={chat.conversations}
        status={chat.conversationsStatus}
        activeId={view.kind === 'chat' ? chat.activeConversation?.id ?? null : null}
        onSelect={openConversation}
        onNewChat={sidebarNewChat}
        onRename={chat.renameConversation}
        onPin={chat.pinConversation}
        onArchive={archiveWithToast}
        onDeleteRequest={setPendingDelete}
        onOpenSettings={openSettingsPanel}
        onRetryLoad={chat.loadConversations}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={closeMobileSidebar}
        collapsed={sidebarCollapsed}
        onCollapse={collapseSidebar}
        onExpand={expandSidebar}
        userEmail={user.email}
        projects={projectsCtl.projects}
        view={view}
        onOpenProject={openProject}
        onNewProject={openNewProjectDialog}
        onOpenFiles={openFilesView}
        onOpenMemory={openMemoryView}
        onOpenSearch={openSearchPalette}
        onMoveToProject={moveWithToast}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Topbar
          title={topbarTitle}
          models={chat.availableModels}
          selectedModel={chat.selectedModel}
          onSelectModel={chat.selectModel}
          sidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={expandSidebar}
          onOpenMobileSidebar={openMobileSidebar}
          disabled={chat.isGenerating}
          onExport={view.kind === 'chat' && chat.messages.length > 0 ? exportActiveChat : undefined}
        />

        {!online && (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 bg-danger/10 border-b border-danger/30 px-4 py-1.5 text-xs font-medium text-danger">
            <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span>You’re offline — messages will fail until you reconnect. Your draft is kept.</span>
          </div>
        )}

        <main className="flex-1 flex flex-col min-h-0 min-w-0">
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
            onOpenMemory={openMemoryView}
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
                userInitial={(user.email ?? 'you').split('@')[0].slice(0, 1)}
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
                onRemember={handleRemember}
                onOpenSource={openSource}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <EmptyState onSuggestion={sendMessage} />
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
              offline={!online}
              autoFocus
            />
          </>
        )}
        </main>
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
        defaultContent={rememberDraft?.content ?? ''}
        defaultType={rememberDraft?.type}
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
