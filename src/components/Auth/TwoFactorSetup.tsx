'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';

const TwoFactorSetup = ({ onDone }: { onDone?: () => void }) => {
  const [phase, setPhase] = useState<'idle' | 'qr' | 'codes'>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    try {
      setBusy(true);
      const res = await fetch('/api/account/2fa/setup', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start setup');
      const data = await res.json();
      setQr(data.qrDataUrl);
      setSecret(data.secret);
      setPhase('qr');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBusy(true);
      const res = await fetch('/api/account/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) throw new Error('Invalid code. Try again.');
      const data = await res.json();
      setRecovery(data.recoveryCodes);
      setPhase('codes');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]';
  const btnCls =
    'px-4 py-2.5 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] active:scale-95 transition-all duration-200 font-medium text-sm disabled:opacity-50';

  if (phase === 'idle') {
    return (
      <button onClick={begin} disabled={busy} className={btnCls}>
        {busy ? 'Starting…' : 'Enable two-factor authentication'}
      </button>
    );
  }

  if (phase === 'qr') {
    return (
      <form onSubmit={confirm} className="flex flex-col space-y-4">
        <p className="text-sm text-black/70 dark:text-white/70">
          Scan this QR code in your authenticator app, then enter the 6-digit code.
        </p>
        {qr && <Image src={qr} alt="2FA QR code" width={180} height={180} className="rounded-lg" unoptimized />}
        <p className="text-xs text-black/50 dark:text-white/50 break-all">
          Manual key: <span className="font-mono">{secret}</span>
        </p>
        <input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label="Authentication code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required className={inputCls} />
        <button type="submit" disabled={busy} className={btnCls}>{busy ? 'Verifying…' : 'Confirm'}</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col space-y-4">
      <p className="text-sm text-black dark:text-white font-medium">Save your recovery codes</p>
      <p className="text-xs text-black/50 dark:text-white/50">
        Each code works once. Store them somewhere safe — they are shown only now.
      </p>
      <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-light-secondary dark:bg-dark-secondary">
        {recovery.map((c) => (
          <span key={c} className="font-mono text-sm text-black dark:text-white">{c}</span>
        ))}
      </div>
      <button onClick={() => onDone?.()} className={btnCls}>Done</button>
    </div>
  );
};

export default TwoFactorSetup;
