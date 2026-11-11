# Runbook de conexión al sistema de transporte de la flota (solo lectura)

Estado: **procedimiento escrito; no se ha conectado ninguna flota real.** Hoy no existe credencial ni documentación de la API de ninguna flota (BLOQUEO EXTERNO: ver `docs/operacion/conexion-tms-red.md` para la red). Este documento dice qué pedir, cómo capturar, probar, desactivar y revertir. Se refiere siempre al «sistema de la flota»; no lleva nombres de personas ni de empresas.

Ficha del catálogo: `tms_api_lectura` (`src/lib/likida/conectores/erp.ts`). Solo lectura: Likida no escribe nada en el sistema de la flota.

## 1. Qué se le pide al área de sistemas de la flota

### 1.1 Lo que pide la ficha (se genera del catálogo)

El bloque siguiente es copia exacta de `loQuePedirle(['tms_api_lectura'])`. Una prueba (`ficha.test.ts`) lo compara con la función: si cambian los campos de la ficha y no este bloque, la prueba falla.

<!-- BEGIN:lo-que-pedirle -->
```text
La API de lectura de tu sistema de transporte:
  · Dirección de la API de tu sistema de transporte. La que te da tu área de sistemas. Tiene la forma https://api.tuempresa.com — sin la ruta del login.
  · Usuario de servicio. Una cuenta de servicio de solo lectura creada para Likida. No uses el correo ni el usuario de una persona.
  · Contraseña de la cuenta de servicio [SECRETO — mándalo por un canal seguro, no por chat]. La de esa cuenta de servicio. Se guarda cifrada y no se vuelve a mostrar.
  · Ruta del inicio de sesión (opcional). Déjala vacía si no te dieron una. Por omisión se usa /api/login.
  · Ambiente (opcional). Escribe prueba o produccion. Conviene empezar por el ambiente de prueba si tu equipo de sistemas lo tiene.
```
<!-- END:lo-que-pedirle -->

Los campos marcados **[SECRETO]** nunca se mandan por WhatsApp ni se pegan en un correo; se entregan por un canal seguro y se capturan directo en el panel (sección 2).

### 1.2 Lo que la ficha no cubre y hay que pedir por escrito

1. **Documentación del inicio de sesión y de cada recurso** que se va a leer (liquidaciones, peajes por fechas, viajes e hitos, posiciones): ruta, método, parámetros, forma de la respuesta y un ejemplo de respuesta con datos de prueba.
2. **Cuenta de servicio de SOLO lectura**, creada para Likida, **sin correo personal** y sin permisos de escritura.
3. **Ambiente de prueba** separado del de producción (se empieza siempre por él).
4. **Límites de tasa:** peticiones por minuto permitidas, tamaño máximo de página y si hay ventana de mantenimiento.
5. **Zona horaria de las fechas** que devuelve la API (con y sin zona explícita). Por defecto Likida interpreta fechas sin zona como `America/Mexico_City` y guarda UTC; si la API usa otra, se declara en el mapeo.
6. **Semántica de `Icident`:** si identifica un viaje completo, un tramo o un tracto-día, y si se repite entre días. Mientras no se confirme, Likida lo guarda como `despacho_ref` sin exigir unicidad estricta.
7. **Qué devuelve ante token vencido o inválido** (código y cuerpo) y cuánto dura un token, para que el re-login no confunda un vencimiento con una credencial mala.
8. **Cómo se marca «consumido»:** si existe un campo de consumo y **quién lo escribe** (el sistema de la flota o Likida). Hasta que se defina, Likida es idempotente por su cuenta (huella por registro) y **no escribe** nada de vuelta.
9. **Red:** si el sistema está detrás de un firewall o Zero Trust, qué IP de salida hay que autorizar. Ver `conexion-tms-red.md` (opciones y costos; la decisión y el gasto son de la persona responsable de Likida).

## 2. Cómo se da de alta la credencial

