import { lazy, Suspense, type ReactNode } from 'react';
import { Spinner } from './components/ui';
import { loaders } from './lazyLoaders';
import { useEverOpened } from './hooks/useEverOpened';

// Each screen/dialog below is its own chunk (see lazyLoaders.ts for the prefetch).
export const SettingsPanel = lazy(() => loaders.settings().then(m => ({ default: m.SettingsPanel })));
export const SearchPalette = lazy(() => loaders.search().then(m => ({ default: m.SearchPalette })));
export const FileDetailDialog = lazy(() => loaders.fileDetail().then(m => ({ default: m.FileDetailDialog })));
export const FilePickerDialog = lazy(() => loaders.filePicker().then(m => ({ default: m.FilePickerDialog })));
export const FilesView = lazy(() => loaders.files().then(m => ({ default: m.FilesView })));
export const MemoryView = lazy(() => loaders.memoryView().then(m => ({ default: m.MemoryView })));
export const MemoryEditor = lazy(() => loaders.memoryEditor().then(m => ({ default: m.MemoryEditor })));
export const ProjectView = lazy(() => loaders.project().then(m => ({ default: m.ProjectView })));
export const ProjectDialog = lazy(() => loaders.projectDialog().then(m => ({ default: m.ProjectDialog })));

/** Renders a lazy dialog only after its first open; afterwards it stays mounted like before. */
export function LazyDialog({ open, children }: { open: boolean; children: ReactNode }) {
  const ever = useEverOpened(open);
  if (!ever) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

/** A lazy full-page view with a spinner while its chunk loads. */
export function LazyView({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-fg-subtle"><Spinner /></div>}>
      {children}
    </Suspense>
  );
}
