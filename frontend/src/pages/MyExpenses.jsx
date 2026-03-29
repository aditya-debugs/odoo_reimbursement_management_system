import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { categoriesApi, expensesApi } from '../api';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import FraudBadge from '../components/FraudBadge';
import { useAuth } from '../context/AuthContext';

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

export default function MyExpenses() {
  const { company } = useAuth();
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    from: '',
    to: '',
    category_id: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await categoriesApi.list();
        setCategories(data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = {};
        if (filters.status) params.status = filters.status;
        if (filters.from) params.from = filters.from;
        if (filters.to) params.to = filters.to;
        if (filters.category_id) params.category_id = filters.category_id;
        const { data } = await expensesApi.list(params);
        if (!cancelled) setRows(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">My expenses</h1>
      <div className="form-row filters-row" style={{ marginBottom: '1rem' }}>
        <label>
          Status
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label>
          To
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
        <label>
          Category
          <select
            value={filters.category_id}
            onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Company amt</th>
              <th>Status</th>
              <th>Risk</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.title}</td>
                <td>{e.expense_date}</td>
                <td>
                  {e.amount} {e.currency_code}
                </td>
                <td>
                  {company?.currency_symbol}
                  {e.amount_in_company_currency != null ? Number(e.amount_in_company_currency).toFixed(2) : '—'}
                </td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                <td>
                  <FraudBadge
                    flags={parseFraudFlags(e.fraud_flags)}
                    level={e.fraud_level}
                    score={e.fraud_score}
                    summary={e.fraud_summary}
                  />
                </td>
                <td>
                  <Link to={`/expenses/${e.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
