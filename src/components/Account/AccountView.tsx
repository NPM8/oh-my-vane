'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import TwoFactorSetup from '../Auth/TwoFactorSetup';
import PasswordSection from './PasswordSection';

const AccountView = ({ forceEnroll = false }: { forceEnroll?: boolean }) => {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/account/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code: code.trim() }),
      });
      if (!res.ok) throw new Error('Invalid password or code.');
      toast.success('Two-factor disabled.');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable');
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';

  return (
    <div className="max-w-md mx-auto px-4 py-10 flex flex-col space-y-6">
      <div className="flex items-center space-x-2">
        <ShieldCheck className="w-6 h-6 text-[#24A0ED]" />
        <h1 className="text-xl font-medium text-black dark:text-white">Account security</h1>
      </div>

      {forceEnroll && (
        <p className="text-sm text-[#24A0ED]">
          Your administrator requires two-factor authentication. Set it up to continue.
        </p>
      )}

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Password</h2>
        <PasswordSection />
      </section>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Two-factor authentication</h2>
        <TwoFactorSetup onDone={() => window.location.reload()} />

        {!forceEnroll && (
          <details className="pt-2">
            <summary className="text-xs text-black/50 dark:text-white/50 cursor-pointer flex items-center gap-1">
              <ShieldOff className="w-3.5 h-3.5" /> Disable two-factor
            </summary>
            <form onSubmit={disable} className="flex flex-col space-y-3 pt-3">
              <input type="password" aria-label="Password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              <input type="text" inputMode="numeric" aria-label="Authentication code" placeholder="Current 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
              <button type="submit" className="px-4 py-2 rounded-lg border border-light-200 dark:border-dark-200 text-sm text-black dark:text-white hover:bg-light-secondary dark:hover:bg-dark-secondary">Disable two-factor</button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
};

export default AccountView;
