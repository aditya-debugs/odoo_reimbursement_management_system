import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

const linkClass = ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link');

export default function Layout() {
  const { user, company, logout, canAccessApprovals, canAccessAnalytics, isAdmin } = useAuth();
  const navigate = useNavigate();

  const isEmployee = user?.role === 'employee';
  const showApproverBlock = canAccessApprovals && !isEmployee;
  const showAdminBlock = isAdmin;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">R</span>
          <div>
            <div className="brand-title">Reimburse</div>
            <div className="brand-sub">{company?.name}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">Overview</div>
          <NavLink to="/" end className={linkClass}>
            Dashboard
          </NavLink>

          {isEmployee ? (
            <>
              <div className="nav-section-label">My claims</div>
              <NavLink to="/submit" className={linkClass}>
                Submit expense
              </NavLink>
              <NavLink to="/my-expenses" className={linkClass}>
                My expenses
              </NavLink>
            </>
          ) : null}

          {showApproverBlock ? (
            <>
              <div className="nav-section-label">Approvals &amp; insights</div>
              <NavLink to="/approvals" className={linkClass}>
                Approval queue
              </NavLink>
              {canAccessAnalytics ? (
                <NavLink to="/analytics" className={linkClass}>
                  Analytics
                </NavLink>
              ) : null}
            </>
          ) : null}

          {showAdminBlock ? (
            <>
              <div className="nav-section-label">Administration</div>
              <NavLink to="/admin/users" className={linkClass}>
                Users
              </NavLink>
              <NavLink to="/admin/categories" className={linkClass}>
                Categories
              </NavLink>
              <NavLink to="/admin/rules" className={linkClass}>
                Approval rules
              </NavLink>
              <NavLink to="/admin/expenses" className={linkClass}>
                All expenses
              </NavLink>
              <NavLink to="/admin/audit" className={linkClass}>
                Audit chain
              </NavLink>
            </>
          ) : null}
        </nav>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-user">
            <span className="muted">{user?.name}</span>
            <span className="role-pill">{user?.role}</span>
          </div>
          <div className="topbar-actions">
            <NotificationBell />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
