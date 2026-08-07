# Likida

**Agente de IA por WhatsApp que liquida viajes de autotransporte federal en México.**

El operador manda por WhatsApp fotos de sus comprobantes de viaje (diésel,
casetas, viáticos) → Likida hace OCR, lee el CFDI, **cuadra contra el anticipo
y la política de la empresa**, aplica la ley fiscal mexicana y entrega la
liquidación en PDF con el registro listo para el ERP de la flota.

> **No reemplaza el ERP: lo alimenta.** El agente hace la captura que hoy es
> manual y escribe el sistema que la flota ya usa. Es un complemento.

---

## Estado actual (ver `docs/REPORTE-ESTADO.md`)

- **3,149 pruebas verdes** · `tsc` 0 errores · `eslint` 0 errores · build limpio
- **42 tablas con RLS activo** · 61 bloques de verificación contra la base real
- **En producción**: app.likida.ai · webhook de WhatsApp verificado · cron de
  facturación vía QStash con fallback síncrono · datos demo genéricos

---

## Arquitectura

```
WhatsApp Cloud API → webhook → intake (OCR + CFDI) → cuadre (motor fiscal) → liquidación (PDF) → ERP
```

| Módulo | Ruta | Qué hace |
|---|---|---|
| **Intake** | `src/lib/likida/intake` | Fotografías por WhatsApp → OCR con IA de visión → JSON estructurado + lectura del CFDI |
| **Cuadre** | `src/lib/likida/cuadre` | Concilia gastos vs anticipo + política + ley fiscal → diferencias, faltantes y veredictos de deducibilidad con fundamento |
| **Liquidación** | `src/lib/likida/liquidacion` | PDF (pdf-lib) + export a ERP (CSV/JSON) |
| **Fiscal** | `src/lib/likida/fiscal.ts` y `normas/` | Contadores de la ley: 15% en efectivo (RFA 2.9), viáticos (RLISR 57/152), estímulo de casetas (RMF 9.1.8), IEPS diésel, faja de 50 km |
| **Facturación** | `src/lib/likida/facturacion` | Portales (CAPUFE, gasolineras) con Playwright, cola QStash, autofactura |
| **Agentes** | `src/lib/agents` | Conversación por WhatsApp, prompts, dedup de mutaciones |
| **SaaS** | `src/lib/saas` | Stripe, suscripciones, FacturAPI |
| **Observabilidad** | `src/lib/observability` | Logger redactado, Sentry (si hay DSN), arranque con sondeo de migraciones |

Paneles web: **dashboard** (jefe de flota: resumen, despacho, fiscal, ARCO,
operadores), **admin** (consola de negocio del operador del SaaS: flotas,
cumplimiento, suscripciones), **portal del chofer** (`/chofer`) y **demo**
(simulador de la conversación).

## Stack

| Para qué | Qué |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript estricto |
| Estilos | Tailwind v4 · sistema de diseño en `src/app/globals.css` (paleta: `--marca #c2410c`, tinta `#17100d`) |
| Datos | Supabase (Postgres + RLS + RPCs) — migraciones en `supabase/migrations/` |
| IA | **OpenRouter** — Gemini 3.6 Flash (visión), Sonnet 5 (cuadre), fallback cross-provider |
| Canal | WhatsApp Cloud API (Meta) |
| Comprobantes | zxing-wasm (QR/barras) · sharp · fast-xml-parser |
| Facturación en portales | Playwright + `@sparticuz/chromium` (solo en el cron) |
| Colas | QStash (enqueue + callback con firma) · Postgres para la barrera de intake |
| Salida | pdf-lib · export CSV/JSON a ERP |
| Pruebas | Vitest (offline) + arneses `pruebas-manuales/*.prueba.ts` que sí llaman a los modelos |

## Calidad (las puertas que no se negocian)

```bash
npx tsc --noEmit -p .      # 0 errores
npx eslint src/            # 0 errores
npx vitest run             # ~3,150 pruebas · cobertura con trinquete (vitest.config.ts)
npm run build              # build de producción limpio
```

- **Verificaciones de base**: `supabase/verificaciones.sql` — 61 bloques que
  prueban lo que solo la DB puede demostrar (mutex de doble liquidación,
  aislamiento entre flotas, RLS del chofer, triggers de "nada entra tras
  liquidar"). Cada migración nueva exige un bloque o una exención con razón
  (`src/lib/likida/migraciones_verificadas.test.ts`).
- **Fail-closed**: lo que no se puede verificar se marca "por confirmar" —
  nunca se inventa una cifra, un régimen ni una deducción.
- **Un rótulo tiene que ser verdad**: los datos de demo se marcan como tales;
  los RFC de prueba son ficticios con dígito verificador válido.

## Correr el demo

```bash
npm install
cp .env.example .env.local   # completa las llaves
npm run dev
```

Flujo del demo: el operador manda fotos de comprobantes al número de WhatsApp
de prueba → Likida responde con la liquidación cuadrada, señala diferencias y
devuelve el PDF. También está el simulador en `/demo`.

## Despliegue

- Vercel, alias `app.likida.ai`. El build es **opt-in**: el commit debe llevar
  `[deploy]` en el asunto (`vercel.json` → `ignoreCommand`).
- Cron de facturación: `vercel.json` → `/api/cron/facturar` (necesita
  `CRON_SECRET`), encola a QStash (`UPSTASH_QSTASH_TOKEN`,
  `QSTASH_CURRENT/NEXT_SIGNING_KEY`, `QSTASH_URL`).
- Webhook de WhatsApp: apunta a `app.likida.ai/api/webhook/whatsapp`.

## Documentación

```
docs/
├── REPORTE-ESTADO.md        ← UN reporte del estado actual del software
└── conocimiento/            ← fiscal, legal, industria e investigaciones
    ├── 00-RESUMEN-EJECUTIVO.md      (el marco fiscal en una página)
    ├── 30-dolores-flota.md          (los 9 dolores de una flota)
    ├── 34-proceso-liquidacion.md    (el proceso que Likida automatiza)
    ├── HANDOFF.md                   (arquitectura y estado para agentes)
    ├── investigacion/               (competencia, portales, decisiones)
    ├── fase1/  fiscal/  legal/      (normas, RFA 2.9, borrador ToS)
    └── CONFIGURAR-META.md           (WhatsApp Cloud API, paso a paso)
```
