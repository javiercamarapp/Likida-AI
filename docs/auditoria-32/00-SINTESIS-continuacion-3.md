# Auditoría 32, continuación 3 — síntesis

**19-sep-2026** · ronda de **CONTINUACIÓN** sobre `claude/auditoria-32` y el PR
**#477** · árbol limpio al arrancar, **autofix habilitado**.

**Global: 4.0** (antes **4.25**) · **▼ 0.25**. Suma **51 → 48**. De los 6
reauditados: bajan 4, sube 1, se queda 1. Los otros 6 conservan su nota.

---

## Lo primero, porque es el resultado de la ronda

**Dos auditores independientes, que no se hablan, encontraron el mismo CRÍTICO
por dos caminos distintos — y lo había metido esta misma rama.**

El 17-sep commiteé las migraciones **0358** y **0359** para cerrar dos CRÍTICOS
que la 0357 había creado. Cerraron. Lo que ninguno de los dos auditores de esa
ronda podía ver es que al alinear las **dos funciones SQL entre sí** dejaron
fuera **la tercera definición del mismo predicado**: `copiasDeComprobante` en
`engine.ts`, que es la que imprime el PDF.

- **Fiscal** llegó desde la norma (`FIS-C3`): el minuendo del 15 % dedupa
  mirando el emisor y el sustraendo no, así que el previo del ejercicio sale
  inflado y **el PDF niega una deducción que la RFA 2026 2.9 concede**.
- **Arquitectura** llegó desde la estructura (`ARQ32C3-C2`): sobre las **mismas
  dos filas**, `/dashboard/fiscal` dice **2 comprobantes / $5,000 / $689.66 de
  IVA** y el PDF del mismo viaje dice **1 / $2,500** con un renglón «duplicado»
  encima de un ticket real.

Los dos midieron contra **Postgres 16 con las 336 migraciones limpias**, cada
uno por su lado. Es textualmente lo que `CLAUDE.md` prohíbe: «una cifra fiscal
que se lee distinto en dos pantallas se lee como dos cálculos».

**Arreglado en `790900d`.** Y la prueba distingue la semántica de la **0358** de
la de la **0357** —que es la regresión que costó dos CRÍTICOS la ronda pasada—:
meter el emisor a secas pone rojos los casos 3 y 3 bis.

**Cuarta ronda consecutiva en que el arreglo del orquestador resulta no cerrar,
o cerrar de menos.** La 31: tres de cuatro cerraban a medias. La 32: la 0357
traía dos CRÍTICOS. La c2: 0358/0359 aguantaron. Hoy: aguantaron *entre sí* y
dejaron el tercer lado suelto. La regla —*el rubro cuyo código tocó la auditoría
anterior entra por derecho propio*— es lo único que ha estado atrapando esto, y
lleva cuatro rondas pagándose sola.

---

## Tipo de ronda y por qué

Decidido **antes de gastar un token en auditores**:

```
list_pull_requests(open) → #477 claude/auditoria-32  ABIERTO (draft, mergeable_state: clean)
                           #478 #479 #480 #481  → rutinas normativas, no de auditoría
git ls-remote origin master → 69becdb (fresco)
git log claude/auditoria-32..origin/master → (vacío)
git status --short → (vacío)
```

**Hay PR de auditoría abierto → CONTINUACIÓN.** Se continúa sobre #477, **no se
abre PR nuevo**. `origin/master` no se ha movido desde el 16-sep.

**Seis auditores, los seis por la cláusula de código cambiado.** Los doce
archivos de rubro existen, así que ninguno entró por archivo faltante:

| Rubro | Por qué entró |
|---|---|
| Operabilidad | `2c38766` arregló su propio CRÍTICO |
| Rendimiento | `fc811a0` arregló su propio CRÍTICO |
| Pruebas | `e47f974` + 5 archivos de prueba nuevos |
| Backend | `pg.ts` y `consolidado.ts` cambiaron de contrato |
| Fiscal | 0358 y 0359 reescriben el predicado de dinero del panel |
| Arquitectura | 0357/0358/0359 son tres arreglos a su ARQ-A3 |

---

## Las doce notas

