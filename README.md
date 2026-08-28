<p align="center">
  <img src="public/images/logo.png" alt="Likida" width="280" />
</p>

<h3 align="center">The AI back office for Mexican trucking — closing every trip's paperwork by itself.</h3>

<p align="center">
  <a href="https://likida.ai">likida.ai</a> ·
  <a href="https://app.likida.ai">app.likida.ai</a>
</p>

---

> **Closing a trip used to take a day of paperwork. Now it takes one WhatsApp message.**

The driver photographs a receipt — diesel, tolls, per diem — and sends it to
a WhatsApp number. Likida reads it, validates the CFDI (Mexico's mandatory
e-invoice) against the tax authority, reconciles it against the advance and
the company's expense policy, flags what's missing, and returns a closed
settlement as a PDF and a line in the fleet's ERP. No app to install in the
cab, no training, no hardware.

Every ticket. Every trip. Every liter. Every discrepancy. **Reconciled.**

---

## The problem

Mexican freight trucking runs its back office on paper, government portals,
and Excel. Closing a single trip means a driver stuffing receipts in the
glovebox, someone in the office keying them in by hand, a controller chasing
what's missing, and an accountant discovering weeks later what was tax
deductible. Fuel is a fleet's single largest cost, and the receipt that
proves it is the most expensive document in the company to turn into
verified data. All of that work is data entry — and data entry shouldn't
exist.

## Market

Built bottom-up from Mexico's official federal transport statistics (SICT's
Estadística Básica del Autotransporte Federal), not a trade-press headline —
and cross-validated two independent ways within 2% of each other.

| | Companies | MXN/year | USD/year |
|---|---:|---:|---:|
| **TAM** — federal cargo carriers (public + private) plus passenger, tourism, transfer, tow, and parcel, >5 vehicles | 55,506 | $3,369.8M | ~$182.2M |
| **SAM** — the slice reachable today: public + private cargo and parcel, medium/large fleets (>30 vehicles), on WhatsApp, inside our known channels (census + CANACAR/ANTP) | 6,743 | $1,392.9M | ~$75.3M |
| **SOM, Year 1 / 3 / 5** | 6 → 63 → 218 clients | $1.09M → $12.83M → $59.43M | ~$59K → ~$694K → ~$3.21M |

Two things about this number that matter more than the number itself:

- **The TAM and SAM grew 4.3× and 3.5× over an earlier internal estimate —
  because the earlier one undercounted the universe by ~2.7× and left out six
  whole segments, not because the market grew.** We caught our own error and
  rebuilt the funnel filter by filter, each one named, sourced, and defensible
  on its own (informality rate from three independent press citations of
  SICT/IMCP data; fleet-size cutoffs from SICT's own published brackets;
  WhatsApp penetration from Sinch/DataReportal). We also explicitly did
  **not** size two adjacent segments (field-service fleets, and
  no-fleet expense management) because the data to back a number honestly
  doesn't exist yet — sizing them anyway would inflate the total with a
  market we have no edge in.
- **The Year-1 SOM is intentionally small, and doesn't move with the TAM/SAM
  correction.** It's gated by one concrete, named blocker: WhatsApp Business
  is still running on Meta's test number, not a production one — no driver
  can message the bot in the wild until that clears. SOM tracks selling
  capacity (one founder, no reps yet, WhatsApp not yet productive), not
  market size. Year 3 and 5 assume WhatsApp goes live and 3 then 9 hires
  accumulate in sales and customer success.

### We didn't just estimate demand — we read it

Instead of a market-size guess, we ran a census of live Mexican job postings
(Indeed, Computrabajo, LinkedIn, OCC): over 5,000 full descriptions
downloaded and read one by one, screenshotted, and classified.

- **828 companies** have a hiring post that names, in its own words, exactly
  the manual work this product eliminates — reconciling trip expenses
  against an advance by hand.
- **63 active postings** put it directly in the job title
  ("liquidador de viajes," "auxiliar de liquidaciones").
