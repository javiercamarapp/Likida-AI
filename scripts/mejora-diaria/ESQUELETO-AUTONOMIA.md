# El esqueleto de autonomía de Likida — 16-ago-2026

El mapa completo de TODO lo rutinario: qué loop existe, dónde vive, qué agenda
tiene y qué lo desbloquea. La regla que atraviesa todo: **la IA prepara, el
humano aprueba** — cada loop termina en un PR, una cola de aprobación o un
reporte; ninguno publica, mergea ni manda nada solo.

## Capa 1 · Loops LOCALES vivos (launchd en la Mac, suscripción + centavos)

### Diarios

| Rutina | Hora | Qué hace | Termina en |
|---|---|---|---|
| `mejora-diaria` | 05:30 | auditor barato (gpt-oss-120b) caza bugs del área del día → `claude -p` verifica y arregla (tope 3 corridas) | PRs `mejora/*` |
| `cazador-censo` | 07:00 | scraper incremental del censo (repo censo-liquidacion, cookies locales) | xlsx del censo |
| `noticias-diaria` | 09:00 | investiga el mercado → carrusel con fuentes + copy por canal | cola `publicar/` |
| `promos-diaria` | 10:00 | beneficio REAL de Likida en rotación, logo compuesto | cola `publicar/` |
| `render-video` | 11:30 | pre-check gratis (grep); anima SOLO sequences `estado: aprobada` y ensambla el video completo (ElevenLabs) | cola `publicar/` |
| `dof-diario` | 21:30 | barre las DOS ediciones del DOF (SIDOF); asienta en `normas/` con fuente, ESCRIBE el cambio de software si la norma lo exige, latido si no hubo nada; el veredicto grita "CAMBIO NORMATIVO" | PR + notificación |
| `jarvis-brief` | 08:30 y 21:45 | el brief de mando por WhatsApp: qué corrió, qué espera SU acción, lo urgente primero — 10 líneas de teléfono | WhatsApp |
| `vigia-produccion` | cada 2h | DETERMINISTA ($0): corre la guardia A0 contra la base de PRODUCCIÓN; incidente S1/S2 nuevo o fuente ciega → WhatsApp al instante (dedup: avisa el cambio, no taladra) | WhatsApp |

### Semanales

| Rutina | Día/hora | Qué hace | Termina en |
|---|---|---|---|
| `reporte-enjambre` | lun 07:00 | el meta-vigía: rutinas caídas EN SILENCIO, PRs/piezas/sequences esperando a Javier, producción y gasto de la semana | reporte de 1 página |
| `guiones-semanal` | lun 08:00 | banco de hooks de los videos de referencia (whisper local) + el guion de la semana | cola `guiones/` |
| `visuales-semanal` | mar 07:30 | pieza de marca estilo papel (nano_banana_2, costo cero) | cola |
| `video-semanal` | mié 08:00 | etapas 2-4: character sheets → lugares sheets → sequence sheets con prompts de animación | sequences `propuesta` |
| `competencia-semanal` | jue 08:00 | informe INTERNO de movimientos de Mendel/Uvicuo/Clara/etc. con timeline acumulado | reporte |
| `alianzas-semanal` | jue 09:30 | calendario del gremio (CANACAR/ANPACT/TyT), mapa de aliados, borrador de acercamiento | cola `alianzas/` |
| `contenido-fiscal-semanal` | vie 09:00 | UN artículo largo desde las fichas VERIFICADAS de `normas/` + 3 derivados | cola `articulos/` |
| `automejora-semanal` | sáb 07:00 | el meta-loop: patrones en descartes/logs/ediciones (umbral ≥3) → edits a los ENCARGOS por PR; mide propuestas previas | PR + reporte |
| `auditoria-semanal` | dom 06:30 | UN rubro profundo (rotación de 8) con pruebas ADVERSARIALES que intentan romper invariantes | PR + reporte |
| `experto-fiscal` | dom 18:00 | re-verifica fichas contra fuente primaria (rotación de 6 áreas), caza drift código-vs-ley, enriquece el corpus | PR + hallazgos |

