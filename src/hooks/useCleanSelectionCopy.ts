import { useEffect } from 'react';
import { htmlForClipboard } from '../lib/clipboard';

/**
 * Dragging to select part of an assistant reply and pressing Ctrl+C would
 * normally carry the app's theme colours into the clipboard (white text on a
 * white Word page in dark mode). For selections inside one reply we put clean
 * HTML (no theme styles, tables with borders) plus the selected text instead.
 */
export function useCleanSelectionCopy(): void {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !e.clipboardData) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const host = (container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement)?.closest('[data-copy-root]');
      if (!host) return; // outside a reply (or across several replies): keep native behaviour
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      const html = htmlForClipboard(holder);
      if (!html.trim()) return;
      e.clipboardData.setData('text/html', `<meta charset="utf-8">${html}`);
      e.clipboardData.setData('text/plain', sel.toString());
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);
}
