import { useEffect, useState, useMemo } from 'react';
import {
    ResponsiveContainer,
    PieChart, Pie, Cell, Tooltip, Legend,
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    AreaChart, Area
} from 'recharts';
import { employeeAnalyticsApi, categoriesApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308'];

export default function EmployeeDashboard() {
    const { company, user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState(null);
    const [trends, setTrends] = useState([]);
    const [categories, setCategories] = useState([]);
    const [topExpenses, setTopExpenses] = useState([]);
    const [recent, setRecent] = useState([]);
    const [insights, setInsights] = useState([]);
    const [comparison, setComparison] = useState(null);
    const [allCats, setAllCats] = useState([]);

    // Filters
    const [filters, setFilters] = useState({
        period: '30', // '7', '30', '90', 'custom'
        from: '',
        to: '',
        category_id: '',
        status: '',
        min_amount: '',
        max_amount: ''
    });

    const [trendView, setTrendView] = useState('daily'); // 'daily', 'monthly'

    const getDateRange = (period) => {
        const now = new Date();
        if (period === '7') return new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0];
        if (period === '30') return new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
        if (period === '90') return new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
        return '';
    };

    const fetchAll = async () => {
        setLoading(true);
        const params = { ...filters };
        if (filters.period !== 'custom') {
            params.from = getDateRange(filters.period);
            params.to = new Date().toISOString().split('T')[0];
        }
        params.view = trendView;

        try {
            const [s, t, c, top, r, i, comp, clist] = await Promise.all([
                employeeAnalyticsApi.summary(params),
                employeeAnalyticsApi.trends(params),
                employeeAnalyticsApi.categories(params),
                employeeAnalyticsApi.topExpenses(params),
                employeeAnalyticsApi.recent({ limit: 8 }),
                employeeAnalyticsApi.insights(params),
                employeeAnalyticsApi.comparison(),
                categoriesApi.list()
            ]);

            setSummary(s.data);
            setTrends(t.data);
            setCategories(c.data);
            setTopExpenses(top.data);
            setRecent(r.data);
            setInsights(i.data);
            setComparison(comp.data);
            setAllCats(clist.data);
        } catch (err) {
            toast.error('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, [filters, trendView]);

    const exportToCSV = () => {
        if (!categories.length) return;
        const headers = ['Category', 'Total Amount', 'Transactions', 'Avg Spend'];
        const rows = categories.map(c => [c.name, c.total, c.count, c.avg_amount]);
        const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `expense_report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading && !summary) return <Spinner />;

    return (
        <div className="dashboard-container">
            <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title">Personal Expense Insights</h1>
                    <p className="muted">Welcome back, {user?.name}. Here's your spending breakdown.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-secondary" onClick={exportToCSV}>📤 Export CSV</button>
                    <Link to="/submit" className="btn btn-primary">➕ New Expense</Link>
                </div>
            </div>

            {/* Filters Panel */}
            <section className="section-block" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    <label>Period
                        <select value={filters.period} onChange={e => setFilters({...filters, period: e.target.value})}>
                            <option value="7">Last 7 Days</option>
                            <option value="30">Last 30 Days</option>
                            <option value="90">Last 90 Days</option>
                            <option value="custom">Custom Range</option>
                        </select>
                    </label>
                    {filters.period === 'custom' && (
                        <>
                            <label>From <input type="date" value={filters.from} onChange={e => setFilters({...filters, from: e.target.value})} /></label>
                            <label>To <input type="date" value={filters.to} onChange={e => setFilters({...filters, to: e.target.value})} /></label>
                        </>
                    )}
                    <label>Category
                        <select value={filters.category_id} onChange={e => setFilters({...filters, category_id: e.target.value})}>
                            <option value="">All Categories</option>
                            {allCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </label>
                    <label>Status
                        <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
                            <option value="">All Statuses</option>
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </label>
                </div>
            </section>

            {/* Summary Cards */}
            <div className="grid-stats" style={{ marginBottom: '2rem' }}>
                <div className="stat-card">
                    <div className="stat-label">Total Expenses</div>
                    <div className="stat-value">{company?.currency_symbol}{Number(summary?.total_amount || 0).toLocaleString()}</div>
                    <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }} className="muted">{summary?.total_count} transactions</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '4px solid #16a34a' }}>
                    <div className="stat-label">Approved</div>
                    <div className="stat-value" style={{ color: '#16a34a' }}>{company?.currency_symbol}{Number(summary?.approved_amount || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '4px solid #d97706' }}>
                    <div className="stat-label">Pending</div>
                    <div className="stat-value" style={{ color: '#d97706' }}>{company?.currency_symbol}{Number(summary?.pending_amount || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Avg / Day</div>
                    <div className="stat-value">{company?.currency_symbol}{Number(summary?.avg_per_day || 0).toFixed(0)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Highest Single</div>
                    <div className="stat-value">{company?.currency_symbol}{Number(summary?.highest_expense || 0).toLocaleString()}</div>
                </div>
            </div>

            <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                
                {/* Trend Chart */}
                <section className="section-block">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ margin: 0 }}>Spending Trend</h2>
                        <div className="btn-group">
                            <button className={`btn btn-sm ${trendView === 'daily' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTrendView('daily')}>Daily</button>
                            <button className={`btn btn-sm ${trendView === 'monthly' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTrendView('monthly')}>Monthly</button>
                        </div>
                    </div>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trends}>
                                <defs>
                                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                                <Tooltip 
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    formatter={(value) => [`${company?.currency_symbol}${value}`, 'Total']}
                                />
                                <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                {/* Category Pie Chart */}
                <section className="section-block">
                    <h2 style={{ marginBottom: '1rem' }}>Category Distribution</h2>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={categories}
                                    dataKey="total"
                                    nameKey="name"
                                    cx="50%" cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                >
                                    {categories.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `${company?.currency_symbol}${value}`} />
                                <Legend verticalAlign="bottom" height={36}/>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            </div>

            <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem', marginBottom: '1.5rem' }}>
                
                {/* Comparison & Insights */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {comparison && (
                        <section className="section-block" style={{ backgroundColor: '#f8fafc' }}>
                            <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Month-over-Month Comparison</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                <div>
                                    <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>{comparison.last_month_label}</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{company?.currency_symbol}{Number(comparison.last_month?.total || 0).toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>{comparison.this_month_label}</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {company?.currency_symbol}{Number(comparison.this_month?.total || 0).toLocaleString()}
                                        {comparison.change_percent !== null && (
                                            <span style={{ 
                                                fontSize: '0.75rem', 
                                                padding: '0.1rem 0.4rem', 
                                                borderRadius: '4px',
                                                backgroundColor: comparison.change_percent > 0 ? '#fee2e2' : '#dcfce7',
                                                color: comparison.change_percent > 0 ? '#dc2626' : '#16a34a'
                                            }}>
                                                {comparison.change_percent > 0 ? '↑' : '↓'} {Math.abs(comparison.change_percent)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    <section className="section-block">
                        <h2 style={{ marginBottom: '1rem' }}>Smart Insights 💡</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {insights.map((insight, idx) => (
                                <div key={idx} style={{ 
                                    padding: '0.75rem 1rem', 
                                    borderRadius: '8px', 
                                    display: 'flex', 
                                    gap: '0.75rem', 
                                    fontSize: '0.9rem',
                                    border: '1px solid #e2e8f0',
                                    backgroundColor: insight.type === 'warning' ? '#fffbeb' : insight.type === 'danger' ? '#fef2f2' : '#f8fafc'
                                }}>
                                    <span style={{ fontSize: '1.1rem' }}>{insight.icon}</span>
                                    <div dangerouslySetInnerHTML={{ __html: insight.text.replace(/₹/g, company?.currency_symbol || '') }} />
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Category List */}
                    <section className="section-block">
                        <h2>Category Breakdown</h2>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Category</th>
                                    <th>Total Spend</th>
                                    <th>Count</th>
                                    <th>Avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map((c, i) => (
                                    <tr key={i}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: COLORS[i % COLORS.length] }} />
                                            {c.name}
                                        </div></td>
                                        <td>{company?.currency_symbol}{Number(c.total).toLocaleString()}</td>
                                        <td>{c.count}</td>
                                        <td>{company?.currency_symbol}{Number(c.avg_amount).toFixed(0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                </div>

                {/* Top & Recent Expenses */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    
                    <section className="section-block">
                        <h2 style={{ marginBottom: '1rem' }}>🔥 Top Expenses</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {topExpenses.map(e => (
                                <Link to={`/expenses/${e.id}`} key={e.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                                    <div className="stat-card" style={{ padding: '0.75rem', cursor: 'pointer', transition: 'transform 0.2s' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{e.title}</div>
                                            <div style={{ fontWeight: 700, color: '#6366f1' }}>{company?.currency_symbol}{Number(e.amount_in_company_currency).toLocaleString()}</div>
                                        </div>
                                        <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>{e.category_name} · {e.expense_date}</div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>

                    <section className="section-block">
                        <h2 style={{ marginBottom: '1rem' }}>🕒 Recent Activity</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {recent.map(e => (
                                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                                        <div style={{ fontSize: '0.85rem' }}>{e.title}</div>
                                        <div className="muted" style={{ fontSize: '0.7rem' }}>{e.expense_date}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{company?.currency_symbol}{Number(e.amount_in_company_currency).toLocaleString()}</div>
                                        <StatusBadge status={e.status} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Link to="/my-expenses" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: '1rem' }}>View all history →</Link>
                    </section>

                </div>
            </div>
        </div>
    );
}
