import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { analyticsApi, approvalsApi, expensesApi } from '../api';
import Spinner from '../components/Spinner';

export default function Dashboard() {
  const { user, company } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [myRecent, setMyRecent] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user?.role === 'employee') {
          const { data: pending } = await expensesApi.list({ status: 'pending' });
          if (!cancelled) setPendingCount(pending.length);
          const { data: all } = await expensesApi.list();
          if (!cancelled) setMyRecent(all.slice(0, 5));
        } else {
          const { data: s } = await analyticsApi.summary({});
          if (!cancelled) setSummary(s);
          if (user?.role === 'manager' || user?.role === 'admin') {
            const { data: ap } = await approvalsApi.pending();
            if (!cancelled) setPendingCount(ap.length);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="muted">
        {company?.currency_symbol}
        {company?.currency_code} · {company?.name}
      </p>

      {user?.role === 'employee' ? (
        <div className="grid-stats">
          <div className="stat-card">
            <div className="stat-label">Pending submissions</div>
            <div className="stat-value">{pendingCount}</div>
            <Link to="/my-expenses" className="link-inline">
              View expenses
            </Link>
          </div>
          <div className="stat-card">
            <div className="stat-label">Quick actions</div>
            <Link to="/submit" className="btn btn-primary">
              Submit expense
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid-stats">
          <div className="stat-card">
            <div className="stat-label">Pending approvals</div>
            <div className="stat-value">{pendingCount}</div>
            <Link to="/approvals" className="link-inline">
              Open queue
            </Link>
          </div>
          <div className="stat-card">
            <div className="stat-label">Approved (filtered)</div>
            <div className="stat-value">{summary?.approved_count ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Approval rate</div>
            <div className="stat-value">{summary?.approval_rate_percent ?? 0}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total approved amount</div>
            <div className="stat-value">
              {summary?.total_approved_amount != null
                ? `${company?.currency_symbol || ''}${Number(summary.total_approved_amount).toFixed(2)}`
                : '—'}
            </div>
          </div>
        </div>
      )}

      {user?.role === 'employee' && myRecent.length > 0 ? (
        <section className="section-block">
          <h2>Recent activity</h2>
          <ul className="simple-list">
            {myRecent.map((e) => (
              <li key={e.id}>
                <Link to={`/expenses/${e.id}`}>{e.title}</Link>
                <span className="muted"> · {e.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
