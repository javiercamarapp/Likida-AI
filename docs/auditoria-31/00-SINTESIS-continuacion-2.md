# Auditoría 31 — síntesis de la CONTINUACIÓN 2

**15-sep-2026** · ronda de **CONTINUACIÓN** sobre el PR **#462** (rama
`claude/auditoria-31`) · 4 rubros reauditados de 12 · árbol limpio al arrancar,
**autofix habilitado**.

**Global: 4.7** (la de ayer: **4.8**) · **▼ 0.1**. Se movió **una** de las doce.

---

## Por qué esta ronda fue de continuación y no una ronda nueva

Decidido antes de gastar un token en auditores, con dos comandos:

- `list_pull_requests(open)` vía el MCP de GitHub (no hay `gh` en esta imagen) →
  **PR #462 abierto**, rama `claude/auditoria-31`. Con un PR de auditoría vivo la
  regla es continuar sobre él: un PR vivo vale más que catorce ignorados.
- `git log --oneline claude/auditoria-31..origin/master` → **vacío**.
  `origin/master` sigue en **`4047a50`**, el sha sobre el que se cortó la rama el
  13-sep. Tercer día sin que el código de producción se mueva.

### La trampa de entorno que esta ronda encontró, y que hay que dejar escrita

El clon de la nube trajo **`refs/remotes/origin/master` rancio**, apuntando a
`7bcc319` (**8-sep**), un sha ANTERIOR al `HEAD` con el que arrancó el
contenedor. El primer cotejo de deriva —el mismo comando que las dos rondas
anteriores usaron— salió con **7,298 borrados que no existen**:

```
$ git ls-remote origin master
4047a50cc01c9e105ecedae8edfc2347f0eb15d9  refs/heads/master   ← el real

$ git rev-parse --short origin/master
7bcc319                                                        ← el del clon
```

Se corrigió con `git fetch origin master`. **Una ronda que confíe en el
`origin/master` del clon mide contra un árbol que no existe** y puede reportar
una catástrofe inventada. Queda como primer paso obligatorio de la próxima:
`git ls-remote origin master` y comparar antes de cualquier `git diff`.

---

## Quién se relanzó, y por qué exactamente ese

Los 12 archivos de rubro existen, así que ninguno se relanzó por faltar. Se
relanzaron los **4 cuyo código cambió** desde que se escribió su archivo más
reciente — el cruce completo está en `MAPA-continuacion-2.md`:

| Rubro | Qué cambió en su superficie |
|---|---|
| **Frontend** | `peajes/controles.tsx` y `peajes/page.tsx` (065f699) + su prueba de render (939c111) |
| **Seguridad** | `scripts/ci/deriva-sin-desplegar.mjs`, script nuevo en 30e5e14 y corregido en 8c0e7df |
| **Pruebas** | seis archivos de prueba nuevos o reescritos en esta rama |
| **Operabilidad** | el mismo script `deriva-sin-desplegar.mjs`, que cambió **después** de que entregara ayer |

Los otros 8 conservan su nota y van marcados `no auditado esta ronda`.

**Dos commits de ayer no están en ninguna síntesis anterior** —`8c0e7df` y
`939c111` entraron después de que se escribiera la de la continuación 1, y
`progreso.md` se cortó a las 11:48—. Es una falla del propio método y por eso
este documento los describe.

---

## Las notas

