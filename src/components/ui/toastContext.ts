import { createContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; defaults to 4000 (errors 6000). */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastItem extends ToastOptions { id: number; tone: ToastTone }

export interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
