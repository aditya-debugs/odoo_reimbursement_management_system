import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  Legend,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { analyticsApi, approvalsApi, expensesApi } from "../api";
import Spinner from "../components/Spinner";

const CHART_COLORS = ["#5e8ca6", "#85aebf", "#d9e8ef"];

const formatCompact = (value) => {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
};

const monthShort = (dateLike) => {
  if (!dateLike) return "";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short" });
};

export default function Dashboard() {
  const { user, company, canAccessApprovals } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [myRecent, setMyRecent] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user?.role === "employee") {
          const { data: pending } = await expensesApi.list({
            status: "pending",
          });
          if (!cancelled) setPendingCount(pending.length);
          const { data: all } = await expensesApi.list();
          if (!cancelled) setMyRecent(all.slice(0, 5));
        } else {
          const requests = [
            analyticsApi.summary({}),
            analyticsApi.monthly({}),
            analyticsApi.categories({}),
          ];
          if (canAccessApprovals) requests.push(approvalsApi.pending());
          const [s, m, c, ap] = await Promise.all(requests);
          if (!cancelled) {
            setSummary(s.data);
            setMonthly(m.data || []);
            setCategories(c.data || []);
            if (ap) setPendingCount(ap.data.length);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, canAccessApprovals]);

  if (loading) return <Spinner />;

  const approvalPie = [
    { name: "Approved", value: Number(summary?.approved_count || 0) },
    { name: "Pending", value: Number(summary?.pending_count || 0) },
    { name: "Rejected", value: Number(summary?.rejected_count || 0) },
  ];

  const monthlySeries = (monthly || []).map((row) => {
    const expense = Number(row.total || 0);
    const budget = expense * 1.1;
    return {
      month: monthShort(row.month),
      expense,
      budget,
    };
  });

  const rankedCategories = [...(categories || [])]
    .map((row) => ({ name: row.name, value: Number(row.value || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const maxCategoryValue = rankedCategories.length
    ? rankedCategories[0].value
    : 1;

  const currency = company?.currency_symbol || "";

  return (
    <div className="manager-dashboard">
      <div className="dash-headline">
        <h1 className="page-title">Welcome {user?.name || "Manager"} !</h1>
        <div className="dash-search-wrap">
          <input
            className="dash-search"
            type="search"
            placeholder="Search"
            aria-label="Search dashboard"
          />
        </div>
      </div>

      <section className="dash-overview">
        <h2>Over View</h2>
        <div className="dash-overview-grid">
          <article className="dash-mini-card">
            <div className="dash-mini-value">
              {summary?.total_expenses ?? 0}
            </div>
            <div className="dash-mini-label">Total Claims</div>
          </article>
          <article className="dash-mini-card">
            <div className="dash-mini-value">
              {summary?.approved_count ?? 0}
            </div>
            <div className="dash-mini-label">Approved</div>
          </article>
          <article className="dash-mini-card">
            <div className="dash-mini-value">
              {currency}
              {formatCompact(summary?.total_approved_amount ?? 0)}
            </div>
            <div className="dash-mini-label">Approved Value</div>
          </article>
          <article className="dash-mini-card warn">
            <div className="dash-mini-value">{pendingCount}</div>
            <div className="dash-mini-label">Pending Approval</div>
          </article>
        </div>
      </section>

      {user?.role === "employee" ? (
        <div className="grid-stats">
          <div className="stat-card">
            <div className="stat-label">Pending submissions</div>
            <div className="stat-value">{pendingCount}</div>
            <Link to="/my-expenses" className="link-inline">
              View expenses
            </Link>
          </div>
          <div className="stat-card">
            <div className="stat-label">Quick actions</div>
            <Link to="/submit" className="btn btn-primary">
              Submit expense
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="dash-grid-top">
            <article className="dash-panel panel-users">
              <div className="dash-panel-title">No of users</div>
              <div className="dash-users-value">
                {formatCompact(summary?.total_expenses || 0)}
              </div>
              <div className="muted">Total claims processed</div>
              <Link to="/approvals" className="link-inline">
                Open queue
              </Link>
            </article>

            <article className="dash-panel">
              <div className="dash-panel-title">Inventory Values</div>
              <div className="dash-chart-box">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={approvalPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={86}
                    >
                      {approvalPie.map((_, i) => (
                        <Cell
                          key={`pie-${i}`}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="dash-panel">
              <div className="dash-panel-title">Top categories by spend</div>
              <ul className="rank-bars">
                {rankedCategories.map((row) => (
                  <li key={row.name}>
                    <span className="label">{row.name}</span>
                    <span className="bar">
                      <em
                        style={{
                          width: `${Math.max(6, (row.value / maxCategoryValue) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="value">{formatCompact(row.value)}</span>
                  </li>
                ))}
              </ul>
            </article>
          </section>

          <section className="dash-panel panel-line">
            <div className="dash-panel-head">
              <div className="dash-panel-title">Expense vs Budget</div>
              <span className="muted">Last 6 months</span>
            </div>
            <div className="dash-chart-box big">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#d7e5eb" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="expense"
                    stroke="#5e8ca6"
                    strokeWidth={3}
                    dot={{ r: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="budget"
                    stroke="#8bb8c9"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {user?.role === "employee" && myRecent.length > 0 ? (
        <section className="section-block">
          <h2>Recent activity</h2>
          <ul className="simple-list">
            {myRecent.map((e) => (
              <li key={e.id}>
                <Link to={`/expenses/${e.id}`}>{e.title}</Link>
                <span className="muted"> · {e.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