1. Entrar a `/dashboard/conexiones` con un usuario administrador de la flota.
2. Elegir la ficha «API de tu sistema de transporte» (`tms_api_lectura`).
3. Capturar dirección, usuario de servicio, contraseña y, si se dieron, ruta de login y ambiente (**empezar con `prueba`**).
4. Guardar. La contraseña se cifra por flota; **el panel no la vuelve a mostrar** ni la devuelve en ninguna respuesta. Para cambiarla se captura de nuevo.
5. No hay otra vía: no se pega en chat, correo, tickets ni commits. Si una credencial se pegó en algún chat, se considera expuesta: pedir su revocación y emitir otra.

## 3. Cómo se prueba

1. En la misma ficha, «Probar conexión». Hace **un login y una lectura de bajo costo**; no escribe nada.
2. Lectura del veredicto:
   - **sirve:** login y lectura respondieron bien.
   - **no sirve:** credencial rechazada (401) o acceso negado por IP (403, «probable lista de IP permitidas»).
   - **no se sabe:** no se pudo comprobar (DNS, tiempo agotado, servidor que rechaza la conexión, redirección, página de acceso web en vez de la API, 5xx). **Esto no significa que la credencial sea mala.**
3. Si sale «no se sabe» por red: es un tema de red, no de la cuenta. Seguir `conexion-tms-red.md`.
4. El detalle del resultado nunca contiene la contraseña, el usuario ni el token.
5. Solo con la prueba en **sirve** en `prueba` se pasa a `produccion` (se captura otra credencial/ambiente y se repite la prueba).

## 4. Cómo se desactiva (cortar el acceso)

1. En `/dashboard/conexiones`, «Desactivar» sobre la ficha. Internamente llama a `desactivarCredencial`: marca la credencial inactiva **y sobrescribe el valor cifrado con un marcador de revocación**, de modo que no se puede volver a abrir aunque la llave del cofre se filtrara después.
2. Reactivar es **capturar de nuevo** la credencial; no hay forma de «deshacer» la desactivación.
3. Si el sistema de la flota también debe revocar la cuenta de servicio, se le pide a su área de sistemas por separado; desactivar en Likida no la elimina allá.

## 5. Cómo se revierte la conexión completa

En este orden, parando primero lo que lee:

1. **Apagar la lectura periódica para esa flota.** El sincronizador del conector (tarea T-TMS-12, que se construye después de esta) debe quedar sin credencial activa y sin mapeo activo para la flota; con eso no lee. Si al momento de revertir el cron ya existe y corre, se excluye a la flota de su lista antes de continuar. *Hoy el cron `tms` solo tiene el interruptor `global`; no existe un interruptor por flota (auditoría 37, A37-TRANSVERSAL-08: pendiente, exige ampliar el CHECK de `interruptor_tenant` y la pantalla de /admin). Mientras tanto, para detener UNA flota sin perder su credencial: desactiva su mapeo en `tms_mapeo` (`activo=false`).* Desde A37-TRANSVERSAL-08 el turno ROTA (va primero la flota con la lectura exitosa más antigua) y el cron avisa al operador (`cron.tms.flota_atrasada`) si una flota se queda sin turno y lleva más de 2 h sin una lectura exitosa.
2. **Desactivar la credencial** (sección 4).
3. **Desactivar el mapeo activo:** en la tabla `tms_mapeo` poner `activo = false` en la fila activa de cada recurso de la flota (las versiones se conservan como historia; no se borran filas). Se hace con un script del servidor, no con el panel.
4. **Estado de lectura:** `tms_sincronizacion` (cursor y última lectura por recurso) y `tms_ingesta` (huellas de lo ya visto) **se conservan**: así una reconexión posterior reanuda sin duplicar. Solo se vacían por orden expresa y respaldo previo.
5. **Datos ya importados** (viajes, peajes, liquidaciones con origen `tms`): no se borran al revertir. Si hubiera que retirarlos, es una tarea aparte con respaldo y autorización; la reversión del conector no toca datos de negocio.
6. Registrar en la bitácora de la operación la fecha, quién ordenó la reversión y por qué.

