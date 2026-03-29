export default function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status" aria-label={label}>
      <div className="spinner" />
      <span className="spinner-label">{label}</span>
    </div>
  );
}
