-- Idempotent migrations for plan features (safe to re-run)

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Users: extend role check (drop old constraint if exists)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'employee', 'financer', 'director'));

-- Expenses: conversion time, OCR payload, merchant key, GST
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS conversion_at TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ocr_payload JSONB;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS merchant_key VARCHAR(255);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gst_base_amount NUMERIC(14, 2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(14, 2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gst_itc_eligible BOOLEAN;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fraud_score SMALLINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fraud_level VARCHAR(10);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fraud_summary TEXT;

ALTER TABLE expense_approvals ADD COLUMN IF NOT EXISTS is_manager_step BOOLEAN NOT NULL DEFAULT FALSE;

-- Categories: GST flags
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS gst_applicable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC(5, 2) DEFAULT 18;

-- Approval rules: sequential conditional override
ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS sequential_conditional_override BOOLEAN NOT NULL DEFAULT FALSE;

-- Workflow snapshot (frozen plan per expense)
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

CREATE INDEX IF NOT EXISTS idx_workflow_snapshots_company ON expense_workflow_snapshots(company_id);

-- Audit chain
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

CREATE INDEX IF NOT EXISTS idx_audit_chain_company ON audit_chain(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_chain_expense ON audit_chain(expense_id);

-- Category budgets (monthly cap per category)
CREATE TABLE IF NOT EXISTS category_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  monthly_cap NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_category_budgets_company ON category_budgets(company_id);

CREATE OR REPLACE TRIGGER update_category_budgets_updated_at
  BEFORE UPDATE ON category_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
