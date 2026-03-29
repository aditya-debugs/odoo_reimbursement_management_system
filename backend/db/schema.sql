-- =============================================
-- Reimbursement Management System - Schema
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- COMPANIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'India',
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  currency_symbol VARCHAR(10) NOT NULL DEFAULT '₹',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'employee', 'financer', 'director')) DEFAULT 'employee',
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_manager_approver BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- EXPENSE CATEGORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  gst_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  gst_rate_percent NUMERIC(5, 2) DEFAULT 18,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- EXPENSES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  amount NUMERIC(14, 2) NOT NULL,
  currency_code VARCHAR(10) NOT NULL,
  amount_in_company_currency NUMERIC(14, 2),
  exchange_rate NUMERIC(14, 6) DEFAULT 1,
  conversion_at TIMESTAMPTZ,
  expense_date DATE NOT NULL,
  receipt_url TEXT,
  receipt_filename TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  fraud_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  fraud_score SMALLINT,
  fraud_level VARCHAR(10),
  fraud_summary TEXT,
  ocr_payload JSONB,
  merchant_key VARCHAR(255),
  gst_base_amount NUMERIC(14, 2),
  gst_amount NUMERIC(14, 2),
  gst_itc_eligible BOOLEAN,
  current_approver_sequence INT DEFAULT 1,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- APPROVAL RULES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS approval_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('sequential', 'percentage', 'specific_approver', 'hybrid')),
  percentage_threshold NUMERIC(5, 2),
  specific_approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sequential_conditional_override BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- APPROVAL RULE STEPS TABLE (ordered approvers)
-- =============================================
CREATE TABLE IF NOT EXISTS approval_rule_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id UUID NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_id, step_order)
);

-- =============================================
-- EXPENSE WORKFLOW SNAPSHOTS (frozen plan)
-- =============================================
CREATE TABLE IF NOT EXISTS expense_workflow_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id UUID NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES approval_rules(id) ON DELETE SET NULL,
  rule_type VARCHAR(30) NOT NULL,
  manager_prepended BOOLEAN NOT NULL DEFAULT FALSE,
  sequential_conditional_override BOOLEAN NOT NULL DEFAULT FALSE,
  percentage_threshold NUMERIC(5, 2),
  specific_approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- EXPENSE APPROVALS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS expense_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_step_id UUID REFERENCES approval_rule_steps(id) ON DELETE SET NULL,
  sequence_order INT NOT NULL DEFAULT 1,
  is_manager_step BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  comments TEXT,
  action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- AUDIT CHAIN
-- =============================================
CREATE TABLE IF NOT EXISTS audit_chain (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chain_index BIGINT NOT NULL,
  action VARCHAR(80) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash VARCHAR(64) NOT NULL,
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, chain_index)
);

-- =============================================
-- CATEGORY BUDGETS
-- =============================================
CREATE TABLE IF NOT EXISTS category_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  monthly_cap NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, category_id)
);

-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_company ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense ON expense_approvals(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_approver ON expense_approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_snapshots_company ON expense_workflow_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_chain_company ON audit_chain(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_chain_expense ON audit_chain(expense_id);
CREATE INDEX IF NOT EXISTS idx_category_budgets_company ON category_budgets(company_id);

-- =============================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_approval_rules_updated_at BEFORE UPDATE ON approval_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_expense_approvals_updated_at BEFORE UPDATE ON expense_approvals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_category_budgets_updated_at BEFORE UPDATE ON category_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
