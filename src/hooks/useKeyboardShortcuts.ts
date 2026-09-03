import { useEffect } from 'react';

export interface Shortcut {
  /** Key value as reported by KeyboardEvent.key (case-insensitive). */
  key: string;
  mod?: boolean;   // ⌘ on Mac / Ctrl elsewhere
  shift?: boolean;
  handler: (e: KeyboardEvent) => void;
  /** Allow firing while focus is in an input/textarea. Default false. */
  allowInInputs?: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts. Handlers run only when modifiers match exactly. */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      for (const s of shortcuts) {
        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;
        if (Boolean(s.mod) !== mod) continue;
        if (Boolean(s.shift) !== e.shiftKey) continue;
        if (!s.allowInInputs && !s.mod && isEditable(e.target)) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
