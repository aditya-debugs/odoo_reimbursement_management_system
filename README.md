# Reimbursement Management System

Full-stack expense reimbursement app: employees submit claims with optional receipt OCR, configurable approval workflows (sequential, percentage, specific approver, hybrid), rule-based fraud flags, notifications, and analytics (Recharts).

## Stack

- **Backend:** Node.js, Express 5, PostgreSQL (Neon) via `pg`, JWT auth, Multer uploads, Tesseract.js OCR (optional Groq or OpenAI vision refinement), exchangerate-api.com for FX.
- **Frontend:** React 19 (Vite), React Router 7, Axios, Recharts, react-hot-toast, Inter + indigo UI.

## Prerequisites

- Node.js 18+
- A Neon (or any PostgreSQL) database
- Optional: [exchangerate-api.com](https://www.exchangerate-api.com/) free tier for live rates (API works without a key for `v4/latest/{base}` in many environments; if rates fail, amounts still store with rate `1` fallback in code paths that use cache)

## Setup

### 1. Database

Run the SQL in `backend/db/schema.sql` on your Postgres instance (Neon SQL editor or `psql`).

If you already applied an older schema without `fraud_flags`, run:

```sql
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fraud_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL`, `JWT_SECRET`, `PORT` (default `5000`), `FRONTEND_URL` (default `http://localhost:5173`). Optional: **`GROQ_API_KEY`** (recommended) or **`OPENAI_API_KEY`** enables an **AI vision review** after Tesseract on **Run OCR** (images are sent to that provider). If both keys exist, Groq is used unless you set `OCR_AI_PROVIDER=openai`. Use `OCR_AI_DISABLED=true` for local-only OCR. See `.env.example` for model IDs.

```bash
npm install
npm start
```

API base: `http://localhost:5000/api`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/uploads` to the backend (see `frontend/vite.config.js`).

## First-time flow

1. Open the app → **Sign up** creates the **company** and **admin** user (currency is inferred from country via restcountries.com).
2. As **admin**, create **Users** (employees/managers), adjust **Categories** if needed, and an **Approval rule** with ordered approver steps.
3. Log in as an **employee**: **Submit expense** (optional receipt + **Run OCR**), then track status under **My expenses**.
4. Approvers (or admin) use **Approval queue**. **Analytics** is available to managers and admins; employee spending chart is admin-only.

## Project layout

- `backend/db/` — pool (`index.js`), schema
- `backend/middleware/` — JWT auth, role guard
- `backend/services/` — currency, OCR, fraud, approval workflow
- `backend/routes/` — REST API
- `backend/uploads/` — receipt files (gitignored except `.gitkeep`)
- `frontend/src/api/` — Axios client and API helpers
- `frontend/src/pages/` — screens

## API overview

| Area        | Examples |
|------------|----------|
| Auth       | `POST /api/auth/signup`, `/login`, `GET /api/auth/me` |
| Users      | `GET/POST/PATCH/DELETE /api/users` (admin) |
| Categories | `GET /api/categories` (active only; add `?all=true` as **admin** for inactive too), `POST/PATCH/DELETE` (admin) |
| Expenses   | `GET/POST /api/expenses`, `GET /api/expenses/:id`, `PATCH .../cancel`, `POST /api/expenses/ocr` |
| Approvals  | `GET /api/approvals/pending`, `POST /api/approvals/:id/action` |
| Rules      | `GET/POST/PATCH/DELETE /api/rules` (admin) |
| Analytics  | `/api/analytics/summary`, `/monthly`, `/categories`, `/employees` |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/read-all` |

## Notes

- The **first active** approval rule for the company (oldest by `created_at`) drives new expenses. If none exists or it has no steps, expenses are **auto-approved**.
- **Company admins** can approve any pending step from the queue (override). Managers only see their own pending rows.
- Fraud checks run on submit and populate `expenses.fraud_flags` (JSON array); admins get a notification when flags are present.

## Demo data (full UI — stored in Neon)

`npm run seed:demo` inserts a full tenant **Northwind Industries (Demo)** into the database configured in `DATABASE_URL` (e.g. Neon). It includes:

- **16 users**: 1 admin, 1 director, 2 financers, 3 managers, 9 employees (realistic manager lines)
- **11 categories** (GST mix), **6 category budgets**
- **4 approval rules** (1 active sequential; 3 inactive: percentage, specific approver, hybrid) each with **steps** so the Rules page looks real
- **~35+ approved** expenses across **Oct 2025–Mar 2026** (strong line chart), **5 large** approved lines for pie balance, **3 pending**, **2 rejected**, **2 cancelled**
- **Notifications** and **audit** blocks

```bash
cd backend
npm run seed:demo
```

- Password for **every** demo user: **`Demo123!`**
- **Admin** (full sidebar: Users, Categories, Rules, All expenses, Audit): `admin@northwind-demo.local`
- **Director / financer** (queue + analytics + GST export + employee bar): `director@…`, `financer@…`, `financer2@…`
- **Manager** (queue + analytics, no admin section): `manager.riya@…`, `manager.karan@…`, `manager.deepa@…`
- **Employee** (Dashboard + Submit + My expenses only): `*.emp@northwind-demo.local`

Replace demo data: `npm run seed:demo -- --reset`

Use **Log out**, then sign in with a demo email. Your other company (e.g. from signup) is unchanged.

## Automated API smoke test

With the **backend running** on the default URL (`http://localhost:5000`) and the database migrated (including `audit_chain` if your app records approvals there):

```bash
cd backend
npm run smoke
```

This creates a disposable company via **signup**, adds a **sequential rule**, an **employee**, submits an **expense**, **approves** it (with required comment), and calls **analytics/summary**.  
Override the base URL: `API_URL=http://127.0.0.1:5000 npm run smoke`.

## Scripts

| Location   | Command      | Purpose        |
|-----------|--------------|----------------|
| `backend` | `npm start`  | Run API server |
| `backend` | `npm run smoke` | API end-to-end smoke test (server must be up) |
| `frontend`| `npm run dev`| Vite dev server|
| `frontend`| `npm run build` | Production build |