## 6. Qué NO hace este conector

- No escribe en el sistema de la flota, ni siquiera el campo de «consumido».
- No usa cuentas personales.
- No se prueba contra producción primero.
- No publica credenciales ni respuestas crudas en bitácoras: los errores son frases propias.

## 7. Contrato del adaptador (F4: listo para conectar; todo SUPUESTO)

Estado: **ninguna parte de este contrato está confirmada por el cliente.** Existe para que, el día que llegue su especificación, conectar sea corregir un archivo y no escribir código. El modo API viene **apagado**.

> **Verificado en la ronda 7 (por lectura del código):** `crearAdaptadorTms` (`contrato.ts`) NO tiene hoy ningún llamador de producción: solo lo usan `contrato_openapi.ts` (que deriva el OpenAPI de abajo) y sus pruebas. Lo que lee el cron `tms` y el pull de desgloses es otra cosa: la tabla `tms_mapeo`, la función `loginDe` y `CONFIG_API_DESGLOSE`. El procedimiento real para el día que llegue la especificación es la **sección 8**; esta sección 7 describe el adaptador F4 (listo y probado, sin cablear).

**Un solo archivo de contrato:** `src/lib/likida/conectores/tms/contrato.supuesto.json` (login y token, detección de sesión caída, paginación por recurso, fecha de corte, modos api/archivos/push, texto) más los mapeos JSON que nombra (`mapeos/viajes|peajes|posiciones|liquidaciones.supuesto.json`: rutas, nombres de campo y formatos de fecha). `contrato.ts` lo valida (falla cerrado con el motivo) y arma `crearAdaptadorTms(contrato, { http, base, credenciales })`. La URL base y las credenciales NO viven en el contrato: salen del cofre por flota.

**Qué cubre el adaptador (probado con dobles en `contrato.test.ts`, 0 red):**

| Tema | Comportamiento |
| --- | --- |
| Login | un POST de login; el token vive solo en memoria; las demás peticiones son GET |
| Sesión caída | 401, o 200 con HTML de login, o 200 con JSON «token expirado»: UN re-login (compartido) y UN reintento; si falla de nuevo, se detiene como «credencial» |
| Paginación | por página, cursor u offset según el contrato; fusible con punto de reanudación |
| Orden inestable | filas repetidas entre páginas se dejan una vez (clave); `huella` distingue nueva / omitida / actualizada, sin depender del orden |
| 429 | espera `Retry-After` (tope 30 s), hasta 3 reintentos; no provoca re-login |
| Mojibake | `Ã³` se repara a `ó` en respuestas, archivos y lotes push (solo si toda la cadena vuelve a ser UTF-8 válido). Límite: un origen que serialice con escapes (`\u00c3\u00b3`) no se detecta ni se repara; se vería en los datos al probar con el servicio real |
| Fecha de corte | la ventana se recorta al corte; lo anterior que el origen mande de más se descarta y se cuenta; sin corte, se avisa |
| Modo archivos | apagado por omisión (como los demás modos) hasta que el cliente confirme; exportaciones CSV/JSON por los MISMOS mapeos y lectores (`entradasDeArchivos` + `sesionDeExportaciones`) |
| Modo push | lote firmado (HMAC-SHA256 de `marca.llave.cuerpo`, con la llave de idempotencia firmada), marca anti-repetición, llave de idempotencia, tamaño máximo, mismo mapeo y corte. Apagado y **sin endpoint publicado**: solo la lógica de recepción |

**OpenAPI del contrato:** `docs/operacion/conexion-tms-openapi.json` (OpenAPI 3.1, cada operación con `x-supuesto: true`) se DERIVA del contrato con `contrato_openapi.ts`; una prueba exige que coincida. Se entrega al cliente para que lo corrija. No hay ruta HTTP: cada `route.ts` nuevo obliga a revisión en el inventario de rutas, y este documento no lo justifica.

