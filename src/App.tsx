import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { Conversation } from './types';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { isSupabaseConfigured } from './lib/supabase';
import { AuthScreen } from './components/auth/AuthScreen';
import { SetupScreen } from './components/auth/SetupScreen';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MessageList } from './components/chat/MessageList';
import { EmptyState } from './components/chat/EmptyState';
import { Composer, type ComposerHandle } from './components/chat/Composer';
import { SettingsPanel } from './components/settings/SettingsPanel';
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
  const chat = useChat(user, { settings });
  const { toast } = useToast();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const toggleSidebar = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, []);

  // Surface non-chat errors (e.g. a failed rename) as toasts; chat errors render inline.
  const lastToastedError = useRef<unknown>(null);
  useEffect(() => {
    const err = chat.error;
    if (!err || err === lastToastedError.current) return;
    if (chat.messages.length === 0 && !chat.activeConversation) {
      lastToastedError.current = err;
      toast({ title: err.title, description: err.message, tone: 'error' });
      chat.clearError();
    }
  }, [chat, toast]);

  const shortcuts = useMemo(() => [
    { key: 'o', mod: true, shift: true, handler: () => { chat.startNewChat(); composerRef.current?.focus(); } },
    { key: 'k', mod: true, handler: () => { if (sidebarCollapsed) toggleSidebar(false); window.dispatchEvent(new Event('solo:focus-search')); } },
    { key: 'b', mod: true, handler: () => toggleSidebar(!sidebarCollapsed) },
    { key: ',', mod: true, handler: () => setSettingsOpen(true) },
    { key: 'Escape', handler: () => { if (chat.isGenerating) chat.stopGeneration(); }, allowInInputs: true },
  ], [chat, sidebarCollapsed, toggleSidebar]);
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

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar
        conversations={chat.conversations}
        status={chat.conversationsStatus}
        activeId={chat.activeConversation?.id ?? null}
        onSelect={chat.selectConversation}
        onNewChat={() => { chat.startNewChat(); composerRef.current?.focus(); }}
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
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Topbar
          title={chat.activeConversation?.title ?? null}
          models={chat.availableModels}
          selectedModel={chat.selectedModel}
          onSelectModel={chat.setSelectedModel}
          sidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={() => toggleSidebar(false)}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          disabled={chat.isGenerating}
        />

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
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <EmptyState onSuggestion={text => chat.sendMessage(text)} userName={user.email} />
          </div>
        )}

        <Composer
          ref={composerRef}
          onSend={chat.sendMessage}
          onStop={chat.stopGeneration}
          isGenerating={chat.isGenerating}
          sendOnEnter={settings.send_on_enter}
          hint={activeModelName ? `Using ${activeModelName}` : 'Auto picks the best model for each message'}
          autoFocus
        />
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
