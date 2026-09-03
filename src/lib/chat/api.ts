/**
 * Persistence layer for conversations and messages.
 * All reads/writes go through Supabase with RLS enforcing ownership.
 * IDs are generated client-side so optimistic UI rows and DB rows match.
 */
import { supabase } from '../supabase';
import { AppError } from '../errors';
import type { Conversation, Message, Attachment } from '../../types';

function throwIf(error: { message: string; code?: string } | null, context: string): void {
  if (error) throw new AppError(`${context} failed`, undefined, `${error.code ? `[${error.code}] ` : ''}${error.message}`);
}

export const conversationsApi = {
  async list(userId: string): Promise<Conversation[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    throwIf(error, 'Loading chats');
    return (data ?? []).map(row => ({ ...row, archived: Boolean(row.archived) })) as Conversation[];
  },

  async create(userId: string, title = 'New chat'): Promise<Conversation> {
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('conversations')
      .insert({ id, title, user_id: userId, pinned: false })
      .select()
      .single();
    throwIf(error, 'Creating chat');
    return { ...data, archived: Boolean(data.archived) } as Conversation;
  },

  async update(id: string, patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'archived' | 'model_id'>>): Promise<void> {
    const { error } = await supabase.from('conversations').update(patch).eq('id', id);
    throwIf(error, 'Updating chat');
  },

  /** Bump updated_at so the chat rises to the top of the list. */
  async touch(id: string): Promise<void> {
    const { error } = await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id);
    throwIf(error, 'Updating chat');
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('conversations').delete().eq('id', id);
    throwIf(error, 'Deleting chat');
  },
};

/** Strip base64 image payloads before persisting attachments. */
export function toStoredAttachments(attachments?: Attachment[] | null): Omit<Attachment, 'base64'>[] | null {
  if (!attachments?.length) return null;
  return attachments.map(({ base64: _omit, ...rest }) => { void _omit; return rest; });
}

export const messagesApi = {
  async list(conversationId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    throwIf(error, 'Loading messages');
    return (data ?? []) as Message[];
  },

  async insert(message: Message & { user_id: string }): Promise<void> {
    const { error } = await supabase.from('messages').insert({
      id: message.id,
      conversation_id: message.conversation_id,
      user_id: message.user_id,
      role: message.role,
      content: message.content,
      model: message.model ?? null,
      model_name: message.model_name ?? null,
      category: message.category ?? null,
      attachments: toStoredAttachments(message.attachments),
      created_at: message.created_at,
    });
    throwIf(error, 'Saving message');
  },

  async updateContent(id: string, content: string): Promise<void> {
    const { error } = await supabase.from('messages').update({ content }).eq('id', id);
    throwIf(error, 'Updating message');
  },

  async remove(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase.from('messages').delete().in('id', ids);
    throwIf(error, 'Deleting messages');
  },
};
