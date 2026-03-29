import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { auditApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

export default function AdminAudit() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const load = async () => {
    const { data } = await auditApi.chain();
    setRows(data);
  };

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        await load();
      } catch {
        toast.error('Could not load audit chain');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const verify = async () => {
    setVerifyBusy(true);
    try {
      const { data } = await auditApi.verify();
      if (data.valid) {
        toast.success(`Chain OK — ${data.blocks} blocks verified`);
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch {
      toast.error('Verification request failed');
    } finally {
      setVerifyBusy(false);
    }
  };

  if (!isAdmin) return <Navigate to="/" replace />;
  if (loading) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Audit chain</h1>
        <button type="button" className="btn btn-primary" onClick={verify} disabled={verifyBusy}>
          {verifyBusy ? 'Verifying…' : 'Verify chain integrity'}
        </button>
      </div>
      <p className="muted">Tamper-evident SHA-256 linked log of key actions.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Expense</th>
              <th>Hash</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.chain_index}</td>
                <td>{r.action}</td>
                <td className="muted">{r.expense_id ? r.expense_id.slice(0, 8) + '…' : '—'}</td>
                <td className="muted" style={{ fontSize: '0.65rem' }}>
                  {r.hash?.slice(0, 16)}…
                </td>
                <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">No audit entries yet.</p> : null}
      </div>
    </div>
  );
}
