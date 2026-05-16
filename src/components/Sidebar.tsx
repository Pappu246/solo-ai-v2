import { MessageSquarePlus, Trash2, X, Zap } from 'lucide-react';
import type { Conversation } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (c: Conversation) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, isOpen, onClose }: SidebarProps) {
  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={onClose} />
      )}
      <aside
        className={`fixed md:relative z-50 md:z-auto top-0 left-0 h-full w-72 bg-zinc-950 border-r border-zinc-800/80 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-zinc-800/80">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Zap className="w-5 h-5 text-black" />
              </div>
              <div>
                <h1 className="text-base font-bold text-amber-400 tracking-wide">SOLO AI</h1>
                <p className="text-[9px] text-zinc-500 -mt-0.5">Multi-Model Intelligence</p>
              </div>
            </div>
            <button onClick={onClose} className="md:hidden text-zinc-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={() => { onNew(); onClose(); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all duration-200 text-sm font-medium group"
          >
            <MessageSquarePlus className="w-4 h-4 group-hover:rotate-12 transition-transform duration-200" />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
                activeId === c.id
                  ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                  : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200 border border-transparent'
              }`}
              onClick={() => { onSelect(c); onClose(); }}
            >
              <span className="flex-1 text-sm truncate">{c.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all duration-200"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-zinc-600 text-xs text-center py-8">No conversations yet</p>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800/80">
          <div className="flex items-center gap-2 justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[10px] text-zinc-500">12 Models Online</p>
          </div>
        </div>
      </aside>
    </>
  );
}
