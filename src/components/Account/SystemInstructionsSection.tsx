'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const SystemInstructionsSection = () => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/account/preferences')
      .then((r) => (r.ok ? r.json() : { preferences: {} }))
      .then((d) => setValue(d.preferences?.systemInstructions ?? ''))
      .catch(() => {});
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/account/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstructions: value }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('System instructions saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-light-200 dark:border-dark-200 rounded-xl p-5 flex flex-col space-y-3">
      <h2 className="text-sm font-medium text-black dark:text-white">System instructions</h2>
      <p className="text-xs text-black/50 dark:text-white/50">
        Personal instructions added to every search you run. Saved to your account.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="e.g. Always answer concisely and cite sources."
        className="w-full px-3 py-2.5 rounded-lg bg-light-secondary dark:bg-dark-secondary text-sm text-black dark:text-white border border-light-200 dark:border-dark-200 focus:outline-none focus:border-[#24A0ED]"
      />
      <button
        onClick={save}
        disabled={saving}
        className="self-start px-4 py-2 rounded-lg bg-[#24A0ED] text-white hover:bg-[#1e8fd1] text-sm font-medium disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
};

export default SystemInstructionsSection;