### Mensuales / quincenales

| Rutina | Día | Qué hace | Termina en |
|---|---|---|---|
| `salud-mensual` | 1, 07:00 | advisories reales vs ruido, bumps patch/minor con suite verde | PR + reporte |
| `documentacion-quincenal` | 1 y 15, 07:30 | drift docs↔código (CLAUDE.md, stack, esqueleto, MARCA) — el código es la verdad | PR |
| `fundraising-mensual` | 2, 08:00 | investor update con lo VERIFICABLE + vigía de deadlines de aceleradoras | cola `inversionistas/` |

Controles compartidos: kill switch `touch .mejora-diaria/APAGADO` (todas las
del repo; el cazador se pausa con `launchctl unload`), `--max-turns` por
corrida, taller worktree aislado (`likida-mejoras`), reportes en
`.mejora-diaria/reportes/`, logs en `.mejora-diaria/logs/`. **TODO llega al
WhatsApp personal de Javier** (`wa-notificar.sh`, Cloud API del producto,
`LIKIDA_WA_JAVIER` en .env.local): veredictos, reportes como documento,
piezas como imagen, y las alertas del vigía — la ventana de 24h se abre
contestando cualquier cosa al bot. `instalar.sh`
instala lo que hay en la carpeta y DESCARGA lo retirado (así murió la
vigilancia-fiscal de solo-viernes cuando el DOF pasó a diario).

## Los gates de Javier (dónde vive cada aprobación)

- **Código**: el PR con su CI de 3 checks — nada se mergea solo.
- **Posts (noticias, promos, visuales, artículos)**: la carpeta
  `publicar/`/`articulos/` con todo listo; publicar es SU tap (decisión
  16-ago: "cola + mi toque").
- **Video**: la cadena corre autónoma hasta las sequence sheets; Javier
  autoriza SEQUENCE POR SEQUENCE (`estado: aprobada`) y eso ES autorizar el
  gasto de animarla. El ensamblado cae a `publicar/`.
- **Fiscal**: PR sobre `normas/` (y el código que la norma exija) con
  aritmética y fuente verificadas; el veredicto grita "CAMBIO NORMATIVO".
- **Prompts de los agentes**: la automejora los edita solo por PR.
- **Acercamientos (alianzas)**: borradores; Javier revisa y manda.

## Capa 2 · Loops en la NUBE ya cableados, esperando la llave

| Loop | Dónde | Qué lo desbloquea |
|---|---|---|
| Runner nivel 2 (redactor → cola → envío, cadencia 48h, topes) | Vercel cron cada 4h (`/api/cron/runner`) | migs 0121-0125 (token `sbp_`) + commit `[deploy]` |
| Scorer, dossier, SDR, approach de ventas | mismo runner, se encienden por fila | migs + deploy + encender agente por agente |
| Entrega de correo medida (webhook Resend) | `/api/correo/eventos` | apuntar el webhook en el panel de Resend |

## Capa 3 · Sin loop todavía (decisión o trámite, no código)

WhatsApp comercial saliente (Meta) · enriquecedor headful (captcha) ·
financieros/instrumentación con datos reales (necesitan clientes) ·
talento/legal (sin vacantes ni contratos aún).

## El presupuesto (suscripción y créditos)

Corridas de `claude -p` por semana en régimen: ~21 del pipeline diario de
código + 14 de contenido + 7 del DOF + ~8 semanales + render condicional
≈ **≤55 corridas/semana**, de madrugada y media mañana. Créditos Higgsfield:
carruseles/promos/hojas ≈ 150-250 cr/mes (sin texto → nano_banana a costo
cero); el video gasta solo lo que Javier apruebe por sequence. Si un día te
quedas corto de ventana: `touch .mejora-diaria/APAGADO` y todo se detiene
sin desinstalar nada.
