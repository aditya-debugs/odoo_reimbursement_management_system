import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import SubmitExpense from './pages/SubmitExpense';
import MyExpenses from './pages/MyExpenses';
import ExpenseDetail from './pages/ExpenseDetail';
import ApprovalQueue from './pages/ApprovalQueue';
import AdminUsers from './pages/AdminUsers';
import AdminRules from './pages/AdminRules';
import AllExpenses from './pages/AllExpenses';
import Analytics from './pages/Analytics';
import AdminAudit from './pages/AdminAudit';

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <Login />
              </PublicOnly>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicOnly>
                <Signup />
              </PublicOnly>
            }
          />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/submit" element={<SubmitExpense />} />
              <Route path="/my-expenses" element={<MyExpenses />} />
              <Route path="/expenses/:id" element={<ExpenseDetail />} />
              <Route path="/approvals" element={<ApprovalQueue />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/rules" element={<AdminRules />} />
              <Route path="/admin/expenses" element={<AllExpenses />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
