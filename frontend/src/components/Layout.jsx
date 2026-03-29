import { useEffect, useState } from "react";
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
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const initials = (user?.name || "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isEmployee = user?.role === 'employee';
  const showApproverBlock = canAccessApprovals && !isEmployee;
  const showAdminBlock = isAdmin;

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
          <div className="nav-section-label">Overview</div>
          <NavLink to="/" end className={linkClass}>
            Dashboard
          </NavLink>
          {user?.role === "employee" ? (
            <>
              <div className="nav-section-label">My claims</div>
              <NavLink to="/submit" className={linkClass}>
                Submit expense
              </NavLink>
              <NavLink to="/my-expenses" className={linkClass}>
                My expenses
              </NavLink>
              <NavLink to="/groups" className={linkClass}>
                Groups (Splitwise)
              </NavLink>
              <NavLink to="/analytics/personal" className={linkClass}>
                Personal Analytics
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/groups" className={linkClass}>
                Groups (Splitwise)
              </NavLink>
            </>
          )}
          {canAccessApprovals ? (
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
            <span className="muted">{company?.name}</span>
            <span className="role-pill">{user?.role}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-ghost topbar-pill"
              title="Switch theme"
              onClick={toggleTheme}
              aria-label="Toggle light and dark theme"
              aria-pressed={theme === "dark"}
            >
              Theme: {theme === "dark" ? "Dark" : "Light"}
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
