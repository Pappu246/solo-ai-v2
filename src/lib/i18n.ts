import { useSyncExternalStore } from 'react';

export type Language = 'en' | 'hi';
export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
];

/**
 * English source strings are the keys, so untranslated text simply falls back to
 * English and tests keep matching the English UI. Add a pair here to translate more.
 */
const HI: Record<string, string> = {
  'New chat': 'नई चैट',
  'Search everything': 'सब कुछ खोजें',
  'Filter chats': 'चैट फ़िल्टर करें',
  Files: 'फ़ाइलें',
  Memory: 'मेमोरी',
  Projects: 'प्रोजेक्ट',
  Pinned: 'पिन की गई',
  Settings: 'सेटिंग्स',
  Rename: 'नाम बदलें',
  Delete: 'हटाएँ',
  Retry: 'फिर कोशिश करें',
  'Move to project': 'प्रोजेक्ट में ले जाएँ',
  'Message Solo AI': 'Solo AI को संदेश लिखें',
  'Drop files to attach': 'जोड़ने के लिए फ़ाइलें यहाँ छोड़ें',
  'Export chat as Markdown': 'चैट Markdown में सेव करें',
  'How can I help you today?': 'आज मैं आपकी क्या मदद करूँ?',
  'Write and debug code': 'कोड लिखें और डीबग करें',
  'Understand a difficult topic': 'कठिन विषय समझें',
  'Make sense of a document': 'दस्तावेज़ समझें',
  'Turn an idea into a plan': 'आइडिया को प्लान बनाएँ',
  'Help me write or debug code. Ask for any missing requirements, then propose a minimal implementation and relevant tests.':
    'कोड लिखने या डीबग करने में मेरी मदद करो। जो जानकारी कम हो वह पूछो, फिर एक सरल इम्प्लीमेंटेशन और ज़रूरी टेस्ट बताओ।',
  'Explain a difficult topic in simple steps. Start with an intuitive analogy, then show a worked example and common mistakes.':
    'एक कठिन विषय को आसान चरणों में समझाओ। पहले एक आसान उदाहरण से शुरू करो, फिर हल किया हुआ उदाहरण और आम गलतियाँ बताओ।',
  'Help me analyze a document. Ask me to attach or paste it first, then summarize its key findings, risks, and recommended actions.':
    'एक दस्तावेज़ का विश्लेषण करने में मेरी मदद करो। पहले मुझसे उसे जोड़ने या पेस्ट करने को कहो, फिर मुख्य बातें, जोखिम और सुझाए गए कदम बताओ।',
  'Help me turn an idea into an actionable plan. Clarify the goal if needed, then outline priorities, milestones, and practical next steps.':
    'मेरे आइडिया को अमल में लाने लायक प्लान बनाने में मदद करो। ज़रूरत हो तो लक्ष्य साफ़ करो, फिर प्राथमिकताएँ, पड़ाव और अगले कदम बताओ।',
  Language: 'भाषा',
  'Interface language': 'इंटरफ़ेस की भाषा',
};

let current: Language = 'en';
const listeners = new Set<() => void>();

export function setLanguage(lang: Language) {
  if (lang === current) return;
  current = lang;
  listeners.forEach(l => l());
}
export function getLanguage(): Language { return current; }

/** Translate outside React (uses the current language). */
export function translate(text: string, lang: Language = current): string {
  return lang === 'hi' ? HI[text] ?? text : text;
}

/** Hook: re-renders the component whenever the language changes. */
export function useT(): (text: string) => string {
  const lang = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getLanguage,
    () => 'en' as Language,
  );
  return (text: string) => translate(text, lang);
}
