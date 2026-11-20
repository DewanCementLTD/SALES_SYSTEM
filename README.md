# DCL Sales & Dispatch — project kickoff pack

Starter repository for building the new Dewan Cement Limited Sales & Dispatch system with Claude Code (Node.js + Next.js, JavaScript only, Oracle).

## Contents

| Path | What |
|---|---|
| `KICKOFF_PROMPT.md` | The prompt to paste into Claude Code |
| `CLAUDE.md` | Standing rules Claude Code follows in every session |
| `docs/BRD.md` | Business requirements, scope, open questions, decision log |
| `docs/PRD.md` | Product requirements: modules, screens, acceptance criteria, NFRs, releases |
| `docs/BUSINESS_RULES.md` | Every business rule with an ID (balance, tax, weight tolerance, ledger, numbering, approvals, state machines) |
| `docs/ARCHITECTURE.md` | Stack, repo layout, layering, flows, security, ADRs |
| `docs/SCHEMA.md` | Database conventions, legacy tables used, new tables/columns, settings, migration |
| `docs/API_SPEC.md` | REST endpoints with permissions and examples |
| `docs/PERMISSIONS.md` | Roles, permission keys, role matrix, enforcement, legacy permission migration |
| `docs/TASKS.md` | Phased build plan P0–P6 with acceptance criteria |
| `docs/reference/REQUIREMENTS_SPEC.md` | Business requirements spec (export, without screenshots) |
| `docs/reference/LEGACY_TABLES.md` | All 174 unified tables with columns and keys (generated) |
| `docs/reference/workflow-v2.png` | Business Workflow V2 process map |
| `db/01…04, FIND_ACTIVE_TABLES.sql` | Unified schema, load, keys, cleanup, check scripts (as used on the test server) |
| `db/05_NEW_SYSTEM_TABLES.sql` | New tables and columns for the application (not yet run against a database) |

## How to start

1. Create an empty git repository and copy this folder's contents into its root.
2. Check that `db/01_DCL_SALES_TABLES.sql` is the same version you ran on the server (replace it if you changed it there).
3. Open Claude Code in the repository root and paste the prompt from `KICKOFF_PROMPT.md`.
4. Answer the open questions in `docs/BRD.md` §8 as they come; record each answer in the decision log.
