import { useEffect, useRef, useState } from 'react';
import { notificationsApi } from '../api';
import toast from 'react-hot-toast';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread_count: 0 });
  const ref = useRef(null);

  const load = async () => {
    try {
      const { data: d } = await notificationsApi.list();
      setData(d);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const markAll = async () => {
    try {
      await notificationsApi.readAll();
      toast.success('Notifications marked read');
      load();
    } catch {
      toast.error('Could not update notifications');
    }
  };

  return (
    <div className="notif-bell" ref={ref}>
      <button
        type="button"
        className="notif-btn"
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
          load();
        }}
      >
        <span className="notif-icon">🔔</span>
        {data.unread_count > 0 ? <span className="notif-dot">{data.unread_count}</span> : null}
      </button>
      {open ? (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <span>Notifications</span>
            <button type="button" className="link-btn" onClick={markAll}>
              Mark all read
            </button>
          </div>
          <ul className="notif-list">
            {data.items.length === 0 ? (
              <li className="notif-empty">No notifications</li>
            ) : (
              data.items.map((n) => (
                <li key={n.id} className={n.is_read ? 'notif-item' : 'notif-item unread'}>
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                  <time>{new Date(n.created_at).toLocaleString()}</time>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
