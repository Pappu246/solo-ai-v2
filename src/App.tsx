import { useEffect, useRef, useState } from 'react';
import { Menu, Zap, LogOut } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatMessage, StreamingMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ModelSelector } from './components/ModelSelector';
import { AuthScreen } from './components/AuthScreen';
import { useChat } from './hooks/useChat';
import { useAuth } from './hooks/useAuth';

function App() {
  const { user, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const {
    conversations,
    activeConversation,
    messages,
    isLoading,
    streamingContent,
    streamingModel,
    selectedModel,
    autoRoute,
    availableModels,
    loadConversations,
    selectConversation,
    createConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    setSelectedModel,
    setAutoRoute,
    loadModels,
  } = useChat(user);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading2, setAuthLoading2] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadModels();
    }
  }, [user, loadConversations, loadModels]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleNewChat = async () => {
    await createConversation();
  };

  const handleSend = async (content: string) => {
    await sendMessage(content);
  };

  const handleToggleAutoRoute = () => {
    setAutoRoute(!autoRoute);
  };

  const handleSignIn = async (email: string, password: string) => {
    setAuthError(null);
    setAuthLoading2(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setAuthError((err as Error).message || 'Sign in failed');
    } finally {
      setAuthLoading2(false);
    }
  };

  const handleSignUp = async (email: string, password: string) => {
    setAuthError(null);
    setAuthLoading2(true);
    try {
      await signUp(email, password);
    } catch (err) {
      setAuthError((err as Error).message || 'Sign up failed');
    } finally {
      setAuthLoading2(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  if (authLoading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSignIn={handleSignIn} onSignUp={handleSignUp} error={authError} loading={authLoading2} />;
  }

  const showWelcome = !activeConversation && messages.length === 0;

  return (
    <div className="h-screen flex bg-black text-white overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeConversation?.id ?? null}
        onSelect={selectConversation}
        onNew={handleNewChat}
        onDelete={deleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-zinc-400 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/20">
              <Zap className="w-3.5 h-3.5 text-black" />
            </div>
            <h1 className="text-sm font-bold text-amber-400 tracking-wide">SOLO AI</h1>
          </div>
          {activeConversation && (
            <span className="text-xs text-zinc-500 truncate ml-1 hidden sm:inline">
              {activeConversation.title}
            </span>
          )}
          <div className="flex-1" />
          <ModelSelector
            models={availableModels}
            selectedModel={selectedModel}
            autoRoute={autoRoute}
            onSelectModel={setSelectedModel}
            onToggleAutoRoute={handleToggleAutoRoute}
          />
          <button
            onClick={handleSignOut}
            className="text-zinc-500 hover:text-red-400 transition-colors duration-200"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        {showWelcome ? (
          <WelcomeScreen onSuggestion={handleSend} />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isLoading && streamingContent && (
              <StreamingMessage content={streamingContent} model={streamingModel} />
            )}
            {isLoading && !streamingContent && (
              <div className="flex gap-3 animate-in fade-in duration-200">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-black flex items-center justify-center mt-1 animate-pulse">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-800/80 border border-zinc-700/50">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[10px] text-zinc-500 ml-1">
                      {streamingModel ? `Connecting to ${streamingModel.name}...` : 'Routing to best model...'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          onStop={stopStreaming}
          autoRoute={autoRoute}
          selectedModel={selectedModel}
        />
      </main>
    </div>
  );
}

export default App;