**Regenerar el OpenAPI** tras tocar el contrato o un mapeo: `TMS_OPENAPI_ACTUALIZAR=1 npx vitest run src/lib/likida/conectores/tms/contrato_openapi.test.ts` y revisar el diff.

**Cuando llegue la especificación real:** corregir `contrato.supuesto.json` y los mapeos, cambiar `estado` a `CONFIRMADO` solo con evidencia, correr la suite de contrato contra el servicio de prueba y recién entonces encender el modo API (decisión de la persona responsable). Migraciones: este cambio no necesita ninguna (el rango 0985-0989 está reservado a F5 «cofre v2»; este cambio no lo toca).

## 8. Al recibir el API: procedimiento exacto (R7)

Todo lo de abajo SOLO LEE del sistema de la flota. Cada nombre fue verificado contra el código en la ronda 7.

### 8.1 Dónde vive cada pieza de la forma del API (qué se edita)

| Pieza | Dónde está | Qué es |
|---|---|---|
| Credencial (dirección, usuario, clave, ruta de login, ambiente) | `/dashboard/conexiones`, ficha `tms_api_lectura` | Dato por flota, cifrado. «Probar conexión» hace login + una lectura (`RUTA_PRUEBA_LECTURA` de `tms/ficha.ts`). |
| Forma del login (cuerpo, dónde viene el token) | `loginDe` en `src/lib/likida/conectores/tms/acceso.ts` (lo usan el sincronizador y el lector de desgloses) y `probarTmsApiLectura`/`extraerToken` en `tms/ficha.ts` (solo la prueba de la ficha) | **Código**, no dato: si el login real difiere (otros nombres de campo, token en otra ruta), se corrigen esos dos sitios. No es el transporte (`SesionTms` no cambia). |
| viajes, peajes, posiciones | tabla `tms_mapeo` (fila por flota y recurso: `tenant_id`, `recurso`, `mapeo` jsonb, `version`, `activo`) | Dato. Punto de partida: `src/lib/likida/conectores/tms/mapeos/{viajes,peajes,posiciones}.supuesto.json`. |
| liquidaciones (nómina) | `tms_mapeo` con `recurso = 'liquidaciones'`; el `mapeo` es `{ "nomina": {…}, "operadores": {…}, "conceptos": {…} }` | Dato. Punto de partida: `mapeos/liquidaciones.supuesto.json`. |
| Desgloses por bitácora (pull del cron `liquidaciones-externas`) | `CONFIG_API_DESGLOSE` en `src/lib/likida/liquidacion_externa/desglose_tms_supuesto.ts` | **Código global** (no por flota): ruta, parámetros, `rutaItems`, `campoCursor` y el `mapeo` de campos. Cambiarlo es un cambio de código y un deploy. |
| Desgloses por CONSULTA con el contrato `muestra-tms` (r13p) | Variables de plataforma `LIKIDA_TMS_DESGLOSE_CONTRATO`, `LIKIDA_TMS_DESGLOSE_CONFIG` y `LIKIDA_TMS_MUESTRA`; valores por omisión (SUPUESTOS) en `liquidacion_externa/desglose_muestra_pull_config.ts` | **Configuración**, no código (un redeploy). Ver 8.7. |
| Entrega por empuje (`muestra-tms`) | `desglose_muestra_tms.ts` y `desglose_muestra_recepcion.ts` | Código; apagado por omisión (8.6). |

El texto de las secciones 1–7 sigue valiendo para pedir datos, credencial, prueba, desactivación y reversión.

### 8.2 Pasos

