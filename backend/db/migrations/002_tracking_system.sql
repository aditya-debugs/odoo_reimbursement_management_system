-- =============================================
-- Migration 002: Transparency & Tracking System
-- =============================================

-- Stage time configuration for ETA calculation
CREATE TABLE IF NOT EXISTS stage_time_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  stage_name VARCHAR(100) NOT NULL,
  min_days INT NOT NULL DEFAULT 1,
  max_days INT NOT NULL DEFAULT 3,
  avg_days NUMERIC(5,2) NOT NULL DEFAULT 1.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, stage_name)
);

-- Seed default global stage configs (company_id = NULL means global default)
INSERT INTO stage_time_config (stage_name, min_days, max_days, avg_days)
VALUES
  ('Manager Approval',  1, 2,  1.0),
  ('Finance Approval',  1, 3,  2.0),
  ('Director Approval', 1, 3,  2.0),
  ('Final Review',      1, 2,  1.5)
ON CONFLICT DO NOTHING;

-- Add delay tracking columns to expense_approvals if not present
ALTER TABLE expense_approvals ADD COLUMN IF NOT EXISTS delay_flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE expense_approvals ADD COLUMN IF NOT EXISTS delay_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stage_time_config_company ON stage_time_config(company_id);
