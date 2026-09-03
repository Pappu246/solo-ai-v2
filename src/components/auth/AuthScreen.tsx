import { useState } from 'react';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { Button, Logo } from '../ui';

export type AuthResult = { needsEmailConfirmation: boolean };

interface Props {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<AuthResult>;
}

export function AuthScreen({ onSignIn, onSignUp }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const result = await onSignUp(email.trim(), password);
        if (result.needsEmailConfirmation) setConfirmationSent(true);
      } else {
        await onSignIn(email.trim(), password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => { setMode(m => (m === 'signin' ? 'signup' : 'signin')); setError(null); };

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={44} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Solo AI</h1>
          <p className="mt-1 text-sm text-fg-muted">Your AI workspace</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          {confirmationSent ? (
            <div className="text-center py-2">
              <MailCheck className="w-8 h-8 text-success mx-auto" />
              <h2 className="mt-3 text-base font-semibold text-fg">Check your inbox</h2>
              <p className="mt-1.5 text-sm text-fg-muted">We sent a confirmation link to <span className="text-fg font-medium break-all">{email}</span>. Open it, then come back to sign in.</p>
              <Button className="mt-5 w-full" variant="secondary" onClick={() => { setConfirmationSent(false); setMode('signin'); }}>Back to sign in</Button>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-fg mb-4">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
              <form onSubmit={submit} className="space-y-3" noValidate>
                <label className="block">
                  <span className="block text-xs font-medium text-fg-muted mb-1.5">Email</span>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    autoComplete="email" required autoFocus inputMode="email"
                    className="w-full h-10 px-3 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-fg-muted mb-1.5">Password</span>
                  <span className="relative block">
                    <input
                      type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6}
                      className="w-full h-10 pl-3 pr-10 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong"
                      placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-fg-subtle hover:text-fg">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </span>
                </label>

                {error && <p role="alert" className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

                <Button type="submit" variant="primary" size="lg" className="w-full mt-1" loading={loading} disabled={!email || password.length < 6}>
                  {mode === 'signup' ? 'Create account' : 'Sign in'}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-fg-muted">
                {mode === 'signup' ? 'Already have an account?' : 'New to Solo AI?'}{' '}
                <button type="button" onClick={switchMode} className="font-medium text-accent hover:underline">
                  {mode === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
