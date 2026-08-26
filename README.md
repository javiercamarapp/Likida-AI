<p align="center">
  <img src="public/images/logo.png" alt="Likida" width="280" />
</p>

<h3 align="center">El back-office del transporte, automatizado con agentes de IA.</h3>

<p align="center">
  <a href="https://likida.ai">likida.ai</a> ·
  <a href="https://app.likida.ai">app.likida.ai</a>
</p>

---

> **Liquidar era un día. Ahora es un mensaje.**

El operador manda por WhatsApp la foto de su comprobante — diésel, casetas,
viáticos. Likida lo lee, valida el CFDI contra el SAT, lo cuadra contra el
anticipo y la política de la empresa, avisa lo que falta y entrega la
liquidación en PDF y en el ERP de la flota. Sin instalar nada en la cabina.

Cada ticket. Cada viaje. Cada litro. Cada faltante. **Cuadrado.**

---

## El problema

El back-office del autotransporte de carga en México todavía corre en papel,
portales y Excel. Cerrar un viaje significa que el operador junte tickets en
la guantera, que alguien en oficina los capture a mano, que el contralor
persiga lo que falta y que el contador descubra semanas después qué era
deducible y qué no. El combustible es el gasto mayor de una flota y el
comprobante que lo ampara es el que más trabajo cuesta convertir en dato
timbrado. Todo ese trabajo es captura — y la captura no debería existir.

## La tesis del producto

Tres decisiones definen a Likida y están documentadas en el corpus de
investigación de este repo (`docs/conocimiento/`):

1. **La foto no es el comprobante; el CFDI sí.** El modelo de datos separa
   `comprobante_recibido` (la foto: control operativo, hora, odómetro) de
   `cfdi_validado` (el XML verificado contra el SAT). Ningún veredicto de
   dinero se dicta sobre una foto.
2. **Un comprobante no tiene un veredicto: tiene varios.** El mismo ticket
   puede ser deducible para un impuesto y no para otro. El motor emite
   veredictos separados, cada uno con su fundamento legal citado.
3. **El motor es determinista.** El LLM solo extrae y redacta; toda la
   lógica de dinero, deducibilidad y aprobación vive en código auditable con
   pruebas. Lo que no se puede verificar se marca "por confirmar" —
   **nunca se inventa una cifra**, ni un régimen, ni una deducción. El
   comprador es un contralor: va a cruzar lo que ve contra su PDF y su
   contador, y el producto está diseñado para ganar esa comparación.

## Por qué ahora

- El SAT ya digitalizó el insumo: CFDI 4.0 y Carta Porte hacen que el dato
  timbrado exista para cada gasto y cada viaje. Falta quien lo cuadre.
- WhatsApp es el canal que el operador ya usa. Cero capacitación, cero app
  nueva, cero hardware.
- Los modelos de visión actuales leen un ticket térmico arrugado con sol
  encima — la barrera que mataba la captura automática ya cayó.

## Arquitectura

```
WhatsApp Cloud API → webhook → intake (OCR + CFDI) → cuadre (motor fiscal determinista) → liquidación (PDF) → ERP
```

| Módulo | Ruta | Qué hace |
|---|---|---|
| **Intake** | `src/lib/likida/intake` | Fotos por WhatsApp → visión → JSON estructurado + lectura y validación del CFDI |
| **Cuadre** | `src/lib/likida/cuadre` | Concilia gastos vs anticipo + política + norma → diferencias, faltantes y veredictos con fundamento |
| **Fiscal** | `src/lib/likida/fiscal.ts` + `normas/` | Los contadores de la ley, cada uno con su cita y su prueba |
| **Liquidación** | `src/lib/likida/liquidacion` | PDF (pdf-lib) + export a ERP (CSV/JSON) |
| **Facturación** | `src/lib/likida/facturacion` | Portales de autofactura con Playwright, cola QStash |
| **Agentes** | `src/lib/agents` | Conversación por WhatsApp, prompts, dedup de mutaciones |
| **SaaS** | `src/lib/saas` | Stripe, suscripciones, FacturAPI |
| **Observabilidad** | `src/lib/observability` | Logger redactado, Sentry, arranque que grita la config ausente |