1. **Credencial en `prueba`.** `/dashboard/conexiones` → ficha `tms_api_lectura` → ambiente `prueba` → «Probar conexión». Debe salir «sirve» (sección 3). Sin credencial probada y sin error, el cron no lee nada.
2. **Corregir el login si hace falta** (8.1) y correr `npx vitest run src/lib/likida/conectores/tms/ficha.test.ts src/lib/likida/conectores/tms/sesion.test.ts`.
3. **Armar el archivo de mapeos** FUERA del repo (p. ej. `/ruta/mapeos.json`), copiando los `*.supuesto.json` y editando rutas y nombres de campo según la especificación:
   `{ "viajes": {…}, "peajes": {…}, "posiciones": {…}, "liquidaciones": { "nomina": {…}, "operadores": {…}, "conceptos": {…} } }`. Reglas del mapeo: `validarMapeo` en `tms/mapeo.ts` (ruta con «/» inicial, `raiz`, `campos`, `clave_externa`, `obligatorios`; transformaciones `numero`, `fecha_local`, `texto`, `booleano`). Un importe en texto con un solo separador de tres dígitos («1.234» o «1,234») es ambiguo: se declara `"decimal": "."` o `","` en el campo.
4. **Archivo de credenciales de prueba** fuera del repo, modo 600, líneas `clave=valor`: `base_url`, `usuario`, `clave` y, si aplica, `ruta_login`.
5. **Prueba en seco** (lee a lo más 20 registros por mapeo, UNA página de los últimos 2 días; no escribe nada; no imprime valores):

   ```bash
   TMS_CREDENCIALES_ARCHIVO=/ruta/.env.tms node scripts/tms/verificar-local.mjs --en-seco /ruta/mapeos.json --desgloses
   ```

   Sin `--desgloses` no se prueba la lectura de desgloses por bitácora (8.1). Sin credenciales reales, el ensayo contra el servidor sintético es `node scripts/tms/verificar-local.mjs --en-seco --falso`. La misma prueba existe como función de servidor: `pruebaEnSecoDeFlota(tenantId, { borrador })` en `tms/prueba_en_seco.ts` (usa la credencial del cofre de la flota; sin `borrador` prueba el mapeo activo de `tms_mapeo`). **No está en la interfaz de conexiones:** no hay hoy ninguna pantalla donde se edite o se vea un mapeo, así que agregarla sería construir una superficie nueva; se corre por script.
6. **Leer el reporte** (código de salida 0 = limpio, 1 = pendientes, 2 = uso/credenciales). Por mapeo: `falta requerido «destino» (fuente «ruta»)` = esa ruta no vino en alguna fila (la fila no entra; nunca se rellena con ceros); `tipo no cuadra … AMBIGUO` = falta declarar `decimal`; `campos del origen que el mapeo no usa` = se ignoran, solo informativo; `opcionales ausentes` = pueden ser correctos; `el mapeo no pudo leer «campo»` (desgloses) = nombre de campo del contrato interno que no se pudo leer. Corregir el JSON (o `CONFIG_API_DESGLOSE`) y repetir hasta `RESULTADO: limpio`.
7. **Activar el mapeo de una flota.** Desde la ronda 10: `DATABASE_URL=… node scripts/tms/activar-mapeo.mjs --tenant <UUID> --recurso <r> --mapeo <json>` (ENSAYO por omisión: valida con `validarMapeo` y dice qué haría; `--aplicar` escribe; `--desactivar --recurso <r>|--todos` frena la lectura; contra una base no local exige `--produccion --confirmar <UUID>`; deja bitácora y respaldo del mapeo previo en `~/likida-respaldos/tms/`). Lo que sigue es lo que el script hace por dentro, en una sola transacción (una versión activa por flota y recurso; las anteriores quedan como historia). No es una migración:

   ```sql
   begin;
   update public.tms_mapeo set activo = false where tenant_id = '<tenant>' and recurso = '<recurso>' and activo;
   insert into public.tms_mapeo (tenant_id, recurso, mapeo, version, activo)
   values ('<tenant>', '<recurso>', '<json>'::jsonb,
           (select coalesce(max(version), 0) + 1 from public.tms_mapeo where tenant_id = '<tenant>' and recurso = '<recurso>'), true);
   commit;
   ```

   `<recurso>` es `viajes`, `peajes`, `posiciones` o `liquidaciones`. El `mapeo` debe pesar menos de 64 KiB (restricción de la tabla).
