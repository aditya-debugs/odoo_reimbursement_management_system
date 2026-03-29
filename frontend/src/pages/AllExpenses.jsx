import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
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

export default function AllExpenses() {
  const { isAdmin, company } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const { data } = await expensesApi.list();
        setRows(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">All expenses</h1>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Employee</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Company amt</th>
              <th>Status</th>
              <th>Fraud</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.title}</td>
                <td>{e.employee_name}</td>
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
        {rows.length === 0 ? <p className="muted">No expenses.</p> : null}
      </div>
    </div>
  );
}
