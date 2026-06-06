'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LogIn, ShieldCheck } from 'lucide-react';

const Login = () => {
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [mfaToken, setMfaToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!res.ok) throw new Error('Invalid credentials.');
      const data = await res.json();
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setStep('mfa');
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code }),
      });
      if (res.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!res.ok) throw new Error('Invalid code.');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';
  const btnCls =
    'w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100';

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
        {step === 'password' ? (
          <>
            <div className="flex flex-col items-center text-center space-y-2">
              <LogIn className="w-8 h-8 text-[#24A0ED]" />
              <h1 className="text-lg font-medium text-black dark:text-white">Sign in to Vane</h1>
            </div>
            <form onSubmit={submitPassword} className="flex flex-col space-y-5">
              <input type="text" autoComplete="username" aria-label="Username" autoFocus placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required className={inputCls} />
              <input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              <button type="submit" disabled={submitting} className={btnCls}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-[#24A0ED]" />
              <h1 className="text-lg font-medium text-black dark:text-white">Two-factor authentication</h1>
              <p className="text-xs text-black/50 dark:text-white/50">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
            </div>
            <form onSubmit={submitCode} className="flex flex-col space-y-5">
              <input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label="Authentication code" autoFocus placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
              <button type="submit" disabled={submitting} className={btnCls}>{submitting ? 'Verifying…' : 'Verify'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;
