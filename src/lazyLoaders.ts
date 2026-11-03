/**
 * Screens and dialogs the user does not need for the first paint are split into
 * their own chunks. They are prefetched when the browser is idle, so opening one
 * later is instant, but the first screen stays small.
 */
export const loaders = {
  settings: () => import('./components/settings/SettingsPanel'),
  search: () => import('./components/search/SearchPalette'),
  fileDetail: () => import('./components/knowledge/FileDetailDialog'),
  filePicker: () => import('./components/knowledge/FilePickerDialog'),
  files: () => import('./components/knowledge/FilesView'),
  memoryView: () => import('./components/memory/MemoryView'),
  memoryEditor: () => import('./components/memory/MemoryEditor'),
  project: () => import('./components/projects/ProjectView'),
  projectDialog: () => import('./components/projects/ProjectDialog'),
};

/** Fetch every lazy chunk in the background once the page is idle. Failures are ignored. */
export function prefetchLazyViews(): void {
  const run = () => { for (const load of Object.values(loaders)) void load().catch(() => {}); };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 }); else window.setTimeout(run, 2000);
}
