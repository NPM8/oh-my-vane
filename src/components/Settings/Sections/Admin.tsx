import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Trash, Ban, KeyRound, UserPlus, RotateCcw, Copy } from 'lucide-react';

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

const Admin = (_props: { fields?: unknown; values?: unknown }) => {
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [requireTwoFactor, setRequireTwoFactor] = useState(false);
  const [newInvite, setNewInvite] = useState<{
    link: string;
    expiresAt: string;
  } | null>(null);

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
      <div className="px-6 py-16 text-center text-sm text-black/50 dark:text-white/50">
        This area is for administrators only.
      </div>
    );
  }

  const iconBtn =
    'p-2 rounded-lg text-black/60 dark:text-white/60 hover:bg-light-200 hover:dark:bg-dark-200 transition duration-200';

  return (
    <div className="px-6 py-6 space-y-8">
      <div className="flex flex-col space-y-3">
        <div className="flex flex-col">
          <h4 className="text-sm font-medium text-black dark:text-white">
            Security
          </h4>
          <p className="text-xs text-black/50 dark:text-white/50">
            Require two-factor authentication for every account.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-black/70 dark:text-white/70">
            Require two-factor for everyone
          </p>
          <button
            onClick={() =>
              act(
                () =>
                  fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      requireTwoFactor: !requireTwoFactor,
                    }),
                  }),
                'Updated',
              )
            }
            className={
              requireTwoFactor
                ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-[#24A0ED] text-white'
                : 'px-3 py-1.5 rounded-lg text-sm font-medium border border-light-200 dark:border-dark-200 text-black/70 dark:text-white/70'
            }
          >
            {requireTwoFactor ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h4 className="text-sm font-medium text-black dark:text-white">
              Invitations
            </h4>
            <p className="text-xs text-black/50 dark:text-white/50">
              Create one-time links to invite new users.
            </p>
          </div>
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
              if (data?.token) {
                // Build the link from the URL the admin is actually on, so it's
                // reachable by invitees (not the container-internal origin).
                const link = `${window.location.origin}/invite/${data.token}`;
                setNewInvite({ link, expiresAt: data.invite?.expiresAt ?? '' });
                try {
                  await navigator.clipboard.writeText(link);
                  toast.success('Invite link copied');
                } catch {
                  // clipboard blocked on plain HTTP — link is shown below to copy manually
                }
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#24A0ED] text-white text-sm font-medium shrink-0"
          >
            <UserPlus size={15} /> New invite
          </button>
        </div>
        {newInvite && (
          <div className="flex flex-col gap-2 p-3 rounded-lg bg-light-secondary dark:bg-dark-secondary">
            <p className="text-xs text-black/50 dark:text-white/50">
              Invite link — copy now, shown once
              {newInvite.expiresAt
                ? `. Expires ${new Date(newInvite.expiresAt).toLocaleString()}`
                : ''}
              :
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={newInvite.link}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 px-2 py-1.5 rounded-md bg-light-primary dark:bg-dark-primary text-xs font-mono text-black dark:text-white border border-light-200 dark:border-dark-200"
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newInvite.link);
                    toast.success('Copied');
                  } catch {
                    toast.error(
                      'Copy blocked — select the text and copy manually',
                    );
                  }
                }}
                className={iconBtn}
                title="Copy link"
                aria-label="Copy invite link"
              >
                <Copy size={16} />
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {invites.length === 0 && (
            <p className="text-xs text-black/50 dark:text-white/50">
              No invites.
            </p>
          )}
          {invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="text-black/70 dark:text-white/70">
                {i.role} · {i.status} · expires{' '}
                {new Date(i.expiresAt).toLocaleString()}
              </span>
              {i.status === 'pending' && (
                <button
                  onClick={() =>
                    act(
                      () =>
                        fetch(`/api/admin/invites/${i.id}`, {
                          method: 'DELETE',
                        }),
                      'Invite revoked',
                    )
                  }
                  className={iconBtn}
                  title="Revoke"
                  aria-label="Revoke invite"
                >
                  <Trash size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h4 className="text-sm font-medium text-black dark:text-white">
            Users
          </h4>
          <p className="text-xs text-black/50 dark:text-white/50">
            Manage existing accounts and their access.
          </p>
        </div>
        <div className="flex flex-col divide-y divide-light-200 dark:divide-dark-200">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between py-2.5 gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-black dark:text-white truncate">
                  {u.username}{' '}
                  <span className="text-xs text-black/40 dark:text-white/40">
                    {u.role}
                    {u.disabled ? ' · disabled' : ''}
                    {u.totpEnabled ? ' · 2FA' : ''}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() =>
                    act(
                      () =>
                        fetch(`/api/admin/users/${u.id}/disable`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ disabled: !u.disabled }),
                        }),
                      u.disabled ? 'Enabled' : 'Disabled',
                    )
                  }
                  className={iconBtn}
                  title={u.disabled ? 'Enable' : 'Disable'}
                  aria-label="Toggle disabled"
                >
                  <Ban size={16} className={u.disabled ? 'text-[#24A0ED]' : ''} />
                </button>
                {u.totpEnabled && (
                  <button
                    onClick={() =>
                      act(
                        () =>
                          fetch(`/api/admin/users/${u.id}/2fa/reset`, {
                            method: 'POST',
                          }),
                        '2FA reset',
                      )
                    }
                    className={iconBtn}
                    title="Reset 2FA"
                    aria-label="Reset 2FA"
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
                <button
                  onClick={async () => {
                    const d = await act(
                      () =>
                        fetch(`/api/admin/users/${u.id}/password/reset`, {
                          method: 'POST',
                        }),
                      'Password reset',
                    );
                    if (d?.tempPassword) {
                      try {
                        await navigator.clipboard.writeText(d.tempPassword);
                        toast.success('Temp password copied');
                      } catch {
                        toast.message(`Temp password: ${d.tempPassword}`);
                      }
                    }
                  }}
                  className={iconBtn}
                  title="Reset password"
                  aria-label="Reset password"
                >
                  <KeyRound size={16} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ${u.username}?`))
                      act(
                        () =>
                          fetch(`/api/admin/users/${u.id}`, {
                            method: 'DELETE',
                          }),
                        'User deleted',
                      );
                  }}
                  className={iconBtn}
                  title="Delete"
                  aria-label="Delete user"
                >
                  <Trash size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Admin;
