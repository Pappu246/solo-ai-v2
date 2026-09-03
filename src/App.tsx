import { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Zap, RefreshCw, ChevronDown } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import { useSettings } from './hooks/useSettings';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatMessage, StreamingMessage, TypingIndicator } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ModelSelector } from './components/ModelSelector';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const { user, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const { settings, updateSettings } = useSettings();
  const chat = useChat(user, settings.default_model);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading2, setAuthLoading2] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Load data on mount (only when user changes — NOT on every `chat` object recreation,
  // which would re-trigger this effect on every render and cause a request storm)
  useEffect(() => {
    if (user) {
      chat.loadConversations();
      chat.loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages, chat.streamingContent]);

  // Show scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const handleSignIn = async (email: string, password: string) => {
    setAuthError(null);
    setAuthLoading2(true);
    try { await signIn(email, password); }
    catch (e) { setAuthError((e as Error).message); }
    finally { setAuthLoading2(false); }
  };

  const handleSignUp = async (email: string, password: string) => {
    setAuthError(null);
    setAuthLoading2(true);
    try { await signUp(email, password); }
    catch (e) { setAuthError((e as Error).message); }
    finally { setAuthLoading2(false); }
  };

  const handleNewChat = () => { chat.createConversation(); setSidebarOpen(false); };
  const handleSuggestion = (text: string) => chat.sendMessage(text);

  // ── Auth loading ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-[#080808] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--accent-light)] to-[var(--accent-dark)] flex items-center justify-center shadow-xl shadow-[var(--accent)] animate-pulse">
            <Zap className="w-6 h-6 text-black" fill="black" />
          </div>
          <div className="flex gap-1.5">
            <span className="bounce-dot w-2 h-2 rounded-full bg-[var(--accent-light)]" />
            <span className="bounce-dot w-2 h-2 rounded-full bg-[var(--accent-light)]" />
            <span className="bounce-dot w-2 h-2 rounded-full bg-[var(--accent-light)]" />
          </div>
        </div>
      </div>
    );
  }

  // ── Not authenticated ─────────────────────────────────────────────────────
  if (!user) {
    return <AuthScreen onSignIn={handleSignIn} onSignUp={handleSignUp} error={authError} loading={authLoading2} />;
  }

  const isStreaming = chat.isLoading && chat.streamingContent;
  const isWaiting = chat.isLoading && !chat.streamingContent;

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-[#080808]">
      {/* Sidebar */}
      <Sidebar
        conversations={chat.conversations}
        filteredConversations={chat.filteredConversations}
        activeId={chat.activeConversation?.id || null}
        searchQuery={chat.searchQuery}
        onSearchChange={chat.setSearchQuery}
        onSelect={chat.selectConversation}
        onNew={handleNewChat}
        onDelete={chat.deleteConversation}
        onRename={chat.renameConversation}
        onPin={chat.pinConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
        userEmail={user.email}
      />

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="relative z-30 flex items-center justify-between px-4 py-3 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 hover:dark:text-zinc-200 hover:bg-zinc-200/60 hover:dark:bg-zinc-800/60 transition-all duration-200 md:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden md:flex p-2 rounded-xl text-zinc-500 hover:text-zinc-800 hover:dark:text-zinc-200 hover:bg-zinc-200/60 hover:dark:bg-zinc-800/60 transition-all duration-200"
            >
              <Menu className="w-4 h-4" />
            </button>

            {chat.activeConversation ? (
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px] md:max-w-[360px]">
                  {chat.activeConversation.title}
                </h2>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--accent-light)] to-[var(--accent-dark)] flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-black" fill="black" />
                </div>
                <span className="text-sm font-black text-[var(--accent)] tracking-widest">SOLO AI</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Regenerate */}
            {chat.messages.length > 0 && !chat.isLoading && (
              <button
                onClick={chat.regenerateLastMessage}
                className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 hover:dark:text-zinc-200 hover:bg-zinc-200/60 hover:dark:bg-zinc-800/60 transition-all duration-200"
                title="Regenerate last response"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            {/* Model selector */}
            <ModelSelector
              models={chat.availableModels}
              selectedModel={chat.selectedModel}
              autoRoute={chat.autoRoute}
              onSelectModel={chat.setSelectedModel}
              onToggleAutoRoute={() => chat.setAutoRoute(!chat.autoRoute)}
            />
          </div>
        </header>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto relative"
        >
          {chat.messages.length === 0 && !chat.isLoading ? (
            <WelcomeScreen onSuggestion={handleSuggestion} userName={user.email} />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {chat.messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onRegenerate={msg.role === 'assistant' ? chat.regenerateLastMessage : undefined}
                  onReact={chat.reactToMessage}
                  showModelBadge={settings.show_model_badges}
                />
              ))}

              {isWaiting && <TypingIndicator model={chat.streamingModel} />}
              {isStreaming && (
                <StreamingMessage content={chat.streamingContent} model={chat.streamingModel} />
              )}

              {chat.error && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex-1">
                    <p className="text-red-400 text-sm font-medium">Error</p>
                    <p className="text-red-300/80 text-sm mt-1">{chat.error}</p>
                  </div>
                  <button
                    onClick={() => chat.sendMessage(chat.messages[chat.messages.length - 1]?.content || '')}
                    className="text-xs text-red-400 hover:text-red-300 underline flex-shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Scroll to bottom button */}
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="fixed bottom-24 right-6 w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-white hover:bg-zinc-300 hover:dark:bg-zinc-700 flex items-center justify-center shadow-xl transition-all duration-200 animate-fade-up z-20"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={chat.sendMessage}
          isLoading={chat.isLoading}
          onStop={chat.stopStreaming}
          autoRoute={chat.autoRoute}
          selectedModel={chat.selectedModel}
        />
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onSignOut={signOut}
          userEmail={user.email}
        />
      )}
    </div>
  );
}
