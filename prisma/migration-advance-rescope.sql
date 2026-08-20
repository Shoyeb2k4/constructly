-- Advance Re-scope / Transfer (Pass 10B)
--
-- Governed correction for advance SCOPE. Unused money recorded against the
-- wrong scope — or stranded on a cancelled agreement — can be moved, without
-- rewriting history and without moving cash.
--
-- A re-scope is always a PAIR written in one transaction:
--   SCOPE_TRANSFER_OUT  −amount at the source scope, draws_from_entry_id = the advance
--   SCOPE_TRANSFER_IN   +amount at the target scope, draws_from_entry_id = the OUT
-- so the contractor's total advance balance is unchanged by construction.
--
-- No new columns: draws_from_entry_id already carries the whole lineage, and the
-- existing CHECK (contract_id IS NULL OR project_id IS NOT NULL) plus the
-- composite FK to contractor_contracts already constrain the new rows correctly.
--
-- Postgres 17 permits ALTER TYPE ... ADD VALUE inside a transaction block, but
-- apply this on its own regardless — an enum addition is not rollback-friendly.

ALTER TYPE "ContractorLedgerType" ADD VALUE IF NOT EXISTS 'SCOPE_TRANSFER_OUT';
ALTER TYPE "ContractorLedgerType" ADD VALUE IF NOT EXISTS 'SCOPE_TRANSFER_IN';
