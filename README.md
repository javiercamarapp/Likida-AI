# Cuadra

**Agente de IA por WhatsApp que automatiza el cierre diario de operaciones logísticas en México.**

El operador manda por WhatsApp fotos de sus comprobantes de viaje (diésel, casetas, facturas) →
Cuadra hace OCR → los cuadra contra el anticipo y la política de la empresa → detecta diferencias y
faltantes **en el momento** → entrega una liquidación en PDF y un registro listo para ERP.

> Validado con 2,474 vacantes reales: ~350 empresas con este dolor exacto, de transportistas
> medianos a Nadro, Danone, Lala y GEPP. Primer demo: **Cliente demo, 6 de agosto**.

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
Next.js · Supabase · @anthropic-ai/sdk (Claude) · pdf-lib · facturapi (CFDI/Carta Porte) ·
Upstash (colas) · Sentry · Tailwind + Radix.

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
