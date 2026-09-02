# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue —
resolved statuses always carry their resolution date

---

## 2026-08-23

### Observation 1: Fiscal onboarding is a parser with a chat skin, not an LLM that declares

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** First-open ChatGPT-style setup for a fleet owner that must capture fiscal facts without inventing them
**Skill:** New skill candidate: fail-closed conversational onboarding
**Type:** internal
**Phase/Area:** product onboarding / tax configuration

**Issue:** A 40-question form is the documented failure mode (people skip it or lie for convenience). A free-form LLM that writes tax eligibility is the opposite failure mode: it invents a yes/no that later credits a stimulus the SAT can deny. The working pattern is a catalog of questions with legal basis, a deterministic parser that treats "I don't know" as absent (never as no), and an LLM that may only explain citations from that catalog.

**Suggested improvement:** If this pattern repeats in other products, capture it as a small skill: catalog → parser → persist only `declarado` → LLM explainer with no write path.

**Principle:** Conversational UI does not authorize the model to invent configuration. The model talks; typed parsers write; unanswered stays absent.

### Observation 2: A lookalike of a reference screen is not a clone

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** Onboarding chat was restyled to resemble ChatFlota; the user rejected it and asked to clone that code for data intake
**Skill:** New skill candidate: fail-closed conversational onboarding
**Type:** open-source
**Phase/Area:** UI cloning / reference screens

**Issue:** Matching palette, logo animation, and thinking phases was not enough. The reference had a specific composer (Consulta + paperclip + ArrowUp), attach menu, Consulta catalog, completed replies without an icon, and a single subtitle. The lookalike used Sustento, extra question copy, and a logo on finished bubbles. The user had to say "clone it, use that code."

**Suggested improvement:** When a user names a screen as the reference, copy that component's markup and interaction (caja, buttons, empty vs conversation layout) and only swap the data/API. Do not restyle a cousin and call it the same.

**Principle:** A reference UI is a source file, not a mood board. Clone the structure; keep the endpoint.

### Observation 3: A SAT catalog clave must move in three places at once

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** Closing régimen 624 (Coordinados) so RFA 2.9 is not PF-only
**Skill:** New skill candidate: fail-closed conversational onboarding
**Type:** open-source
**Phase/Area:** tax catalogs / database CHECK

**Issue:** 624 was parsed in the interview and listed as eligible for the 15% rule, but REGIMENES, the tenant CHECK constraint, the admin form copy, and the billing write path all disagreed. The UI said "billing does not admit it yet"; the alta form said "ask Javier"; crearFlota already treated 624 as eligible. A coordinator fleet could declare in chat and still not exist as a receptor.

**Suggested improvement:** When adding a catalog clave, update the TypeScript catalog, the SQL CHECK, the form copy, and the write path in the same change. A test that asserts REGIMENES === CHECK keys catches drift.

**Principle:** A legal clave that the parser accepts but the CHECK rejects is a silent product lie: the user declared it, the database cannot store it.

### Observation 4: Exhaustive audit on a dirty tree still runs — it just cannot autofix

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** User asked to launch an exhaustive audit after finishing the onboarding/624 work
**Skill:** auditoria-diaria
**Type:** open-source
**Phase/Area:** Phase 0 / dirty-tree rule

**Issue:** The daily-audit skill forbids autofix when git status is dirty, and that rule held. The remaining risk is treating "cannot fix" as "should not run": the 12 auditors still found verified críticos in the uncommitted onboarding path. Running the round produced the signal; skipping it would have shipped the RFC-from-pump-ticket hole unmeasured.

**Suggested improvement:** Keep autofix-off on dirty trees. Make the default when the user says "audit when you finish" to still run the 12, and to label findings in the new uncommitted files as "código de esta sesión" so they are not mistaken for production regressions.

**Principle:** A dirty working tree disables commits, not observation. Measure first; repair when the tree can take an atomic commit.

### Observation 5: db push --include-all is not how you apply one numbered migration to a timestamp-history project

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** User pasted supabase login, link, and db push --include-all to get régimen 624 (0172) onto production
**Skill:** New skill candidate: supabase numbered-vs-timestamp migration apply
**Type:** internal
**Phase/Area:** production schema apply / CLI vs MCP

**Issue:** The repo names files `0001`–`0172`. Production `schema_migrations` stores timestamp versions (`20260725…`). `db push --include-all` (even `--dry-run`) aborts with "Remote migration versions not found in local migrations directory" and suggests `migration repair --status reverted` of every remote version plus `db pull`. Following that on prod would mark the live history as reverted or re-apply 168 inits. The CHECK for 624 was already live; the gap was only the history row. MCP `apply_migration` with the same idempotent DROP/ADD CHECK registered `regimen_624_coordinados` without touching the rest.

**Suggested improvement:** Before any linked `db push` against this project: dry-run; if remote versions are timestamps, do not push and do not repair. Apply the one pending file via MCP `apply_migration` (idempotent SQL) or `db query --linked -f`. Never run `migration repair --status reverted` on the full remote list.

**Principle:** When local migration filenames and remote history versions use different schemes, `db push --include-all` is a history-repair trap, not a deploy. Apply the missing DDL by name; do not reconcile the two clocks in production.

### Observation 6: A "view as owner" link without the role query skips owner-only gates

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** Superadmin saw the admin console and expected the first-open onboarding chat
**Skill:** New skill candidate: fail-closed conversational onboarding
**Type:** open-source
**Phase/Area:** impersonation / first-open gates

**Issue:** The dashboard redirects to onboarding only when the effective role is the fleet owner. The demo preview already passed `?rol=flota_admin`. Live "Panel de dueño" links passed only `?tenant=`, so a superadmin kept their real role, skipped the gate, and landed on the control plane. The user read that as "it was never deployed."

**Suggested improvement:** Any "view as <role>" control must include the same query the page uses to decide gates. Add a source test that the owner href carries the owner role.

**Principle:** Impersonation that does not change the effective role is not a preview. Gates keyed on role will treat the operator as themselves.
