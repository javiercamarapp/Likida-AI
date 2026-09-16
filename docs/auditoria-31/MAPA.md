# MAPA — auditoría 31 (ronda COMPLETA, 13-sep-2026)

## Qué es esta ronda

**Ronda COMPLETA, 12 rubros.** La decisión se tomó con la regla de tamaño,
**antes** de gastar un token en auditores:

- `list_pull_requests(javiercamarapp/cuadra, state=open)` → **`[]`, cero PRs
  abiertos**. El PR de la ronda 30 está mergeado (`5ce91b2` en el log de
  `master`). → **no aplica la regla de continuación**.
- `git log 5ce91b2..HEAD -- src/ supabase/ normas/` → **2 commits** →
  hubo commits en las rutas que la regla vigila → **ronda COMPLETA**.

Rama nueva: **`claude/auditoria-31`** (prefijo `claude/` obligatorio: las
routines solo pueden pushear a ramas con ese prefijo). Base: `master` =
`4047a50`. Árbol limpio al arrancar (`git status --porcelain` vacío) →
**autofix habilitado**.

El clon de la nube no traía `node_modules`: se corrió `npm ci` (exit 0) antes
de la compuerta. Costo de la ronda, no un fallo.

## El hecho que define la ventana: NO ENTRÓ CÓDIGO

Esto va antes que nada porque cambia dónde puede estar el riesgo hoy.

Los dos commits de la ventana son, íntegros:

```
4047a50 chore(normas): latido cuota-diesel — INFRA, egress bloqueado (#459)
        normas/.latido-cuota-diesel | 38 +++++-----
ecfdf42 chore(normas): latido de vigilancia — INFRA (egreso bloqueado) (#461)
        normas/.latido-vigilancia   | 58 ++++++--------
```

`git diff 5ce91b2..HEAD --name-only` devuelve **exactamente dos rutas**, las dos
archivos de latido (dotfiles de bitácora de las rutinas de vigilancia):

```
normas/.latido-cuota-diesel
normas/.latido-vigilancia
```

**Cero líneas de `src/`. Cero de `supabase/`. Cero fichas `normas/*.yaml`.**
Ninguna de las dos rutinas pudo salir a la red (egress bloqueado en el
contenedor), así que ni siquiera traen dato nuevo del dominio: registran el
intento fallido.

Consecuencias directas para tu auditoría, y son de método:

1. **Lo que leas hoy es, línea por línea, el mismo árbol que la ronda 30
   calificó.** Si reportas un hallazgo NUEVO, es algo que la 30 no vio, no algo
   que la ventana rompió. Dilo así.
2. **Ningún hallazgo abierto pudo cerrarse por código.** Verifica igual: la
   forma correcta de gastar el arranque de tu turno es abrir tus hallazgos
   abiertos de la 30 y confirmar, con `archivo:línea`, si siguen ahí. Si alguno
   ya no está, es que estaba mal reportado, y eso es un hallazgo en sí.
3. **Tienes la ronda entera para profundidad en vez de para cobertura del
   diff.** No hay diff que cubrir.

## Cómo se decide tu nota (léelo completo)

Tu nota la decide **el código que leas hoy**, con las anclas 0–10 de tu sección
de rubro y nada más. No hay una dirección esperada, ni un movimiento correcto.
Que suba, que baje o que se quede son los tres resultados igual de válidos, y
ninguno de los tres es el que este documento quiere.

Mover la nota exige una de las tres razones escritas de la skill (*se atacó y
subió* · *deuda que cobró factura* · *mirada más profunda*). **Sin una de las
tres, la nota se queda donde está** — y dado el punto anterior, «se atacó y
subió» es difícil de sostener esta ronda salvo que encuentres que un hallazgo
abierto estaba mal reportado desde el principio.

Un aviso de método, porque la serie histórica del proyecto va dando bandazos
(6.2 · 5.3 · 6.0 · 5.3 · 4.4 · 6.0 · 5.2): **ancla cada movimiento en algo
contable.** Un número que puedas medir y pegar —cuántas copias hay de un
predicado, cuántas mutaciones mueren, cuántas rutas sin la marca, cuántos
archivos de prueba corren en tu rubro— vale más que un párrafo de juicio, y es
lo único que permite distinguir mañana una medición de una impresión.

