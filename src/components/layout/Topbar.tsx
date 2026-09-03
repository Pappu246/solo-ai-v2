import { Menu, PanelLeftOpen } from 'lucide-react';
import type { AIModel } from '../../types';
import { ModelSelector } from '../chat/ModelSelector';
import { IconButton, Logo, Wordmark } from '../ui';

interface TopbarProps {
  title: string | null;
  models: AIModel[];
  selectedModel: string | null;
  onSelectModel: (id: string | null) => void;
  sidebarCollapsed: boolean;
  onOpenSidebar: () => void;
  onOpenMobileSidebar: () => void;
  disabled?: boolean;
}

export function Topbar({ title, models, selectedModel, onSelectModel, sidebarCollapsed, onOpenSidebar, onOpenMobileSidebar, disabled }: TopbarProps) {
  return (
    <header className="flex items-center justify-between h-14 px-2 sm:px-3 shrink-0">
      <div className="flex items-center gap-1 min-w-0">
        <IconButton label="Open menu" onClick={onOpenMobileSidebar} className="md:hidden"><Menu className="w-5 h-5" /></IconButton>
        {sidebarCollapsed && (
          <IconButton label="Open sidebar" onClick={onOpenSidebar} className="hidden md:inline-flex"><PanelLeftOpen className="w-4 h-4" /></IconButton>
        )}
        {title ? (
          <h1 className="text-sm font-medium text-fg truncate px-1.5" title={title}>{title}</h1>
        ) : (
          <div className="flex items-center gap-2 px-1.5 md:hidden">
            <Logo size={22} /><Wordmark className="text-sm" />
          </div>
        )}
      </div>
      <ModelSelector models={models} selected={selectedModel} onSelect={onSelectModel} disabled={disabled} />
    </header>
  );
}