| Rubro | Ayer | Hoy | Δ | Porqué del movimiento |
|---|---|---|---|---|
| **Operabilidad y DX** | 5 | **4** | ▼1 | **Deuda que cobró factura, con la factura fechada.** El 14-sep 22:50:41Z producción contestó `503 / crons=degraded` —la primera roja en cinco días— y **el nombre del cron no sobrevive en ningún artefacto**: `cron_latido` es una fila por cron sobrescrita sin historial, los logs de Vercel no tienen drain, y el issue que se abrió a los 3 s remite al log. Si el cron degradado fue `facturar` o `wa-outbox`, eso es el camino del dinero, y la ventana solo se puede acotar entre dos verdes: **hasta 5 h 23 min**. Encima, las tres cifras que sostenían el 5 empeoraron otra vez, recontadas hoy: **14 → 18** corridas verdes sobre el arreglo fiscal sin publicar, hueco del pulso **345 → 408 min**, respaldo de Storage **19 → 20 días** sin intento. El ancla del rubro («4 o menos si un fallo en producción es invisible») quedó tocada por un hecho, no por una opinión. |
| **Pruebas** | 6 | **6** | = | **Dos fuerzas medibles se cancelan, y las dos son números.** Un CRÍTICO se retiró de verdad: `PRU-31-C2` cierra —mutar `2000 → 20000` mata 4 pruebas—. Contra eso, una clase nueva: de las **6** pruebas nuevas de esta rama, **4 muerden a medias**; la mutación general dio **9 de 18 muertas (50 %)** contra 24/45 (53 %) de la ronda anterior. |
| **Frontend** | 5 | **5** | = | **Dos de las tres razones aplicaron y se cancelaron, contadas.** *Se atacó y subió*: entró código correcto en su superficie por primera vez en tres rondas (`065f699` cierra el acuse, demostrado por agotamiento). *Deuda que cobró factura*: el arreglo se aplicó a **1 de 2** sitios con ese patrón, y los abiertos pasan de **9 a 13** con **0 cierres**, tercera ronda seguida. |
| **Seguridad** | 5 | **5** | = | **Ninguna de las tres razones aplica, y lo sostiene con el barrido.** **9 de 9** hallazgos abiertos siguen abiertos, **0 cerrados**; `git diff` no toca `src/lib/auth/`, el proxy, `api/webhook/` ni `supabase/`. Remedido: `npm audit` **0 sobre 751**, `grant … to anon` **0 ocurrencias** en las 333 migraciones. |
| Los otros 8 | — | — | = | **No auditados esta ronda.** Conservan su nota por regla. |

**Global = 56 / 12 = 4.67 → 4.7.**

### Las notas que NO moví, y por qué lo digo

**Operabilidad no sube por mi arreglo.** `c361379` cierra OP-31C-A1 —el aviso de
deriva ya llega al resumen de la corrida y abre un issue con dueño— pero se
commiteó **después** de que el auditor entregara. Calificar mi propio arreglo con
el auditor ya ido es exactamente el sesgo que la ronda 30 documentó. Además,
ninguna de las cuatro razones de su 4 la toca: el incidente de anoche ya ocurrió
y las tres cifras son de producción, no del repo. La 32 decide con mirada fresca.

Lo mismo con **frontend** y `e48a6f9`, y con **rendimiento**, que ni siquiera se
reauditó hoy y por tanto conserva su 4 aunque `6098cc8` haya cerrado la parte
restante de uno de sus dos críticos.

---

## Los tres arreglos, y qué prueba sostiene cada uno

Tope de **3 vueltas gastado**. **Revertidos: 0** — la suite terminó verde en los
tres, y cada uno lleva mutación verificada **en los dos sentidos**.

### `c361379` — OP-31C-A1 (ALTO): el aviso de deriva llega a un canal que alguien lee

El detector que entró ayer mide bien y avisaba donde nadie mira. Verificado por
mí antes de tocar nada: `grep -c GITHUB_STEP_SUMMARY` sobre el script daba **0**,
el único `gh issue create` está bajo `if: failure()`, y el paso del detector sale
0 siempre. GitHub solo manda correo cuando un workflow programado **falla**, así
que el `::warning::` moría en el log — **18 corridas verdes, cero avisos**.

Ahora escribe en `$GITHUB_STEP_SUMMARY` y deja su veredicto en `$GITHUB_OUTPUT`,
y el workflow abre un issue con **etiqueta propia** (`deriva-sin-desplegar`) que
se cierra solo cuando producción alcanza a master. La etiqueta propia no es
cosmética: con la compartida, el paso «Cerrar el issue al recuperarse» lo
cerraría en la primera corrida verde, que son todas.

La prueba del cableado se afirma **sobre el paso**, no sobre el archivo entero —
el `toContain` sobre todo el YAML sobrevivía a mover una línea de un paso a otro,
que es la mutación que OP-31C-M2 reportó viva. Quitar `id: deriva`, apagar el
resumen o cambiar la condición por `failure()` matan una prueba cada uno.

### `6098cc8` — REN-31-C1, parte restante (CRÍTICO): el peor caso cabe en sus 120 s

El arreglo de ayer cerró el modo de falla y no el techo (130.2 s medidos contra
`maxDuration = 120`). Dos huecos, los dos invisibles para la prueba que existía
porque sus mocks contestan en 0 ms:

1. `venceEn` se anclaba **después** de `puertaCron` y `leerInterruptor`. El
   hachazo de Vercel cuenta desde que entró la petición.
2. La cadena real tiene **ocho** consultas, no siete: `escalarUna` lee
   `leerConfigCobranza` en el camino ámbar antes del claim — **y esa era la única
   de la cadena sin `acotada()`**, o sea que heredaba los 300 s de undici dentro
   de una ruta de 120. Y `registrarLatido` cuesta hasta 9.5 s, no los 5.0 que el
   colchón reserva.

