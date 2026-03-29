import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
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
import { analyticsApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#818cf8', '#4f46e5'];

export default function Analytics() {
  const { user, isAdmin } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
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
    if (user?.role === 'admin') {
      const e = await analyticsApi.employees(params);
      setEmployees(e.data);
    } else {
      setEmployees([]);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'manager') return;
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
  }, [user?.role, from, to]);

  if (user?.role !== 'admin' && user?.role !== 'manager') {
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

      {isAdmin ? (
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
