/**
 * API smoke test: signup → rule → employee → submit expense → approve → analytics.
 * Requires: backend running (default http://localhost:5000) and DB migrated (incl. audit_chain if approvals append audit).
 *
 * Usage:  npm run smoke
 * Or:     API_URL=https://example.com node scripts/smoke-api.mjs
 */

const BASE = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function readError(res) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return j.message || JSON.stringify(j);
  } catch {
    return t || res.statusText;
  }
}

async function main() {
  const ts = Date.now();
  const adminEmail = `smoke_admin_${ts}@example.com`;
  const empEmail = `smoke_emp_${ts}@example.com`;
  const password = 'SmokeTest123!';

  let res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`health: ${res.status} ${await readError(res)}`);
  console.log('✓ GET /api/health');

  res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: `Smoke Co ${ts}`,
      country: 'India',
      name: 'Smoke Admin',
      email: adminEmail,
      password,
    }),
  });
  if (!res.ok) throw new Error(`signup: ${res.status} ${await readError(res)}`);
  const signup = await res.json();
  const adminToken = signup.token;
  const adminId = signup.user.id;
  const companyCurrency = signup.user.company?.currency_code || 'INR';
  console.log('✓ POST /api/auth/signup');

  res = await fetch(`${BASE}/api/categories?all=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) throw new Error(`categories: ${res.status} ${await readError(res)}`);
  const cats = await res.json();
  const categoryId = cats.find((c) => c.is_active)?.id || cats[0]?.id;
  if (!categoryId) throw new Error('No categories after signup');
  console.log('✓ GET /api/categories?all=true');

  res = await fetch(`${BASE}/api/rules`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke sequential',
      rule_type: 'sequential',
      steps: [{ approver_id: adminId, step_order: 1 }],
    }),
  });
  if (!res.ok) throw new Error(`rules: ${res.status} ${await readError(res)}`);
  console.log('✓ POST /api/rules');

  res = await fetch(`${BASE}/api/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Employee',
      email: empEmail,
      password,
      role: 'employee',
    }),
  });
  if (!res.ok) throw new Error(`users: ${res.status} ${await readError(res)}`);
  console.log('✓ POST /api/users (employee)');

  res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: empEmail, password }),
  });
  if (!res.ok) throw new Error(`login employee: ${res.status} ${await readError(res)}`);
  const empSession = await res.json();
  const empToken = empSession.token;
  console.log('✓ POST /api/auth/login (employee)');

  const fd = new FormData();
  fd.append('title', 'Smoke meal');
  fd.append('amount', '42');
  fd.append('currency_code', companyCurrency);
  fd.append('expense_date', '2026-03-15');
  fd.append('category_id', categoryId);

  res = await fetch(`${BASE}/api/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`expenses: ${res.status} ${await readError(res)}`);
  console.log('✓ POST /api/expenses');

  res = await fetch(`${BASE}/api/approvals/pending`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) throw new Error(`pending: ${res.status} ${await readError(res)}`);
  const pending = await res.json();
  const approvalId = pending[0]?.id;
  if (!approvalId) throw new Error('No pending approval row');
  console.log('✓ GET /api/approvals/pending');

  res = await fetch(`${BASE}/api/approvals/${approvalId}/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', comments: 'Smoke test approval' }),
  });
  if (!res.ok) throw new Error(`approve: ${res.status} ${await readError(res)}`);
  console.log('✓ POST /api/approvals/:id/action');

  res = await fetch(`${BASE}/api/analytics/summary`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) throw new Error(`analytics: ${res.status} ${await readError(res)}`);
  const summary = await res.json();
  console.log('✓ GET /api/analytics/summary');
  console.log('\nSmoke test passed.', { approved_count: summary.approved_count, pending_count: summary.pending_count });
}

main().catch((e) => {
  console.error('\nSMOKE FAILED:', e.message);
  process.exit(1);
});
