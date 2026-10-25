import { Download, Menu, PanelLeftOpen } from 'lucide-react';
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
  /** When set, shows a button that downloads the open chat. */
  onExport?: () => void;
}

export function Topbar({ title, models, selectedModel, onSelectModel, sidebarCollapsed, onOpenSidebar, onOpenMobileSidebar, disabled, onExport }: TopbarProps) {
  return (
    <header className="relative z-30 flex items-center justify-between min-h-14 pt-env px-2 sm:px-3 shrink-0 glass border-b border-border">
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
      <div className="flex items-center gap-1 shrink-0">
        {onExport && <IconButton label="Export chat as Markdown" onClick={onExport} tooltipPosition="bottom"><Download className="w-4 h-4" /></IconButton>}
        <ModelSelector models={models} selected={selectedModel} onSelect={onSelectModel} disabled={disabled} />
      </div>
    </header>
  );
}
