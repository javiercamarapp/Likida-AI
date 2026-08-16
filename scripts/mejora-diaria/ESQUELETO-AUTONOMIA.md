# El esqueleto de autonomía de Likida — 16-ago-2026

El mapa completo de TODO lo rutinario: qué loop existe, dónde vive, qué agenda
tiene y qué lo desbloquea. La regla que atraviesa todo: **la IA prepara, el
humano aprueba** — cada loop termina en un PR, una cola de aprobación o un
reporte; ninguno publica, mergea ni manda nada solo.

## Capa 1 · Loops LOCALES vivos (launchd en la Mac, suscripción + centavos)

| Rutina | Cadencia | Qué hace | Termina en |
|---|---|---|---|
| `com.likida.mejora-diaria` | diario 05:30 | auditor barato (gpt-oss-120b) caza bugs del área del día → `claude -p` verifica y arregla (tope 3 corridas) | PRs `mejora/*` |
| `com.likida.auditoria-semanal` | dom 06:30 | UN rubro profundo (rotación de 8) con pruebas ADVERSARIALES que intentan romper invariantes; calificación no ambigua | PR + reporte |
| `com.likida.vigilancia-fiscal` | vie 21:00 | cuota IEPS del DOF vespertino, aritmética verificada o nada | PR a normas/ |
| `com.likida.guiones-semanal` | lun 08:00 | etapa 1 de la cadena de video: destila hooks de los videos de referencia de Javier (whisper local) + escribe el guion | cola `guiones/` |
| `com.likida.video-semanal` | mié 08:00 | etapas 2-4 sobre el guion más reciente: character sheets → lugares sheets → sequence sheets con prompts de animación listos | sequences en `estado: propuesta` |
| `com.likida.render-video` | diario 11:30 | pre-check gratis (grep); SOLO si Javier marcó sequences `estado: aprobada` → anima (seedance std/480p) y, con el video completo, ensambla con narración ElevenLabs | cola `publicar/`; el tap es de Javier |
| `com.likida.noticias-diaria` | diario 09:00 | investiga el mercado (flotas MX, competencia, tecnología) → carrusel con fuentes citadas + copy por canal | cola `publicar/` |
| `com.likida.promos-diaria` | diario 10:00 | beneficio REAL de Likida en rotación → imagen o carrusel con logo compuesto + copy por canal | cola `publicar/` |
| `com.likida.visuales-semanal` | mar 07:30 | pieza de marca estilo papel (nano_banana_2, costo cero) según MARCA.md | cola `likida-marketing-cola/` |
| `com.likida.salud-mensual` | día 1 07:00 | advisories reales vs ruido, bumps patch/minor con suite verde | PR + reporte |
| `com.likida.cazador-censo` | diario 07:00 | scraper incremental del censo (repo censo-liquidacion, cookies locales) | xlsx del censo |

Controles compartidos: kill switch `touch .mejora-diaria/APAGADO` (las 6 del
repo; el cazador se pausa con `launchctl unload`), `--max-turns` por corrida,
taller worktree aislado (`likida-mejoras`), reportes en
`.mejora-diaria/reportes/`, logs en `.mejora-diaria/logs/`.

## Capa 2 · Loops en la NUBE ya cableados, esperando la llave

| Loop | Dónde | Qué lo desbloquea |
|---|---|---|
| Runner nivel 2 (redactor → cola → envío con cadencia 48h y topes) | Vercel cron cada 4h (`/api/cron/runner`, vercel.json) | aplicar migs 0121-0125 (token `sbp_` de Javier) + commit `[deploy]` |
| Scorer, dossier, SDR, approach de ventas | mismo runner (se encienden por fila: `runner_habilitado` + techo) | migs + deploy + encender agente por agente |
| Entrega de correo medida (webhook Resend) | `/api/correo/eventos` | apuntar el webhook de Resend ahí (panel de Resend) |

## Capa 3 · Diseñados SIN loop todavía (decisión o trámite, no código)

- WhatsApp comercial saliente — BLOQUEADO por Meta (número de prueba).
- Redes sociales — falta decidir canal (los compradores están en LinkedIn/gremio).
- Enriquecedor con navegador headful — necesita rescate humano de captcha.
- Financieros con datos reales — necesitan clientes (la base está en cero).

## Los gates de Javier (dónde vive cada aprobación)

- **Código**: el PR con su CI de 3 checks — nada se mergea solo.
- **Posts (noticias, promos, visuales)**: la carpeta `publicar/<fecha>-*/` con
  todo listo; publicar en LinkedIn/IG/TikTok es SU tap (decisión 16-ago:
  "cola + mi toque").
- **Video**: la cadena corre autónoma hasta las sequence sheets; Javier
  autoriza SEQUENCE POR SEQUENCE (`estado: aprobada` en el .md de la escena)
  y eso ES autorizar el gasto de animarla. El ensamblado cae a `publicar/`.
- **Fiscal**: PR sobre normas/ con la aritmética verificada.

## El presupuesto (suscripción y créditos)

Corridas de `claude -p` por semana en régimen: ~21 diarias (mejora 3×7) + 14
de contenido (noticias+promos) + 1 auditoría + 1 fiscal + 1 guion + 1 video +
1 visuales + render condicional ≈ **≤45 corridas/semana**, de madrugada y
media mañana. Créditos Higgsfield: carruseles/promos ≈ 100-150 cr/mes (las
piezas sin texto van por nano_banana a costo cero); el video gasta solo lo
que Javier apruebe por sequence. Si un día te quedas corto de ventana:
`touch .mejora-diaria/APAGADO` y todo se detiene sin desinstalar nada.
