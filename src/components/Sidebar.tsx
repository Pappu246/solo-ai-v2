import { useState, useCallback } from 'react';
import {
  MessageSquarePlus, Trash2, X, Zap, Search, Pin, PinOff,
  MoreHorizontal, Pencil, Check, ChevronDown, Settings
} from 'lucide-react';
import type { Conversation } from '../types';

interface Props {
  conversations: Conversation[];
  filteredConversations: Conversation[];
  activeId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (c: Conversation) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  userEmail?: string;
}

export function Sidebar({
  filteredConversations, activeId, searchQuery, onSearchChange,
  onSelect, onNew, onDelete, onRename, onPin,
  isOpen, onClose, onOpenSettings, userEmail,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);

  const startRename = useCallback((c: Conversation) => {
    setRenamingId(c.id);
    setRenameValue(c.title);
    setMenuId(null);
  }, []);

  const commitRename = useCallback((id: string) => {
    if (renameValue.trim()) onRename(id, renameValue.trim());
    setRenamingId(null);
  }, [renameValue, onRename]);

  const pinned = filteredConversations.filter(c => c.pinned);
  const recent = filteredConversations.filter(c => !c.pinned);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside className={`fixed md:relative z-50 md:z-auto top-0 left-0 h-full w-72 bg-[#0d0d0e] border-r border-zinc-800/60 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Header */}
        <div className="p-4 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Zap className="w-4 h-4 text-black" fill="black" />
              </div>
              <div>
                <h1 className="text-sm font-black tracking-widest text-amber-400">SOLO AI</h1>
                <p className="text-[9px] text-zinc-600 -mt-0.5 font-medium">Multi-Model Intelligence</p>
              </div>
            </div>
            <button onClick={onClose} className="md:hidden text-zinc-500 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* New chat */}
          <button
            onClick={() => { onNew(); onClose(); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-amber-500/25 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/40 transition-all duration-200 text-sm font-semibold group"
          >
            <MessageSquarePlus className="w-4 h-4 group-hover:rotate-12 transition-transform duration-200" />
            New Chat
          </button>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-zinc-900/60 border border-zinc-700/40 rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 input-focus transition-all duration-200"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {pinned.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1.5 mt-1">
                <Pin className="w-3 h-3 text-zinc-600" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Pinned</span>
              </div>
              {pinned.map(c => (
                <ConvItem
                  key={c.id} conv={c} activeId={activeId}
                  renamingId={renamingId} renameValue={renameValue}
                  menuId={menuId} setMenuId={setMenuId}
                  onSelect={() => { onSelect(c); onClose(); }}
                  onDelete={onDelete} onPin={onPin}
                  startRename={startRename}
                  setRenameValue={setRenameValue}
                  commitRename={commitRename}
                />
              ))}
              {recent.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 mt-2">
                  <ChevronDown className="w-3 h-3 text-zinc-600" />
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Recent</span>
                </div>
              )}
            </>
          )}
          {recent.map(c => (
            <ConvItem
              key={c.id} conv={c} activeId={activeId}
              renamingId={renamingId} renameValue={renameValue}
              menuId={menuId} setMenuId={setMenuId}
              onSelect={() => { onSelect(c); onClose(); }}
              onDelete={onDelete} onPin={onPin}
              startRename={startRename}
              setRenameValue={setRenameValue}
              commitRename={commitRename}
            />
          ))}
          {filteredConversations.length === 0 && (
            <p className="text-zinc-600 text-xs text-center py-10 px-4">
              {searchQuery ? 'No matching chats' : 'No conversations yet'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800/60">
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-all duration-200 group"
          >
            <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-xs font-medium truncate">{userEmail || 'Settings'}</p>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}

interface ConvItemProps {
  conv: Conversation;
  activeId: string | null;
  renamingId: string | null;
  renameValue: string;
  menuId: string | null;
  setMenuId: (id: string | null) => void;
  onSelect: () => void;
  onDelete: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  startRename: (c: Conversation) => void;
  setRenameValue: (v: string) => void;
  commitRename: (id: string) => void;
}

function ConvItem({ conv, activeId, renamingId, renameValue, menuId, setMenuId, onSelect, onDelete, onPin, startRename, setRenameValue, commitRename }: ConvItemProps) {
  const isActive = activeId === conv.id;
  const isRenaming = renamingId === conv.id;
  const isMenuOpen = menuId === conv.id;

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
        isActive
          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
          : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200 border border-transparent'
      }`}
      onClick={() => { if (!isRenaming) onSelect(); }}
    >
      {conv.pinned && <Pin className="w-2.5 h-2.5 text-amber-500/60 flex-shrink-0" />}
      {isRenaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onBlur={() => commitRename(conv.id)}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(conv.id); if (e.key === 'Escape') { setRenameValue(''); } }}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-zinc-800 text-xs text-zinc-100 px-2 py-1 rounded border border-amber-500/40 outline-none"
        />
      ) : (
        <span className="flex-1 text-xs truncate">{conv.title}</span>
      )}

      {isRenaming ? (
        <button onClick={e => { e.stopPropagation(); commitRename(conv.id); }} className="text-emerald-400">
          <Check className="w-3.5 h-3.5" />
        </button>
      ) : (
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity duration-200">
          <button
            onClick={e => { e.stopPropagation(); setMenuId(isMenuOpen ? null : conv.id); }}
            className="p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Context menu */}
      {isMenuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); setMenuId(null); }} />
          <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl z-40 overflow-hidden animate-scale-in">
            <button onClick={e => { e.stopPropagation(); startRename(conv); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors">
              <Pencil className="w-3 h-3" /> Rename
            </button>
            <button onClick={e => { e.stopPropagation(); onPin(conv.id, !conv.pinned); setMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors">
              {conv.pinned ? <><PinOff className="w-3 h-3" /> Unpin</> : <><Pin className="w-3 h-3" /> Pin</>}
            </button>
            <div className="border-t border-zinc-700/50 my-0.5" />
            <button onClick={e => { e.stopPropagation(); onDelete(conv.id); setMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
