import type { Attachment } from '../types';

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export const ACCEPTED_TYPES: Record<string, Attachment['type']> = {
  'image/jpeg': 'image', 'image/jpg': 'image', 'image/png': 'image',
  'image/gif': 'image', 'image/webp': 'image',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt', 'text/csv': 'csv',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/ogg': 'audio',
  'video/mp4': 'video', 'video/webm': 'video',
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain' || file.type === 'text/csv') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  return '';
}

export async function processFile(file: File): Promise<Attachment> {
  const type = ACCEPTED_TYPES[file.type] || 'txt';
  const base64 = type === 'image' ? await fileToBase64(file) : undefined;
  const extracted_text = type !== 'image' ? await extractTextFromFile(file) : undefined;

  return {
    id: crypto.randomUUID(),
    name: file.name,
    type,
    base64,
    size: file.size,
    extracted_text,
    mime_type: file.type,
  };
}
