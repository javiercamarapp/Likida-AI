COMPLETA: los 12 rubros auditados, 1 arreglo retenido con prueba, 1 revertido por la suite, global 5.2 → 4.8.
CONTINUACIÓN (14-sep-2026): 2 rubros reauditados, 4 arreglos retenidos con prueba, 0 revertidos, global 4.8 → 4.8 (=).

---

# Ronda del 13-sep-2026 — COMPLETA

- **Tipo:** ronda **COMPLETA**, decidida antes de gastar un token en auditores:
  `list_pull_requests(open)` → **`[]`, cero PRs abiertos** (el de la 30 está
  mergeado en `5ce91b2`), y `git log 5ce91b2..HEAD -- src/ supabase/ normas/` →
  **2 commits** → hubo commits en las rutas que la regla vigila. Rama nueva
  `claude/auditoria-31` sobre `4047a50`. Árbol limpio → autofix habilitado.
- **La ventana NO trajo código.** Los 2 commits tocan exactamente dos rutas,
  `normas/.latido-cuota-diesel` y `normas/.latido-vigilancia`, los dos dotfiles
  de bitácora, los dos registrando que la rutina no pudo salir a la red. Cero
  líneas de `src/`, cero de `supabase/`. El árbol es byte por byte el que la 30
  calificó con 5.2.
- **Los 12 entregaron**, ninguno relanzado, ninguno vacío. **148 hallazgos · 13
  críticos · 89 reincidentes.**
- **Global: 4.8** (antes **5.2**) · **▼ 0.4**. Bajan 5, sube 1 (arquitectura), se
  quedan **6**.
- **El resultado metodológico, que es el producto de esta ronda.** La 30 cerró
  con una acción escrita: que el MAPA de la 31 no sugiriera ninguna dirección
  para las notas, porque el suyo dijo que bajar era «válido y esperado» y nueve
  bajaron citando esa razón. Se cumplió, y con el código congelado el contraste
  es limpio: **notas que no se movieron, 1 de 12 en la 30 → 6 de 12 hoy**, seis
  de ellas escribiendo sin ponerse de acuerdo alguna forma de «ninguna de las
  tres razones aplica». Buena parte del bandazo de las rondas 28-30 era el
  encargo, no el código. No está resuelto: sigue habiendo ▼0.4 con cero líneas
  cambiadas. **Acción para la 32:** MAPA neutral ya como default, y todo
  movimiento con un número contable detrás.
- **El hallazgo que urge, verificado con comando y notificado en el momento:**
  los dos arreglos de la ronda 30 —`cuadre/desde_db.ts` (ARQ-C2, el cubo del
  15 %: $90,600 impresos contra $95,300 correctos) y `sat_descarga/ciclo.ts`
  (AG-C1)— están en `master` y **no en producción**. El merge `5ce91b2` no llevó
  `[deploy]` en el asunto; el último con bandera es `cfa00ab`, del 10-sep. El
  pulso de salud sale **verde** igual porque mide «¿aterrizó lo último que se
  pidió publicar?», no «¿producción está al día?». Se arregla con Redeploy en
  Vercel o un commit con `[deploy]` en la primera línea.
- **Arreglado: 1** (`fd66be6`, PRU-31-C2). **Revertido: 1** (AG-31-A1, la suite
  lo rechazó con razón). **Pendientes con razón escrita: 9.**
- **Compuerta al cerrar:** `npm test` **984 archivos / 12,939 pasan / 6 saltadas
  / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154 avisos ·
  `lint:ratchet` 0 nuevos. `npm run build` no corre en la nube.
- **Tablero:** `tablero.html` + `tablero.png`, capturado **y mirado**.

---

# Continuación del 14-sep-2026

- **Tipo:** ronda de **CONTINUACIÓN**, decidida antes de gastar un token en
  auditores: `list_pull_requests(open)` → **PR #462 abierto** (rama
  `claude/auditoria-31`), así que se continúa sobre él y **no se abre un PR
  nuevo**. `git log 4e36c82..HEAD -- src/ supabase/ normas/` → los 3 commits que
  devuelve ya están dentro de la 31; **`origin/master` sigue en `4047a50`**.
- **Auditores relanzados: 2 de 12, y por la regla.** Los 12 archivos de rubro
  existen y el código de master no se movió, así que la regla de continuación
  daba **cero** relanzamientos. Los dos que corrieron —**rendimiento** y
  **operabilidad**— son los únicos cuyo código cambió, y cambió por los arreglos
  de esta misma continuación. Escribieron `<rubro>-continuacion.md`; los archivos
  de la 31 se conservan intactos para poder leer el delta.
- **Global: 4.8** (la de la 31: **4.8**) · **= 0.0**. Ninguna de las 12 se movió.
  Los 10 no auditados conservan su nota y van marcados `no auditado esta ronda`.