8. **Verificar.** El cron `tms` corre cada 10 minutos (`vercel.json`) y exige: interruptor `global` encendido, credencial activa, probada y sin error, y mapeo activo. Mirar: latido `tms` en `/admin/salud-sistema` (`ok` o `parcial`; en `parcial` leer `detalle` y el log `cron.tms.parcial`), filas de `tms_sincronizacion` de la flota (`ultimo_error` vacío, `ultima_ok_en` reciente) y que `credencialRechazada` sea falso. Cada recurso informa `leidas/nuevas/omitidas/rechazadas/pendientes` sin datos del cliente. Pasar de `prueba` a `produccion` solo con todo limpio en `prueba` (sección 3, punto 5).

### 8.3 Cómo apagar

- **Una flota, sin perder su credencial:** `update public.tms_mapeo set activo = false where tenant_id = '<tenant>' and activo;` (sección 5, punto 3). No existe interruptor por flota (A37-TRANSVERSAL-08).
- **Cortar el acceso:** «Desactivar» la ficha en `/dashboard/conexiones` (sección 4; para volver hay que recapturar).
- **Todo el sincronizador `tms`:** interruptor `global` de la tabla `interruptor` (también apaga los demás crons de agentes).
- **Pull de desgloses (cron `liquidaciones-externas`):** interruptor `agente:liquidacion` (el cron pregunta primero `global` y luego éste) o dejar apagado «Activar el envío» de la flota con canal `correo`; sin eso `lectoresDesglosesTms` no entrega la flota al pull.

### 8.4 Qué verificar contra la prueba en seco antes de confiar

La prueba usa los mismos `aplicarMapeo`, `aNumero`, `aFechaLocal` y `mapearBitacoraTms` que producción, así que lo que marca limpio es lo que producción acepta. No sustituye la revisión de una persona de las cifras (que una liquidación cuadre contra su PDF) ni cubre paginación completa, cursores, límites de tasa ni sesiones caídas (eso lo cubre la suite de `tms/*.test.ts` con servidores falsos).

### 8.5 Qué NO cubre este procedimiento

La especificación real no existe: login, rutas, paginación, zona horaria, semántica de `Icident` y campo de consumo siguen SUPUESTOS (sección 1.2). Ninguna flota real está conectada.

### 8.6 Entrega por empuje `muestra-tms` (`POST /v1/liquidaciones-externas/desgloses`)

Apagada por omisión y falla cerrado (403 sin explicar la causa). Se enciende con TODO esto: variable de plataforma `LIKIDA_TMS_MUESTRA=si` (un redeploy), interruptores `global` y `agente:liquidacion` encendidos, y que la flota tenga «Activar el envío» con canal `correo`. Topes: 100 bitácoras por petición, 100 renglones por bloque (Percepciones, Deducciones) y 2 MB de cuerpo. El tenant sale de la llave de API, nunca del cuerpo. Sin `Poliza` en la bitácora, lo que se recibe queda en `sin_poliza` (o provisional, según la perilla de la flota) y no se inventa una. Apagar: `LIKIDA_TMS_MUESTRA` distinta de `si` (redeploy) o el interruptor `agente:liquidacion`.

