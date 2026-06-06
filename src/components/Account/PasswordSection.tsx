'use client';

import { useState } from 'react';
import { toast } from 'sonner';

const PasswordSection = ({ forced = false }: { forced?: boolean }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) {
      toast.error('New password must be at least 10 characters.');
      return;
    }
    try {
      setBusy(true);
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Failed to change password');
      }
      toast.success('Password changed.');
      window.location.href = '/';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';

  return (
    <form onSubmit={submit} className="flex flex-col space-y-3">
      <input type="password" autoComplete="current-password" aria-label="Current password" placeholder={forced ? 'Temporary password' : 'Current password'} value={current} onChange={(e) => setCurrent(e.target.value)} required className={inputCls} />
      <input type="password" autoComplete="new-password" aria-label="New password" placeholder="New password (min 10 chars)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} className={inputCls} />
      <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
};

export default PasswordSection;
