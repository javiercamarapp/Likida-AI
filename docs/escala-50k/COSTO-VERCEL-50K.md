# RES-24 — Qué le cuesta a Vercel 50,000 viajes/mes

**22-ago-2026.** La auditoría de resiliencia dejó RES-24 como "medir GB-h" sin
una sola cifra. Esta nota es esa cuenta, hecha con las cadencias que hoy tiene
`vercel.json` (todas cambiaron en esta ronda: ESC-1 y ESC-5) y con las
constantes reales del código. **No es una factura: es el orden de magnitud y,
sobre todo, la lista de qué hay que medir para dejar de estimar.**

Regla de la casa aplicada aquí: cada número dice si está **MEDIDO** (sale del
repo, se puede verificar abriendo el archivo) o **SUPUESTO** (una hipótesis
declarada, con cómo comprobarla). Un supuesto pintado como medición es
exactamente lo que esta nota existe para no hacer.

---

## 1. Lo MEDIDO — las cadencias y los topes que hoy están puestos

| Ruta | Cadencia (`vercel.json`) | `maxDuration` | Invocaciones / 30 días |
|---|---|---|---|
| `/api/cron/wa-pendientes` | `* * * * *` (cada minuto) | 120 s | **43,200** |
| `/api/cron/wa-outbox` | `* * * * *` (cada minuto) | 300 s | **43,200** |
| `/api/cron/facturar` | `*/15 * * * *` | 300 s | **2,880** |
| `/api/cron/gps` | `*/5 * * * *` | 300 s | **8,640** |
| `/api/cron/asistencia` | `*/5 * * * *` | 120 s | **8,640** |
| `/api/cron/escalar` | `0 * * * *` | 120 s | **720** |
| `/api/cron/runner` | `0 */4 * * *` | 120 s | **180** |
| `/api/cron/purgar` | `15 4 * * *` | 120 s | **30** |
| | | | **107,490 fijas** |

Las dos primeras cambiaron en esta ronda y son las que mueven la cuenta:
wa-pendientes pasó de cada 5 minutos a cada minuto (**×5**), y facturar de cada
hora a cada 15 (**×4**). El resto ya estaba así.