Peor caso resultante: **120.0 s exactos**. El precio declarado: la ventana de
admisión baja de ~28.5 s a ~14.5 s, y lo que no entra lo toma la corrida de 5
minutos después. El colchón del latido se corrigió **en esta ruta y no en la
constante compartida** a propósito: subirla re-presupuesta de golpe los otros
cinco crons, y eso lo tiene que pricear el auditor de rendimiento.

### `e48a6f9` — FE-31C2-A1 (ALTO): la bitácora de Cobranza deja de mentir

El hermano que el arreglo de ayer no tocó — y es el agente que **sí manda
WhatsApp a choferes**. Con 400 en cola y el reloj cortando a los 40, la ficha de
corridas archivaba, de forma durable, **«OK · 40/40»** sobre 360 choferes a los
que nadie escribió; con el agente pausado entre el render y el clic, **«OK ·
0/0»** para una corrida que no corrió. El acuse que sí dice la verdad vive en
`useActionState` y se evapora con el primer `router.refresh()`.

Es la regla que CLAUDE.md pone primero: un rótulo tiene que ser verdad.

---

## Lo que urge y no es código — **tercer día consecutivo**

**El arreglo fiscal de la ronda 30 sigue en `master` y no en producción.**
Verificado hoy con comando, contra el remoto real:

```
$ git log origin/master --format='%h|%ad|%s' --date=short | awk -F'|' '$3 ~ /^\[deploy/ {print; exit}'
cfa00ab|2026-09-10|[deploy] publicar fix de integridad de REN-C1 (keyset en candidatosDb)

$ git diff --stat cfa00ab..origin/master -- src/ supabase/
 src/lib/likida/cuadre/desde_db.ts      | 19 ++++-   ← ARQ-C2 (el cubo del 15 %)
 src/lib/likida/sat_descarga/ciclo.ts   | 22 +++---   ← AG-C1
 (+3 archivos de prueba)
```

En dinero: con acumulado $100,000 y un ticket de diésel en efectivo de $4,700
fotografiado dos veces, el previo que corre en producción sale **$90,600** donde
lo correcto son **$95,300**, y el PDF declara deducible lo que ya excedió la RFA
2026 2.9. **Se arregla con Redeploy en el panel de Vercel**, o con un commit cuyo
asunto lleve `[deploy]` en la primera línea. No hace falta código nuevo.
Notificado al dueño en el momento de verificarlo.

**Y algo nuevo: producción se degradó anoche.** 14-sep 22:50:41Z, `503 /
crons=degraded`, recuperada a las 01:03Z. Cuál cron fue no se puede saber desde
ningún artefacto que siga existiendo. Es OP-C1 cobrando factura en su séptima
ronda.

---

## Pendientes, con razón escrita

- **OP-C1** (CRÍTICO, **7ª ronda**) — **no atacado, y esta vez la razón es
  distinta de las seis anteriores.** El único arreglo que no cambia el contrato
  público de `/api/health` —nombrar el cron en el issue PRIVADO que el workflow
  ya abre con `GH_TOKEN`— necesita que el nombre viaje del servidor al CI, y los
  dos caminos posibles quedan fuera de lo que esta corrida puede verificar: un
  secreto de repositorio (lo pone el dueño, no yo) o una tabla con historial de
  latidos (migración, y este contenedor no tiene Postgres corriendo). Arreglarlo a
  ciegas es lo que la rutina prohíbe. **Es la pieza más vieja del tablero y ya
  cobró factura: merece una decisión, no un octavo intento.**
- **REN-30-C1, parte restante** (CRÍTICO reincidente) — el prólogo del barrido de
  peajes (hasta 100 páginas de `gasto`, ~30 s) corre antes del único chequeo de
  reloj. No atacado: el tope de 3 vueltas se gastó en OP-31C-A1, REN-31-C1 y
  FE-31C2-A1. **Y hay algo peor que el auditor de pruebas midió hoy:** quitar
  `venceEn` de `peajes/page.tsx:234` —el cableado que enciende el arreglo en
  producción— pasa con **94 archivos / 612 pruebas verdes**.
- **REN-30-C2** (CRÍTICO reincidente) — `candidatosDeGasto`, 427.5 s contra el
  techo. Sin atacar, misma razón de presupuesto.
