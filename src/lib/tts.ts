let session = 0;

/** Turn Markdown into text that sounds natural when read aloud. */
export function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Split into sentence-sized chunks; long utterances are cut off by some browsers. */
export function chunkForSpeech(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?।。！？]+[.!?।。！？]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
    cur += s;
    while (cur.length > max * 1.5) {
      const cut = cur.lastIndexOf(' ', max);
      const at = cut > 40 ? cut : max;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices?.() ?? [];
  const l = lang.toLowerCase();
  const b = l.split('-')[0];
  return voices.find(v => v.lang.toLowerCase().replace('_', '-') === l)
    ?? voices.find(v => v.lang.toLowerCase().startsWith(b)) ?? null;
}

export interface SpeakOptions { lang?: string; onEnd?: () => void }

/** Read `text` aloud (Markdown is stripped). `onEnd` fires once when finished, not when cancelled. */
export function speak(text: string, rate = 1, pitch = 1, opts: SpeakOptions = {}): void {
  if (!window.speechSynthesis) { opts.onEnd?.(); return; }
  stop();
  const my = ++session;
  const chunks = chunkForSpeech(plainForSpeech(text));
  if (!chunks.length) { opts.onEnd?.(); return; }
  const voice = opts.lang ? pickVoice(opts.lang) : null;
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = rate;
    u.pitch = pitch;
    if (opts.lang) u.lang = voice?.lang ?? opts.lang;
    if (voice) u.voice = voice;
    if (i === chunks.length - 1) {
      const done = () => { if (my === session) opts.onEnd?.(); };
      u.onend = done;
      u.onerror = done;
    }
    window.speechSynthesis.speak(u);
  });
}

export function stop(): void {
  session++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return window.speechSynthesis?.speaking ?? false;
}
