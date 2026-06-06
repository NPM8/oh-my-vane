'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';

const BootstrapAdmin = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      toast.error('Password must be at least 10 characters.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create admin');
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create admin');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-2">
          <ShieldCheck className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Create admin account
          </h1>
          <p className="text-xs text-black/50 dark:text-white/50">
            This is the first and only account with full control. There is no
            sign-up page — invite others later.
          </p>
        </div>
        <input
          type="text"
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <input
          type="password"
          autoComplete="new-password"
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
          {submitting ? 'Creating…' : 'Create admin'}
        </button>
      </form>
    </div>
  );
};

export default BootstrapAdmin;
