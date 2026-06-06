'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Trash, Ban, KeyRound, UserPlus, RotateCcw } from 'lucide-react';

interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}
interface InviteRow {
  id: string;
  role: string;
  expiresAt: string;
  status: 'pending' | 'used' | 'expired';
}

const AdminPanel = () => {
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [requireTwoFactor, setRequireTwoFactor] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    setUsers((await res.json()).users);
    const inv = await fetch('/api/admin/invites');
    if (inv.ok) setInvites((await inv.json()).invites);
    const s = await fetch('/api/admin/settings');
    if (s.ok) setRequireTwoFactor((await s.json()).requireTwoFactor);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>, okMsg: string) => {
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Action failed');
      }
      const data = await res.json().catch(() => ({}));
      toast.success(okMsg);
      await load();
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (forbidden) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-black/60 dark:text-white/60">
        This area is for administrators only.
      </div>
    );
  }

  const btn = 'p-2 rounded-lg hover:bg-light-secondary dark:hover:bg-dark-secondary text-black/60 dark:text-white/60';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col space-y-8">
      <div className="flex items-center space-x-2">
        <ShieldCheck className="w-6 h-6 text-[#24A0ED]" />
        <h1 className="text-xl font-medium text-black dark:text-white">Administration</h1>
      </div>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-black dark:text-white">Require two-factor for everyone</h2>
          <button
            onClick={() =>
              act(
                () =>
                  fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requireTwoFactor: !requireTwoFactor }),
                  }),
                'Updated',
              )
            }
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${requireTwoFactor ? 'bg-[#24A0ED] text-white' : 'border border-light-200 dark:border-dark-200 text-black/70 dark:text-white/70'}`}
          >
            {requireTwoFactor ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-black dark:text-white">Invitations</h2>
          <button
            onClick={async () => {
              const data = await act(
                () =>
                  fetch('/api/admin/invites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'user', ttlHours: 48 }),
                  }),
                'Invite created',
              );
              if (data?.link) {
                try {
                  await navigator.clipboard.writeText(data.link);
                  toast.success('Invite link copied');
                } catch {
                  toast.message(data.link);
                }
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#24A0ED] text-white text-sm font-medium"
          >
            <UserPlus size={15} /> New invite
          </button>
        </div>
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {invites.length === 0 && <p className="text-xs text-black/50 dark:text-white/50">No invites.</p>}
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-black/70 dark:text-white/70">{i.role} · {i.status}</span>
              {i.status === 'pending' && (
                <button onClick={() => act(() => fetch(`/api/admin/invites/${i.id}`, { method: 'DELETE' }), 'Invite revoked')} className={btn} title="Revoke" aria-label="Revoke invite">
                  <Trash size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-4">
        <h2 className="text-sm font-medium text-black dark:text-white">Users</h2>
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm text-black dark:text-white truncate">
                  {u.username}{' '}
                  <span className="text-xs text-black/40 dark:text-white/40">{u.role}{u.disabled ? ' · disabled' : ''}{u.totpEnabled ? ' · 2FA' : ''}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => act(() => fetch(`/api/admin/users/${u.id}/disable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: !u.disabled }) }), u.disabled ? 'Enabled' : 'Disabled')} className={btn} title={u.disabled ? 'Enable' : 'Disable'} aria-label="Toggle disabled">
                  <Ban size={16} className={u.disabled ? 'text-[#24A0ED]' : ''} />
                </button>
                {u.totpEnabled && (
                  <button onClick={() => act(() => fetch(`/api/admin/users/${u.id}/2fa/reset`, { method: 'POST' }), '2FA reset')} className={btn} title="Reset 2FA" aria-label="Reset 2FA">
                    <RotateCcw size={16} />
                  </button>
                )}
                <button onClick={async () => { const d = await act(() => fetch(`/api/admin/users/${u.id}/password/reset`, { method: 'POST' }), 'Password reset'); if (d?.tempPassword) { try { await navigator.clipboard.writeText(d.tempPassword); toast.success('Temp password copied'); } catch { toast.message(`Temp password: ${d.tempPassword}`); } } }} className={btn} title="Reset password" aria-label="Reset password">
                  <KeyRound size={16} />
                </button>
                <button onClick={() => { if (confirm(`Delete ${u.username}?`)) act(() => fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' }), 'User deleted'); }} className={btn} title="Delete" aria-label="Delete user">
                  <Trash size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AdminPanel;
