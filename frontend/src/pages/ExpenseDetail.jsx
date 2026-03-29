import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { auditApi, expensesApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import FraudBadge from '../components/FraudBadge';
import TrackingTimeline from '../components/TrackingTimeline';

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

function backPath(role) {
  if (role === 'employee') return '/my-expenses';
  if (role === 'admin') return '/admin/expenses';
  return '/approvals';
}

export default function ExpenseDetail() {
  const { id } = useParams();
  const { user, company, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

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

  const verifyAudit = async () => {
    setVerifyBusy(true);
    try {
      const { data: v } = await auditApi.verify();
      if (v.valid) toast.success(`Audit chain OK (${v.blocks} blocks)`);
      else toast.error(v.error || 'Verification failed');
    } catch {
      toast.error('Verification failed');
    } finally {
      setVerifyBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (!data) return null;

  const flags = parseFraudFlags(data.fraud_flags);
  const receiptSrc = data.receipt_url ? data.receipt_url : null;
  const snap = data.workflow_snapshot;
  let snapSteps = [];
  try {
    if (snap?.steps) {
      snapSteps = typeof snap.steps === 'string' ? JSON.parse(snap.steps) : snap.steps;
    }
  } catch {
    snapSteps = [];
  }

  return (
    <div>
      <p>
        <Link to={backPath(user?.role)}>← Back</Link>
      </p>
      <h1 className="page-title">{data.title}</h1>
      <div className="detail-meta">
        <StatusBadge status={data.status} />
        <FraudBadge flags={flags} level={data.fraud_level} score={data.fraud_score} summary={data.fraud_summary} />
      </div>
      {data.approval_prediction?.approval_chance_percent != null ? (
        <p className="muted">
          <strong>Approval outlook:</strong> ~{data.approval_prediction.approval_chance_percent}% —{' '}
          {data.approval_prediction.reason}
        </p>
      ) : null}
      <div className="detail-grid">
        <div>
          <p>
            <strong>Amount:</strong> {data.amount} {data.currency_code}
          </p>
          <p>
            <strong>In company currency:</strong> {company?.currency_symbol}
            {data.amount_in_company_currency != null ? Number(data.amount_in_company_currency).toFixed(2) : '—'}
          </p>
          {data.conversion_at ? (
            <p className="muted">
              <strong>Converted at:</strong> {new Date(data.conversion_at).toLocaleString()}
            </p>
          ) : null}
          <p>
            <strong>Date:</strong> {data.expense_date}
          </p>
          <p>
            <strong>Category:</strong> {data.category_name || '—'}
          </p>
          <p>
            <strong>Employee:</strong> {data.employee_name}
          </p>
          {data.gst_amount != null ? (
            <p>
              <strong>GST:</strong> base {company?.currency_symbol}
              {Number(data.gst_base_amount).toFixed(2)} + GST {company?.currency_symbol}
              {Number(data.gst_amount).toFixed(2)} (ITC eligible: {data.gst_itc_eligible ? 'yes' : 'no'})
            </p>
          ) : null}
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
          {isAdmin ? (
            <p style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={verifyAudit} disabled={verifyBusy}>
                {verifyBusy ? 'Verifying…' : 'Verify audit chain integrity'}
              </button>
            </p>
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

      {snap ? (
        <section className="section-block">
          <h2>Frozen approval plan</h2>
          <p className="muted">
            Rule type: {snap.rule_type}
            {snap.manager_prepended ? ' · Manager first' : ''}
            {snap.sequential_conditional_override ? ' · Conditional override enabled' : ''}
          </p>
          <ul className="simple-list">
            {snapSteps.map((s, i) => (
              <li key={i}>
                Step {s.step_order}: approver {s.approver_id?.slice(0, 8)}…
                {s.is_manager_step ? ' (manager)' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.splits && data.splits.length > 0 && (
        <section className="section-block">
          <h2>Shared splitting breakdown</h2>
          <ul className="simple-list">
            {data.splits.map((s) => (
              <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.user_name} <span className="muted">({s.user_email})</span></span>
                <span style={{ fontWeight: 600 }}>{Number(s.amount).toFixed(2)} {data.currency_code}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section-block">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Approval Journey</h2>
          <Link to={`/expenses/${id}/tracking`} className="btn btn-secondary btn-sm">🔍 Full Tracking View</Link>
        </div>
        <TrackingTimeline expenseId={id} />
      </section>
    </div>
  );
}