| Rubro | 32·c2 | **Hoy** | Δ | Porqué |
|---|---|---|---|---|
| Modelo de datos y esquema | 6 | **6** | = | No auditado esta ronda. |
| Backend y API | 6 | **5** | ▼1 | **Mirada más profunda.** Un consolidado cuya conciliación lanza deja el paquete marcado como ingerido ENTERO: el ECC queda «disponible» para siempre y nadie vuelve por él. La prueba que monta ese escenario (`ciclo_flota.test.ts:547`) no mira `paquetes_bajados` ni `estado`. |
| Frontend | 5 | **5** | = | No auditado esta ronda. |
| Pruebas | 5 | **4** | ▼1 | **Mirada más profunda.** La 5 de ayer descansaba sobre «la suite TS sí muerde donde la probé». Hoy se probaron los **tres sitios de escritura de dinero en TS** que ocho rondas dejaron sin medir, y los tres están desnudos. 36 mutaciones, **10 mueren (27.8 %)**. El ancla «la suite pasa con la función rota» ahora es cierta en las dos capas, no sólo en SQL. |
| Seguridad | 4 | **4** | = | No auditado esta ronda. |
| Operabilidad y DX | 4 | **5** | ▲1 | **Se atacó y subió.** OP-32C2-C1 cerró **entero**, verificado en los tres estados en que puede quedar la salida del detector, y la prueba dejó de canonizar la condición rota para **evaluarla**. No pasa de 5 porque la pregunta del rubro —¿qué tengo a la mañana siguiente?— sigue respondiéndose que nada. |
| Tool calling | 4 | **4** | = | No auditado esta ronda. |
| Rendimiento y costo | 4 | **4** | = | **Ninguna neta**, y las dos formas se escribieron: hubo ataque real (`fc811a0` es trabajo correcto) y hubo mirada más profunda (dos cadenas que nadie había sumado nunca, `cron/purgar` y `cron/escalar`, y las dos se pasan). Se cancelan contra el ancla, que hoy se cumple en **once** cadenas contra nueve ayer. |
| Arquitectura y mantenibilidad | 4 | **3** | ▼1 | **Deuda que cobró factura**, con el censo hecho: **seis implementaciones de «el mismo comprobante», en dos lenguajes, con TRES semánticas**. Antes del 16-sep eran seis sitios y **una** semántica. ARQ-C1 va por su **12ª** aparición. |
| Sistema agéntico | 3 | **3** | = | No auditado esta ronda. |
| Cumplimiento fiscal | 3 | **2** | ▼1 | **Deuda que cobró factura.** Además de FIS-C3: ninguna de las tres migraciones cita **una sola ficha de `normas/`** —el predicado que decide el denominador de una deducción del ISR se argumenta sobre el comportamiento del OCR—, y la justificación escrita de la 0358 («nunca infla el cupo del 15 %») es **aritméticamente falsa** ($2,125 por par). |
| Cumplimiento legal | 3 | **3** | = | No auditado esta ronda. |

**Suma 48 · global 4.0** (antes 51 · 4.25) · **▼0.25**.

**Las notas que NO subí, y por qué se dice:** los tres arreglos de hoy son de
rendimiento, fiscal/arquitectura y operabilidad. Ninguno sube por ellos — sería
calificar mi propio arreglo con el auditor ya ido. Los califican sus auditores
en la 33. La única que subió lo hizo por un arreglo **de la ronda anterior**,
juzgado por un auditor independiente.

---

## Arreglado: 3, en 3 commits atómicos · Revertidos: 0 · Tope de 3 vueltas gastado

Cada uno: prueba que lo reproduce, **rojo medido** → verde, **mutación
verificada en los dos sentidos**, y suite completa entre uno y otro.

| sha | hallazgo | rojo medido | mutación |
|---|---|---|---|
| `95f497c` | **REN-32C3-C1** (CRÍTICO) | la lectura pedía **100,000 filas** donde deben ser 0 | quitar el cableado → 2 rojas · quitar el corte del motor → 4 rojas |
| `790900d` | **FIS-C3 / ARQ32C3-C2** (CRÍTICO) | dos tickets legítimos de $2,500 con folio 1234 → uno marcado «duplicado» | emisor fuera de la llave → CASO 1 rojo · emisor **a secas**, como la 0357 → CASO 3 y 3 bis rojos |
| `8863b04` | **OP-32C3-A1** (ALTO) | `expected '' to contain …` — **salida vacía**, la firma exacta de las corridas #1678 y #1480 | devolver el comando desnudo → 2 rojas |

**`OP-32C3-A1` explica algo que se veía y no se entendía.** El paso que mergea
los PR de las rutinas corre bajo `bash -e` y tenía el comando desnudo en el
cuerpo de un `for`: un `exit 8` —«los checks siguen en curso», que es el caso
**normal**, porque el workflow se dispara cuando termina *uno* de ellos— mataba
el paso en esa línea, sin `CODE=$?`, sin rama de reintento, sin el comentario de
rechazo y **sin una sola línea de salida**. Por eso los PR de las rutinas se
apilaban abiertos y nadie sabía por qué.

