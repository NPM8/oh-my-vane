'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) {
        throw new Error('Too many attempts. Try again later.');
      }
      if (!res.ok) {
        throw new Error('Invalid credentials.');
      }
      const data = await res.json();
      if (data.mfaRequired) {
        toast.error('Two-factor authentication is not available yet.');
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
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
          <LogIn className="w-8 h-8 text-[#24A0ED]" />
          <h1 className="text-lg font-medium text-black dark:text-white">
            Sign in to Vane
          </h1>
        </div>
        <input
          type="text"
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:active:scale-100"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

export default Login;
