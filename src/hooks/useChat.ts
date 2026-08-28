import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Conversation, Message, ChatMessage, AIModel, Attachment } from '../types';
import type { User } from '@supabase/supabase-js';

const CHAT_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
async function getChatHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return {
    Authorization: `Bearer ${session.access_token}`,
    ...(publishableKey ? { apikey: publishableKey } : {}),
    'Content-Type': 'application/json',
  };
}

export function useChat(user: User | null, defaultModel = 'gpt-oss-120b') {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingModel, setStreamingModel] = useState<{ id: string; name: string; category: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [autoRoute, setAutoRoute] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch(CHAT_API_URL, { method: 'GET', headers: await getChatHeaders() });
      const data = await response.json();
      if (data.models) setAvailableModels(data.models);
    } catch { /* retry later */ }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('conversations').select('*').eq('user_id', user.id).order('pinned', { ascending: false }).order('updated_at', { ascending: false });
    if (data) setConversations(data as Conversation[]);
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!user) return;
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [user]);

  const selectConversation = useCallback(async (conversation: Conversation) => {
    setActiveConversation(conversation);
    await loadMessages(conversation.id);
  }, [loadMessages]);

  const createConversation = useCallback(async (title = 'New Chat') => {
    if (!user) return null;
    const { data } = await supabase.from('conversations').insert({ title, user_id: user.id, pinned: false }).select().maybeSingle();
    if (data) {
      setConversations(prev => [data as Conversation, ...prev]);
      setActiveConversation(data as Conversation);
      setMessages([]);
      return data as Conversation;
    }
    return null;
  }, [user]);

  const deleteConversation = useCallback(async (id: string) => {
    await supabase.from('conversations').delete().eq('id', id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversation?.id === id) { setActiveConversation(null); setMessages([]); }
  }, [activeConversation]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    await supabase.from('conversations').update({ title }).eq('id', id);
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    if (activeConversation?.id === id) setActiveConversation(prev => prev ? { ...prev, title } : prev);
  }, [activeConversation]);

  const pinConversation = useCallback(async (id: string, pinned: boolean) => {
    await supabase.from('conversations').update({ pinned }).eq('id', id);
    setConversations(prev => prev.map(c => c.id === id ? { ...c, pinned } : c));
  }, []);

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    if ((!content.trim() && (!attachments || attachments.length === 0)) || isLoading || !user) return;

    let conversation = activeConversation;
    if (!conversation) {
      conversation = await createConversation();
      if (!conversation) return;
    }

    const userMessage: Message = { id: crypto.randomUUID(), conversation_id: conversation.id, role: 'user', content, attachments, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);

    const storedAttachments = attachments?.map(({ base64: _base64, ...attachment }) => attachment);
    await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'user', content, user_id: user.id, attachments: storedAttachments || null });

    setIsLoading(true); setStreamingContent(''); setStreamingModel(null); setError(null);

    const chatHistory: ChatMessage[] = [...messages, { role: 'user', content }].map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
    if (attachments?.length) {
      const fileContext = attachments.filter(a => a.extracted_text).map(a => `[File: ${a.name}]\n${a.extracted_text}`).join('\n\n');
      if (fileContext) chatHistory[chatHistory.length - 1].content += `\n\n${fileContext}`;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    let finalModelInfo = { id: selectedModel || defaultModel, name: '', category: 'conversation' };

    try {
      const requestBody: Record<string, unknown> = { messages: chatHistory, model: selectedModel || undefined, autoRoute: !selectedModel && autoRoute };
      const images = attachments?.filter(a => a.type === 'image' && a.base64).map(image => ({ base64: image.base64, mime_type: image.mime_type || 'image/jpeg' }));
      if (images?.length) requestBody.images = images;

      const response = await fetch(CHAT_API_URL, { method: 'POST', headers: await getChatHeaders(), body: JSON.stringify(requestBody), signal: abortController.signal });
      if (!response.ok) {
        let errorMsg = `Request failed (${response.status})`;
        try { const errData = await response.json(); if (errData.error) errorMsg = errData.error; } catch { /* ignore */ }
        throw new Error(errorMsg);
      }
      if (!response.body) throw new Error('No response body');

      const headerModel = response.headers.get('X-Model-Used') || finalModelInfo.id;
      const headerModelName = response.headers.get('X-Model-Name') || '';
      const headerCategory = response.headers.get('X-Route-Category') || 'conversation';
      finalModelInfo = { id: headerModel, name: headerModelName, category: headerCategory };
      setStreamingModel(finalModelInfo);

      const reader = response.body.getReader(); const decoder = new TextDecoder(); let fullContent = ''; let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6); if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data); const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { fullContent += delta; setStreamingContent(fullContent); }
          } catch { /* skip malformed */ }
        }
      }

      if (fullContent) {
        const assistantMessage: Message = { id: crypto.randomUUID(), conversation_id: conversation.id, role: 'assistant', content: fullContent, model: finalModelInfo.id, model_name: finalModelInfo.name, category: finalModelInfo.category, created_at: new Date().toISOString() };
        setMessages(prev => [...prev, assistantMessage]); setStreamingContent(''); setStreamingModel(null);
        await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: fullContent, model: finalModelInfo.id, model_name: finalModelInfo.name, category: finalModelInfo.category, user_id: user.id });

        if (messages.length === 0) {
          const title = content.length > 45 ? content.slice(0, 45) + '…' : content;
          await supabase.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', conversation.id);
          setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, title } : c));
        } else {
          await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation.id);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') { console.error('Chat error:', error); setError((error as Error).message || 'Something went wrong'); setStreamingContent(''); setStreamingModel(null); }
    } finally { setIsLoading(false); abortRef.current = null; }
  }, [activeConversation, messages, isLoading, createConversation, selectedModel, autoRoute, user, defaultModel]);

  const stopStreaming = useCallback(() => { abortRef.current?.abort(); }, []);

  const regenerateLastMessage = useCallback(async () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMessages(prev => prev.filter(m => m.id !== prev[prev.length - 1].id));
    await sendMessage(lastUser.content, lastUser.attachments);
  }, [messages, sendMessage]);

  const filteredConversations = searchQuery ? conversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase())) : conversations;

  return {
    conversations, filteredConversations, activeConversation, messages, isLoading, streamingContent, streamingModel, error,
    selectedModel, autoRoute, availableModels, searchQuery, setSearchQuery,
    loadConversations, loadMessages, selectConversation, createConversation, deleteConversation, renameConversation, pinConversation,
    sendMessage, stopStreaming, regenerateLastMessage, setSelectedModel, setAutoRoute, loadModels,
  };
}
