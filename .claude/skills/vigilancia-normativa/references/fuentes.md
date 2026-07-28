# Fuentes, probadas con curl

Cada fila se golpeó de verdad. Lo que dice "no" no es sospecha: es un código de respuesta.

| Fuente | Endpoint | Formato | Estado | Cadencia |
|---|---|---|---|---|
| **SIDOF notas** | `sidofqa.segob.gob.mx/dof/sidof/notas/{DD-MM-AAAA}` | JSON sin auth | **200**, ~29 KB. Índice + texto completo | Diaria, 3 ediciones |
| **SIDOF nota** | `…/notas/nota/{codNota}` | JSON | **200**, ~33 KB. HTML íntegro en `cadenaContenido` | Por nota |
| **SIDOF diarios** | `…/diarios/porFecha/{DD-MM-AAAA}` | JSON | **200**. Qué ediciones salieron. **El cruce anti-silencio** | Diaria |
| **SAT minisitio** | `sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html` | HTML estático | **200**, ~226 KB, 46 enlaces a anticipadas. Trae `ETag` y `Last-Modified` | Semanal (jue/vie) |
| **Diputados PDF** | `diputados.gob.mx/LeyesBiblio/pdf/{CFF,LISR,LIVA,LFPDPPP}.pdf` | PDF | **200**. El `Last-Modified` rastrea la reforma | Por reforma |
| **Diputados ref** | `diputados.gob.mx/LeyesBiblio/ref/{cff,lisr,…}.htm` | HTML | **200**. Historial de reformas con fechas | Por reforma |
| DOF índice | `dof.gob.mx/index.php?year=&month=&day=` | HTML | **200**, 59–90 KB. Respaldo del cruce | Diaria |
| ~~DOF nota_detalle~~ | `dof.gob.mx/nota_detalle.php` | HTML | **Prohibido por `robots.txt`** (`Disallow: /nota_detalle.php?`). Usar SIDOF, que no está bloqueado | — |
| ~~SAT portal~~ | `www.sat.gob.mx/portal/…`, `omawww.sat.gob.mx` | — | **Muerto.** CloudFront devuelve `302` a un shell JS de 1,476 b para toda URL profunda. Con cookie jar, idéntico | — |
| ~~RSS del DOF~~ | `dof.gob.mx/rss/rss.xml` | — | **404.** No existe feed oficial | — |

## Calendario, verificado escaneando oct-2025 → jul-2026

| Qué | Cuándo salió | A qué fichas pega |
|---|---|---|
| **Cuota IEPS diésel** | **Cada viernes, VESPERTINA.** 10 de 10 verificados | `lif-2026-20-A`, cálculo del estímulo |
| LIF 2026 | 07-nov-2025, vespertina | `lif-2026-20-A` |
| **RMF 2026** | **28-dic-2025, DOMINGO**, matutina, cod. 5777217 | todas las `rmf-*` |
| Anexos de la RMF | Goteo: 28-dic, 29-dic (ves), 09, 13, 19 y 26-ene | Anexos 3 y 20 |
| RFA 2026 | 17-feb-2026, matutina | `rfa-2026-2.2`, `rfa-2026-2.9` |
| 1ª mod. a la RMF | Anticipada en el SAT 23-feb · DOF hasta **09-jul** | las reglas que cite |
| Reformas a ley | Irregular. CFF: 14-nov-2025, 28-dic-2025, **09-abr-2026 (ves)** | `lisr-*`, `liva-*`, `cff-*` |

Dos lecciones del escaneo, ambas caras: **la publicación más importante del año cayó en domingo**, y **casi todo lo que mueve dinero salió en vespertina**.

## Los siete modos de falla

1. **Día no hábil.** Barrer 7 días. El primer barrido de prueba filtró fines de semana y se perdió la RMF completa.
2. **Solo matutina.** Iterar siempre las tres ediciones.
3. **SIDOF falla en silencio.** `200` con arrays vacíos para fin de semana, fecha futura y caída. Cruzar contra `diarios/porFecha`. Canario: un día hábil con 0 notas es siempre un fallo.
4. **Ventana de la anticipada.** Cuatro meses y medio de efectos jurídicos sin pasar por el DOF. Lo cubre el job del `ETag`.
5. **Renumeración sin cambio de texto.** El diff no la ve. Verificar que el número siga apuntando al mismo tema.
6. **Fe de erratas y notas aclaratorias.** Van en el diccionario de disparadores.
7. **Anexos que llegan semanas después.** Marcar la ficha incompleta hasta que aparezca el anexo.

## Alternativas comerciales

- **Tlaloc** (`api.tlaloc.sh/mx/mcp`) — API del DOF con búsqueda semántica sobre ~160 mil documentos y servidor MCP, prepago ~$0.05 MXN por consulta. Es la única que sustituiría este código.
- **DOF Monitor** (`dof-monitor.com`) — gratuito, barre cada hora las tres ediciones. Sirve de **red redundante**, no de fuente de verdad: no entrega texto estructurado.
- **IMCP, EY Tax Flash, HLB** — boletines humanos con 1 a 3 días de retraso. Buen segundo par de ojos.

Nadie publica en abierto un feed estructurado de *qué reglas cambiaron*. Esa capa es la que construye esta rutina.
