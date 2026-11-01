import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { setLanguage } from '../../lib/i18n';
import { ToastProvider } from '../ui';
import { MemoryView } from './MemoryView';
import { FilesView } from '../knowledge/FilesView';
import type { MemoriesController } from '../../hooks/useMemories';
import type { KnowledgeController } from '../../hooks/useKnowledge';

const memories = { memories: [], status: 'ready', error: null, reload: vi.fn() } as unknown as MemoriesController;
const knowledge = { files: [], status: 'ready', error: null, reload: vi.fn(), progress: {}, cancelUpload: vi.fn(), uploadFiles: vi.fn() } as unknown as KnowledgeController;

describe('Hindi on Memory and Files screens', () => {
  afterEach(() => act(() => setLanguage('en')));

  it('Memory view', () => {
    act(() => setLanguage('hi'));
    render(<ToastProvider><MemoryView memories={memories} projects={[]} /></ToastProvider>);
    expect(screen.getByRole('heading', { name: 'मेमोरी' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /मेमोरी जोड़ें/ })).toBeInTheDocument();
    expect(screen.getByText('Solo को अभी कुछ याद नहीं है।')).toBeInTheDocument();
    expect(screen.queryByText('Add memory')).not.toBeInTheDocument();
  });

  it('Files view', () => {
    act(() => setLanguage('hi'));
    render(<ToastProvider><FilesView knowledge={knowledge} projects={[]} onOpenFile={vi.fn()} /></ToastProvider>);
    expect(screen.getByRole('heading', { name: 'फ़ाइलें' })).toBeInTheDocument();
    expect(screen.getByText('अभी कोई फ़ाइल नहीं है। शुरू करने के लिए ऊपर से एक अपलोड करें।')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /तैयार/ })).toBeInTheDocument();
  });

  it('stays English by default', () => {
    render(<ToastProvider><MemoryView memories={memories} projects={[]} /></ToastProvider>);
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
  });
});
