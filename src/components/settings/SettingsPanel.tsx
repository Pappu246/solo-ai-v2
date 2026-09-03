import { useState, type ReactNode } from 'react';
import { Sun, Moon, Monitor, SlidersHorizontal, Palette, Sparkles, Volume2, UserRound, LogOut } from 'lucide-react';
import type { UserSettings, Theme, FontSize, AIModel } from '../../types';
import { ACCENT_OPTIONS } from '../../types';
import { Dialog, Toggle, Button } from '../ui';
import { speak, stop as stopSpeaking } from '../../lib/tts';
import { cn } from '../../lib/cn';

type Section = 'general' | 'appearance' | 'ai' | 'voice' | 'account';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onUpdate: (patch: Partial<UserSettings>) => void;
  onReset: () => void;
  models: AIModel[];
  userEmail?: string;
  onSignOut: () => void;
}

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'ai', label: 'AI', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'voice', label: 'Voice', icon: <Volume2 className="w-4 h-4" /> },
  { id: 'account', label: 'Account', icon: <UserRound className="w-4 h-4" /> },
];

const ACCENT_SWATCH: Record<string, string> = {
  amber: 'bg-amber-500', blue: 'bg-blue-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500', cyan: 'bg-cyan-500',
};

export function SettingsPanel({ open, onClose, settings, onUpdate, onReset, models, userEmail, onSignOut }: Props) {
  const [section, setSection] = useState<Section>('general');
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <Dialog open={open} onClose={onClose} title="Settings" size="lg" className="sm:h-[560px]">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 h-full -mx-1">
        <nav aria-label="Settings sections" className="flex sm:flex-col gap-1 sm:w-40 shrink-0 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={cn('flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm whitespace-nowrap transition-colors', section === s.id ? 'bg-surface-2 text-fg font-medium' : 'text-fg-muted hover:text-fg hover:bg-surface-2/60')}
            >
              {s.icon}{s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 sm:overflow-y-auto sm:pr-1">
          {section === 'general' && (
            <Group title="General">
              <Toggle label="Send with Enter" description="Shift+Enter inserts a new line. When off, use ⌘/Ctrl+Enter to send." checked={settings.send_on_enter} onChange={v => onUpdate({ send_on_enter: v })} />
              <Toggle label="Name chats automatically" description="Use your first message as the chat title." checked={settings.auto_title} onChange={v => onUpdate({ auto_title: v })} />
              <div className="pt-4 mt-2 border-t border-border">
                <Button size="sm" variant="ghost" onClick={onReset}>Reset all settings to defaults</Button>
              </div>
            </Group>
          )}

          {section === 'appearance' && (
            <Group title="Appearance">
              <Field label="Theme">
                <Segmented<Theme>
                  value={settings.theme}
                  onChange={theme => onUpdate({ theme })}
                  options={[
                    { value: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
                    { value: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
                    { value: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
                  ]}
                />
              </Field>
              <Field label="Accent">
                <div role="radiogroup" aria-label="Accent color" className="flex gap-2">
                  {ACCENT_OPTIONS.map(a => (
                    <button
                      key={a.value}
                      type="button"
                      role="radio"
                      aria-checked={settings.accent === a.value}
                      aria-label={a.label}
                      title={a.label}
                      onClick={() => onUpdate({ accent: a.value })}
                      className={cn('w-7 h-7 rounded-full transition-transform', ACCENT_SWATCH[a.value], settings.accent === a.value ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg scale-105' : 'opacity-70 hover:opacity-100')}
                    />
                  ))}
                </div>
              </Field>
              <Field label="Text size">
                <Segmented<FontSize>
                  value={settings.font_size}
                  onChange={font_size => onUpdate({ font_size })}
                  options={[{ value: 'sm', label: 'Small' }, { value: 'base', label: 'Default' }, { value: 'lg', label: 'Large' }]}
                />
              </Field>
              <Toggle label="Show which model answered" description="Display the model name under each response." checked={settings.show_model_badges} onChange={v => onUpdate({ show_model_badges: v })} />
            </Group>
          )}

          {section === 'ai' && (
            <Group title="AI">
              <Field label="Default model" hint="Auto lets Solo choose the best model for each message. You can still change it per chat from the top bar.">
                <select
                  value={settings.preferred_model ?? ''}
                  onChange={e => onUpdate({ preferred_model: e.target.value || null })}
                  aria-label="Default model"
                  className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-sm text-fg outline-none focus:border-border-strong"
                >
                  <option value="">Auto (recommended)</option>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}
                  {settings.preferred_model && !models.some(m => m.id === settings.preferred_model) && (
                    <option value={settings.preferred_model}>{settings.preferred_model}</option>
                  )}
                </select>
              </Field>
              <p className="text-xs text-fg-subtle leading-relaxed">
                Provider API keys are stored server-side and never reach the browser. Memory, projects and tools arrive in later releases.
              </p>
            </Group>
          )}

          {section === 'voice' && (
            <Group title="Voice">
              {!ttsSupported && <p className="text-sm text-fg-muted">Your browser doesn’t support speech output.</p>}
              <Toggle label="Read aloud button" description="Show a “Read aloud” action on responses." checked={settings.tts_enabled} onChange={v => onUpdate({ tts_enabled: v })} disabled={!ttsSupported} />
              <Field label={`Speaking rate · ${settings.tts_rate.toFixed(1)}×`}>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={0.5} max={2} step={0.1}
                    value={settings.tts_rate}
                    onChange={e => onUpdate({ tts_rate: Number(e.target.value) })}
                    disabled={!ttsSupported || !settings.tts_enabled}
                    aria-label="Speaking rate"
                    className="flex-1 accent-[rgb(var(--accent))]"
                  />
                  <Button size="sm" variant="secondary" disabled={!ttsSupported || !settings.tts_enabled} onClick={() => { stopSpeaking(); speak('This is how Solo AI sounds when reading aloud.', settings.tts_rate); }}>
                    Preview
                  </Button>
                </div>
              </Field>
              <p className="text-xs text-fg-subtle">Voice input uses your browser’s speech recognition and appears in the message box when available.</p>
            </Group>
          )}

          {section === 'account' && (
            <Group title="Account">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs text-fg-subtle">Signed in as</p>
                <p className="text-sm font-medium text-fg mt-0.5 break-all">{userEmail ?? '—'}</p>
              </div>
              <div className="pt-2">
                <Button variant="danger" size="md" leftIcon={<LogOut className="w-4 h-4" />} onClick={onSignOut}>Sign out</Button>
              </div>
            </Group>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <h3 className="sr-only">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <p className="text-sm font-medium text-fg mb-2">{label}</p>
      {children}
      {hint && <p className="text-xs text-fg-muted mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[] }) {
  return (
    <div role="radiogroup" className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg')}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
