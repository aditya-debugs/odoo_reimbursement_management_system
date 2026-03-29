import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TrackingTimeline from '../components/TrackingTimeline';

function backPath(role) {
  if (role === 'employee') return '/my-expenses';
  if (role === 'admin') return '/admin/expenses';
  return '/approvals';
}

export default function ExpenseTracking() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleResubmit = () => {
    navigate(`/submit?resubmit=${id}`);
  };

  return (
    <div>
      <p style={{ marginBottom: '1rem' }}>
        <Link to={backPath(user?.role)}>← Back</Link>
        {' · '}
        <Link to={`/expenses/${id}`}>View full details</Link>
      </p>

      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title">Expense Tracking</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Real-time approval journey
        </span>
      </div>

      <div style={{ maxWidth: 680 }}>
        <TrackingTimeline
          expenseId={id}
          onResubmit={user?.role === 'employee' ? handleResubmit : undefined}
        />
      </div>
    </div>
  );
}
