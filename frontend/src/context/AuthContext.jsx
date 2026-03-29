import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      setCompany(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await authApi.me();
      setUser(data.user);
      setCompany(data.company);
    } catch {
      localStorage.removeItem('token');
      setUser(null);
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (email, password) => {
    const { data } = await authApi.login({ email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    setCompany(data.user.company);
    return data;
  };

  const signup = async (payload) => {
    const { data } = await authApi.signup(payload);
    localStorage.setItem('token', data.token);
    setUser(data.user);
    setCompany(data.user.company ?? data.company);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setCompany(null);
  };

  const value = useMemo(
    () => ({
      user,
      company,
      loading,
      login,
      signup,
      logout,
      loadMe,
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager',
      isEmployee: user?.role === 'employee',
      isFinancer: user?.role === 'financer',
      isDirector: user?.role === 'director',
      canAccessApprovals: ['admin', 'manager', 'financer', 'director'].includes(user?.role),
      canAccessAnalytics: ['admin', 'manager', 'financer', 'director'].includes(user?.role),
    }),
    [user, company, loading, loadMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
