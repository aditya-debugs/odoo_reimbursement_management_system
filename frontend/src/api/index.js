import api from './client';

export const authApi = {
  signup: (body) => api.post('/auth/signup', body),
  login: (body) => api.post('/auth/login', body),
  me: () => api.get('/auth/me'),
  countries: () => api.get('/auth/countries'),
};

export const usersApi = {
  list: () => api.get('/users'),
  create: (body) => api.post('/users', body),
  update: (id, body) => api.patch(`/users/${id}`, body),
  remove: (id) => api.delete(`/users/${id}`),
};

export const categoriesApi = {
  /** Pass `{ all: 'true' }` as admin to include inactive categories. */
  list: (params) => api.get('/categories', { params }),
  create: (body) => api.post('/categories', body),
  update: (id, body) => api.patch(`/categories/${id}`, body),
  remove: (id) => api.delete(`/categories/${id}`),
};

export const expensesApi = {
  list: (params) => api.get('/expenses', { params }),
  get: (id) => api.get(`/expenses/${id}`),
  submit: (formData) =>
    api.post('/expenses', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  ocr: (formData) =>
    api.post('/expenses/ocr', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  cancel: (id) => api.patch(`/expenses/${id}/cancel`),
};

export const approvalsApi = {
  pending: () => api.get('/approvals/pending'),
  action: (id, body) => api.post(`/approvals/${id}/action`, body),
};

export const rulesApi = {
  list: () => api.get('/rules'),
  create: (body) => api.post('/rules', body),
  update: (id, body) => api.patch(`/rules/${id}`, body),
  remove: (id) => api.delete(`/rules/${id}`),
};

export const analyticsApi = {
  summary: (params) => api.get('/analytics/summary', { params }),
  monthly: (params) => api.get('/analytics/monthly', { params }),
  categories: (params) => api.get('/analytics/categories', { params }),
  employees: (params) => api.get('/analytics/employees', { params }),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  readAll: () => api.patch('/notifications/read-all'),
};

export const auditApi = {
  chain: () => api.get('/audit/chain'),
  verify: () => api.post('/audit/verify'),
};

export const budgetsApi = {
  list: () => api.get('/budgets'),
  set: (body) => api.post('/budgets', body),
  remove: (id) => api.delete(`/budgets/${id}`),
};

export const gstApi = {
  downloadReport: (from, to) =>
    api.get('/gst/report', { params: { from, to }, responseType: 'blob' }),
};

export const trackingApi = {
  get: (expenseId) => api.get(`/tracking/${expenseId}`),
};

export const groupsApi = {
  list: () => api.get('/groups'),
  create: (data) => api.post('/groups', data),
  get: (id) => api.get(`/groups/${id}`),
  addMember: (id, data) => api.post(`/groups/${id}/members`, data),
  addExpense: (id, data) => api.post(`/groups/${id}/expenses`, data),
  simplify: (id) => api.get(`/groups/${id}/simplify`),
};

export const employeeAnalyticsApi = {
  summary: (params) => api.get('/employee-analytics/summary', { params }),
  trends: (params) => api.get('/employee-analytics/trends', { params }),
  categories: (params) => api.get('/employee-analytics/categories', { params }),
  topExpenses: (params) => api.get('/employee-analytics/top-expenses', { params }),
  recent: (params) => api.get('/employee-analytics/recent', { params }),
  insights: (params) => api.get('/employee-analytics/insights', { params }),
  comparison: () => api.get('/employee-analytics/comparison'),
};