**Un daño colateral que encontré en mi propio arreglo antes de commitearlo:** la
primera versión de `REN-32C3-C1` miraba `Date.now()` **también sin reloj** y le
corría la secuencia a `REND-A3`. Lo atrapó la suite, no yo. Corregido con
`venceEn !== undefined` antes de la mirada.

---

## Pendientes con razón escrita: 10 CRÍTICOS

- **ARQ32C3-C1 / el otro lado del espejo** — `desde_db.ts:184` contra `0358:101`.
  Es el mismo hilo que hoy se cerró por un lado; el otro exige tocar el cálculo
  del ejercicio previo, que es un rediseño y no un parche de madrugada.
- **ARQ-C1 (12ª ronda)**, **FE-C1 (9ª)**, **OP-C1 (9ª)** — las tres tienen dos
  salidas y las dos son **decisión de producto**. Un hallazgo en su novena o
  duodécima ronda no necesita un reporte más: necesita que el dueño elija.
- **FIS-C1 (4ª)** y **FIS-C2** — reincidentes; no entraron en las 3 vueltas.
- **PRU32C3-C1** (NUEVO, medido hoy por primera vez) — escribir todas las líneas
  de un ECC con `monto = 0` y `litros = null` pasa con **989 archivos / 12,990
  pruebas / 0 fallos**, byte por byte la línea base.
- **PRU32C3-C2** (NUEVO) — **13 de las 14** comparaciones de la guarda de
  `api/v1/_escritura.ts` se pueden borrar una por una con 207/207 verdes, **las
  cuatro de dinero incluidas**.
- **PRU32C2-C1 (2ª)** — merece una ronda dedicada: son arneses SQL nuevos.
- **PRU-C1 (6ª)** — la cifra que la pantalla imprime va **0 de 24**. La clase ya
  abarca las tres capas: donde se escribe, donde se calcula en SQL y donde se
  imprime.

---

## Lo que urge y no es código, SÉPTIMO día consecutivo

```
git log --format='%h %ad %s' --date=short origin/master | grep '\[deploy'
  → cfa00ab 2026-09-10 …
git diff --name-only cfa00ab..origin/master -- src/ supabase/ | wc -l  →  21
```

El último commit con `[deploy]` en el **asunto** sigue siendo `cfa00ab`, del
**10-sep — hace 9 días**. **21 archivos** de `src/`/`supabase/` en `master` que
nunca llegaron a producción, entre ellos el cubo del 15 %. **Redeploy en
Vercel.** No es un hallazgo de ningún rubro: es una acción del dueño.
Notificado.

---

## INFRA e higiene de la ronda

- **Un auditor dejó viva una mutación de pruebas en el árbol** (`monto: 0` en
  `intake/consolidado.ts:523`). **No era un descuido:** era una sonda
  deliberada, corriendo durante una suite completa, y su autor la restauró al
  pedírselo. Otros **tres** auditores la detectaron y la reportaron **sin
  tocarla**, que es la conducta correcta. **Ningún commit de esta ronda usó
  `git add -A`:** los cinco se armaron con rutas explícitas.
- **El dato que dejó esa mutación es un hallazgo por derecho propio** y es
  `PRU32C3-C1`.
- **Una suite intermedia no contó como compuerta** y se dice: corrió con
  mutaciones de otro agente en el árbol. Se volvió a correr con el árbol quieto.
- El clon llegó **sin `node_modules`** (`npm ci`, exit 0). No hay `gh`: todo lo
  de GitHub salió del MCP. `docs/auditoria-*/` está en `.gitignore:36` y se
  commitea con `git add -f`.
- **Mirar el tablero encontró dos defectos que medir no encontró:** la serie
  histórica tenía **4.8 donde va 4.7** (la continuación 2 de la 31 cerró en 4.7,
  no 4.8) — es decir, el tablero mentía sobre una nota —, y el pie decía «nueve
  puntos» habiendo **ocho**. Corregidos y recapturado.

---

## Compuerta al cerrar

```
npx vitest run       991 archivos · 13,007 pasan · 6 saltadas · 0 fallan · exit 0
npx tsc --noEmit     exit 0
npm run lint         0 errores · 154 avisos
npm run lint:ratchet 0 nuevos · 154/194 heredados
```

Línea base al arrancar: **989 / 12,990 / 6 / 0**, cifra por cifra idéntica al
cierre del 18-sep, que es lo que confirma que el árbol no se había movido entre
rondas. `npm run build` no se corre en la nube.

El intermitente de `cron/asistencia/route.test.ts` **sigue cerrado**: 0 rojas de
20 corridas aisladas, más las pasadas completas de la suite.

**Tablero:** `tablero-continuacion-3.html` + `.png`, capturado **y mirado**.
