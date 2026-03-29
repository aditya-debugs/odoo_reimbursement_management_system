export default function FraudBadge({ flags }) {
  if (!flags?.length) return null;
  return (
    <span className="badge badge-fraud" title={flags.map((f) => f.message).join('\n')}>
      Fraud: {flags.length} warning{flags.length > 1 ? 's' : ''}
    </span>
  );
}
