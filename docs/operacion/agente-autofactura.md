# Agente 6 — Autofactura: operación, candados y paso humano

Estado al 2-oct-2026. Cubre las migraciones **0540** (vinculación asistida), **0541** (cancelación de CFDI de Carta
Porte) y **0542** (control de la emisión real). Este archivo es al que apuntan `verificacion-portales.md`,
`scripts/verificar-portal.mjs` y `carta_porte_cancelacion.ts`.

> Regla que ordena todo lo de abajo: **emitir un CFDI por un portal es irreversible.** Cancelarlo cuesta y, fuera
> de plazo, se le queda al cliente en su contabilidad. Por eso cada llave falla cerrado: ante la duda, ensayo.

## 1. Qué hace el agente

Foto del ticket → OCR → cuadre → el gasto entra a la cola de «por facturar» → el cron
`/api/cron/facturar` (cada 15 min, `vercel.json`) agrupa los tickets **por flota y por portal** y los factura en
UNA sesión de navegador (`facturarLoteAlVuelo`, `src/lib/likida/facturacion/al_vuelo.ts`). Un UUID puede caer sobre
varios gastos (una factura de varias casetas): se distinguen por `cfdi_orden`.

Lo que la máquina no puede probar, no lo hace: confianza de OCR menor a 0.90, campo requerido ausente, portal
sin adaptador o que pide cuenta sin sesión vinculada, ticket vencido → el ticket queda en la pantalla y en la cola
del jefe, con el motivo.

## 2. Las llaves de la emisión real (todas deben estar abiertas; cualquiera cerrada = ensayo)

En modo **ensayo** el agente llena el portal y NO aprieta emitir. Es el default de todo.

| # | Llave | Quién la abre | Dónde vive |
|---|---|---|---|
| 1 | `FACTURACION_MODO=emitir` | Javier, en Vercel (CLI) | variable de entorno |
| 2 | `FACTURACION_MANDATO_ACEPTADO=si` (exactamente `si`) | Javier, el día que exista la cláusula legal publicada | variable de entorno (`modo.ts`) |
| 3 | Mandato **de la flota** vigente | el dueño de la flota, en `/dashboard/legal` | `aceptacion_legal` (0443), vía `mandatoFlotaVigente` |
| 4 | **Bandera de la flota** `emision_real` | el dueño (apagarla también puede el contador) | `autofactura_control` (0542), RPC `activar_emision_real`; exige además el mandato |
| 5 | **Portal verificado** | una corrida supervisada contra el portal real | `adaptadores/verificaciones.json`; ver `verificacion-portales.md` |
| 6 | **Fase del portal** | supervisada = una persona confirma cada lote; autónoma solo tras ≥ 3 emisiones reales con UUID y la decisión del dueño | `autofactura_portal_fase`, RPC `promover_portal_autonomo` |
| 7 | **Límites y cupo** | por flota, editables en el panel | `autofactura_control`: monto por ticket (1,500), tickets por lote (3), por día (10), monto por día (10,000) |

Notas:

- Las llaves 1 y 2 son globales; 3 a 7 son **por flota** (y 5 y 6, además, por portal). Una flota nunca emite con la
  bandera, el lote o el cupo de otra.
- La base arbitra lo que importa: el cupo diario se reserva **atómicamente** (`reservar_cupo_dia`; dos corridas no
  pueden gastar el mismo cupo) y el lote confirmado se **consume una sola vez** (`consumir_lote_confirmado`).
- Si la base del control no contesta (bandera, fase, cupo o lote), el resultado es **ensayo y se dice por qué**
  (`control_ilegible`). Nunca emitir a ciegas.
- Cada decisión y cada resultado deja bitácora (`autofactura.lote_propuesto`, `.emision_autorizada`, `.emitido`,
  `.emision_fallida`, `.vinculacion_*`), sin RFC, cookies ni contraseñas.

### La fase supervisada, paso a paso

1. El cron ve tickets listos de un portal en fase supervisada y **propone un lote** (`proponer_lote_emision`; un solo
   lote vivo por flota y portal; vence en 48 h). Los tickets quedan «esperando confirmación» y el portal NO se abre.
2. Una persona (dueño o contador) abre **/dashboard/agentes/facturas → Facturas en automático** y confirma o rechaza
   el lote (`decidir_lote_emision`; exige bandera encendida y mandato vigente).
3. En la corrida siguiente el cron consume el lote confirmado una vez y emite **solo lo que la persona vio**: un
   ticket que llegó después de confirmar no se cuela, espera su propia propuesta.
4. Con el UUID escrito se cuenta la emisión confirmada (`registrar_emision_portal`). A las 3, el dueño puede promover
   el portal a autónomo; puede devolverlo a supervisado cuando quiera.

### Qué pasa cuando algo sale mal (todo está en `al_vuelo.ts` y lo prueba el E2E)

