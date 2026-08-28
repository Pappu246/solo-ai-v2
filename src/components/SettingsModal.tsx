import { useState } from 'react';
import { X, Sun, Moon, Monitor, Palette, Type, Brain, LogOut } from 'lucide-react';
import type { UserSettings, Theme, AccentColor } from '../types';

interface Props {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => void;
  onClose: () => void;
  onSignOut: () => void;
  userEmail?: string;
}

type Tab = 'appearance' | 'advanced';

const ACCENT_OPTIONS: { value: AccentColor; label: string; color: string }[] = [
  { value: 'amber', label: 'Amber', color: 'bg-amber-500' },
  { value: 'blue', label: 'Blue', color: 'bg-blue-500' },
  { value: 'violet', label: 'Violet', color: 'bg-violet-500' },
  { value: 'emerald', label: 'Emerald', color: 'bg-emerald-500' },
  { value: 'rose', label: 'Rose', color: 'bg-rose-500' },
  { value: 'cyan', label: 'Cyan', color: 'bg-cyan-500' },
];

export function SettingsModal({ settings, onUpdate, onClose, onSignOut, userEmail }: Props) {
  const [tab, setTab] = useState<Tab>('appearance');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl animate-scale-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-100">Settings</h2>
            {userEmail && <p className="text-xs text-zinc-500 mt-0.5">{userEmail}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1" aria-label="Close settings">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-zinc-800">
          {([['appearance', <Palette className="w-3.5 h-3.5" />, 'Appearance'], ['advanced', <Brain className="w-3.5 h-3.5" />, 'Advanced']] as [Tab, React.ReactNode, string][]).map(([id, icon, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold transition-colors ${tab === id ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {icon}{label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto max-h-[400px]">
          {tab === 'appearance' && (
            <div className="space-y-5">
              <SettingRow label="Theme" icon={<Sun className="w-4 h-4" />}>
                <div className="flex gap-2">
                  {([['dark', <Moon className="w-3.5 h-3.5" />, 'Dark'], ['light', <Sun className="w-3.5 h-3.5" />, 'Light'], ['system', <Monitor className="w-3.5 h-3.5" />, 'System']] as [Theme, React.ReactNode, string][]).map(([value, icon, label]) => (
                    <button key={value} onClick={() => onUpdate({ theme: value })} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${settings.theme === value ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>
                      {icon}{label}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Accent Color" icon={<Palette className="w-4 h-4" />}>
                <div className="flex gap-2 flex-wrap">
                  {ACCENT_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => onUpdate({ accent: opt.value })} title={opt.label} aria-label={`${opt.label} accent`} className={`w-7 h-7 rounded-full ${opt.color} transition-all duration-200 ${settings.accent === opt.value ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-zinc-950 scale-110' : 'opacity-60 hover:opacity-100'}`} />
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Font Size" icon={<Type className="w-4 h-4" />}>
                <div className="flex gap-2">
                  {(['sm', 'base', 'lg'] as const).map(size => (
                    <button key={size} onClick={() => onUpdate({ font_size: size })} className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${settings.font_size === size ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>
                      {size === 'sm' ? 'Small' : size === 'base' ? 'Medium' : 'Large'}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <ToggleRow label="Show Model Badges" description="Display which model was used for each response" checked={settings.show_model_badges} onChange={v => onUpdate({ show_model_badges: v })} />
            </div>
          )}

          {tab === 'advanced' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold text-amber-300">Provider security</p>
                <p className="text-xs text-zinc-500 mt-1">AI provider keys are managed server-side in Supabase Edge Function secrets. They are never stored in browser local storage.</p>
              </div>
              <ToggleRow label="Send on Enter" description="Press Enter to send (Shift+Enter for newline)" checked={settings.send_on_enter} onChange={v => onUpdate({ send_on_enter: v })} />
              <ToggleRow label="Auto-title Chats" description="Automatically name chats from first message" checked={settings.auto_title} onChange={v => onUpdate({ auto_title: v })} />
              <ToggleRow label="Memory System" description="Remember context across conversations (local settings only)" checked={settings.memory_enabled} onChange={v => onUpdate({ memory_enabled: v })} />
              <ToggleRow label="Text to Speech" description="Read AI responses aloud" checked={settings.tts_enabled} onChange={v => onUpdate({ tts_enabled: v })} />
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 flex justify-end">
          <button onClick={onSignOut} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 text-xs font-medium transition-all duration-200">
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div><div className="flex items-center gap-2 mb-2"><span className="text-zinc-500">{icon}</span><label className="text-sm font-semibold text-zinc-300">{label}</label></div>{children}</div>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div><p className="text-sm font-medium text-zinc-300">{label}</p><p className="text-xs text-zinc-600 mt-0.5">{description}</p></div>
      <button onClick={() => onChange(!checked)} aria-pressed={checked} className={`relative rounded-full transition-all duration-300 flex-shrink-0 ${checked ? 'bg-amber-500' : 'bg-zinc-700'}`} style={{ height: '22px', width: '40px' }}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
