import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// CADA RUTA NUEVA (bajo `src/app`, no solo `src/app/api`) PASA POR UNA
// REVISIÓN CONSCIENTE (auditoría 21; ampliada a toda la app en la 28, SEG-B1).
//
// El matcher de `proxy.ts` EXCLUYE todo `/api` a propósito (decisión de
// diseño documentada en su cabecera: webhook, demo, export manejan lo suyo y
// no deben pasar por el gate ni cargar cabeceras de página). Eso significa
// que cada `route.ts` bajo `src/app/api/` es su PROPIA y ÚNICA puerta:
// sesión + rol + tenant los resuelve el archivo mismo, sin red de respaldo
// del lado del proxy — a diferencia de /dashboard y /admin, que tienen la
// puerta de proxy.ts MÁS la de la página.
//
// La auditoría 28 (SEG-B1) encontró que este inventario escaneaba SOLO
// `src/app/api`, dejando fuera cinco `route.ts` que viven en otras ramas de
// `src/app` y que `proxy.ts` tampoco cubre (su `RUTAS_CON_SESION` solo nombra
// /dashboard, /admin, /vendedor): `auth/callback`, las tres variantes de
// `.well-known/oauth-*` y `pago/[token]/complemento/[uuid]`. Ninguna es un
// hallazgo nuevo — las cinco YA tienen su propia puerta (ver el detalle de
// cada una abajo) — pero el inventario que promete "cada ruta nueva pasa por
// revisión consciente" no era verdad fuera de /api. Ahora escanea `src/app`
// entero: cualquier `route.ts` nuevo, esté donde esté, sube esta constante.
//
// Esta prueba NO agrega una segunda capa de gate (revertir la exclusión del
// proxy sobre las rutas de /api es otro trabajo, con otro riesgo). Es el
// MECANISMO DE CONTENCIÓN: inventaría el disco —no una lista que alguien
// mantenga— y compara contra la constante de abajo. Crecer la superficie sin
// tocar este archivo pone la suite en rojo; tocar este archivo es el momento
// de la revisión. El mismo trato que ya reciben los previews
// (sin_previews.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El número de archivos `route.ts` bajo `src/app/` (toda la app, no solo
 * `src/app/api/`) que YA fueron revisados.
 *
 * 64 (auditoría 21, 29-ago-2026) → 65 (auditoría 24, 1-sep-2026:
 * `v1/operadores/route.ts`) → 66 (auditoría 24, BLOQ-6: `v1/liquidaciones/
 * route.ts`) → 67 (auditoría 25: `client-error/route.ts`) → 72 (auditoría 28,
 * 7-sep-2026, SEG-B1: el escaneo pasa de `src/app/api` a `src/app` entero y
 * aparecen cinco rutas que ya existían y ya tenían puerta propia, solo que
 * nadie las había hecho pasar por ESTE inventario:
 *
 *   · `auth/callback/route.ts` — SIN sesión a propósito: es el destino del
 *     intercambio de código de Supabase (`exchangeCodeForSession`) que CREA
 *     la sesión; exigir sesión aquí sería pedirle al login el resultado que
 *     todavía no tiene. Su puerta es el `code` de un solo uso que emite
 *     Supabase (o, sin `code`, cae a un mensaje de error de login sin tocar
 *     nada de negocio) y una allowlist de PREFIJOS DE RUTA PROPIOS para el
 *     `next` de retorno (nunca una URL completa: así se cierra el open
 *     redirect).
 *   · `.well-known/oauth-authorization-server/route.ts`,
 *     `.well-known/oauth-protected-resource/route.ts` y
 *     `.well-known/oauth-protected-resource/api/mcp/route.ts` — SIN sesión a
 *     propósito: son metadatos de descubrimiento OAuth (RFC 8414 y RFC 9728)
 *     que el propio estándar exige servir en público, sin autenticar, para
 *     que un cliente MCP pueda encontrar dónde autorizar. No filtran dato de
 *     negocio ni de tenant: solo URLs y capacidades del servidor.
 *   · `pago/[token]/complemento/[uuid]/route.ts` — autenticado por el token
 *     de un solo uso en el PATH (`resolverLiga(token)`, resuelto de nuevo
 *     contra la base en esta llamada, sin confiar en que "venía de la
 *     página"), con rate limit por IP (30/10min) y el `uuid` del complemento
 *     filtrado siempre por el `factura_id`/`tenant_id` de la liga resuelta:
 *     un folio de otra flota o inventado no encuentra nada.
 *
 * Si vas a subir este número: primero confirma que la ruta nueva trae su
 * propia puerta COMPLETA — sesión (o firma de webhook / llave de API / token
 * de un solo uso / secreto de cron), rol y tenant, o una razón documentada
 * para no tenerlos (como las cuatro públicas de arriba) — ANTES de procesar
 * nada. Ni el proxy ni este inventario la van a salvar.
 */
// 1-oct-2026 (loop punta a punta, Agente 1 «liquidación externa», 0370): +3.
//   · `v1/liquidaciones-externas/route.ts` — llave API por área (`abrir(req,
//     'administracion')` para el POST, `'dinero'` para el GET) antes de leer el
//     cuerpo; tenant de la credencial (un `tenant_id` en el cuerpo es 400);
//     idempotencia por `claveExterna` y 409 ante otro contenido.
//   · `export/liquidaciones-externas/route.ts` — sesión → flota → área `dinero`
//     → `puedeExportar`; el PDF se busca CON el tenant de la sesión.
//   · `cron/liquidaciones-externas/route.ts` — secreto de cron (`puertaCron`),
//     palanca global y del agente, latido en todo camino de salida.
// 1-sep-2026 (auditoría 24, BLOQ-6): +1 por `v1/liquidaciones/route.ts`.
// Su puerta: `abrir(req, 'dinero')` —llave API por área o cookie+CSRF— antes
// de tocar la base, y `.eq('tenant_id', acceso.tenantId)` en la única consulta.
// 3-sep-2026 (auditoría 25, ALTO): +1 por `client-error/route.ts`. SIN
// sesión a propósito, mismo criterio que `health/route.ts` y `lead/route.ts`:
// es el destino de un fallo de CLIENTE (el layout raíz truena antes de que
// la sesión se pueda leer), así que exigir sesión sería pedirle al reporte
// del fallo la misma cosa que acaba de fallar. Su puerta es otra: rate limit
// por IP (`client-error:${clientIp}`, 20/min), tope de cuerpo (4 KB) aplicado
// durante la lectura streaming (`leerTextoAcotado`), `level` acotado a {warn,error} y
// `msg`/`meta` saneados (sin saltos de línea, `meta` solo si es objeto plano)
// ANTES de tocar `logger.error`/Sentry — no filtra dato de negocio ni tenant.
// 7-sep-2026 (auditoría 28, SEG-B1): 67 → 72. El escaneo deja de limitarse a
// `src/app/api` y cubre `src/app` entero (ver el comentario de arriba con el
// detalle de las cinco rutas que aparecen).
//
// 75 → 78 (loop punta a punta, Agente 2, 1-oct-2026): tres rutas de la
// conciliación de peajes, cada una con su propia puerta —
//   · `api/peajes/ingesta/route.ts` — SIN sesión a propósito (la llama el
//     sistema del proveedor/cliente): su puerta es la firma HMAC por flota
//     (cuerpo crudo + timestamp ±5 min + comparación en tiempo constante),
//     fail-closed sin PEAJES_INGESTA_SECRETO o con la flota sin activar, tope de
//     cuerpo, rate limit y cola con tope de pendientes;
//   · `api/cron/peajes/route.ts` — puertaCron (CRON_SECRET) y palancas global y
//     `agente:peajes`;
//   · `api/export/bitacora-conciliada/route.ts` — sesión + área dinero +
//     puedeExportar, rate limit y siempre acotada al tenant de la sesión.
//
// 78 → 83 (loop punta a punta, Agente 5 «Conductor», 2-oct-2026): cinco rutas,
// cada una con su propia puerta —
//   · `api/cron/conductor-hitos/route.ts` — puertaCron (CRON_SECRET), palancas
//     global y `agente:conductores` (ambas fail-closed) y latido en todo camino
//     de salida;
//   · `api/v1/hitos/route.ts` y `api/v1/hitos/eventos/route.ts` — llave API por
//     área o cookie, área `operacion` (`abrir(req, 'operacion')`) antes de leer;
//     SIEMPRE acotadas al tenant de la credencial (`.eq('tenant_id', …)`);
//   · `api/v1/viajes/[id]/citas/route.ts` — `abrir(req, 'administracion')` +
//     CSRF para la cookie; el UPDATE lleva `.eq('tenant_id', …)` y «no existe» y
//     «no es de tu flota» contestan lo mismo (404);
//   · `api/v1/conductor/config/route.ts` — `abrir(req, 'administracion')` también
//     para LEER (trae teléfonos de personas); el PUT fusiona con la config de la
//     flota de la credencial, un `tenant_id` en el cuerpo es 400 y la terminal
//     de otra flota la rechaza la FK compuesta.
//
// 83 → 86 (loop punta a punta, Agente 5 «Conductor», 2.ª entrega, 2-oct-2026): tres rutas, cada una
// con su propia puerta (`abrir()` resuelve credencial → flota → ÁREA antes de tocar un dato) —
//   · `api/v1/estadias/route.ts` — área `dinero` (trae el monto propuesto de cobro: el jefe de tráfico,
//     que ve operación y nada de pesos, no la lee); fechas validadas (días de México, máx. 93), filtros
//     uuid, CSV con neutralización de fórmulas; SIEMPRE acotada al tenant de la credencial (`?tenant=` se borra
//     en el borde) y la lectura truncada se declara;
//   · `api/v1/sitios/route.ts` — área `operacion`, solo lectura del catálogo de la flota de la credencial;
//   · `api/v1/viajes/[id]/sitios/route.ts` — área `administracion` + CSRF para la cookie; el sitio se resuelve
//     (código o id) DENTRO de la flota de la credencial y el UPDATE lleva `.eq('tenant_id', …)`; «no existe» y «no es
//     de tu flota» contestan lo mismo (404); un `tenant_id` en el cuerpo es 400.
//
// 86 → 87 (misma entrega): `api/v1/evidencias/[id]/route.ts` — `abrir(req, 'operacion')`; busca la evidencia SIEMPRE
//   con `.eq('tenant_id', …)` de la credencial, firma solo rutas que cuelgan del prefijo de esa flota y redirige (302) a una
//   URL de 10 minutos del bucket privado: el archivo nunca se sirve ni es público.
// 87 → 88 (loop punta a punta, Agente 4 «Vigía de servicio al cliente», 1-oct-2026):
//   · `api/cron/vigia/route.ts` — puertaCron (CRON_SECRET, comparación en tiempo
//     constante) y palanca `global` (falla cerrado si no se puede leer); latido en
//     todo camino de salida. Barre el SLA de TODAS las flotas con el agente
//     encendido (`vigia_config.habilitado`, apagado por omisión) y cada acción
//     usa el tenant de la propia conversación. No acepta cuerpo ni parámetros.
//     El tablero del Vigía NO añade rutas: sus acciones son server actions de la
//     página, con la sesión, el rol y el tenant de la cookie.
// 88 → 89 (loop punta a punta, Agente 3 «Carta Porte multi-formato», 1-oct-2026): una ruta,
//   · `api/export/carta-porte-docs/route.ts` — rate limit por IP y por flota,
//     `resolverTenantApi` (sesión → flota), área `operacion` de la bandeja de documentos
//     + `puedeExportar`, y todas las lecturas acotadas al tenant de la sesión (un `?ids=`
//     de otra flota no exporta nada de ella). Solo exporta documentos APROBADOS; no emite
//     ni timbra nada. El correo `cp-<token>@…` NO suma ruta: comparte el webhook firmado de
//     `api/correo/entrante/route.ts`, que verifica la firma Svix antes de leer el cuerpo.
//
// Conteo de la integración de la ola 2: 78 + 9 (Conductor) + 1 (Vigía) + 1 (Carta Porte) = 89.
// 89 → 92 (loop punta a punta, ola 3, Agente 1 «liquidación externa», salida hacia SAP/TMS por pull):
//   · `api/v1/liquidaciones-externas/acuses/route.ts` — `abrir(req, 'dinero')` antes de leer; SIEMPRE acotada al
//     tenant de la credencial; solo trae acuses del propio tenant aún no confirmados;
//   · `api/v1/liquidaciones-externas/acuses/confirmar/route.ts` — `abrir(req, 'administracion')`; ids validados
//     como uuid (≤ 200), la confirmación lleva `.eq('tenant_id', …)` y un id ajeno cae en `noAplican`;
//   · `api/v1/liquidaciones-externas/exportacion/route.ts` — `abrir(req, 'dinero')`; layout por catálogo cerrado
//     de columnas, texto neutralizado contra inyección de fórmulas, tope duro que falla en vez de entregar un
//     archivo parcial, y `?tenant=` ignorado (el tenant sale de la credencial).
// 92 → 95 (ola 3, Agente 2 «conciliación de peajes», salida hacia SAP/ERP y anulación), tres rutas con puerta propia
// (`abrir()` resuelve credencial → flota → ÁREA antes de tocar un dato; el tenant sale SIEMPRE de la credencial):
//   · `api/v1/peajes/desgloses/route.ts` — área `dinero`, solo lectura de los desgloses de la flota (los anulados no salen);
//   · `api/v1/peajes/desgloses/[id]/anular/route.ts` — área `administracion`; motivo obligatorio, la anulación lleva
//     `.eq('tenant_id', …)` y «no existe»/«no es de tu flota» contestan lo mismo (404); no borra nada;
//   · `api/v1/peajes/exportacion/route.ts` — área `dinero`; el desglose se busca CON el tenant de la credencial, layout por
//     catálogo cerrado de columnas, texto neutralizado contra fórmulas.
// El correo `pj-<token>@…` NO suma ruta: comparte el webhook firmado de `api/correo/entrante/route.ts`, que verifica la firma
// Svix antes de leer el cuerpo y resuelve la flota por el token del destinatario.
//
// (Lo anterior, 89 → 95, es de la rama de los Agentes 1 y 2; lo siguiente, 89 → 93, de la rama integrada; la suma de ambas es 99.)
// 89 → 90 (loop punta a punta, ola 3, Agente 9 «Buzón de facturas», 2-oct-2026): una ruta,
//   · `api/cron/buzon-entrega/route.ts` — puertaCron (CRON_SECRET, comparación en tiempo
//     constante) y palanca `global` (falla cerrado si no se puede leer); latido en todo camino de
//     salida. Arma el lote del día y envía los vencidos de las flotas que ENCENDIERON la entrega
//     (`buzon_entrega_config.activo`, apagada por omisión); cada acción usa el tenant del propio
//     lote. No acepta cuerpo ni parámetros. La confirmación (entregada/rebotada) NO suma ruta:
//     comparte el webhook firmado `api/correo/eventos/route.ts` (firma Svix antes de leer).
// 90 → 92 (ola 3, Agente 6 «autofacturación», 0540): dos rutas SIN sesión de Likida a propósito — las llama
//   el script de la máquina con pantalla del contralor, que no tiene cookie del panel. Su ÚNICA credencial es
//   el código de un solo uso que el dueño genera en el panel (80 bits, 15 min, se consume al reclamarlo; en la
//   base solo vive su SHA-256), y TODO lo decide el código: el tenant y el portal salen de la solicitud, jamás
//   del cuerpo (un `tenant_id`/`comercio` en el cuerpo se ignora). Antes de leer nada: rate limit por IP
//   (20/10 min) y cuerpo acotado en streaming (200 KB). La sesión que suben se vuelve a recortar al dominio del
//   portal y se cifra en el cofre; si el cofre no está configurado, no se guarda ni se anota «vinculado».
//   · `api/vinculacion-portal/reclamar/route.ts` — consume el código y devuelve QUÉ portal abrir (nunca tenant ni id).
//   · `api/vinculacion-portal/completar/route.ts` — sube la sesión ya iniciada (o avisa del fallo).
//
// 92 → 93 en la integración de la ola 3 (ronda-03): `api/v1/hitos/[id]/validar/route.ts` (W3 Conductor,
//   POST con llave de API de la flota: valida el hito DE ESA flota con la RPC atómica; la rama de Conductor
//   no subió esta constante) más las 2 de autofactura (vinculación de portal) y la de cron buzon-entrega.
// 99 → 100 (ola 3b, Agente 2, reporte de reclamación): `api/export/peajes-reclamacion/route.ts` — las dos puertas de todo export de
//   dinero (área `dinero` Y `puedeExportar`), rate limit por IP y por flota, formato `xlsx|pdf` validado, y el desglose se busca CON el
//   tenant de la sesión (`reporteReclamacion(t.tenantId, …)`): un uuid de otra flota es 404, nunca datos ajenos. Una lectura incompleta no
//   sale como archivo corto. Mismo molde que `api/export/bitacora-conciliada`.

//
// 93 → 95 (ola 3, W3 «GPS/Jornada»): dos rutas,
//   · `api/gps/push/[flota]/route.ts` — SIN sesión a propósito: es el endpoint al que un GPS
//     propio hace POST. Su puerta es la firma HMAC-SHA256 por flota (secreto cifrado en la
//     base, rotable con ventana de 24 h, tiempo constante, timestamp firmado ±5 min); el
//     límite de tasa (por IP y por flota) corre ANTES de leer el cuerpo, el cuerpo está
//     acotado (256 KiB / 500 lecturas), flota inexistente, push apagado y firma mala
//     responden igual (401) y todo se asienta con el tenant del PATH ya autenticado por su
//     secreto — nunca con un dato del cuerpo.
//   · `api/cron/jornada-alertas/route.ts` — cron: `puertaCron` (CRON_SECRET o 401/500) y la
//     palanca global fail-closed; lee jornadas en curso solo de las flotas con la alerta
//     ENCENDIDA (apagada por omisión) y manda WhatsApp/correo al encargado y al operador de ESA
//     flota; claim por (jornada, nivel) en la base y latido en todo camino de salida.

// Integración ola 3b: 100 (peajes-reclamacion) + 2 de GPS/jornada (gps push, cron jornada-alertas).
//
// 93 → 94 en la ola 3, W3 «convenios» (0580): `api/export/convenios/route.ts` — GET de la flota de la SESIÓN (`resolverTenantApi`,
//   `?tenant=` solo lo vale el superadmin ya validado): puerta del dato (área `operacion`), del verbo (`puedeExportar`) y, para el
//   tipo `completo` (tarifa y requisitos de cobro), del DINERO (área `dinero`); rate limit por IP y por flota. Las instrucciones
//   salen sin dinero (ni siquiera se consulta la tabla comercial). Prueba: `export/convenios/route.test.ts`.
// Integración ola 3b: 102 (peajes-reclamacion, gps push, cron jornada-alertas) + 1 (export/convenios).
// 103 → 104 (ronda 07, P3 «carta-porte-worker», 0640-0642): una ruta,
//   · `api/cron/carta-porte-docs/route.ts` — cron: `puertaCron` (CRON_SECRET o 401/500) y las palancas `global` y
//     `agente:carta_porte`, ambas fail-closed; latido en todo camino de salida. Reclama con la RPC existente
//     (`cp_documento_reclamar`: lease + tope de 5 intentos) los documentos de CADA flota recibidos, de lease vencido o
//     de fallo reintentable, y cada acción posterior usa el tenant de la propia fila; el aviso a la oficina sale al
//     teléfono de ESA flota, una vez por documento (candado de la 0641). No acepta cuerpo ni parámetros.
const RUTAS_APP_REVISADAS = 104;

function rutasApp(): string[] {
  const raiz = join(process.cwd(), 'src', 'app');
  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === 'route.ts')
    .map((e) => relative(raiz, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

describe('la superficie de rutas de src/app no crece en silencio', () => {
  it(`hay exactamente ${RUTAS_APP_REVISADAS} route.ts bajo src/app`, () => {
    const rutas = rutasApp();

    const mensaje = rutas.length > RUTAS_APP_REVISADAS
      ? 'Una ruta nueva apareció bajo src/app sin que nadie confirme que tiene su ' +
        'propia puerta (sesión+rol+tenant, o una razón documentada para no tenerla) ' +
        '— revísala y sube esta constante (RUTAS_APP_REVISADAS en este archivo). ' +
        'Recuerda: proxy.ts excluye /api entero y su RUTAS_CON_SESION solo nombra ' +
        '/dashboard, /admin y /vendedor, así que fuera de esas tres la puerta que esa ' +
        'ruta escriba adentro es la ÚNICA que tiene.\n\nInventario actual ' +
        `(${rutas.length}):\n  ` + rutas.join('\n  ')
      : 'Desaparecieron rutas bajo src/app (¿se borró o movió un endpoint?). Si fue a ' +
        'propósito, baja RUTAS_APP_REVISADAS en este archivo para que el inventario ' +
        `siga siendo verdad.\n\nInventario actual (${rutas.length}):\n  ` + rutas.join('\n  ');

    expect(rutas.length, mensaje).toBe(RUTAS_APP_REVISADAS);
  });
});