- **Marca «emisión en curso»** (RES-10): antes de abrir el portal en modo emitir, los gastos del lote quedan
  bloqueados con ese motivo. Se levanta solo después de escribir el UUID, o tras un fallo limpio donde consta que no
  se apretó emitir. Si el proceso muere a media sesión la marca se queda: **una persona mira el portal antes de
  reintentar**.
- **«Se apretó emitir y no se pudo confirmar el folio»**: el ticket se bloquea y el cupo del día **se conserva** (el
  CFDI pudo existir). Revisar en el portal; si existe, usar «Ya quedó» con el folio; si no, desbloquear.
- **CAPTCHA o sesión vencida**: el ticket sale de la cola automática con su motivo, el cupo se devuelve y no se
  reintenta solo. La salida es vincular el portal (sección 3), no reintentar.
- **«El portal cambió»**: el roto es nuestro (el mapeo); la sesión sigue buena. Se corrige el guion y se vuelve a
  verificar el portal.
- **Claim del ticket**: cada corrida lo reclama con un UPDATE condicional (vive 10 min). Dos corridas solapadas del
  cron no pueden abrir el portal sobre el mismo ticket.

## 3. Vinculación asistida (0540): el paso humano del CAPTCHA o del código de dos pasos

Likida **no resuelve ni rodea** CAPTCHA ni MFA, y **no teclea la contraseña** del portal. Crear la sesión de un
portal con login pasa por una persona.

Flujo:

1. En **/dashboard/agentes/facturas** el dueño pulsa «Vincular con código» en el portal. Se crea una solicitud con un
   **código de un solo uso** (80 bits, `XXXX-XXXX-XXXX-XXXX`, vence en 15 min). El panel lo muestra **una vez**; en la
   base solo vive su SHA-256 (`portal_vinculacion_solicitud.codigo_hash`).
2. En una **computadora con pantalla** se corre `npx tsx scripts/vincular-portal.mjs --codigo XXXX-XXXX-XXXX-XXXX`
   (opcional `--url` o `LIKIDA_URL`). El script no lleva llaves de Likida: presenta el código a
   `POST /api/vinculacion-portal/reclamar`, que lo consume (una sola máquina lo gana) y devuelve **qué portal abrir**.
3. El script abre un Chromium **visible**; la persona entra y resuelve el reto. El script solo espera a que
   desaparezca la pantalla de entrar.
4. El script sube **solo las cookies de ese portal** (`POST /api/vinculacion-portal/completar`). El servidor las
   **vuelve a recortar** al dominio del portal (cookies de otros sitios no se guardan), las cifra en el cofre
   (AES-256-GCM, `LIKIDA_COFRE_LLAVE`), anota «vinculado» y cierra la solicitud.

Estados: `pendiente → reclamada → completada | fallida`; `pendiente | reclamada → expirada | cancelada`. **Una solicitud viva
por flota y portal.** Las rutas HTTP no llevan sesión de Likida: su única credencial es el código; el tenant y el
portal salen de la solicitud, nunca del cuerpo; hay límite de ritmo por IP y cuerpo acotado (200 KB). La purga de
solicitudes cerradas (90 días) corre dentro de `/api/cron/purgar`.

Caducidad: cuando el portal cierra la sesión, el cron `facturar` lo detecta (`invalidarVinculo` → «caducada»), el
tablero lo grita y el mismo botón la renueva.

### DECISIÓN PENDIENTE DE JAVIER: cómo llega el vinculador a quien lo corre

Hoy `scripts/vincular-portal.mjs` **vive en el repositorio**: quien lo corre necesita ese repositorio clonado, Node y
Chromium de Playwright (la pantalla del panel dice «en la carpeta de Likida»). Es un paso que hoy **opera el equipo de
Likida** con la persona del cliente al lado; el cliente no puede hacerlo solo desde su computadora.

Opciones (no se construyó ninguna, necesita decisión):

1. **Lo opera solo Likida** (video-llamada o visita): no se construye nada; se deja escrito así en la pantalla y en
   esta doc. Es lo que describe el estado actual.
2. **Paquete `npx`** publicado: el cliente corre un comando sin clonar. Requiere publicar un paquete (cuenta de npm,
   versionado, que el catálogo de portales viaje con él para que coincida con el servidor).
3. **Binario descargable desde el panel**: la mejor experiencia, el mayor costo (empaquetar Chromium, firma de
   binarios en macOS y Windows, actualizaciones).

Mientras no se decida, no prometer al cliente que se vincula solo.

## 4. Cancelación de CFDI (0541): de Carta Porte, NO de autofactura

La 0541 agrega la cancelación **por API del PAC (SW sapien)** de los CFDI **que Likida timbra** (Carta Porte,
`ccp_timbre`): `carta_porte_cancelacion.ts`. Los motivos son los del SAT (01 a 04; el 01 exige folio de
sustitución); un humano la pide, y la fila pasa a `solicitada` ANTES de llamar al PAC.

