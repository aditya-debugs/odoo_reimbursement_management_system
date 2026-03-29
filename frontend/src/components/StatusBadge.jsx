const map = {
  pending: { label: 'Pending', className: 'badge badge-warn' },
  approved: { label: 'Approved', className: 'badge badge-ok' },
  rejected: { label: 'Rejected', className: 'badge badge-bad' },
  cancelled: { label: 'Cancelled', className: 'badge badge-muted' },
  skipped: { label: 'Skipped', className: 'badge badge-muted' },
};

export default function StatusBadge({ status }) {
  const s = map[status] || { label: status, className: 'badge' };
  return <span className={s.className}>{s.label}</span>;
}