Paneles: **`/dashboard`** (la flota: resumen, despacho, fiscal, operadores,
ARCO), **`/admin`** (consola de negocio del operador del SaaS) y **`/demo`**
(simulador de la conversación). El operador en carretera no tiene panel
propio — todo su flujo es por WhatsApp (`/api/webhook/whatsapp`).

> **No reemplaza el ERP: lo alimenta.** Likida hace la captura que hoy es
> manual y escribe en el sistema que la flota ya usa.

## Stack

| Para qué | Qué |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript estricto |
| Datos | Supabase (Postgres + RLS + RPCs) — migraciones en `supabase/migrations/` |
| IA | OpenRouter — visión para OCR, modelos de razonamiento para el cuadre, fallback cross-provider |
| Canal | WhatsApp Cloud API (Meta) |
| Comprobantes | zxing-wasm (QR/barras) · sharp · fast-xml-parser |
| Portales | Playwright + `@sparticuz/chromium` (solo en el cron) |
| Colas | QStash (enqueue + callback firmado) · Postgres para la barrera de intake |
| Salida | pdf-lib · export CSV/JSON |
| Pruebas | Vitest (offline) + arneses `pruebas-manuales/*.prueba.ts` que sí llaman a los modelos |

## Las reglas que no se negocian

- **Nunca inventar una cifra.** Si no hay dato real, la pantalla dice qué
  falta y por qué. Una estimación se muestra declarada, con su supuesto a la
  vista.
- **Un rótulo tiene que ser verdad.** Si dice "del periodo", la consulta
  filtra por fecha. Los datos de demo se marcan como demo; los RFC de prueba
  son ficticios con dígito verificador válido.
- **Fallar cerrado y decirlo.** Una base caída jamás se lee como "no hay
  liquidaciones". Una variable de entorno ausente se grita en el arranque,
  no se descubre en la demo.
- **El formato de cifras vive en un solo lugar** (`lib/formato.ts`) — hay
  una prueba que falla si aparece en otro. Una cifra fiscal que se lee
  distinto en dos pantallas se lee como dos cálculos.

## Correr en local

```bash
npm install
cp .env.example .env.local   # completa las llaves — el archivo documenta cada una
npm run dev
```

Puertas de calidad, en orden:

```bash
npx tsc --noEmit -p .   # 0 errores
npx eslint src/         # 0 errores
npx vitest run          # todas en verde
npm run build           # build limpio
```

El flujo de demo: fotos de comprobantes al número de WhatsApp de prueba →
Likida responde con la liquidación cuadrada, señala diferencias y devuelve el
PDF. Sin número, el simulador vive en `/demo`.

## Despliegue

- Vercel, alias `app.likida.ai`. El build es **opt-in**: el commit debe
  llevar `[deploy]` en la primera línea del mensaje (`vercel.json` →
  `ignoreCommand`). Un push sin bandera sube código y no publica nada.
- Webhook de WhatsApp → `app.likida.ai/api/webhook/whatsapp`.
- Crons en `vercel.json`; el de facturación necesita `CRON_SECRET` y encola
  a QStash.

## Documentación

```
docs/
└── conocimiento/                    ← el corpus: fiscal, legal, industria, competencia
    ├── 00-RESUMEN-EJECUTIVO.md      (el marco fiscal en una página)
    ├── 30-dolores-flota.md          (el mapa completo de dolores de una flota)
    ├── 34-proceso-liquidacion.md    (el proceso que Likida automatiza)
    ├── fase1/  fiscal/  legal/      (normas y fundamentos, con fuente primaria)
    └── CONFIGURAR-META.md           (WhatsApp Cloud API, paso a paso)
```

El corpus cita fuente primaria (DOF, SAT, leyes federales y estatales) o
marca la afirmación como pista sin fundamento. La misma regla que el
producto: cifra con fuente, o decir qué falta.

---

<p align="center">
  <sub>Hecho en México, para las flotas de carga de México. · <a href="https://likida.ai">likida.ai</a></sub>
</p>
