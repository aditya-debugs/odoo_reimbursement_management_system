import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { analyticsApi, budgetsApi, categoriesApi, gstApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#818cf8', '#4f46e5'];

export default function Analytics() {
  const { user, isAdmin, canAccessAnalytics } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [gstFrom, setGstFrom] = useState('');
  const [gstTo, setGstTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetForm, setBudgetForm] = useState({ category_id: '', monthly_cap: '' });
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);

  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;

  const load = async () => {
    const [s, m, c] = await Promise.all([
      analyticsApi.summary(params),
      analyticsApi.monthly(params),
      analyticsApi.categories(params),
    ]);
    setSummary(s.data);
    setMonthly(
      m.data.map((row) => ({
        ...row,
        monthLabel: row.month ? String(row.month).slice(0, 7) : '',
      }))
    );
    setCategories(c.data);
    if (user?.role === 'admin' || user?.role === 'financer' || user?.role === 'director') {
      try {
        const e = await analyticsApi.employees(params);
        setEmployees(e.data);
      } catch {
        setEmployees([]);
      }
    } else {
      setEmployees([]);
    }
    if (isAdmin) {
      try {
        const [b, catList] = await Promise.all([budgetsApi.list(), categoriesApi.list()]);
        setBudgets(b.data);
        setCats(catList.data);
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    if (!canAccessAnalytics) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessAnalytics, from, to]);

  const saveBudget = async (e) => {
    e.preventDefault();
    if (!budgetForm.category_id || !budgetForm.monthly_cap) {
      toast.error('Pick category and cap');
      return;
    }
    try {
      await budgetsApi.set({
        category_id: budgetForm.category_id,
        monthly_cap: parseFloat(budgetForm.monthly_cap),
      });
      toast.success('Budget saved');
      setBudgetForm({ category_id: '', monthly_cap: '' });
      const { data } = await budgetsApi.list();
      setBudgets(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const downloadGst = async () => {
    if (!gstFrom || !gstTo) {
      toast.error('Pick GST report date range');
      return;
    }
    try {
      const res = await gstApi.downloadReport(gstFrom, gstTo);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gst-report.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch {
      toast.error('GST export failed');
    }
  };

  if (!canAccessAnalytics) {
    return <Navigate to="/" replace />;
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Analytics</h1>
      <div className="form-row filters-row">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => load()}>
          Apply
        </button>
      </div>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value">{summary?.pending_count ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approved</div>
          <div className="stat-value">{summary?.approved_count ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rejected</div>
          <div className="stat-value">{summary?.rejected_count ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approval rate</div>
          <div className="stat-value">{summary?.approval_rate_percent ?? 0}%</div>
        </div>
      </div>

      {isAdmin && budgets.length > 0 ? (
        <section className="section-block">
          <h2>Category budgets (month-to-date)</h2>
          <ul className="simple-list">
            {budgets.map((b) => (
              <li key={b.id}>
                <strong>{b.category_name}</strong> cap {b.monthly_cap} · spent {Number(b.spent_mtd).toFixed(2)} ·{' '}
                {b.utilization_percent}% used
                <div className="budget-bar">
                  <span style={{ width: `${Math.min(100, b.utilization_percent)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="section-block">
          <h2>Set category budget</h2>
          <form onSubmit={saveBudget} className="form-row">
            <label>
              Category
              <select
                value={budgetForm.category_id}
                onChange={(e) => setBudgetForm((f) => ({ ...f, category_id: e.target.value }))}
              >
                <option value="">—</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monthly cap (company currency)
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetForm.monthly_cap}
                onChange={(e) => setBudgetForm((f) => ({ ...f, monthly_cap: e.target.value }))}
              />
            </label>
            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-end' }}>
              Save
            </button>
          </form>
        </section>
      ) : null}

      {(user?.role === 'admin' || user?.role === 'financer' || user?.role === 'director') && (
        <section className="section-block">
          <h2>GST report (CSV)</h2>
          <div className="form-row">
            <label>
              From
              <input type="date" value={gstFrom} onChange={(e) => setGstFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={gstTo} onChange={(e) => setGstTo(e.target.value)} />
            </label>
            <button type="button" className="btn btn-secondary" onClick={downloadGst}>
              Download CSV
            </button>
          </div>
          <p className="muted">Includes approved expenses with GST breakdown. Mark categories as GST in DB or future admin UI.</p>
        </section>
      )}

      <section className="chart-section">
        <h2>Monthly trend (approved)</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="chart-section">
        <h2>By category</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie dataKey="value" data={categories} nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                {categories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      {user?.role === 'admin' || user?.role === 'financer' || user?.role === 'director' ? (
        <section className="chart-section">
          <h2>Spending by employee</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={employees}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="employee_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </div>
  );
}
