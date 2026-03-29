import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

const linkClass = ({ isActive }) => (isActive ? "nav-link active" : "nav-link");

export default function Layout() {
  const {
    user,
    company,
    logout,
    canAccessApprovals,
    canAccessAnalytics,
    isAdmin,
  } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.name || "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand card">
          <span className="brand-avatar">{initials}</span>
          <div className="brand-profile-copy">
            <div className="brand-title">{user?.name}</div>
            <div className="brand-sub">{user?.email}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className={linkClass}>
            Dashboard
          </NavLink>
          {user?.role === "employee" ? (
            <>
              <NavLink to="/submit" className={linkClass}>
                Submit expense
              </NavLink>
              <NavLink to="/my-expenses" className={linkClass}>
                My expenses
              </NavLink>
            </>
          ) : null}
          {canAccessApprovals ? (
            <>
              <NavLink to="/approvals" className={linkClass}>
                Approval queue
              </NavLink>
            </>
          ) : null}
          {canAccessAnalytics ? (
            <NavLink to="/analytics" className={linkClass}>
              Analytics
            </NavLink>
          ) : null}
          {isAdmin ? (
            <>
              <NavLink to="/admin/users" className={linkClass}>
                Users
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
            <span className="muted">{company?.name}</span>
            <span className="role-pill">{user?.role}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-ghost topbar-pill"
              title="Theme"
            >
              Theme
            </button>
            <NotificationBell />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                logout();
                navigate("/login");
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
