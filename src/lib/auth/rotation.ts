export type RotationDecision =
  | { action: 'rotate' }
  | { action: 'reuse_detected' }
  | { action: 'invalid' };

export const decideRefresh = (
  row: { revokedAt: string | null; expiresAt: string } | undefined,
  now: number,
): RotationDecision => {
  if (!row) return { action: 'invalid' };
  if (row.revokedAt) return { action: 'reuse_detected' };
  if (new Date(row.expiresAt).getTime() <= now) return { action: 'invalid' };
  return { action: 'rotate' };
};
