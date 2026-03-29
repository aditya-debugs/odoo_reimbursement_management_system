import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { groupsApi } from '../api';
import Spinner from '../components/Spinner';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', tag: 'Trip' });

  const load = async () => {
    try {
      const { data } = await groupsApi.list();
      setGroups(data);
    } catch {
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await groupsApi.create(form);
      toast.success('Group created!');
      setForm({ name: '', description: '', tag: 'Trip' });
      setShowCreate(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create group');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title">Groups & Splitting</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create Group</button>
      </div>

      {showCreate && (
        <section className="section-block" style={{ marginBottom: '2rem' }}>
          <h2>New Group</h2>
          <form onSubmit={handleCreate} className="form-group">
            <label>Group Name <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></label>
            <label>Description <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></label>
            <label>Tag
                <select value={form.tag} onChange={e => setForm({...form, tag: e.target.value})}>
                    <option value="Trip">Trip</option>
                    <option value="Project">Project</option>
                    <option value="Event">Event</option>
                    <option value="Misc">Misc</option>
                </select>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary">Create</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {groups.length === 0 ? (
        <div className="section-block muted" style={{ textAlign: 'center', padding: '3rem' }}>
          No groups found. Create one to start sharing expenses!
        </div>
      ) : (
        <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {groups.map(g => (
            <Link to={`/groups/${g.id}`} key={g.id} className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="stat-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{g.tag}</span>
                <span>{g.member_count} members</span>
              </div>
              <div className="stat-value" style={{ fontSize: '1.25rem', margin: '0.4rem 0' }}>{g.name}</div>
              <p className="muted" style={{ fontSize: '0.85rem' }}>{g.description || 'No description'}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
