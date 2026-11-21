// Apply the saved theme before first paint to avoid a flash.
// The warm light theme is the default; "system" still follows the OS.
try {
  var s = JSON.parse(localStorage.getItem('solo-ai-settings') || '{}');
  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var t = s.theme === 'dark' ? 'dark'
        : s.theme === 'light' || s.theme === undefined ? 'light'
        : mq ? 'dark' : 'light';
  if (t === 'dark') document.documentElement.classList.add('dark');
  if (s.accent) document.documentElement.setAttribute('data-accent', s.accent);
} catch (e) {}