## Dónde está todo

Repo `javiercamarapp/cuadra` (el producto se llama **Likida**), Next.js + React
+ TypeScript sobre Supabase/Postgres. Inventario de hoy, contado:

- **1,774** archivos `.ts`/`.tsx` en `src/`, de los cuales **954** son `*.test.ts*`.
- **333** migraciones en `supabase/migrations/`, de la `0001` a la **`0356`**.
- `normas/*.yaml` — fichas normativas (fuente de verdad fiscal/legal).
- `docs/auditoria-30/` — la ronda anterior **completa**: tu archivo de rubro de
  la 30 es tu punto de partida obligado.

Los dos paneles, y no son el mismo producto:

- `/admin` — consola del superadmin (Javier). Cruza TODOS los tenants a
  propósito; `lib/admin/negocio.ts` es la única función con ese permiso.
- `/dashboard` — panel del CLIENTE (flota_admin, contador, encargado), ~31
  páginas, **todas filtradas al tenant**. Reusa los componentes de `/admin`.

Las reglas del producto que valen como criterio de auditoría (de `CLAUDE.md`):

- **Nunca inventar una cifra.** Sin dato real se dice qué falta y por qué
  (`dashboard/pendiente.tsx`, `EstadoVacio`); no se rellena con ceros que
  parezcan medición. Una estimación se muestra declarada y con su supuesto
  a la vista.
- **Un rótulo tiene que ser verdad.** Si dice «del periodo», la consulta filtra
  por fecha. Si hay un filtro en pantalla, mueve TODO lo que hay debajo.
- **El formato de cifras vive solo en `lib/formato.ts`** (hay prueba que falla
  si aparece `toLocaleString('es-MX')` en otro archivo).
- **Fallar cerrado y decirlo.** supabase-js reporta errores POR VALOR: sin
  comprobar `error`, una base caída se lee como «no hay nada». Ver `exigir()` y
  `traerTodo()` en `analytics.ts` (PostgREST recorta a 1,000 filas en silencio).

Trampas ya pisadas, para que no las reportes como hallazgo nuevo:

- `gasto.ocr_raw` está MUERTA; la prueba de OCR es `ocr_confianza`.
- La tabla `politica_gasto` está muerta: la política viva es
  `tenant.config.politica` vía `getConfig()`.
- `wa_mensaje_procesado` NO tiene `tenant_id`.
- `viaje.estatus` solo admite `abierto | en_cuadre | liquidado`.
- `cliente`, `unidad`, `tarifa`, `factura_emitida`, `pago_recibido`, `posicion`,
  `cotizacion`, `mantenimiento` y `ticket_mensaje` **ya tienen escritor**. Siguen
  sin escritor: `geocerca`, `terminal`, `portal_credencial`, `invitacion`, y las
  muertas `campania`/`envio_mensaje`. La base está en cero porque **no hay
  clientes todavía**, no por falta de código.
- `requireSessionTenant(destino)` pierde el query string; por eso existe
  `dashboard/sufijo.ts`.
- Las 33 tools declaran `properties: {}` **a propósito**: el modelo decide
  *cuándo*, nunca *con qué datos*. Proponer «validar mejor los argumentos» es no
  haber leído el código.

## Qué NO tocar / restricciones de la nube

- **NO edites ningún archivo del repo.** Tú encuentras y calificas; arreglar es
  de otra fase y de otro agente. Tu único archivo de salida es
  `docs/auditoria-31/<rubro>.md`.
- **NO corras `pruebas-manuales/*.prueba.ts`**: hacen llamadas reales de pago.
- **NO corras `npm run build`**: pide Supabase, OpenRouter, Facturapi y Upstash,
  que aquí no existen; su fallo no dice nada del código.
