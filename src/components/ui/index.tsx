import React from 'react';
import clsx from 'clsx';
import { Status, RecordStatus, BlacklistStatus, Blacklist } from '../../types/domain';

// Consolidated from the former ui/Card.tsx + ui/Badge.tsx into one ui module.
// Implementations are unchanged — behavior and styling are identical.

export const Card = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: React.ReactNode }) => (
  <div className={clsx("bg-panel border border-border rounded-xl p-5", className)}>
    {title && <h3 className="font-semibold text-text-main mb-4">{title}</h3>}
    {children}
  </div>
);

export const Badge = ({ status, className }: { status: Status | RecordStatus | BlacklistStatus | 'Processing' | 'Queued'; className?: string }) => {
  const getStyles = () => {
    switch (status) {
      case 'Healthy':
      case 'Pass':
      case 'Clean':
        return 'bg-status-success/10 text-status-success border-status-success/20';
      case 'Warning':
        return 'bg-status-warning/10 text-status-warning border-status-warning/20';
      case 'Critical':
      case 'Fail':
      case 'Listed':
        return 'bg-status-error/10 text-status-error border-status-error/20';
      // DNSBL still in the rate-limited queue — an in-progress accent, not a result.
      case 'Processing':
      case 'Queued':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'Unknown':
      case 'Missing':
      case 'Check Failed':
      default:
        return 'bg-status-neutral/10 text-status-neutral border-status-neutral/20';
    }
  };

  return (
    <span className={clsx("px-2 py-0.5 rounded text-xs font-medium border", getStyles(), className)}>
      {status}
    </span>
  );
};

// Map the DNSBL queue lifecycle to a display label: while a check is PENDING/QUEUED/
// RUNNING we show "Processing"/"Queued" (never a stale Clean/Listed); once DONE we
// show the real result status. Preserves the existing result info otherwise.
export function blacklistDisplayStatus(bl?: { status?: string; jobStatus?: string }): string {
  const j = bl?.jobStatus;
  if (j === 'QUEUED') return 'Queued';
  if (j === 'PENDING' || j === 'RUNNING') return 'Processing';
  return bl?.status || 'Unknown';
}

export const BlacklistBadge = ({ blacklist, className }: { blacklist: Blacklist; className?: string }) => (
  <Badge status={blacklistDisplayStatus(blacklist) as any} className={className} />
);
