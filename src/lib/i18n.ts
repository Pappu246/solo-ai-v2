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
  'AI is unavailable': 'AI अभी उपलब्ध नहीं है',
  'AI provider is temporarily unavailable. Please try again.': 'AI सेवा कुछ समय के लिए उपलब्ध नहीं है। कृपया फिर कोशिश करें।',
  'Access turned off': 'पहुँच बंद है',
  'An account with this email already exists. Try signing in instead.': 'इस ईमेल से खाता पहले से है। साइन इन करके देखें।',
  'Blocked': 'रोका गया',
  'Connection problem': 'कनेक्शन की समस्या',
  'Could not connect. Check your internet connection.': 'कनेक्ट नहीं हो पाया। अपना इंटरनेट जाँचें।',
  'Could not reach Solo AI. Check your internet connection and try again.': 'Solo AI तक नहीं पहुँच पाया। इंटरनेट जाँचकर फिर कोशिश करें।',
  'Could not reach the AI. Check your connection and try again.': 'AI तक नहीं पहुँच पाया। कनेक्शन जाँचकर फिर कोशिश करें।',
  'Empty response': 'खाली जवाब',
  'Generation was stopped.': 'जवाब बनाना रोक दिया गया।',
  'Images not supported': 'इमेज समर्थित नहीं है',
  'Incorrect email or password.': 'ईमेल या पासवर्ड गलत है।',
  'Limit reached': 'सीमा पूरी हो गई',
  'Message too large': 'संदेश बहुत बड़ा है',
  'Model unavailable': 'मॉडल उपलब्ध नहीं है',
  'No access': 'अनुमति नहीं है',
  'No internet connection. Reconnect and try again — your draft is still here.': 'इंटरनेट नहीं है। दोबारा जुड़कर कोशिश करें — आपका लिखा हुआ सुरक्षित है।',
  'Not found': 'नहीं मिला',
  'Password must be at least 6 characters.': 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।',
  'Please confirm your email address first. Check your inbox for the confirmation link.': 'पहले अपना ईमेल कन्फ़र्म करें। इनबॉक्स में कन्फ़र्मेशन लिंक देखें।',
  'Please enter a valid email address.': 'कृपया सही ईमेल पता डालें।',
  'Please try again.': 'कृपया फिर कोशिश करें।',
  'Request rejected': 'अनुरोध अस्वीकार हुआ',
  'Response interrupted': 'जवाब बीच में रुक गया',
  'Signed out': 'साइन आउट हो गए',
  'Slow down': 'थोड़ा धीरे',
  'Solo AI hit a server problem. Please try again.': 'Solo AI में सर्वर की समस्या आई। कृपया फिर कोशिश करें।',
  'Something went wrong': 'कुछ गड़बड़ हो गई',
  'Stopped': 'रोका गया',
  'That model is not available right now. Switch to Auto or pick another model.': 'वह मॉडल अभी उपलब्ध नहीं है। Auto चुनें या कोई और मॉडल लें।',
  'The AI returned an empty response. Please try again.': 'AI ने खाली जवाब दिया। कृपया फिर कोशिश करें।',
  'The AI took too long to respond. Please try again.': 'AI को जवाब देने में बहुत समय लगा। कृपया फिर कोशिश करें।',
  'The owner has turned off access for this account.': 'मालिक ने इस खाते की पहुँच बंद कर दी है।',
  'The response was interrupted. You can retry to continue.': 'जवाब बीच में रुक गया। जारी रखने के लिए फिर कोशिश करें।',
  'The selected model cannot read images. Switch to Auto or pick a vision-capable model.': 'चुना हुआ मॉडल इमेज नहीं पढ़ सकता। Auto चुनें या इमेज पढ़ने वाला मॉडल लें।',
  'This conversation is too long. Start a new chat or shorten your message.': 'यह बातचीत बहुत लंबी है। नई चैट शुरू करें या संदेश छोटा करें।',
  'This conversation or attachment is too large. Start a new chat or shorten your message.': 'यह बातचीत या अटैचमेंट बहुत बड़ा है। नई चैट शुरू करें या संदेश छोटा करें।',
  'This request was blocked by the model’s content policy. Try rephrasing it.': 'यह अनुरोध मॉडल की कंटेंट नीति से रोका गया। इसे दूसरे शब्दों में लिखकर देखें।',
  'Too many attempts. Please wait a minute and try again.': 'बहुत ज़्यादा कोशिशें हो गईं। एक मिनट रुककर फिर कोशिश करें।',
  'Took too long': 'बहुत समय लगा',
  'Waiting for approval': 'मंज़ूरी का इंतज़ार',
  'You are sending messages too quickly. Wait a moment and try again.': 'आप बहुत तेज़ी से संदेश भेज रहे हैं। थोड़ा रुककर फिर कोशिश करें।',
  'You don’t have permission to do that.': 'आपको ऐसा करने की अनुमति नहीं है।',
  'You have reached your usage limit for now. Please try again later.': 'अभी के लिए आपकी उपयोग सीमा पूरी हो गई है। कृपया बाद में कोशिश करें।',
  'Your access request has not been approved yet.': 'आपके एक्सेस अनुरोध को अभी मंज़ूरी नहीं मिली है।',
  'Your session has expired. Please sign in again.': 'आपका सेशन खत्म हो गया है। कृपया फिर साइन इन करें।',
  'You’re offline': 'आप ऑफ़लाइन हैं',
  'General': 'सामान्य',
  'Appearance': 'दिखावट',
  'AI': 'AI',
  'Voice': 'आवाज़',
  'Account': 'खाता',
  'Settings sections': 'सेटिंग्स के भाग',
  'Send with Enter': 'Enter से भेजें',
  'Shift+Enter inserts a new line. When off, use ⌘/Ctrl+Enter to send.': 'Shift+Enter से नई पंक्ति बनती है। बंद होने पर भेजने के लिए ⌘/Ctrl+Enter दबाएँ।',
  'Name chats automatically': 'चैट का नाम अपने आप रखें',
  'Use your first message as the chat title.': 'आपका पहला संदेश चैट का शीर्षक बनेगा।',
  'Suggest memories': 'मेमोरी सुझाएँ',
  'Offer to remember durable preferences and facts from your messages.': 'आपके संदेशों से पक्की पसंद और बातें याद रखने का सुझाव दें।',
  'Reset all settings to defaults': 'सभी सेटिंग्स डिफ़ॉल्ट पर लौटाएँ',
  'Theme': 'थीम',
  'Light': 'हल्की',
  'Dark': 'गहरी',
  'System': 'सिस्टम',
  'Accent': 'रंग',
  'Text size': 'अक्षर का आकार',
  'Small': 'छोटा',
  'Default': 'सामान्य',
  'Large': 'बड़ा',
  'Show which model answered': 'जवाब देने वाला मॉडल दिखाएँ',
  'Display the model name under each response.': 'हर जवाब के नीचे मॉडल का नाम दिखाएँ।',
  'Default model': 'डिफ़ॉल्ट मॉडल',
  'Auto lets Solo choose the best model for each message. You can still change it per chat from the top bar.': 'Auto में Solo हर संदेश के लिए सबसे अच्छा मॉडल चुनता है। आप ऊपर की पट्टी से हर चैट में इसे बदल सकते हैं।',
  'Auto (recommended)': 'Auto (सुझाया गया)',
  'Read aloud button': 'ज़ोर से पढ़ने का बटन',
  'Show a “Read aloud” action on responses.': 'जवाबों पर “ज़ोर से पढ़ें” बटन दिखाएँ।',
  'Your browser doesn’t support speech output.': 'आपका ब्राउज़र आवाज़ में पढ़ने का समर्थन नहीं करता।',
  'Voice input uses your browser’s speech recognition and appears in the message box when available.': 'आवाज़ से लिखना आपके ब्राउज़र की स्पीच पहचान से चलता है और उपलब्ध होने पर संदेश बॉक्स में दिखता है।',
  'Signed in as': 'इस खाते से लॉगिन',
  'Sign out': 'साइन आउट',
  'Your usage today': 'आज का आपका उपयोग',
  'Loading…': 'लोड हो रहा है…',
  'Usage is not available right now.': 'उपयोग की जानकारी अभी उपलब्ध नहीं है।',
  'message': 'संदेश',
  'messages': 'संदेश',
  'image search': 'इमेज सर्च',
  'image searches': 'इमेज सर्च',
  'Counts reset daily. If a free model is busy, Solo AI automatically answers with another one and shows its name under the reply.': 'गिनती रोज़ रीसेट होती है। कोई मुफ़्त मॉडल व्यस्त हो तो Solo AI अपने आप दूसरे मॉडल से जवाब देता है और उसका नाम जवाब के नीचे दिखाता है।',
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
