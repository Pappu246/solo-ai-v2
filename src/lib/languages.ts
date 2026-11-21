/** Languages offered for voice input, read-aloud and replies. `code` is a BCP-47 tag. */
export interface VoiceLanguage { code: string; name: string; native: string }

export const AUTO_LANGUAGE = 'auto';

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: 'en-US', name: 'English', native: 'English' },
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur-PK', name: 'Urdu', native: 'اردو' },
  { code: 'es-ES', name: 'Spanish', native: 'Español' },
  { code: 'fr-FR', name: 'French', native: 'Français' },
  { code: 'de-DE', name: 'German', native: 'Deutsch' },
  { code: 'pt-BR', name: 'Portuguese', native: 'Português' },
  { code: 'it-IT', name: 'Italian', native: 'Italiano' },
  { code: 'nl-NL', name: 'Dutch', native: 'Nederlands' },
  { code: 'ru-RU', name: 'Russian', native: 'Русский' },
  { code: 'tr-TR', name: 'Turkish', native: 'Türkçe' },
  { code: 'ar-SA', name: 'Arabic', native: 'العربية' },
  { code: 'id-ID', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'vi-VN', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th-TH', name: 'Thai', native: 'ไทย' },
  { code: 'ja-JP', name: 'Japanese', native: '日本語' },
  { code: 'ko-KR', name: 'Korean', native: '한국어' },
  { code: 'zh-CN', name: 'Chinese', native: '中文' },
];

export function isVoiceLanguage(code: unknown): code is string {
  return code === AUTO_LANGUAGE || (typeof code === 'string' && VOICE_LANGUAGES.some(l => l.code === code));
}

export function languageName(code: string): string | null {
  return VOICE_LANGUAGES.find(l => l.code === code)?.name ?? null;
}

// Script → languages written in it (first = default). Used to guess the spoken
// language from a transcript, since the browser cannot auto-detect speech.
const SCRIPTS: [RegExp, string[]][] = [
  [/[ऀ-ॿ]/, ['hi-IN', 'mr-IN']],
  [/[ঀ-৿]/, ['bn-IN']],
  [/[஀-௿]/, ['ta-IN']],
  [/[ఀ-౿]/, ['te-IN']],
  [/[઀-૿]/, ['gu-IN']],
  [/[ಀ-೿]/, ['kn-IN']],
  [/[ഀ-ൿ]/, ['ml-IN']],
  [/[਀-੿]/, ['pa-IN']],
  [/[؀-ۿ]/, ['ar-SA', 'ur-PK']],
  [/[Ѐ-ӿ]/, ['ru-RU']],
  [/[฀-๿]/, ['th-TH']],
  [/[぀-ヿ]/, ['ja-JP']],
  [/[가-힯]/, ['ko-KR']],
  [/[一-鿿]/, ['zh-CN', 'ja-JP']],
];

const base = (code: string) => code.split('-')[0].toLowerCase();

function isLatinLanguage(code: string): boolean {
  return !SCRIPTS.some(([, codes]) => codes.some(c => base(c) === base(code)));
}

/** Language of `text` by script; falls back to `fallback` for Latin-script text. */
export function detectLanguage(text: string, fallback: string): string {
  for (const [re, codes] of SCRIPTS) {
    if (re.test(text)) return codes.find(c => base(c) === base(fallback)) ?? codes[0];
  }
  return isLatinLanguage(fallback) ? fallback : 'en-US';
}

/** Closest supported language for the browser/UI locale. */
export function browserLanguage(): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  return VOICE_LANGUAGES.find(l => l.code.toLowerCase() === nav.toLowerCase())?.code
    ?? VOICE_LANGUAGES.find(l => base(l.code) === base(nav))?.code
    ?? 'en-US';
}

const LAST_KEY = 'solo.lastVoiceLang';
export function rememberVoiceLanguage(code: string): void {
  try { localStorage.setItem(LAST_KEY, code); } catch { /* storage unavailable */ }
}
/** The language to listen for: the chosen one, or (Auto) the last one heard. */
export function resolveListenLanguage(setting: string): string {
  if (setting !== AUTO_LANGUAGE) return setting;
  try {
    const last = localStorage.getItem(LAST_KEY);
    if (last && isVoiceLanguage(last)) return last;
  } catch { /* storage unavailable */ }
  return browserLanguage();
}

const PREVIEW: Record<string, string> = {
  'hi-IN': 'नमस्ते! मैं सोलो एआई हूँ, इसी तरह आपको जवाब पढ़कर सुनाऊँगा।',
  'es-ES': '¡Hola! Así suena Solo AI al leer en voz alta.',
  'fr-FR': 'Bonjour ! Voici comment Solo AI lit à voix haute.',
  'de-DE': 'Hallo! So klingt Solo AI beim Vorlesen.',
  'bn-IN': 'নমস্কার! আমি সোলো এআই, এভাবেই পড়ে শোনাব।',
  'ta-IN': 'வணக்கம்! நான் சோலோ ஏஐ, இப்படித்தான் படித்துக் காட்டுவேன்.',
  'te-IN': 'నమస్కారం! నేను సోలో ఏఐ, ఇలా చదివి వినిపిస్తాను.',
  'mr-IN': 'नमस्कार! मी सोलो एआय आहे, असेच वाचून दाखवेन.',
  'gu-IN': 'નમસ્તે! હું સોલો એઆઈ છું, આ રીતે વાંચી સંભળાવીશ.',
};
export function previewText(code: string): string {
  return PREVIEW[code] ?? 'This is how Solo AI sounds when reading aloud.';
}
