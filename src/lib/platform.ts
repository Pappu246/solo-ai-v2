/** True on Apple platforms; used to render ⌘ vs Ctrl in shortcut hints. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