- **No hay red saliente, ni `.env`, ni base.** No hay producción que consultar:
  cualquier afirmación sobre el estado de producción tiene que salir de la API
  de GitHub o declararse como no verificada.
- Sí puedes leer, buscar, y correr en modo lectura `npm test` (o `npx vitest run
  <patrón>` para tu rubro), `npm run typecheck` y `npm run lint`.

## Compuerta de esta ronda (línea base, medida hoy)

Ver `docs/auditoria-31/00-SINTESIS.md` para la salida final. La línea base al
arrancar, sobre el árbol sin tocar, se corrió con `npm test`, `npm run
typecheck` y `npm run lint`; el resultado real se pega en la síntesis. Si tu
rubro depende de la compuerta, córrela tú y pega **tu** salida, no la cites.

## Las notas de la ronda 30 y de dónde vienes

| Rubro | Nota 30 | En una línea, por qué |
|---|---|---|
| Backend y API | 7 | La `0348` cerró los seis agregados que sumaban dinero de liquidaciones rechazadas, con test SQL que siembra el caso divergente. |
| Modelo de datos | 7 | 9 migraciones, 8 con prueba que hace divergir la versión vieja de la nueva, ninguna cambia firma. |
| Operabilidad y DX | 7 | Cobertura de publicación medida en 100 %; OP-C1 sigue abierto en su 4ª ronda. |
| Seguridad | 6 | Las 9 migraciones salieron limpias de escalada; `no-store` se aplicó ruta por ruta y quedaron 13 salidas 200 sin la marca. |
| Pruebas | 6 | Medido mutando: 14 de 34 mueren; sobre la cifra de dinero impresa, 0 de 11. |
| Frontend | 5 | 2 archivos de producción en 38 commits; los 5 hallazgos abiertos de la 29 siguen intactos. |
| Rendimiento y costo | 5 | La mitad reintentable de REN-C1 cerró con prueba; la suma del peor caso sigue en 331.2 s contra `maxDuration = 300`. |
| Tool calling | 5 | 0 de 8 abiertos cerrados; la suite del rubro dio 54 archivos / 339 pruebas, el número exacto de la 29. |
| Cumplimiento legal | 4 | 6 reincidentes intactos; un CRÍTICO nuevo por la coordenada del operador en texto. |
| Sistema agéntico | 4 | 5 reincidentes intactos línea por línea; el CRÍTICO de `ingerirRep` sí quedó cerrado. |
| Arquitectura | 3 | El predicado del 15 % se contó y salieron seis copias; ARQ-C1 en su 8ª aparición. |
| Cumplimiento fiscal | 3 | El cotejo contra la clave del SAT corre después de la escritura que vigila; `actualizarFacilidad15` tiene dos llamadores más y los dos son del cliente. |

**Global 30: 5.2** (media de los 12).

**Tus hallazgos abiertos están en `docs/auditoria-30/<tu-rubro>.md`.** Ábrelo
antes de empezar: es tu lista de reincidentes a verificar. Los tres arreglos que
la 30 sí commiteó —y que por tanto **no** debes reportar como abiertos— son
`7d5bcdc` (AG-C1), `b740fe0` (ARQ-C2) y `7a9b087` (el guardia TS↔SQL del cubo
del 15 %). Verifícalos si te tocan: la 30 los declaró cerrados con prueba.

> **CORRECCIÓN escrita al cerrar la 31 (el auditor de arquitectura lo cazó y
> tenía razón): esos tres shas NO EXISTEN en este repo.** `git cat-file -t` da
> `Not a valid object name` en los tres: el PR de la 30 entró **aplastado** en
> `5ce91b2`, así que los shas de su rama murieron con el merge. Yo los copié del
> `RESULTADO.md` de la 30 sin comprobarlos. Los arreglos **sí** están en el
> código y se verificaron ahí (`ciclo.ts:342-357` para AG-C1;
> `fiscal_agregado_15pct.test.ts:53-63` para el guardia). **Para la 32: una
> ronda no debe citar shas de su propia rama como evidencia — cita
> `archivo:línea`, que es lo único que sobrevive al squash.**
