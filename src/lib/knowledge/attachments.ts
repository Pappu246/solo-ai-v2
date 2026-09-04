import type { Attachment, KnowledgeFile } from '../../types';

/** Convert a knowledge file row into the attachment shape the chat composer and messages use. */
export function attachmentFromFile(f: KnowledgeFile): Attachment {
  const kind = f.metadata.kind;
  const type: Attachment['type'] = kind === 'pdf' ? 'pdf' : kind === 'csv' ? 'csv' : kind === 'json' ? 'json' : kind === 'markdown' ? 'md' : kind === 'code' ? 'code' : 'txt';
  return { id: f.id, file_id: f.id, name: f.name, type, size: f.size, mime_type: f.mime_type, status: f.status, error: f.error ?? undefined };
}
