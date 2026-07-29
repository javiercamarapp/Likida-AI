# Cuadra

**Agente de IA por WhatsApp que automatiza el cierre diario de operaciones logísticas en México.**

El operador manda por WhatsApp fotos de sus comprobantes de viaje (diésel, casetas, facturas) →
Cuadra hace OCR → los cuadra contra el anticipo y la política de la empresa → detecta diferencias y
faltantes **en el momento** → entrega una liquidación en PDF y un registro listo para ERP.

> Validado con 2,474 vacantes reales: ~350 empresas con este dolor exacto, de transportistas
> medianos a Nadro, Danone, Lala y GEPP. Primer demo: **Transportes Innovativos, 6 de agosto**.

## Arquitectura

Chasis prestado de `atiende.ai` (WhatsApp Cloud API, capa LLM, colas, observabilidad) + 3 módulos nuevos:

| Módulo | Ruta | Qué hace |
|--------|------|----------|
| **1. Intake** | `src/lib/cuadra/intake` | Recibe fotos por WhatsApp → OCR con Claude visión → JSON estructurado |
| **2. Cuadre** | `src/lib/cuadra/cuadre` | Concilia gastos vs anticipo + política → detecta diferencias/faltantes |
| **3. Liquidación** | `src/lib/cuadra/liquidacion` | Genera PDF (pdf-lib) + export a ERP (CSV/JSON) |

Superficies web (estilo macOS premium, ver `DESIGN.md`): **dashboard** (liquidaciones por operador/terminal),
**admin** (política de gastos, flota, usuarios), **portal del cliente** (la flota ve lo suyo) y una **pantalla de demo**.

## Stack

Lo que el código usa de verdad, verificable con `grep -rl <paquete> src/`:

| Para qué | Qué |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript estricto |
| Estilos | Tailwind v4 |
| Datos | Supabase (Postgres + RLS + RPCs) |
| IA | **OpenRouter** — Gemini 3.6 Flash para visión, Sonnet 5 para el cuadre, con fallback cross-provider |
| Canal | WhatsApp Cloud API (Meta) |
| Comprobantes | zxing-wasm (QR y código de barras) · sharp · fast-xml-parser |
| Salida | pdf-lib · export CSV/JSON a ERP |
| Pruebas | Vitest (offline) + arneses `*.prueba.ts` que sí llaman a los modelos |

Se **quitaron** de `package.json` cinco dependencias con cero uso en el código:
`@anthropic-ai/sdk` (se habla con OpenRouter, no con Anthropic directo),
`facturapi`, `@upstash/redis`, `@upstash/qstash` y `axios`. Radix nunca estuvo.

`@sentry/nextjs` **ya está en uso** (`src/lib/observability/sentry.ts`, import
dinámico): el logger replica ahí los `warn` y `error` ya redactados, y
`onRequestError` manda las excepciones con stack. Se enciende solo si hay
`SENTRY_DSN`; sin esa variable no hay alerta de nada y el arranque lo grita
(`startup.observabilidad`).

Siguen declaradas y **sin usar**: `class-variance-authority`, `date-fns` y
`lucide-react`.

> Hasta la auditoría 5 este párrafo decía que `@sentry/nextjs` estaba «sin usar
> todavía (a cablear: hoy no hay observabilidad de errores en producción)». La
> conclusión era cierta y el motivo falso: el cable existía desde antes, lo que
> faltaba era el DSN en Vercel. Un documento que acierta por accidente es el que
> deja de leerse.

> Esta sección describía un stack que no existe, y no salió gratis: una revisión
> externa calificó cuatro tecnologías que el proyecto no usa —leyó el README, no
> el código— y hubo que gastar tiempo en desmentirla. Las colas están hechas con
> Postgres (`intake_delta`, mig. 0011) y el timbrado se va a construir aquí, no
> con Facturapi.
>
> Para comprobar cualquiera de estas afirmaciones hay que usar `command grep`, no
> `grep`: en esta máquina `grep` es una función de shell que envuelve `ugrep -I`
> y **salta los archivos que parezcan binarios en silencio**, devolviendo "no
> encontrado" sobre archivos que sí contienen el patrón.

## Correr el demo
```bash
npm install
cp .env.example .env.local   # completa las llaves
npm run dev
```
El flujo del demo: manda 3–4 fotos de comprobantes al número de WhatsApp de prueba →
Cuadra responde con la liquidación cuadrada, señala diferencias, y devuelve el PDF.

## Estado
Sprint 0 — MVP para el demo del 6 de agosto. Ruta crítica (WhatsApp→OCR→cuadre→PDF) primero;
dashboard/admin/portales encima.
