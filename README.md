# Reimbursement Management System

Full-stack expense reimbursement app: employees submit claims with optional receipt OCR, configurable approval workflows (sequential, percentage, specific approver, hybrid), rule-based fraud flags, notifications, and analytics (Recharts).

## Stack

- **Backend:** Node.js, Express 5, PostgreSQL (Neon) via `pg`, JWT auth, Multer uploads, Tesseract.js OCR, exchangerate-api.com for FX.
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

Edit `.env`: set `DATABASE_URL`, `JWT_SECRET`, `PORT` (default `5000`), `FRONTEND_URL` (default `http://localhost:5173`).

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
2. As **admin**, create **Users** (employees/managers) and an **Approval rule** with ordered approver steps.
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
| Categories | `GET /api/categories`, `POST/PATCH/DELETE` (admin) |
| Expenses   | `GET/POST /api/expenses`, `GET /api/expenses/:id`, `PATCH .../cancel`, `POST /api/expenses/ocr` |
| Approvals  | `GET /api/approvals/pending`, `POST /api/approvals/:id/action` |
| Rules      | `GET/POST/PATCH/DELETE /api/rules` (admin) |
| Analytics  | `/api/analytics/summary`, `/monthly`, `/categories`, `/employees` |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/read-all` |

## Notes

- The **first active** approval rule for the company (oldest by `created_at`) drives new expenses. If none exists or it has no steps, expenses are **auto-approved**.
- **Company admins** can approve any pending step from the queue (override). Managers only see their own pending rows.
- Fraud checks run on submit and populate `expenses.fraud_flags` (JSON array); admins get a notification when flags are present.

## Scripts

| Location   | Command      | Purpose        |
|-----------|--------------|----------------|
| `backend` | `npm start`  | Run API server |
| `frontend`| `npm run dev`| Vite dev server|
| `frontend`| `npm run build` | Production build |