**OPERABILIDAD (barrido MEDIO/BAJO, 26-ago-2026): faltaban `wa-outbox` y `gps`
en esta tabla** — `vercel.json` trae 7 crons, no 5, y el que faltaba pesa más
que casi todos los que sí estaban: `wa-outbox` corre cada minuto, el mismo
piso que `wa-pendientes`, y el "47,010 fijas" de abajo lo excluía por
completo (más del doble del piso real). Los `maxDuration` de ambos ya no son
120 s: la oleada 9 (#77) los subió a 300 s tras medir en vivo que el `gps`
real tarda 174–188 s y el `wa-outbox` 155.5 s contra el tope viejo de 60 s —
ver S5 en §2, esa duración medida NO es la misma cosa que "duración media"
(es lo que se observó en las corridas con trabajo real, no un promedio sobre
todas las invocaciones, la mayoría de las cuales no tienen nada que hacer).

**Fase 5 (26-ago-2026): se añade `/api/cron/asistencia`** (el reloj muerto de
emergencias, cada 5 min, +8,640/mes — el total de arriba ya lo incluye). Sin
incidencias abiertas la corrida es una consulta corta por índice parcial y
nada más; su GB-h real entra al mismo cajón S5 hasta medirlo.

Las 47,010 son el **piso**: se pagan aunque no haya un solo cliente. A eso se
le suman las vueltas encadenadas por QStash, que sí dependen del tráfico:

- `wa-pendientes` se auto-reencola **solo si el lote sale lleno**
  (`LOTE = 40`, `ANCHO_POOL = 5`, `MAX_VUELTAS_QSTASH = 20` →
  `/api/cron/wa-pendientes/route.ts`). Capacidad por minuto: 40 × 20 = **800
  mensajes**, o sea 48,000/hora.
- `facturar` fan-outea **un mensaje de QStash por flota con backlog**
  (`TOPE_POR_CORRIDA = 8` tickets por vuelta).

---

## 2. Los SUPUESTOS — declarados, con cómo medirlos de verdad

| # | Supuesto | De dónde sale | Cómo se mide de verdad |
|---|---|---|---|
| S1 | **350,000 – 790,000 mensajes de WhatsApp al mes** | El rango 490–1,100 msg/hora de ESC-1 (auditoría de escala-50k, reporte archivado fuera del repo), × 720 h | `select count(*) from wa_evento_pendiente where recibido_en >= now() - interval '30 days'` — la bandeja durable recibe **una fila por mensaje** (`webhook/route.ts:194`) |
| S2 | **~8 s de duración media** de la invocación del webhook | Una foto paga visión (OCR) más el cuadre; un texto no. Mezcla 60/40 | El p95 y la media reales están en el panel de Vercel (Observability → Functions), por ruta |
| S3 | **~5 s de duración media** de una corrida de `wa-pendientes` con trabajo, ~0.3 s en vacío | Mismo motor que el webhook, 40 mensajes con 5 en vuelo | Igual que S2 |
| S4 | **1.75 GB de memoria** por función | Es el default de Vercel hoy; el repo **no** fija memoria en ningún lado | Vercel → Project → Settings → Functions. **Verificarlo antes de multiplicar**: si el default cambió, toda la columna de GB-h cambia con él |
| S5 | **`wa-outbox`/`gps` NO entran a la cuenta del §3** | La mayoría de sus 43,200+8,640 invocaciones/mes no tienen nada que drenar/sincronizar (outbox vacío, sin unidades con GPS activo) y duran una fracción de segundo; los 155.5 s / 174–188 s medidos en #77 son el caso CON trabajo real contra el tope viejo de 60 s, no un promedio — usarlos como "duración media" inflaría el GB-h de estos dos crons por un orden de magnitud | Panel de Vercel (Observability → Functions) filtrado por ruta, igual que S2/S3 — falta medir antes de sumarlos a §3 |

La fórmula, para poder rehacerla con cifras propias:

```
GB-h = (invocaciones × duración_media_segundos ÷ 3600) × memoria_GB
```

---

## 3. La cuenta

Con S1–S4, y **rango bajo → alto**:

| Origen | Invocaciones / mes | Segundos-función / mes | GB-h / mes |
|---|---|---|---|
| Webhook de WhatsApp | 350,000 – 790,000 | 2.8 M – 6.3 M | **1,360 – 3,070** |
| `wa-pendientes` (43,200 fijas) | 43,200 + reencolados | ~30 k – 150 k | **15 – 73** |
| `facturar` (2,880 + fan-out) | 2,880 + 1 por flota con backlog | ~90 k – 300 k | **44 – 146** |
| `escalar` + `runner` + `purgar` | 930 | ~40 k | **19** |
| `wa-outbox` + `gps` (51,840 fijas) | 51,840 | sin medir (S5) | **sin medir (S5)** |
| Panel (`/dashboard`, `/admin`, SSR + server actions) | ver §4 | ver §4 | ver §4 |
| | | | **≈ 1,440 – 3,300 GB-h + S5** |

**El webhook es el 90 % de la cuenta, y de él la mayor parte es esperar al
modelo de visión.** Ninguna cadencia de `vercel.json` mueve eso: lo mueve el
número de fotos y lo que tarda el OCR. Los tres crons ya medidos (wa-pendientes,
facturar, escalar+runner+purgar) juntos son ~80 GB-h, menos del 6 % — `wa-outbox`
y `gps` quedan fuera de ese 6 % hasta medir S5, no porque valgan cero.

Puesto al revés, que es como se decide: **cada 1,000 viajes/mes cuestan del
orden de 29–66 GB-h**, casi todos de intake.

---

## 4. Lo que esta nota NO cuenta, y hay que sumarle

- **El panel.** `/dashboard` y `/admin` son SSR: cada carga es una invocación
  con su lectura a Postgres. Depende de cuántas personas por flota entren y
  cuántas veces al día — nadie lo ha medido, y estimarlo aquí sería inventar
  una cifra. La caché de 60 s de `getResumenNegocio` (ESC-10) y las RPC de
  agregado de esta ronda bajan el **tiempo** de cada carga, no su número.
- **El build.** Va aparte de las funciones. Ya está acotado desde el 5-ago por
  el `ignoreCommand` de `vercel.json` (~$26 USD/mes de builds antes de eso —
  ver CLAUDE.md).
- **El precio unitario.** A propósito: el plan, el bloque incluido y el precio
  por GB-h extra se leen del panel de Vercel el día que se pague, no de la
  memoria de nadie. Esta nota entrega las UNIDADES; la multiplicación es de un
  minuto y con la cifra correcta.
- **Storage y egress de Supabase**, que a 50k viajes son ~61 GB/mes de
  comprobantes (ESC-13) y se facturan por su lado.

---

## 5. Las tres palancas, en orden de efecto

1. **Bajar el tiempo del webhook** (≈90 % del gasto). Todo lo que acorte el
   camino del OCR —caché por hash de imagen, un modelo más rápido, cortar
   antes ante `fallo_tecnico`— se lleva casi uno a uno el GB-h.
2. **No devolver el lote lleno en `wa-pendientes`.** Mientras el lote de 40 no
   se llene, no hay reencolado por QStash y las 43,200 fijas son todo. Si el
   caudal sube a llenarlo, la cuenta de ese cron se multiplica por las vueltas.
3. **Las cadencias**, que es lo barato y lo que ya se movió. Volver
   `wa-pendientes` a cada 5 minutos ahorraría ~35,000 invocaciones al mes (del
   orden de 12 GB-h): **menos del 1 % de la cuenta, a cambio de la bandeja sin
   drenar de ESC-1.** No es la palanca; queda escrito para que nadie la
   proponga como ahorro.