- **Arreglado: 4**, en 4 commits atómicos, cada uno con prueba que lo reproduce,
  rojo medido → verde, y **mutación verificada en los dos sentidos**:
  - `f4fde69` — **REN-31-C1 (CRÍTICO)**: el cron de emergencias reservaba 15 s
    para una unidad de 91.5 s y quemaba el claim de escalación antes del
    WhatsApp; un nivel 4 que moría ahí no volvía al barrido nunca. Margen
    derivado + la única consulta sin techo de la cadena, acotada.
  - `54bddb2` — **REN-30-C1 (CRÍTICO reincidente)**: el «Ejecutar ahora» de
    Peajes, 914 s nominales contra un techo de 300, ahora corre con reloj y
    declara `cortadosPorReloj`.
  - `30e5e14` — **OP-A6 (ALTO)**: el pulso de producción detecta y nombra el
    código de `src/`/`supabase/` que está en master y no en producción.
  - `065f699` — **REN-31C-C1 (CRÍTICO)**: **regresión que creó `54bddb2`** y que
    encontró el auditor al reauditar — el acuse decía «No había nada pendiente
    que barrer» sobre una cola de 1,000 que el reloj cortó, y la bitácora la
    archivaba como `ok`. Prueba de render sobre el componente real.
- **Revertido: 0.** La suite terminó verde en los cuatro.
- **Lo que los auditores dijeron de mis propios arreglos, y es el producto de la
  ronda:** `f4fde69` **cierra a medias** (el techo sigue en 130.2 s contra 120
  porque `venceEn` se ancla después de `leerInterruptor`); `54bddb2` **no
  cierra** (el prólogo de hasta 100 páginas de `gasto` corre antes del único
  chequeo de reloj); `30e5e14` **no cierra: lo mueve de sitio** (el `::warning::`
  no escribe en `$GITHUB_STEP_SUMMARY`, no abre issue y no manda correo — las 14
  corridas verdes habrían mandado **cero** notificaciones). Los tres quedan
  abiertos con su parte restante escrita. Un arreglo que no mueve el ancla del
  rubro no mueve la nota, y por eso la global no se movió con cuatro arreglos
  retenidos.
- **La nota que NO subí y por qué lo digo:** REN-31C-C1, una de las dos razones
  por las que rendimiento se quedó en 4, se cerró **después** de que el auditor
  entregara. Subirle el punto sería calificar mi propio arreglo con el auditor ya
  ido. La otra razón (gps 314.0/300 y descarga-sat 323.5/300, medidos) sostiene
  el 4 por sí sola.
- **Lo que urge y no es código, segundo día consecutivo:** el arreglo fiscal de
  la 30 sigue en `master` y **no en producción** (último `[deploy]` en asunto:
  `cfa00ab`, del 10-sep). **14** corridas verdes del pulso sobre ese estado.
  Redeploy en Vercel, o un commit con la bandera en la primera línea.
- **Lo que no se pudo reproducir y por eso NO se arregló:** **ARQ-A3** (CRÍTICO,
  el dedup del ejercicio que regala cupo del 15 %) vive en una función SQL y este
  contenedor no tiene servidor de Postgres corriendo. Lead para la 32: hay
  binarios de PostgreSQL 16 en la imagen y el PR corre un job «Migraciones +
  aislamiento (Postgres efímero)» que sí ejecuta `supabase/tests/`.
- **Reverificados por el orquestador, abiertos e idénticos:** ARQ-C1 (9ª
  aparición, `poliza/route.ts:363-367`) y FE-C1 (6ª ronda, `visibilidad.ts:41` +
  `forma-viaje.tsx:90`).
- **Compuerta al cerrar:** `npm test` **986 archivos / 12,958 pasan / 6 saltadas
  / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154 avisos ·
  `lint:ratchet` 0 nuevos. Línea base al arrancar idéntica al cierre de la 31
  (984 / 12,939), que es lo que confirma que el árbol no se había movido.
- **Tablero:** `tablero-continuacion.html` + `tablero-continuacion.png`,
  capturado **y mirado** — mirarlo encontró dos defectos que medir no encontró
  (el punto de la 29 caía fuera del `viewBox` y no se dibujaba; la etiqueta final
  salía cortada). Corregidos y recapturado. Verificado en la imagen: 12 rubros,
  suma 57, global 4.8.
- **INFRA:** el clon no traía `node_modules` (`npm ci`, exit 0); no hay `gh` en
  la imagen, todo lo de GitHub salió del MCP; sin red saliente, nada se consultó
  contra `app.likida.ai`; `docs/auditoria-*/` está en `.gitignore:36` y se
  commitea con `git add -f`.
