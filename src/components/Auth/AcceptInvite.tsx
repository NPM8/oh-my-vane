'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

const AcceptInvite = ({ token }: { token: string }) => {
  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/invite/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        setState(data.valid ? 'valid' : 'invalid');
      } catch {
        setState('invalid');
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      toast.error('Password must be at least 10 characters.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to accept invitation');
      }
      window.location.href = '/';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept invitation');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
        <div className="flex flex-col items-center text-center space-y-2">
          <UserPlus className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Accept your invitation
          </h1>
        </div>

        {state === 'checking' && (
          <p className="text-center text-xs text-black/50 dark:text-white/50">
            Checking invitation…
          </p>
        )}

        {state === 'invalid' && (
          <p className="text-center text-sm text-black/70 dark:text-white/70">
            This invitation is invalid, expired, or has already been used. Ask an
            admin for a new link.
          </p>
        )}

        {state === 'valid' && (
          <form onSubmit={submit} className="flex flex-col space-y-5">
            <input
              type="text"
              autoComplete="username"
              aria-label="Username"
              autoFocus
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Password"
              placeholder="Password (min 10 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100"
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AcceptInvite;
