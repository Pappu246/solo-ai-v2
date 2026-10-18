import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { failed: boolean }

/** Last-resort guard: a crash in one component shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UI crash]', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="h-screen flex flex-col items-center justify-center gap-4 p-6 text-center text-fg">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-fg-muted max-w-sm">Your chats are safe. Reload to continue.</p>
        <button type="button" onClick={() => window.location.reload()} className="h-9 px-4 rounded-lg bg-accent text-sm font-medium text-black">Reload</button>
      </div>
    );
  }
}
