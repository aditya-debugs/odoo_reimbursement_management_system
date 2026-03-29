import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { expensesApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import FraudBadge from '../components/FraudBadge';

function parseFraudFlags(f) {
  if (!f) return [];
  if (Array.isArray(f)) return f;
  if (typeof f === 'string') {
    try {
      return JSON.parse(f);
    } catch {
      return [];
    }
  }
  return [];
}

export default function ExpenseDetail() {
  const { id } = useParams();
  const { user, company } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: d } = await expensesApi.get(id);
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) toast.error('Could not load expense');
        if (!cancelled) navigate(-1);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const cancel = async () => {
    if (!confirm('Cancel this pending expense?')) return;
    setCancelling(true);
    try {
      await expensesApi.cancel(id);
      toast.success('Cancelled');
      const { data: d } = await expensesApi.get(id);
      setData(d);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <Spinner />;
  if (!data) return null;

  const flags = parseFraudFlags(data.fraud_flags);
  const receiptSrc = data.receipt_url ? data.receipt_url : null;

  return (
    <div>
      <p>
        <Link to={user?.role === 'employee' ? '/my-expenses' : '/admin/expenses'}>← Back</Link>
      </p>
      <h1 className="page-title">{data.title}</h1>
      <div className="detail-meta">
        <StatusBadge status={data.status} />
        <FraudBadge flags={flags} />
      </div>
      <div className="detail-grid">
        <div>
          <p>
            <strong>Amount:</strong> {data.amount} {data.currency_code}
          </p>
          <p>
            <strong>In company currency:</strong> {company?.currency_symbol}
            {data.amount_in_company_currency != null ? Number(data.amount_in_company_currency).toFixed(2) : '—'}
          </p>
          <p>
            <strong>Date:</strong> {data.expense_date}
          </p>
          <p>
            <strong>Category:</strong> {data.category_name || '—'}
          </p>
          <p>
            <strong>Employee:</strong> {data.employee_name}
          </p>
          {data.description ? (
            <p>
              <strong>Notes:</strong> {data.description}
            </p>
          ) : null}
          {user?.role === 'employee' && data.employee_id === user.id && data.status === 'pending' ? (
            <button type="button" className="btn btn-secondary" onClick={cancel} disabled={cancelling}>
              Cancel submission
            </button>
          ) : null}
        </div>
        {receiptSrc ? (
          <div>
            <strong>Receipt</strong>
            <div className="receipt-preview">
              <img src={receiptSrc} alt="Receipt" />
            </div>
          </div>
        ) : null}
      </div>

      <section className="section-block">
        <h2>Approval timeline</h2>
        <ul className="timeline">
          {(data.approvals || []).map((a) => (
            <li key={a.id} className="timeline-item">
              <div className="timeline-dot" />
              <div>
                <strong>{a.approver_name}</strong>
                <span className="muted"> · Step {a.sequence_order}</span>
                <div>
                  <StatusBadge status={a.status} />
                </div>
                {a.comments ? <p className="muted">{a.comments}</p> : null}
                {a.action_at ? <time className="muted">{new Date(a.action_at).toLocaleString()}</time> : null}
              </div>
            </li>
          ))}
        </ul>
        {(!data.approvals || data.approvals.length === 0) && data.status === 'approved' ? (
          <p className="muted">Auto-approved or no approval records.</p>
        ) : null}
      </section>
    </div>
  );
}
