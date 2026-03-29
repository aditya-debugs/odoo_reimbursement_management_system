import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { usersApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const emptyUser = { name: '', email: '', password: '', role: 'employee', manager_id: '', is_manager_approver: false };

export default function AdminUsers() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyUser);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await usersApi.list();
    setRows(data);
  };

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const save = async () => {
    setBusy(true);
    try {
      await usersApi.create({
        ...form,
        manager_id: form.manager_id || undefined,
      });
      toast.success('User created');
      setOpen(false);
      setForm(emptyUser);
      await load();
    } catch (err) {
      const first = err.response?.data?.errors?.[0]?.msg;
      toast.error(err.response?.data?.message || first || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Users</h1>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Add user
        </button>
      </div>
      <div className="section-block muted" style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
        <p>
          <strong>Roles are separate.</strong> Admin is <em>not</em> the same as Manager — each user has exactly one role.
        </p>
        <ul className="simple-list" style={{ marginTop: '0.5rem' }}>
          <li>
            <strong>Admin</strong> — Created on company signup. Users, approval rules, all expenses, audit, budgets. Can force
            approve/reject any step.
          </li>
          <li>
            <strong>Manager</strong> — Sees <em>direct reports’</em> expenses and own approval queue. Typical line manager (not
            IT admin).
          </li>
          <li>
            <strong>Employee</strong> — Submits expenses; sees only their own claims.
          </li>
          <li>
            <strong>Financer</strong> — Finance approver: company-wide expense visibility; acts when assigned in a rule chain.
          </li>
          <li>
            <strong>Director</strong> — Senior approver: same visibility pattern as financer in this app; use in multi-step
            flows (e.g. final sign-off).
          </li>
        </ul>
        <p style={{ marginTop: '0.5rem' }}>
          <strong>Approver</strong> column = “Can approve as manager”: if checked and this user is an employee’s{' '}
          <strong>Manager</strong>, that employee’s expenses can require this person first (step 0) before other rule steps.
        </p>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Manager</th>
              <th title="If manager for an employee, can be first approver (step 0)">Mgr approver</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.manager_name || '—'}</td>
                <td>{u.is_manager_approver ? 'Yes' : '—'}</td>
                <td>{u.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        title="Create user"
        onClose={() => !busy && setOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
              Save
            </button>
          </>
        }
      >
        <div className="form-stack">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={6}
            />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="financer">Financer</option>
              <option value="director">Director</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Manager (optional)
            <select
              value={form.manager_id}
              onChange={(e) => setForm((f) => ({ ...f, manager_id: e.target.value }))}
            >
              <option value="">None</option>
              {rows.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.is_manager_approver}
              onChange={(e) => setForm((f) => ({ ...f, is_manager_approver: e.target.checked }))}
            />
            Can approve as manager
          </label>
        </div>
      </Modal>
    </div>
  );
}
