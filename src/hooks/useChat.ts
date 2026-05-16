import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Conversation, Message, ChatMessage, AIModel } from '../types';
import type { User } from '@supabase/supabase-js';

const CHAT_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const HEADERS = {
  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

export function useChat(user: User | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingModel, setStreamingModel] = useState<{ id: string; name: string; category: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [autoRoute, setAutoRoute] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch(CHAT_API_URL, {
        method: 'GET',
        headers: HEADERS,
      });
      const data = await response.json();
      if (data.models) setAvailableModels(data.models);
    } catch {
      // Models will load when available
    }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (data) setConversations(data);
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!user) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data);
  }, [user]);

  const selectConversation = useCallback(async (conversation: Conversation) => {
    setActiveConversation(conversation);
    await loadMessages(conversation.id);
  }, [loadMessages]);

  const createConversation = useCallback(async () => {
    if (!user) return null;
    const { data } = await supabase
      .from('conversations')
      .insert({ title: 'New Chat', user_id: user.id })
      .select()
      .maybeSingle();
    if (data) {
      setConversations((prev) => [data, ...prev]);
      setActiveConversation(data);
      setMessages([]);
      return data;
    }
    return null;
  }, [user]);

  const deleteConversation = useCallback(async (id: string) => {
    await supabase.from('conversations').delete().eq('id', id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversation?.id === id) {
      setActiveConversation(null);
      setMessages([]);
    }
  }, [activeConversation]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading || !user) return;

    let conversation = activeConversation;
    if (!conversation) {
      conversation = await createConversation();
      if (!conversation) return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      role: 'user',
      content,
      user_id: user.id,
    });

    setIsLoading(true);
    setStreamingContent('');
    setStreamingModel(null);

    const chatHistory: ChatMessage[] = [...messages, { role: 'user', content }].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Track the final model info outside the closure to avoid stale references
    let finalModelInfo = { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', category: 'conversation' };

    try {
      const response = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          messages: chatHistory,
          model: selectedModel || undefined,
          autoRoute,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to get response');
      }

      // Read model info from headers
      const headerModel = response.headers.get('X-Model-Used') || 'llama-3.3-70b';
      const headerModelName = response.headers.get('X-Model-Name') || 'Llama 3.3 70B';
      const headerCategory = response.headers.get('X-Route-Category') || 'conversation';
      finalModelInfo = { id: headerModel, name: headerModelName, category: headerCategory };
      setStreamingModel(finalModelInfo);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              // Check for model_info in the first chunk
              if (parsed.choices?.[0]?.model_info) {
                const info = parsed.choices[0].model_info;
                finalModelInfo = {
                  id: info.model || headerModel,
                  name: info.modelName || headerModelName,
                  category: info.category || headerCategory,
                };
                setStreamingModel(finalModelInfo);
              }

              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                setStreamingContent(fullContent);
              }
            } catch {
              // skip unparseable chunks
            }
          }
        }
      }

      if (fullContent) {
        // Add the assistant message to state FIRST, then clear streaming state
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: conversation!.id,
          role: 'assistant',
          content: fullContent,
          model: finalModelInfo.id,
          modelName: finalModelInfo.name,
          category: finalModelInfo.category,
          created_at: new Date().toISOString(),
        };

        // Add message to state and clear streaming in the same batch
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingContent('');
        setStreamingModel(null);

        // Persist to database (non-blocking)
        supabase.from('messages').insert({
          conversation_id: conversation!.id,
          role: 'assistant',
          content: fullContent,
          model: finalModelInfo.id,
          model_name: finalModelInfo.name,
          category: finalModelInfo.category,
          user_id: user.id,
        }).then(({ error }) => {
          if (error) console.error('Failed to save message:', error);
        });

        const title = content.length > 40 ? content.slice(0, 40) + '...' : content;
        supabase
          .from('conversations')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', conversation!.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update conversation:', error);
          });

        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversation!.id ? { ...c, title, updated_at: new Date().toISOString() } : c
          )
        );
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Chat error:', error);
      }
      // Clear streaming state on error too
      setStreamingContent('');
      setStreamingModel(null);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [activeConversation, messages, isLoading, createConversation, selectedModel, autoRoute, user]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
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
    loadMessages,
    selectConversation,
    createConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    setSelectedModel,
    setAutoRoute,
    loadModels,
  };
}
