<p align="center">
  <img src="public/images/logo.png" alt="Likida" width="280" />
</p>

<h3 align="center">The AI back office for Mexican trucking — closing every trip's paperwork by itself.</h3>

<p align="center">
  <a href="https://likida.ai">likida.ai</a> ·
  <a href="https://app.likida.ai">app.likida.ai</a>
</p>

---

## What it does

The driver photographs a receipt — diesel, tolls, per diem — and sends it to
a WhatsApp number. Likida reads it, validates the CFDI (Mexico's mandatory
e-invoice) against the tax authority, reconciles it against the advance and
the company's expense policy, flags what's missing, and returns a closed
settlement as a PDF and a line in the fleet's ERP. No app to install in the
cab, no training, no hardware.

## Product principles

1. **The photo is not the source of truth; the CFDI is.** The data model
   keeps `comprobante_recibido` (the photo — operational control, timestamp,
   odometer) strictly separate from `cfdi_validado` (the XML verified
   against the tax authority). No money decision is ever made on a photo
   alone.
2. **A receipt doesn't get one verdict — it gets several.** The same ticket
   can be deductible for one tax and not another. The engine emits separate
   verdicts, each one citing the specific legal basis behind it.
3. **The engine is deterministic.** The LLM only extracts and drafts
   language; every money decision, every deductibility call, every approval
   gate lives in auditable, tested code. What can't be verified is marked
   "needs confirmation" — the product never fabricates a number, a tax
   regime, or a deduction.

## Architecture

```
WhatsApp Cloud API → webhook → intake (vision OCR + CFDI validation) → reconciliation engine (deterministic) → settlement (PDF) → fleet's ERP
                                                                      ↘ specialized agents (finance, growth, leads, support, engineering…) ↗
```

| Module | Path | What it does |
|---|---|---|
| **Intake** | `src/lib/likida/intake` | WhatsApp photos → vision model → structured JSON + CFDI parsing and government validation |
| **Reconciliation** | `src/lib/likida/cuadre` | Reconciles expenses vs. advance + policy + tax rule → discrepancies, missing items, cited verdicts |
| **Fiscal** | `src/lib/likida/fiscal.ts` + `normas/` | The tax rule engine — every counter cites its legal source and carries a test |
| **Settlement** | `src/lib/likida/liquidacion` | PDF generation + ERP export (CSV/JSON) |
| **Invoicing** | `src/lib/likida/facturacion` | Declarative portal automation (Playwright), queued via QStash |
| **Agents** | `src/lib/likida/agentes` | The agent runner: budgets, kill switches, dispatch |
| **Conversational agents** | `src/lib/agents` | WhatsApp conversation, prompts, mutation dedup |
| **SaaS** | `src/lib/saas` | Stripe, subscriptions, invoicing for Likida itself |
| **Observability** | `src/lib/observability` | Redacted logging, Sentry, fail-loud startup config checks |

Dashboards: **`/dashboard`** (the fleet), **`/admin`** (Likida's internal
console — cross-tenant, superadmin only), **`/chofer`** (the driver's portal)
and **`/demo`** (a live conversation simulator).

> Likida doesn't replace the fleet's ERP — it feeds it.

## Stack

| For | What |
|---|---|
| App | Next.js 16 (App Router) · React 19 · strict TypeScript |
| Data | Supabase (Postgres + row-level security + RPCs) — every schema change is a reviewed, tested migration |
| AI | OpenRouter — vision models for OCR, reasoning models for reconciliation, cross-provider fallback |
| Channel | WhatsApp Cloud API (Meta) |
| Documents | zxing-wasm (QR/barcode) · sharp · fast-xml-parser (CFDI) |
| Portal automation | Playwright + `@sparticuz/chromium` (cron-only) |
| Queues | QStash (signed enqueue + callback) · Postgres for the intake barrier |
| Output | pdf-lib · CSV/JSON export |
| Testing | Vitest (offline) + real-model harnesses in `pruebas-manuales/*.prueba.ts` |
| Hosting | Vercel |

## Rules the code doesn't bend on

- **Never fabricate a number.** If real data doesn't exist, the screen says
  what's missing and why. An estimate is shown declared, with its
  assumption visible next to it.
- **A label has to be true.** If it says "this period," the query filters by
  date. Demo data is marked as demo; test RFCs (Mexican tax IDs) are
  fictitious but pass the real checksum.
- **Fail closed, and say so.** A database outage is never read as "no
  settlements yet." A missing environment variable is screamed at startup,
  not discovered live in front of a customer.
- **Number formatting lives in exactly one place** (`lib/formato.ts`) — a
  test fails the build if it shows up anywhere else.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the keys — the file documents each one
npm run dev
```

Quality gates, in order:

```bash
npx tsc --noEmit -p .   # 0 errors
npx eslint src/         # 0 errors
npx vitest run          # everything green
npm run build           # clean build
```

Without a WhatsApp number, the conversation simulator lives at `/demo`.
Synthetic demo data for local databases: `scripts/demo/cinco-agentes/`.

## Deployment

- Vercel, aliased to `app.likida.ai`. Builds are **opt-in**: the commit
  subject must carry `[deploy]` (enforced via `vercel.json`'s
  `ignoreCommand`) — a plain push ships code without publishing it.
- WhatsApp webhook → `app.likida.ai/api/webhook/whatsapp`.
- Scheduled jobs in `vercel.json`; the invoicing cron requires
  `CRON_SECRET` and queues through QStash.
- Runbooks: `docs/conocimiento/DEPLOY.md`, `docs/operacion/`.

## Documentation

- `docs/conocimiento/DEPLOY.md` — production runbook.
- `docs/conocimiento/CONFIGURAR-META.md` — WhatsApp Cloud API, step by step.
- `docs/operacion/` — runbooks of the agents, portals and operations.
- `docs/legal/` — legal templates (DPA, SLA, security annex, retention).
- `CLAUDE.md`, `CONTEXT.md`, `DESIGN.md` — engineering rules, glossary and design system.

---

<p align="center">
  <sub>Built in Mexico, for Mexico's trucking fleets. · <a href="https://likida.ai">likida.ai</a></sub>
</p>
