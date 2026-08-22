# Inventario de los 117 hallazgos — quién los cierra
Leyenda: ✅ integrado en escala-dashboard · 🔄 agente en curso · ⏳ sin asignar (tercera ola)

## ESCALA (19)
ESC-1..4 ✅F1 · ESC-5 ✅F2 · ESC-6,7 ✅S4 · ESC-8 ✅F4 · ESC-9 ⏳(pmf.ts 7 counts × N flotas)
ESC-10 ✅F1(SQL) + ⏳(unstable_cache en negocio.ts) · ESC-11 ✅F1(purga+índice) + ⏳(getEstadoRastreo a RPC)
ESC-12 ✅F2 · ESC-13 ✅F1 · ESC-14 🔄F3 · ESC-15 ✅F4 · ESC-16,17 ✅F1 · ESC-18 ✅F4 · ESC-19 (inventario, sin acción)
## RESILIENCIA (24)
RES-1 ✅F1 · RES-2..5 🔄F3 · RES-6,7 ✅F1 · RES-8 ⏳(backup de Storage: script + runbook)
RES-9 🔄F3 · RES-10 ✅F2 · RES-11,12 🔄F3 · RES-13 ✅F2 · RES-14 ✅F1 · RES-15..17 🔄F3 · RES-18,19 ✅F1
RES-20 🔄F3 · RES-21 ✅F2 · RES-22 ⏳(serie/año en folio: decisión de producto) · RES-23 ✅F2 · RES-24 ⏳(medir costo Vercel)
## SEGURIDAD (9)
SEG-1..9 🔄F3
## DATOS (41)
DAT-01 ⏳(hash de foto siempre + wa_message_id único) · DAT-02,14 ✅D1 · DAT-03 ✅D1 · DAT-04 ⏳Stripe
DAT-05,06 ✅D4 · DAT-07 ✅D1 · DAT-08 🔄W2 · DAT-09 ✅F2 · DAT-10 🔄F3 · DAT-11,12,13 ⏳Stripe
DAT-15 ✅S3 · DAT-16 ✅D4 · DAT-17 ✅F1 · DAT-18,19 ⏳(OCR: monto absurdo, moneda) · DAT-20 ✅D4
DAT-21,22 ⏳(lock del cierre, cierre por texto) · DAT-23 🔄W2 · DAT-24,25 ⏳Stripe · DAT-26..30 ✅D1
DAT-31 ✅F1(SQL) · DAT-32,33 ⏳Stripe · DAT-34 ⏳(dedup antes del rate limit) · DAT-35 ⏳(limpieza de Storage)
DAT-36 ✅D1 · DAT-37,38 ⏳(codigo_pendiente, timestamp de Meta) · DAT-39 ✅D1 · DAT-40 ⏳Stripe menores · DAT-41 ✅D4
## FRONTEND (24)
FE-1 ✅S4(parcial) + 🔄W1 · FE-2 🔄W1 · FE-3 ✅S3 · FE-4 ✅S1/S2 · FE-5,6 🔄W1 · FE-7 ✅S3(parcial)
FE-8 ✅S4(parcial) + ⏳(consumo.ts, slo.ts) · FE-9..13 🔄W1 · FE-14 ⏳(Suspense/streaming) · FE-15 ⏳(importar en lote)
FE-16 ⏳(Cerebro: 6 MB al cliente) · FE-17,18 🔄W2 · FE-19 🔄W1 · FE-20 🔄W2 · FE-21 🔄W1 · FE-22 🔄W2 · FE-23,24 🔄W1
