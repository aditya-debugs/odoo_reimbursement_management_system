import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { groupsApi, usersApi, categoriesApi } from '../api';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';

export default function GroupDashboard() {
  const { id } = useParams();
  const { user, company } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [cats, setCats] = useState([]);
  const [simplify, setSimplify] = useState(null);

  const load = async () => {
    try {
      const { data } = await groupsApi.get(id);
      setData(data);
    } catch {
      toast.error('Failed to load group details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const fetchUsers = async () => {
      const res = await usersApi.list();
      setUsersList(res.data);
    };
    const fetchCats = async () => {
      const res = await categoriesApi.list();
      setCats(res.data);
    };
    fetchUsers();
    fetchCats();
  }, [id]);

  const handleAddMember = async (userId) => {
    try {
      await groupsApi.addMember(id, { user_id: userId, role: 'member' });
      toast.success('Member added!');
      setShowAddMember(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add member');
    }
  };

  const handleSimplify = async () => {
    try {
      const { data } = await groupsApi.simplify(id);
      setSimplify(data);
    } catch {
      toast.error('Failed to simplify debts');
    }
  };

  if (loading) return <Spinner />;
  if (!data) return <div>Group not found</div>;

  const isAdmin = data.members.find(m => m.user_id === user.id)?.role === 'admin';

  return (
    <div>
      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title">{data.group.name}</h1>
        <p className="muted">{data.group.tag} · Created by {data.group.creator_name}</p>
      </div>

      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: '1.5rem' }}>
        
        {/* Main Content: Expenses */}
        <section className="section-block">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2>Shared Expenses</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddExpense(true)}>Add Expense</button>
          </div>

          {showAddExpense && (
              <AddGroupExpenseModal 
                groupId={id} 
                members={data.members} 
                categories={cats}
                onClose={() => setShowAddExpense(false)}
                onSuccess={() => { setShowAddExpense(false); load(); }}
              />
          )}

          {data.expenses.length === 0 ? (
            <p className="muted">No shared expenses yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Amount</th>
                  <th>Paid By</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.expenses.map(e => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>{e.amount} {e.currency_code}</td>
                    <td>{e.paid_by_name}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>{e.expense_date}</td>
                    <td><Link to={`/expenses/${e.id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Sidebar: Balances & Members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <section className="section-block">
            <h3>Group Balances</h3>
            <div className="simple-list">
              {data.balances.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                  <span>{b.name} {b.id === user.id ? '(You)' : ''}</span>
                  <span style={{ fontWeight: 600, color: b.net_balance > 0 ? '#16a34a' : b.net_balance < 0 ? '#dc2626' : 'inherit' }}>
                    {b.net_balance > 0 ? `+${b.net_balance}` : b.net_balance}
                  </span>
                </div>
              ))}
            </div>
            
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '1rem', width: '100%' }} onClick={handleSimplify}>
              Simplify Debts
            </button>

            {simplify && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>Optimized Settlements</h4>
                    {simplify.length === 0 ? <p className="muted" style={{ fontSize: '0.75rem' }}>Everyone is settled up!</p> : (
                        simplify.map((t, idx) => (
                            <div key={idx} style={{ fontSize: '0.78rem', padding: '0.2rem 0' }}>
                                <strong>{t.from}</strong> owes <strong>{t.to}</strong> {company?.currency_symbol}<strong>{t.amount}</strong>
                            </div>
                        ))
                    )}
                </div>
            )}
          </section>

          <section className="section-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <h3>Members</h3>
              {isAdmin && (
                <button className="btn btn-ghost btn-sm" style={{ padding: '0' }} onClick={() => setShowAddMember(true)}>+</button>
              )}
            </div>
            <ul className="simple-list">
              {data.members.map(m => (
                <li key={m.user_id} style={{ fontSize: '0.85rem' }}>
                  {m.name} <span className="muted">({m.role})</span>
                </li>
              ))}
            </ul>

            {showAddMember && (
              <div style={{ marginTop: '1rem' }}>
                <select onChange={(e) => handleAddMember(e.target.value)} defaultValue="">
                  <option value="" disabled>Add user...</option>
                  {usersList.filter(u => !data.members.find(m => m.user_id === u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddMember(false)}>Close</button>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

// ─── Modal Implementation (Inline) ──────────────────────────────────────────

function AddGroupExpenseModal({ groupId, members, categories, onClose, onSuccess }) {
    const { user, company } = useAuth();
    const [title, setTitle] = useState('');
    const [amount, setAmount] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [splitType, setSplitType] = useState('equal');
    const [shares, setShares] = useState({}); // user_id -> amount/percentage

    useEffect(() => {
        if (splitType === 'equal') {
            const equalAmt = amount ? (parseFloat(amount) / members.length).toFixed(2) : 0;
            const newShares = {};
            members.forEach(m => newShares[m.user_id] = equalAmt);
            setShares(newShares);
        }
    }, [amount, splitType, members]);

    const handleShareChange = (userId, value) => {
        setShares({ ...shares, [userId]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Sum check
        const totalShare = Object.values(shares).reduce((acc, v) => acc + parseFloat(v || 0), 0);
        if (Math.abs(totalShare - parseFloat(amount)) > 0.05) {
            toast.error(`Total shares (${totalShare.toFixed(2)}) must equal amount (${parseFloat(amount)})`);
            return;
        }

        const splitsRaw = members.map(m => ({
            user_id: m.user_id,
            share_amount: parseFloat(shares[m.user_id] || 0),
            share_percentage: splitType === 'percentage' ? parseFloat(shares[m.user_id] || 0) : null
        })).filter(s => s.share_amount > 0);

        try {
            await groupsApi.addExpense(groupId, {
                title,
                amount: parseFloat(amount),
                currency_code: company?.currency_code || 'INR',
                category_id: categoryId,
                expense_date: date,
                splits: splitsRaw
            });
            toast.success('Group expense submitted for approval!');
            onSuccess();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to add expense');
        }
    };

    return (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem', backgroundColor: '#fff', marginBottom: '1.5rem', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
            <h3>New shared expense</h3>
            <form onSubmit={handleSubmit} className="form-group">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                    <label>Title <input type="text" required value={title} onChange={e => setTitle(e.target.value)} /></label>
                    <label>Amount ({company?.currency_symbol}) <input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <label>Category
                        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} required>
                            <option value="">Select...</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </label>
                    <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
                </div>

                <div style={{ marginTop: '1rem', borderTop: '1px solid #f3f4f6', paddingTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>Split Breakdown</span>
                        <select style={{ width: 'auto' }} value={splitType} onChange={e => setSplitType(e.target.value)}>
                            <option value="equal">Equally</option>
                            <option value="unequal">Unequally</option>
                        </select>
                    </div>

                    <div style={{ marginTop: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                        {members.map(m => (
                            <div key={m.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0' }}>
                                <span>{m.name} {m.user_id === user.id ? '(You)' : ''}</span>
                                <input 
                                    style={{ width: '100px', marginBottom: 0 }} 
                                    type="number" 
                                    step="0.01" 
                                    disabled={splitType === 'equal'}
                                    value={shares[m.user_id] || ''} 
                                    onChange={e => handleShareChange(m.user_id, e.target.value)} 
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
                    <button type="submit" className="btn btn-primary">Submit for Approval</button>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </form>
        </div>
    );
}