- Respuestas del PAC: 201 = en proceso (el CFDI sigue **vigente**, no libera el viaje); 202 = el SAT ya lo tenía
  cancelado (se confirma sola); rechazo explícito = `rechazada` (se puede volver a pedir); sin respuesta (red) =
  se queda en `solicitada`.
- **La consulta de estatus por API no está verificada contra SW real.** Por eso quien libera el viaje para
  re-timbrar es un **humano** que vio el acuse o el estatus «Cancelado» (`confirmarCancelacionTimbre`), con bitácora.
- **Lo emitido por un portal de tercero (autofactura) no tiene API de cancelación.** Lo cancela una persona, en el
  portal o con el contador; es una de las razones de la fase supervisada.

## 5. Control de la emisión real (0542): tablas y RPC

| Objeto | Para qué |
|---|---|
| `autofactura_control` | bandera ensayo→real y límites por flota (sin fila = ensayo, límites por omisión) |
| `autofactura_portal_fase` | fase por (flota, portal) y emisiones reales confirmadas con UUID |
| `autofactura_lote` | lotes propuestos/confirmados; consumo único |
| `autofactura_cupo_dia` | cupo diario reservado atómicamente |
| RPC | `activar_emision_real`, `apagar_emision_real`, `cambiar_limites_emision`, `registrar_emision_portal`, `promover_portal_autonomo`, `devolver_portal_a_supervisada`, `proponer_lote_emision`, `decidir_lote_emision`, `consumir_lote_confirmado`, `reservar_cupo_dia`, `liberar_cupo_dia`, `purgar_autofactura` |

Deny-all para `anon` y `authenticated`: todo entra por `service_role` vía RPC. Encender exige un `flota_admin` activo
de ESA flota y el mandato vigente; promover a autónomo, solo el dueño.

**Hallazgo abierto:** `purgar_autofactura(p_dias)` (retención de lotes cerrados y cupos viejos; mínimo 30 días) **no
la llama ningún cron todavía** (`/api/cron/purgar` solo llama a `purgar_vinculacion_portal`). No hay datos personales
en esas tablas y crecen una fila por día y flota, así que no urge; conectarla es una llamada más en `purgar` y subir
en uno el techo de `frontera_datos_guardiana.test.ts`.

## 6. Vigilante de portales (`/api/cron/portales-vivos`)

Lunes 06:40 UTC. Mide los portales del catálogo (los de muro anti-bot se excluyen a propósito) con un `fetch` que
se identifica como navegador. Cada roto se mide **dos veces**; un fallo de nuestro lado es «no medido», una SPA es
«sin confirmar»; **solo un portal roto y confirmado escala a correo**. Latido: `ok`, `parcial` (el reloj dejó
portales sin mirar), `saltado` (interruptor global apagado) o `fallo`. Contrato fijado en `route.test.ts`.

## 7. Qué está probado y qué no

Probado en CI (sin red, sin portales reales):

- **E2E del ciclo** `src/lib/likida/e2e/agente-06-autofactura.e2e.test.ts` con un doble del portal: feliz (propone →
  confirma → consume una vez → emite → cupo y bitácora), fallo (cada llave cerrada, CAPTCHA, emisión sin confirmar,
  portal caído, cofre sin llave), duplicado (corridas solapadas, lote consumido una vez, proceso muerto a media
  sesión), fuera de orden (ticket tardío, código vencido o reusado) y otra flota (bandera, lote, cupo y vinculación
  por flota).
- Unitarias del control (`control_emision.test.ts`), de la vinculación (`vinculacion_remota.test.ts`), del motor
  contra HTML fixture (`contrato_portales.test.ts`) y de la ruta de `facturar`.

**No** probado, y no lo puede probar el código:

- **Ningún portal está verificado contra el sitio real** (0 de 21 en `verificaciones.json`): los fixtures son
  sintéticos, derivados de la propia tabla de selectores. El botón de emitir, el contenedor del UUID y el cuadro de
  error solo se ven emitiendo, por eso la **primera emisión real es supervisada** (`docs/encender-emision.md`).
- La cláusula de mandato en `/terminos` y la decisión de Javier de encender (ver `docs/encender-emision.md`).
- El estatus de cancelación por API de SW (sección 4).

## 8. Variables de entorno

`CRON_SECRET` (todos los crons), `FACTURACION_MODO`, `FACTURACION_MANDATO_ACEPTADO`, `LIKIDA_COFRE_LLAVE` (cofre de
sesiones; sin ella la vinculación falla cerrado y lo dice), `LIKIDA_PAC_*` (solo para timbrar y cancelar Carta
Porte; no interviene en la autofactura por portal), `NEXT_PUBLIC_APP_URL` (a dónde apunta el script del vinculador).
