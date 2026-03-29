import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { rulesApi, usersApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const emptyRule = {
  name: '',
  description: '',
  rule_type: 'sequential',
  percentage_threshold: '60',
  specific_approver_id: '',
  sequential_conditional_override: false,
  stepApproverIds: [''],
};

export default function AdminRules() {
  const { isAdmin } = useAuth();
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyRule);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [r, u] = await Promise.all([rulesApi.list(), usersApi.list()]);
    setRules(r.data);
    setUsers(u.data);
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

  const submit = async (e) => {
    e.preventDefault();
    const steps = form.stepApproverIds
      .map((id, idx) => ({ approver_id: id, step_order: idx + 1 }))
      .filter((s) => s.approver_id);
    if (!steps.length) {
      toast.error('Add at least one approver step');
      return;
    }
    const seqCond = form.rule_type === 'sequential' && form.sequential_conditional_override;
    setBusy(true);
    try {
      await rulesApi.create({
        name: form.name,
        description: form.description,
        rule_type: form.rule_type,
        sequential_conditional_override: seqCond,
        percentage_threshold:
          form.rule_type === 'percentage' || form.rule_type === 'hybrid' || seqCond
            ? parseFloat(form.percentage_threshold) || 60
            : null,
        specific_approver_id:
          form.rule_type === 'specific_approver' || form.rule_type === 'hybrid' || seqCond
            ? form.specific_approver_id || null
            : null,
        steps,
      });
      toast.success('Rule created');
      setForm(emptyRule);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create rule');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Approval rules</h1>
      <p className="muted">First active rule applies to new expenses. Snapshot freezes plan per expense.</p>

      <section className="section-block">
        <h2>Existing rules</h2>
        <ul className="simple-list">
          {rules.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> · {r.rule_type} · {r.is_active ? 'active' : 'inactive'}
              {r.sequential_conditional_override ? ' · seq. conditional override' : ''}
              <ul>
                {(r.steps || []).map((s) => (
                  <li key={s.id} className="muted">
                    Step {s.step_order}: {s.approver_name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {rules.length === 0 ? <p className="muted">No rules yet.</p> : null}
      </section>

      <section className="section-block">
        <h2>Create rule</h2>
        <form onSubmit={submit} className="form-stack form-max">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label>
            Rule type
            <select value={form.rule_type} onChange={(e) => setForm((f) => ({ ...f, rule_type: e.target.value }))}>
              <option value="sequential">Sequential</option>
              <option value="percentage">Percentage</option>
              <option value="specific_approver">Specific approver</option>
              <option value="hybrid">Hybrid (% or specific)</option>
            </select>
          </label>
          {form.rule_type === 'sequential' ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.sequential_conditional_override}
                onChange={(e) => setForm((f) => ({ ...f, sequential_conditional_override: e.target.checked }))}
              />
              Conditional override (e.g. 60% approvals or CFO approves ends flow early)
            </label>
          ) : null}
          {(form.rule_type === 'percentage' || form.rule_type === 'hybrid' || form.sequential_conditional_override) && (
            <label>
              Approve when ≥ this % of approvers agree
              <input
                type="number"
                min="1"
                max="100"
                value={form.percentage_threshold}
                onChange={(e) => setForm((f) => ({ ...f, percentage_threshold: e.target.value }))}
              />
            </label>
          )}
          {(form.rule_type === 'specific_approver' || form.rule_type === 'hybrid' || form.sequential_conditional_override) && (
            <label>
              Specific approver (user id)
              <select
                value={form.specific_approver_id}
                onChange={(e) => setForm((f) => ({ ...f, specific_approver_id: e.target.value }))}
              >
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div>
            <strong>Steps (ordered)</strong>
            {form.stepApproverIds.map((id, idx) => (
              <div key={idx} className="form-row">
                <label className="flex-1">
                  Approver {idx + 1}
                  <select
                    value={id}
                    onChange={(e) => {
                      const next = [...form.stepApproverIds];
                      next[idx] = e.target.value;
                      setForm((f) => ({ ...f, stepApproverIds: next }));
                    }}
                  >
                    <option value="">— select —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      stepApproverIds: f.stepApproverIds.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setForm((f) => ({ ...f, stepApproverIds: [...f.stepApproverIds, ''] }))}
            >
              Add step
            </button>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create rule'}
          </button>
        </form>
      </section>
    </div>
  );
}