**Campos del piloto (11-nov-2026)**, todos opcionales y dentro de cada bitácora: `NumeroEmpleado` (manda sobre el nombre; si además viene `Operador` y no coincide con el del padrón ⇒ revisión `operador_no_coincide`), `TipoOperador` (`local`|`foraneo`|`permisionario`; el tipo va en cada bitácora, NO en el padrón), `Poliza` (texto ≤40 o null), `NumeroPago` (≤40, `[A-Za-z0-9._/-]`), `Neto` (≤2 decimales; si no cuadra con los renglones ⇒ `total_no_cuadra`) y `Folio` (el número que conoce el operador: se guarda en `liquidacion_desglose.folio_origen`, migración 1003, y se muestra en el Excel, el asunto del correo y el panel; no entra en la clave ni en la huella). `BitacoraID` admite entero o texto `[A-Za-z0-9._-]` ≤40 y sigue siendo la llave (`BIT-<id>`). Un valor inválido manda SOLO esa bitácora a revisión. **`NumeroLiquidacion` se ignora a propósito**: cablearlo cambia la clave a `LIQ-<n>` y el índice único del número por flota; si una liquidación junta varias bitácoras enviadas como objetos separados con el mismo número, la segunda caería en `correccion_pendiente`. Hasta confirmar 1 liquidación = 1 bitácora no se lee.

**Respuesta por bitácora y simulación.** La respuesta trae `resultados: [{ indice, bitacora, folio?, estado, motivos? }]` con `estado` = `recibida` | `retenida` | `idempotente` | `correccion_pendiente` | `en_revision` | `no_guardada` (entregada = las cuatro primeras; los campos anteriores no cambian). Con la cabecera `Likida-Simular: si` se valida y se responde lo mismo, más `simulada: true`, SIN escribir nada (ni liquidaciones, ni Excel, ni entregas, ni excepciones ni revisiones); un valor distinto de `si`/`no` es 400.

**Catálogo de conceptos (P0-3).** Es cerrado y vive en `CATALOGO_CONCEPTOS_MUESTRA` (`desglose_muestra_tms.ts`): ese es el punto único donde se agregan, con su caso en `desglose_muestra_tms.test.ts` (cambio de código + deploy). El catálogo real lo entrega el cliente; no se inventa. Alias por flota sin deploy (columna jsonb en `liquidacion_correo_config` + pantalla + migración) es tamaño M y no se hizo; `convertirBitacoraMuestra` ya acepta `conceptosAdicionales` para inyectarlos cuando exista.

### 8.7 Consulta (pull) con el contrato `muestra-tms` (r13p, 8-nov-2026)

Decisión del dueño: el cliente NO empuja; Likida CONSULTA su API (solo `GET`, cuenta de servicio; no existe ninguna escritura hacia el TMS). El mismo contrato `muestra-tms` de la ruta POST (`BitacoraID`, `Operador`, `Unidad`, `Fecha{Inicia,Termina}`, `Percepciones[]`, `Deducciones[]`) se lee ahora también por consulta: `conectores/tms/lector_muestra.ts` lo pone detrás del mismo puerto que el pull ya usaba, así que el cursor, la relectura, `recibirDesglose` (idempotencia por `BIT-<BitacoraID>`) y las guardas son las de siempre.

**Qué se configura (sin escribir código).** Apagado por omisión. Para encenderlo, en la plataforma:

| Variable | Valor | Efecto |
|---|---|---|
| `LIKIDA_TMS_DESGLOSE_CONTRATO` | `muestra-tms` (vacío o `supuesto` = el comportamiento de siempre) | Elige la forma de la respuesta. Un nombre desconocido deja el pull sin lectores. |
| `LIKIDA_TMS_MUESTRA` | `si` | La MISMA bandera que enciende la entrega por empuje (8.6). Además: interruptores `global` y `agente:liquidacion`, y la flota con «Activar el envío» + canal `correo` + credencial `tms_api_lectura` probada y sana. |
| `LIKIDA_TMS_DESGLOSE_CONFIG` | JSON con SOLO lo que difiere de los valores por omisión | Ver abajo. Llave desconocida o valor fuera de rango ⇒ ningún lector (falla cerrado; el aviso nombra la llave, nunca el valor). |