- The role being hired for carries a **median salary of $11,129–$14,500
  MXN/month** (31 of those postings publish pay) — that's the recurring
  headcount cost per fleet that a WhatsApp number replaces.
- The postings span the three buyer profiles the product is built for:
  **dedicated carriers** (transportistas), **shippers running a private
  fleet** with their own in-house logistics staff, and **3PL operators**
  managing fleets on someone else's behalf.

This is primary research, not a citation — the row-level data, screenshots,
and methodology are kept on file and reconciled against the CRM.

## Why now

- **The tax authority already digitized the input.** CFDI 4.0 and Carta
  Porte (the mandatory bill-of-lading e-invoice) mean verified, government-
  stamped data now exists for every expense and every trip. What's missing
  is someone to reconcile it — that's the wedge.
- **The channel is already in the driver's pocket.** WhatsApp is where
  Mexican truckers already are. Zero training, zero new app, zero hardware.
- **Vision models cleared the bar.** Current-generation vision models read a
  crumpled thermal receipt with sun glare on it. That was the barrier that
  killed automated capture five years ago — it's gone.

## Product thesis

Three decisions define the product, and they're the reason a controller can
trust an AI-generated settlement enough to sign it:

1. **The photo is not the source of truth; the CFDI is.** The data model
   keeps `comprobante_recibido` (the photo — operational control, timestamp,
   odometer) strictly separate from `cfdi_validado` (the XML verified
   against the tax authority). No money decision is ever made on a photo
   alone.
2. **A receipt doesn't get one verdict — it gets several.** The same ticket
   can be deductible for one tax and not another. The engine emits separate
   verdicts, each one citing the specific legal basis behind it.
3. **The engine is deterministic.** The LLM only extracts and drafts
   language; every dollar decision, every deductibility call, every approval
   gate lives in auditable, tested code. What can't be verified is marked
   "needs confirmation" — **the product never fabricates a number**, a tax
   regime, or a deduction. The buyer is a fleet controller who will hold the
   output up against their own paper trail and their accountant. The product
   is built to win that comparison, not to look good in a demo.

## What's actually running today

This isn't a wrapper around a single LLM call. It's a deterministic financial
engine surrounded by a company of specialized autonomous agents, each with
its own budget, kill switch, and audit trail.

- **60 autonomous agents live in production**, dispatched by an internal
  scheduler with per-agent cost ceilings, individual on/off switches, and a
  hard clock so a slow agent can never take the whole fleet down silently.
  They span eight departments: **Product** (settlement, invoicing,
  collections, tolls, drivers), **Back Office** (quality, documentation,
  legal/compliance, talent), **Customer Success** (support, onboarding,
  retention, billing), **Finance** (metrics, cost control, treasury,
  monthly close), **Direction** (KPIs, weekly orchestration, self-
  improvement, incident response, fundraising reporting), **Leads**
  (enrichment, SDR, outreach, scoring, dossiers, proposals), **Growth**
  (content, SEO, video, partnerships), and **Engineering** (migration
  drift, security posture, performance, release tracking — the platform
  auditing itself).
- **~225 versioned, tested database migrations**, every one enforcing
  tenant isolation at the row level so one fleet's data is architecturally
  incapable of leaking into another's.
- **8,500+ automated tests, zero mocked reality on the money path.** Every
  merge runs against an ephemeral, RLS-enforced Postgres instance before it
  ships — not just unit tests against a mock.
- **A closed-loop audit discipline.** Independent adversarial review passes
  run continuously against the codebase and the database schema, each
  finding reproduced with a concrete failure scenario before it's accepted,
  each fix shipped with the regression test that would have caught it. The
  engineering process treats "the test suite is green" as a starting
  hypothesis to attack, not a finished state.
- **37 invoicing portals mapped and field-verified against the live pages**
  (not against three-week-old documentation) — merchant by merchant, form
  field by form field, CAPTCHA by CAPTCHA. Five are fully automated
  end-to-end today on a declarative adapter engine built so that adding the
  next one is a data table, not new code.