- **PRU-C1** (CRÍTICO, **4ª ronda**) — la cifra de dinero que la pantalla imprime
  sigue sin arnés: con las dos mutaciones nuevas van **0 de 14**.
  `vitest.config.ts:104` excluye la capa entera.
- **ARQ-C1** (9ª aparición) y **FE-C1** (7ª) — **reverificados hoy por mí, abiertos
  e idénticos**: `poliza/route.ts:363-367` conserva el `bloqueos.push` + `continue`
  por fila; `src/lib/auth/visibilidad.ts:41` (`encargado: ['operacion']`) y
  `forma-viaje.tsx:90` siguen dejando el Anticipo fuera del despacho. (Ojo: las
  síntesis anteriores citaban `lib/likida/visibilidad.ts`, ruta que **no existe**.)
- **ARQ-A3** (CRÍTICO) — el dedup del ejercicio que regala cupo del 15 %. Sigue
  sin reproducirse: vive en una función SQL y no hay Postgres corriendo. El lead
  de ayer (binarios de PostgreSQL 16 en la imagen) **no se intentó**: el
  presupuesto se fue en los tres arreglos. Sigue siendo el mejor lead para la 32.
- **SEG-31-A1, SEG-31-M1..M4, SEG-31-B1..B4** — los 9 de seguridad, intactos.
- **FIS-C1, FIS-C2, LEG-C1, LEG-31-C1** — rubros no reauditados hoy.

### Hallazgos nuevos que dejo propuestos, no arreglados

- **El colchón del latido está subdeclarado para los otros cinco crons.**
  `COLCHON_LATIDO_CRON_MS` reserva 5.0 s para una escritura cuyo techo es 9.5 s.
  Hoy se corrigió solo en `asistencia`; `gps` y `descarga-sat` —que el auditor de
  rendimiento ya midió excedidos (314.0/300 y 323.5/300)— cargan el mismo error.
- **SEG-31C2-B1..B3** (seguridad, BAJO): la inyección por *argumento* sigue viva
  en el detector de deriva (`--output=…` se lee como opción), la prueba de
  regresión se satisface con un comentario del JSDoc, y «no bloquea» es un string
  y no una propiedad — `execFileSync` lanza ante exit ≠ 0 y el paso puede tumbar
  el pulso.
- **`master` hoy es `protected: true`**, lo que contradice
  `.github/workflows/NOTAS-SEGURIDAD.md` §3 («hoy NO EXISTE»).
- **FE-31C2-M1** y los tres MEDIO de operabilidad y pruebas.

---

## Compuerta al cerrar

```
npm test        988 archivos · 12,976 pasan · 6 saltadas · 0 fallan · exit 0
tsc --noEmit    exit 0
eslint          0 errores · 154 avisos
lint:ratchet    154/194 heredados · 0 nuevos · 0 errores
npm run build   no se corre en la nube (pide Supabase/OpenRouter/Facturapi/Upstash)
```

Línea base al arrancar: **986 archivos / 12,960 pruebas** — idéntica al cierre de
la continuación 1 más las 2 de `939c111`, que es lo que confirma que el árbol no
se había movido. Al cerrar: **+2 archivos, +16 pruebas**, todas nacidas de un
arreglo con su mutación medida.

**Tablero:** `tablero-continuacion-2.html` + `tablero-continuacion-2.png`,
capturado **y mirado**. Verificado en la imagen: 12 filas, suma 56, global 4.7,
una sola flecha (▼1 en operabilidad), los 10 puntos de la serie dentro del
`viewBox` y ninguna etiqueta cortada. Mirarlo encontró además que **el tablero de
ayer rotuló la serie histórica corrida una ronda** (empezaba en «25 · 6.2» donde
los títulos de commit dicen 24); aquí va con la numeración de los commits.

## INFRA de esta corrida

- El clon no traía `node_modules` (`npm ci`, exit 0). No es un fallo del código.
- `refs/remotes/origin/master` del clon venía **rancio** (ver arriba). Es la
  trampa nueva de esta ronda.
- No hay `gh` en la imagen: todo lo de GitHub salió del MCP. Donde el encargo
  pedía `gh pr list`, se corrió `list_pull_requests` y se pega su salida.
- Sin red saliente: nada se consultó contra `app.likida.ai`. Lo de producción se
  dedujo de la historia de git y de lo que el auditor leyó de las corridas del
  pulso, no de un `curl`.
- `docs/auditoria-*/` está en `.gitignore:36` → se commitea con `git add -f` o el
  PR sale vacío sin avisar.
- Chromium para la captura en `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  con `--force-prefers-reduced-motion`.
