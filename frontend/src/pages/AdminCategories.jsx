import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { categoriesApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const emptyCat = {
  name: '',
  description: '',
  gst_applicable: false,
  gst_rate_percent: '18',
};

export default function AdminCategories() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState(emptyCat);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await categoriesApi.list({ all: 'true' });
    setRows(data);
  };

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        await load();
      } catch {
        toast.error('Could not load categories');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const openCreate = () => {
    setForm(emptyCat);
    setCreateOpen(true);
  };

  const openEdit = (row) => {
    setEditRow(row);
    setForm({
      name: row.name,
      description: row.description || '',
      gst_applicable: Boolean(row.gst_applicable),
      gst_rate_percent: row.gst_rate_percent != null ? String(row.gst_rate_percent) : '18',
    });
  };

  const saveCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      await categoriesApi.create({
        name: form.name.trim(),
        description: form.description || undefined,
        gst_applicable: form.gst_applicable,
        gst_rate_percent: form.gst_applicable ? parseFloat(form.gst_rate_percent) || 18 : undefined,
      });
      toast.success('Category created');
      setCreateOpen(false);
      setForm(emptyCat);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editRow || !form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      await categoriesApi.update(editRow.id, {
        name: form.name.trim(),
        description: form.description,
        is_active: editRow.is_active,
        gst_applicable: form.gst_applicable,
        gst_rate_percent: form.gst_applicable ? parseFloat(form.gst_rate_percent) || 18 : undefined,
      });
      toast.success('Category updated');
      setEditRow(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    try {
      await categoriesApi.update(row.id, { is_active: !row.is_active });
      toast.success(row.is_active ? 'Category deactivated' : 'Category activated');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const remove = async (row) => {
    if (!confirm(`Delete category "${row.name}"? Expenses may lose this category link.`)) return;
    try {
      await categoriesApi.remove(row.id);
      toast.success('Deleted');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Expense categories</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Add category
        </button>
      </div>
      <p className="muted">Manage categories for claims. Inactive categories are hidden from employees when submitting.</p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>GST</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.description || '—'}</td>
                <td>
                  {c.gst_applicable ? `${c.gst_rate_percent ?? 18}%` : '—'}
                </td>
                <td>{c.is_active ? 'Yes' : 'No'}</td>
                <td className="table-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => openEdit(c)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => toggleActive(c)}>
                    {c.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(c)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">No categories yet.</p> : null}
      </div>

      <Modal
        open={createOpen}
        title="New category"
        onClose={() => !busy && setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveCreate} disabled={busy}>
              Create
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
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.gst_applicable}
              onChange={(e) => setForm((f) => ({ ...f, gst_applicable: e.target.checked }))}
            />
            GST applicable
          </label>
          {form.gst_applicable ? (
            <label>
              GST rate (%)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.gst_rate_percent}
                onChange={(e) => setForm((f) => ({ ...f, gst_rate_percent: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={!!editRow}
        title="Edit category"
        onClose={() => !busy && setEditRow(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditRow(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={busy}>
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
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.gst_applicable}
              onChange={(e) => setForm((f) => ({ ...f, gst_applicable: e.target.checked }))}
            />
            GST applicable
          </label>
          {form.gst_applicable ? (
            <label>
              GST rate (%)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.gst_rate_percent}
                onChange={(e) => setForm((f) => ({ ...f, gst_rate_percent: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
