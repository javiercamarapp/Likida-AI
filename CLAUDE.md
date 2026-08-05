# Likida (repo `cuadra`)

Liquidación de viajes de flotas de carga en México, por WhatsApp. El operador
manda comprobantes, un motor los cuadra contra el anticipo y la política, y
entrega la liquidación en PDF.

## Los dos paneles

- `/admin` — la consola de Javier (superadmin). Costo de IA, flotas, agentes.
  Cruza TODOS los tenants a propósito (`lib/admin/negocio.ts` es la única
  función con ese permiso).
- `/dashboard` — el panel del CLIENTE (flota_admin, contador, encargado). ~31
  páginas,
  todas filtradas al tenant. Reusa los componentes de `/admin` (`ui/kit`,
  `ui/graficas`, `charts`) — no hay una segunda librería de UI.

## Reglas que NO se rompen

**Nunca inventar una cifra.** Es la regla que define al producto: el contralor
va a cruzar lo que ve contra su PDF y su contador. Si no hay dato real:
- se dice qué falta y por qué (`dashboard/pendiente.tsx`, `EstadoVacio`),
- no se rellena con datos de ejemplo, ni con ceros que parezcan medición.
Una estimación se puede mostrar, pero declarada y con su supuesto a la vista
(ver `MINUTOS_CAPTURA_MANUAL` en `lib/cuadra/analytics.ts`).

**Un rótulo tiene que ser verdad.** Si dice "del periodo", la consulta filtra
por fecha. Si un filtro está en pantalla, mueve TODO lo que hay debajo.

**El formato de cifras vive solo en `lib/formato.ts`.** Hay una prueba que
falla si aparece `toLocaleString('es-MX')` en cualquier otro archivo. Una cifra
fiscal que se lee distinto en dos pantallas se lee como dos cálculos.

**Fallar cerrado y decirlo.** supabase-js reporta errores POR VALOR: sin
comprobar `error` explícitamente, una base caída se lee como "no hay nada", y
el panel afirma "aún no hay liquidaciones" estando ciego. Ver `exigir()` y
`traerTodo()` en `analytics.ts` (PostgREST recorta a 1,000 filas en silencio).

## Trampas ya pisadas (no volver a caer)

- `gasto.ocr_raw` está MUERTA — `repo.ts` escribe `ocr_confianza`/`ocr_extra`.
  La prueba de que algo pasó por OCR es `ocr_confianza`.
- `politica_gasto` (la tabla) está muerta. La política viva es
  `tenant.config.politica`, vía `getConfig()`.
- `wa_mensaje_procesado` NO tiene `tenant_id`: no se puede atribuir a una flota.
- `viaje.estatus` solo admite `abierto | en_cuadre | liquidado` (constraint
  `viaje_estatus_dominio`). `app_user.rol`: superadmin, flota_admin, contador,
  operador, encargado.
- `cliente`, `unidad`, `tarifa`, `factura_emitida`, `pago_recibido`, `posicion` y
  `geocerca` SÍ EXISTEN (migs. 0047-0050), y `viaje` tiene `km_recorridos` e
  `ingreso_flete`. Lo que pasa es que están VACÍAS: nadie las escribe todavía.
  Esa distinción importa — hasta el 4-ago-2026 esta línea decía "no existen", y
  eso le prohibía a cada agente nuevo construir sobre tablas ya aplicadas.
  Antes de usar cualquiera, mira si tiene filas; si no, la pantalla dice qué falta.
- `requireSessionTenant(destino)` arma su redirect a /login con un string fijo,
  así que **pierde el query string** — por eso existe `dashboard/sufijo.ts`.

## Cómo se verifica

1. `npx tsc --noEmit -p .` y `npx eslint src/` — limpios.
2. `npx vitest run` — ~2,880 pruebas (la cifra crece; no la cites de memoria).
3. **Mirar el render.** Medir no sustituye a mirar. Las páginas están detrás de
   sesión, así que para verlas: `npm run build` compila todas, y para un
   screenshot se levanta un preview temporal bajo `src/app/zzz-preview-*` que
   importe el componente REAL (nunca una copia — una copia verifica la copia),
   se borra al terminar. Chrome headless con `--force-prefers-reduced-motion`,
   si no el screenshot cae a mitad de la animación de count-up.

## Despliegue

**El push a `master` ya NO despliega solo.** Desde el 5-ago-2026, `vercel.json`
trae un `ignoreCommand` que construye únicamente si **el asunto** (la primera
línea) del commit lleva la bandera. Lee solo el asunto a propósito: leyendo el
mensaje completo, cualquier commit que *mencione* desplegar disparaba un build. Antes se redesplegaba producción en cada push: 30 builds en
12 horas, ~$26 USD/mes de puro build, casi todos publicando arreglos de auditoría
que no urgían.

- **Para publicar:** pon la bandera en la PRIMERA LÍNEA del commit, o usa
  **Redeploy** en el panel de Vercel sobre el último deployment.
- **Los pushes a GitHub no cambian.** La gráfica de contribuciones cuenta
  commits, no builds; puedes seguir subiendo a `master` todo el día.
- **El modo de falla es silencioso:** si olvidas la bandera, el push se ve
  normal en GitHub y el sitio se queda con la versión anterior sin avisar.
  Antes de enseñarle algo a alguien, confirma que el último deployment
  corresponda a tu último commit.

`NEXT_PUBLIC_APP_URL` debe ser `https://app.likida.ai`; si no coincide con el
Site URL de Supabase (Auth → URL Configuration), el login deja la cookie en otro
dominio y el usuario queda fuera de su propia cuenta.
