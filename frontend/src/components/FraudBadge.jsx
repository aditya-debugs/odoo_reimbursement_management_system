export default function FraudBadge({ flags, level, score, summary }) {
  const list = Array.isArray(flags) ? flags : [];
  const hasScore = score != null && score !== '';
  if (!list.length && !hasScore) return null;

  const cls =
    level === 'red' ? 'badge badge-bad' : level === 'yellow' ? 'badge badge-warn' : 'badge badge-ok';
  const titleParts = [];
  if (summary) titleParts.push(summary);
  if (list.length) titleParts.push(...list.map((f) => f.message));
  const title = titleParts.join('\n');

  const label =
    hasScore && level
      ? `Risk ${level} (${score}/100)`
      : hasScore
        ? `Risk ${score}/100`
        : list.length
          ? `Alerts (${list.length})`
          : 'Risk';

  return (
    <span className={cls} title={title}>
      {label}
      {summary ? <span className="fraud-summary-inline"> — {summary}</span> : null}
    </span>
  );
}