Llaves de `LIKIDA_TMS_DESGLOSE_CONFIG` y su valor por omisión (todos SUPUESTOS): `ruta` (`/api/liquidaciones`), `params` (`{desde:"desde",hasta:"hasta",pagina:"pagina",tam:"tam"}`; `pagina` y `tam` en `null` = el API no pagina), `tamano` (100), `envoltorio` (`auto`: arreglo directo o `{data:[…]}`; también `arreglo` y `envuelto`), `rutaLista` (`data`), `rutaTotalPaginas` y `rutaTotalRegistros` (`null`: si el API los trae y lo leído no coincide, NO se recibe nada), `campoCursor` (`Fecha.Termina`; o `Fecha.Inicia`), `formatoFechaParam` (`iso`; o `fecha_hora_mx` = `yyyy-MM-dd HH:mm:ss` y `fecha_mx`, ambas en hora de México), `maxPaginas` (50), `ventanaInicialDias` (2). Ejemplo: `{"ruta":"/v1/bitacoras","params":{"desde":"fechaInicio","hasta":"fechaFin","pagina":"page","tam":"size"},"envoltorio":"envuelto","rutaLista":"resultado.filas","rutaTotalPaginas":"resultado.paginas","formatoFechaParam":"fecha_hora_mx"}`.

**Qué hace y qué no.**
- Falla cerrado y lo dice: red, 5xx o 429 agotados ⇒ `TmsNoDisponible`/`TmsLimite`; 401 (tras UN re-login) o 403 ⇒ `TmsCredenciales` (la credencial se degrada una vez, como siempre); respuesta sin la lista configurada, página vacía antes del total, total que no cuadra o tope de páginas ⇒ error. En todos los casos la lectura devuelve NADA (no hay datos a medias) y el cursor no avanza.
- Nada se inventa. La muestra no trae póliza: lo leído queda en `sin_poliza` (no se envía) hasta que haya póliza. Tampoco trae nº de liquidación, nº de pago, terminal, nº de empleado ni tipo de operador (este último ⇒ `tipo_sin_regla`, retenido).
- Operador por NOMBRE contra el padrón de la flota (coincidencia exacta normalizada): ausente u homónimo ⇒ excepción `operador_no_encontrado` (motivo `nombre_sin_alta`/`nombre_ambiguo`, sin el nombre); se relee hasta 14 días atrás y se resuelve sola cuando el padrón se completa. Monto con más de 2 decimales, fecha ilegible, concepto desconocido o `BitacoraID` repetida con otro contenido ⇒ `mapeo_invalido` con el nombre del campo, jamás el valor.
- Las credenciales no aparecen en logs ni respuestas (token solo en memoria; los mensajes de error se redactan).

**Prueba en seco.** `node scripts/tms/verificar-local.mjs --en-seco --falso --muestra-tms` (ensayo sintético) o `TMS_CREDENCIALES_ARCHIVO=… LIKIDA_TMS_DESGLOSE_CONFIG='{…}' node scripts/tms/verificar-local.mjs --en-seco /ruta/mapeos.json --muestra-tms`. Pide UNA página, no escribe nada y reporta solo nombres de campo y conteos (el operador no se compara con el padrón en la prueba). En `opcionales ausentes` lista lo que el contrato no trae.

**Qué falta pedirle a sistemas del cliente (sin esto todo lo de arriba sigue siendo supuesto):**
1. URL de pruebas (base https) y, si el login no es `usuario`/`clave` → `token`, su forma real (`loginDe`, 8.1).
2. Ruta exacta del recurso y si es GET.
3. Nombres de los parámetros de fecha (¿filtran por inicio o por fin de la bitácora?) y su formato; si hay zona horaria distinta de la de México.
4. Paginación: parámetros, tamaño máximo, si trae total de páginas o de registros, y el envoltorio (¿arreglo directo o dentro de un objeto? ¿cuál campo?).
5. Póliza: en qué campo (hoy el contrato no la trae; sin ella nada se envía).
6. Nº de liquidación y nº de pago (hoy ausentes).
7. Tipo de operador (foráneo/local/…) por bitácora, y el nº de empleado junto al nombre (hoy se cruza solo por nombre).
8. Si una bitácora ya consumida cambia después (corrección) o es inmutable, y cómo se identifica una cancelada.
