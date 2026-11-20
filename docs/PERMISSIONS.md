# PERMISSIONS.md — Role-based access control

Model: **user → roles per branch → permissions**. A request is allowed when the user holds the permission **in the branch of the data** (current branch, or the document's branch). Permission keys are constants in `packages/shared/src/permissions.js`; the seed script writes them to `APP_PERMISSION`. The same constants drive UI visibility (hide/disable) — the API is always the enforcer.

---

## 1. Permission keys

Format `module.action`. Standard actions:

| Action | Meaning |
|---|---|
| `view` | List and open |
| `create` | Create / save draft |
| `update` | Edit while editable |
| `cancel` | Cancel with reason |
| `approve` | Approve/reject (maker-checker; never own) |
| `print` | Print / download PDF |
| `share` | Email / WhatsApp / link (spec 10.4) |
| `export` | Excel export |
| `override` | Bypass a check with reason (always also needs an approval rule unless stated) |
| `configure` | Change settings/rules of the module |

| Module | Keys |
|---|---|
| admin | `admin.users`, `admin.roles`, `admin.settings`, `admin.devices`, `admin.templates`, `admin.print_texts`, `admin.gl_map`, `admin.approval_rules` |
| audit | `audit.view` |
| masters | `masters.view`, `masters.create`, `masters.update` (geography, products, DO types, bags, channels, banks, instruments, transporters, credit/note types) |
| pricing | `pricing.view`, `pricing.create` (new rate rows), `pricing.approve`, `pricing.import` |
| tax | `tax.view`, `tax.update`, `tax.approve` |
| customer | `customer.view`, `customer.create`, `customer.update`, `customer.approve`, `customer.block`, `customer.credit_limit`, `customer.credit_limit_approve`, `customer.view_balance` |
| srf | `srf.view`, `srf.create`, `srf.update`, `srf.cancel`, `srf.print`, `srf.share` |
| oc | `oc.view`, `oc.create`, `oc.update`, `oc.review`, `oc.approve`, `oc.confirm`, `oc.cancel`, `oc.price_override`, `oc.balance_override`, `oc.print`, `oc.share` |
| brv | `brv.view`, `brv.create`, `brv.update`, `brv.verify`, `brv.bounce`, `brv.cancel`, `brv.print`, `brv.share` |
| permit | `permit.view`, `permit.create`, `permit.update`, `permit.issue`, `permit.send_cfo`, `permit.cfo_approve`, `permit.adjust`, `permit.cancel`, `permit.balance_override`, `permit.print`, `permit.share` |
| do | `do.view`, `do.cancel`, `do.adjust`, `do.hold_release`, `do.reprice`, `do.print`, `do.share`, `do.resend` |
| gate | `gate.view`, `gate.in`, `gate.manual_lookup`, `gate.exit`, `gate.abort`, `gate.temp_token`, `gate.exit_override` |
| weigh | `weigh.view`, `weigh.capture`, `weigh.manual`, `weigh.override` |
| dc | `dc.view`, `dc.update` (bags/bilty/export fields before invoice), `dc.cancel`, `dc.print`, `dc.share` |
| invoice | `invoice.view`, `invoice.print`, `invoice.share`, `invoice.fbr_retry`, `invoice.fbr_view` |
| sync | `sync.push` (devices), `sync.resolve` |
| ledger | `ledger.view`, `ledger.print`, `ledger.share`, `ledger.recon` |
| note | `note.view`, `note.create`, `note.approve`, `note.post`, `note.reverse`, `note.transfer`, `note.print`, `note.share` |
| incentive | `incentive.view`, `incentive.run`, `incentive.commit`, `target.view`, `target.update` |
| report | `report.r1` … `report.r13`, `report.merge_branches`, `report.export`, `report.share` |
| dashboard | `dashboard.sales`, `dashboard.plant`, `dashboard.management` |
| approval | `approval.inbox` (see requests routed to own roles) |

## 2. Roles (seeded)

| Role code | Name | Typical users |
|---|---|---|
| SYS_ADMIN | System administrator | IT |
| BRANCH_ADMIN | Branch administrator | IT at plant |
| MARKETING | Marketing / sales officer | Sales team |
| SALES_MANAGER | Sales manager | Head of sales |
| FINANCE | Finance officer | Finance |
| FINANCE_MANAGER | Finance manager | Head of finance |
| CFO | CFO | CFO |
| CUSTOMER_APPROVER | Authorised customer approver | Named sales users |
| GATE_OPERATOR | Gate operator | Security/gate staff |
| WEIGH_OPERATOR | Weighbridge operator | Weighbridge staff |
| DISPATCH_SUPERVISOR | Dispatch supervisor | Shift supervisor |
| PLANT_MANAGER | Plant manager | Plant head |
| MANAGEMENT | Management (read) | Directors |
| AUDITOR | Auditor (read-only) | Internal audit |

## 3. Role → permission matrix

✓ = granted. Anything not listed is denied. `*` = all keys of the module.

| Permission | ADMIN¹ | MKT | SLS_MGR | FIN | FIN_MGR | CFO | CUST_APR | GATE | WEIGH | DSP_SUP | PLANT_MGR | MGMT | AUD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| admin.* | ✓ | | | | | | | | | | | | |
| audit.view | ✓ | | | | ✓ | ✓ | | | | | ✓ | | ✓ |
| masters.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| masters.create/update | ✓ | | ✓ | | ✓ | | | | | | | | |
| pricing.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| pricing.create/import | | | ✓ | | ✓ | | | | | | | | |
| pricing.approve | | | | | ✓ | ✓ | | | | | | | |
| tax.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | | ✓ |
| tax.update | | | | | ✓ | | | | | | | | |
| tax.approve | | | | | | ✓ | | | | | | | |
| customer.view, view_balance | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ |
| customer.create/update | | ✓ | ✓ | ✓ | | | | | | | | | |
| customer.approve, block | | | | | | | ✓ | | | | | | |
| customer.credit_limit | | | ✓ | ✓ | | | | | | | | | |
| customer.credit_limit_approve | | | | | ✓ | ✓ | | | | | | | |
| srf.view/create/update/cancel/print/share | | ✓ | ✓ | ✓ (view) | | | | | | | | ✓ (view) | ✓ (view) |
| oc.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| oc.create/update | | ✓ | ✓ | ✓ | | | | | | | | | |
| oc.review | | | ✓ | ✓ | ✓ | | | | | | | | |
| oc.approve | | | ✓ | ✓ | ✓ | | | | | | | | |
| oc.confirm | | | | ✓ | ✓ | | | | | | | | |
| oc.cancel | | | ✓ | ✓ | ✓ | | | | | | | | |
| oc.price_override (request) | | ✓ | ✓ | ✓ | | | | | | | | | |
| oc.balance_override (request) | | | ✓ | ✓ | ✓ | | | | | | | | |
| oc.print/share | | ✓ | ✓ | ✓ | ✓ | | | | | | | | |
| brv.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| brv.create/update/print/share | | | ✓ | ✓ | ✓ | | | | | | | | |
| brv.verify, brv.bounce | | | | ✓ | ✓ | | | | | | | | |
| brv.cancel | | | | ✓ | ✓ | | | | | | | | |
| permit.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | ✓ |
| permit.create/update/issue/send_cfo/print/share | | | ✓ | ✓ | ✓ | | | | | | | | |
| permit.cfo_approve | | | | | | ✓ | | | | | | | |
| permit.adjust, permit.cancel | | | ✓ | ✓ | ✓ | | | | | | | | |
| permit.balance_override (request) | | | ✓ | ✓ | ✓ | | | | | | | | |
| do.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | ✓ |
| do.cancel, do.adjust, do.hold_release, do.reprice | | | ✓ | ✓ | ✓ | | | | | | | | |
| do.print, do.share, do.resend | | ✓ | ✓ | ✓ | ✓ | | | | | | | | |
| gate.view | | | | | | | | ✓ | ✓ | ✓ | ✓ | | ✓ |
| gate.in, gate.exit | | | | | | | | ✓ | | ✓ | | | |
| gate.manual_lookup | | | | | | | | | | ✓ | ✓ | | |
| gate.abort | | | | | | | | | | ✓ | ✓ | | |
| gate.temp_token | | | | | | | | | | ✓ | | | |
| gate.exit_override (request) | | | | | | | | | | ✓ | ✓ | | |
| weigh.view, weigh.capture | | | | | | | | | ✓ | ✓ | | | |
| weigh.manual | | | | | | | | | | ✓ | ✓ | | |
| weigh.override (request) | | | | | | | | | | ✓ | ✓ | | |
| dc.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| dc.update, dc.print | | | | | | | | ✓ (print) | | ✓ | ✓ | | |
| dc.cancel | | | | | | | | | | ✓ | ✓ | | |
| dc.share | | ✓ | ✓ | ✓ | | | | | | ✓ | | | |
| invoice.view/print/share | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ | ✓ | ✓ | ✓ (view) |
| invoice.fbr_view, fbr_retry | | | | ✓ | ✓ | | | | | ✓ | ✓ | | ✓ (view) |
| sync.resolve | | | | | | | | | | ✓ | ✓ | | |
| ledger.view/print/share | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| ledger.recon | | | | | ✓ | | | | | | | | ✓ |
| note.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| note.create, note.transfer | | | ✓ | ✓ | ✓ | | | | | | | | |
| note.approve | | | | | ✓ | ✓ | | | | | | | |
| note.post, note.reverse | | | | ✓ | ✓ | | | | | | | | |
| incentive.view, target.view | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | ✓ |
| incentive.run, target.update | | | ✓ | ✓ | | | | | | | | | |
| incentive.commit | | | | | ✓ | | | | | | | | |
| report.r1–r13, export, share | | ✓ (R1,R8–R11,R13) | ✓ | ✓ | ✓ | ✓ | | | | ✓ (R10,R11) | ✓ (R10–R12) | ✓ | ✓ |
| report.merge_branches | | | | | ✓ | ✓ | | | | | | ✓ | ✓ |
| dashboard.sales | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | |
| dashboard.plant | | | | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | |
| dashboard.management | | | | | ✓ | ✓ | | | | | ✓ | ✓ | |
| approval.inbox | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | ✓ | | |

¹ ADMIN = SYS_ADMIN (all branches) and BRANCH_ADMIN (own branch; cannot grant SYS_ADMIN or edit company-level settings).

## 4. Enforcement rules

| # | Rule |
|---|---|
| P-1 | Every route declares `config: { permission: 'oc.confirm' }` (or a list). A Fastify `preHandler` resolves the target branch (path param `brnch`, body `brnch`, or current session branch) and checks `hasPermission(user, brnch, key)`. No permission = 403 problem+json. |
| P-2 | Services re-check sensitive actions (`approve`, `override`, `verify`, `cancel`) because they can be called from jobs/approvals. |
| P-3 | **Maker-checker**: `approve`, `brv.verify`, `customer.approve`, `note.approve` are denied when the actor created the document or the request (`SAME_USER_ALLOWED` = N). |
| P-4 | **Branch scope** (BR-BR): repo functions require `allowedBranches` and add `BRNCH IN (…)`; list endpoints never return other branches; tests assert this for every list endpoint. |
| P-5 | Overrides are two-step: the `*.override` / `*_override` permission lets a user **request** an override with reason; the approval rule decides who approves (BR-APR-04). |
| P-6 | Device tokens (weighbridge agent, gate tablet) carry only `sync.push` + the plant endpoints of their branch; they cannot call other APIs. |
| P-7 | Permission changes and role grants are audited (`AUDIT_LOG` entity `APP_USER_ROLE`, `APP_ROLE_PERMISSION`). |
| P-8 | The UI hides menu items and disables buttons without permission, and shows "You need <permission> to do this" on direct navigation. |
| P-9 | Report data respects branch scope and the report permission; `report.merge_branches` needed to combine branches. |
| P-10 | Field-level: users without `customer.view_balance` do not receive balance fields (API omits them). |

## 5. Migrating legacy permissions

Legacy: `SEC_USERNAME` (users per unit), `SEC_MODULE_S` (screens), `SEC_USERPERM` (I/Q/U/D/P per user × screen).

1. Each active legacy user → `APP_USER` (`LEGACY_UNIT_ID`, `LEGACY_USRID`, `HOME_BRNCH` from unit, `MUST_CHANGE_PWD = 'Y'`).
2. A mapping file `tools/migrate/legacy-module-map.js` maps each legacy module code (e.g. `SD_BRV_NEW`, `SD_OCCONFIRM`, `SD_PERMIT_CITY`, `SD_CRLMT`) to permission keys for I/Q/U/D/P.
3. For each user, compute the set of mapped keys, then suggest the smallest set of roles that covers it; output a review sheet (Excel) per department: user, suggested roles, extra keys not covered.
4. Department heads confirm; admin applies roles. No user gets permissions automatically without this review.