## Where the company is, honestly

**Pre-revenue.** The product is running in production against a real
fleet's real data — not a demo environment — but there is no paying customer
yet. That's the stage. Everything above is what exists to sell into the
first cohort, and the architecture (multi-tenant from migration one, cost
governance on every autonomous action, a fiscal engine that refuses to
guess) is built for the scale after that, not just the pilot.

## Architecture

```
WhatsApp Cloud API → webhook → intake (vision OCR + CFDI validation) → reconciliation engine (deterministic) → settlement (PDF) → fleet's ERP
                                                                      ↘ the 60-agent company (finance, growth, leads, support, engineering…) ↗
```

| Module | Path | What it does |
|---|---|---|
| **Intake** | `src/lib/likida/intake` | WhatsApp photos → vision model → structured JSON + CFDI parsing and government validation |
| **Reconciliation** | `src/lib/likida/cuadre` | Reconciles expenses vs. advance + policy + tax rule → discrepancies, missing items, cited verdicts |
| **Fiscal** | `src/lib/likida/fiscal.ts` + `normas/` | The tax rule engine — every counter cites its legal source and carries a test |
| **Settlement** | `src/lib/likida/liquidacion` | PDF generation + ERP export (CSV/JSON) |
| **Invoicing** | `src/lib/likida/facturacion` | Declarative portal automation (Playwright), queued via QStash |
| **Agent company** | `src/lib/likida/agentes` | The 60-agent runner, budgets, kill switches, dispatch |
| **Conversational agents** | `src/lib/agents` | WhatsApp conversation, prompts, mutation dedup |
| **SaaS** | `src/lib/saas` | Stripe, subscriptions, invoicing for Likida itself |
| **Observability** | `src/lib/observability` | Redacted logging, Sentry, fail-loud startup config checks |

Dashboards: **`/dashboard`** (the fleet: summary, dispatch, fiscal,
drivers, data-rights requests), **`/admin`** (Likida's own business
console — cross-tenant, superadmin only), **`/chofer`** (the driver's
portal), and **`/demo`** (a live conversation simulator).

> **Likida doesn't replace the fleet's ERP — it feeds it.** It automates the
> capture step that's manual today and writes into the system the fleet
> already runs.

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
  test fails the build if it shows up anywhere else. A fiscal figure that
  renders differently on two screens is, functionally, two different
  calculations.

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

Demo flow: send receipt photos to the test WhatsApp number and Likida
replies with the reconciled settlement, flags discrepancies, and returns the
PDF. Without a number, the simulator lives at `/demo`.

## Deployment

- Vercel, aliased to `app.likida.ai`. Builds are **opt-in**: the commit
  subject must carry `[deploy]` (enforced via `vercel.json`'s
  `ignoreCommand`) — a plain push ships code without publishing it, so
  production never rebuilds on every merge.
- WhatsApp webhook → `app.likida.ai/api/webhook/whatsapp`.
- Scheduled jobs in `vercel.json`; the invoicing cron requires
  `CRON_SECRET` and queues through QStash.

## Documentation

```
docs/
└── conocimiento/                    ← the research corpus: fiscal law, legal, industry, competitive landscape
    ├── 00-RESUMEN-EJECUTIVO.md      (the fiscal framework, one page)
    ├── 30-dolores-flota.md          (the full map of a fleet's operational pain)
    ├── 34-proceso-liquidacion.md    (the process Likida automates)
    ├── fase1/  fiscal/  legal/      (tax rules and legal basis, primary source cited)
    └── CONFIGURAR-META.md           (WhatsApp Cloud API, step by step)
```

The corpus cites primary sources (Mexico's Federal Register, tax authority
guidance, federal and state law) or flags the claim as unverified. Same rule
as the product: a number with a source, or a stated gap.

---

<p align="center">
  <sub>Built in Mexico, for Mexico's trucking fleets. · <a href="https://likida.ai">likida.ai</a></sub>
</p>
