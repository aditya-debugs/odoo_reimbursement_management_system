import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { approvalsApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

export default function ApprovalQueue() {
  const { company } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await approvalsApi.pending();
    setRows(data);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const act = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      await approvalsApi.action(modal.id, { action: modal.action, comments: comments || undefined });
      toast.success(modal.action === 'approve' ? 'Approved' : 'Rejected');
      setModal(null);
      setComments('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Approval queue</h1>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Expense</th>
              <th>Employee</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Company amt</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.employee_name}</td>
                <td>{r.expense_date}</td>
                <td>
                  {r.amount} {r.currency_code}
                </td>
                <td>
                  {company?.currency_symbol}
                  {r.amount_in_company_currency != null ? Number(r.amount_in_company_currency).toFixed(2) : '—'}
                </td>
                <td className="table-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setModal({ id: r.id, action: 'approve' })}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setModal({ id: r.id, action: 'reject' })}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">Nothing pending.</p> : null}
      </div>

      <Modal
        open={!!modal}
        title={modal?.action === 'approve' ? 'Approve expense' : 'Reject expense'}
        onClose={() => !busy && setModal(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={act} disabled={busy}>
              Confirm
            </button>
          </>
        }
      >
        <label>
          Comments (optional)
          <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
