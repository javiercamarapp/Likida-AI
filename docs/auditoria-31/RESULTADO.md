COMPLETA: los 12 rubros auditados, 1 arreglo retenido con prueba, 1 revertido por la suite, global 5.2 → 4.8.

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
- **Arreglado: 1**, commit atómico con prueba que lo reproduce y rojo→verde
  verificado:
  - `fd66be6` — **PRU-31-C2 (CRÍTICO)**: el tope de efectivo de la LISR 27-III
    que de verdad llega al motor no tenía ancla — la auditoría 24 ancló la
    constante de la rama que producción nunca toma. `2000 → 20000` pasaba **593
    pruebas** de `cuadre`+`config` en verde; con el tope movido, la banda de
    $2,000–$20,000 en efectivo se declara deducible y sale impresa en el PDF.
    Con la mutación mueren 4 de las 5 aserciones nuevas.
- **Revertido: 1.** **AG-31-A1 (ALTO)** — el PDF encolado que se reporta como no
  entregado. La prueba reprodujo el bug y el arreglo la puso verde, pero la suite
  completa lo rechazó **con razón**: un 400 de Meta sin `code` parseable da
  `codigo: undefined`, que `pdfEstadoDe` traduce a «encolado», y ese caso no se
  encola — el arreglo habría sellado como entregado un PDF perdido. Vuelve a
  pendiente.
- **Hallazgo nuevo salido de ese intento fallido, vivo hoy en producción:**
  `pdfEstadoDe` no puede distinguir «el catch de red encoló» de «un 400 sin
  código, que no encola», porque `client.ts:571` no devuelve `status`. El
  llamador que **ya** la usa (`processor.ts:1192`) sella la entrega y se calla.
  Propuesto, no tocado: arreglarlo cambia el contrato de `sendDocument`, que
  usan cuatro emisores.
- **Pendientes con razón escrita: 9.** Propuestos verificados: 2 nuevos
  (LEG-31-C1, REN-31-C1).
- **Falso encontrado, y es defecto del método:** los 3 shas que la 30 cita como
  sus arreglos (`7d5bcdc`, `b740fe0`, `7a9b087`) **no existen** — el PR entró
  aplastado en `5ce91b2`. Mi propio MAPA los propagó; lo cazó el auditor de
  arquitectura. Para la 32: citar `archivo:línea`, no shas de rama.
- **Compuerta al cerrar:** `npm test` **984 archivos / 12,939 pasan / 6 saltadas
  / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154 avisos ·
  `lint:ratchet` 0 nuevos. `npm run build` no corre en la nube.
- **Tablero:** `tablero.html` + `tablero.png`, capturado **y mirado** — mirarlo
  encontró que la primera captura salía truncada y cortaba la tabla de hallazgos;
  se recapturó. Verificado en la imagen: 12 rubros, suma 57, global 4.8.
- **INFRA:** el clon no traía `node_modules` (`npm ci`, exit 0); `docs/auditoria-*/`
  está en `.gitignore:36`, así que la ronda se commitea con `git add -f` o el PR
  sale vacío sin avisar; sin red saliente, nada se consultó contra
  `app.likida.ai`; Chromium vive en `/opt/pw-browsers/chromium`.
