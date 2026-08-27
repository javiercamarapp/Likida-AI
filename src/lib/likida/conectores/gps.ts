import {
  probarConGuardas, veredictoHttp, sinApiQueProbar,
  type Conector, type Http, type ResultadoPrueba, type ValoresCredencial,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// RASTREO GPS — los cuatro del mercado mexicano, más el genérico.
//
// ── POR QUÉ EL GENÉRICO NO ES EL ÚLTIMO DE LA LISTA SINO EL PATRÓN ──────
//
// El censo de vacantes (1,987 empresas, 14-ago-2026) dice esto: 131 empresas
// piden "GPS" a secas, y por marca casi nadie — Samsara 9, Geotab 1,
// Encontrack 1, Wialon 0, Navixy 0. O sea que NINGUNA marca domina y la flota
// promedio ni siquiera nombra la suya. Construir para una marca sería apostar
// al 0.2% del censo.
//
// La consecuencia de diseño es directa: lo que se estandariza no es el
// proveedor, es el PATRÓN DE AUTENTICACIÓN. Solo hay tres en todo el mercado y
// los cuatro adaptadores de aquí son un ejemplo de cada uno:
//
//   1. TOKEN LARGO → SESIÓN CORTA (Wialon). Un token que el cliente genera en
//      su UI se cambia por una sesión que se muere sola.
//   2. TOKEN PERMANENTE EN CABECERA (Samsara, Navixy con API key). No hay
//      login: la credencial viaja en cada petición.
//   3. USUARIO Y CONTRASEÑA → SESIÓN (Geotab, Navixy con user/auth). El
//      cliente entrega credenciales de una persona, con todo lo que eso implica.
//
// `gps_generico` no adivina un endpoint: PIDE la ruta de prueba y el patrón, y
// con eso sí puede verificar de verdad contra el proveedor que traiga la flota.
// Es lo contrario de inventar `api.suproveedor.com/v1/login`.
//
// ── LO QUE SE VERIFICÓ Y LO QUE NO ──────────────────────────────────────
//
// De los cuatro concretos se verificó la AUTENTICACIÓN contra la documentación
// del fabricante, con URL y fecha en cada `fuente`. Lo que NO se verificó es un
// solo endpoint de datos: no hay instancia de ningún cliente contra la cual
// llamarlos. Por eso `capacidades` describe el alcance del producto y `probar()`
// solo promete "la credencial sirve".
//
// ── LA TRAMPA QUE COMPARTEN LOS CUATRO ──────────────────────────────────
//
// Los tres primeros contestan **HTTP 200 con un error adentro del cuerpo**.
// Wialon devuelve `{"error":8}` con estado 200. Geotab devuelve
// `{"error":{...}}` con estado 200, porque JSON-RPC transporta sus errores en
// la carga, no en el código. Un adaptador que se quedara en `estado === 200`
// declararía CONECTADA una credencial rechazada, y el dueño de la flota vería
// su pantalla en verde con el mapa vacío — el modo de falla exacto que esta
// capa existe para impedir. Por eso ninguno de estos `probar()` usa
// `veredictoHttp` solo: primero se descarta el error de transporte y luego se
// LEE EL CUERPO.
// ═══════════════════════════════════════════════════════════════════════════

/** Quita la diagonal final para que `base + ruta` no produzca `//`. */
function base(v: string | undefined, porDefecto: string): string {
  const b = (v ?? '').trim() || porDefecto;
  return b.replace(/\/+$/, '');
}

/**
 * Lee JSON sin confiar en que lo sea.
 *
 * Devuelve `null` en vez de lanzar porque el caso frecuente no es un bug: es un
 * portal contestando HTML —una página de login, un error de proxy corporativo—
 * con estado 200. Ese caso tiene que terminar en "no se pudo comprobar", no en
 * una excepción que la pantalla de configuración enseñe como falla del sistema.
 */
function json(cuerpo: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(cuerpo);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** El mismo mensaje para los tres que contestan 200 con basura adentro. */
function cuerpoIlegible(endpoint: string, nombre: string): ResultadoPrueba {
  return {
    ok: false,
    detalle: `${nombre} contestó 200 pero no con la respuesta que documenta su API. Suele significar que la URL apunta a un portal web y no al endpoint de la API, o que hay un proxy en medio. NO se puede afirmar que la credencial sirva.`,
    verificadoContra: endpoint,
  };
}

// ── Wialon (Gurtam) ────────────────────────────────────────────────────────

export const WIALON: Conector = {
  id: 'wialon',
  nombre: 'Wialon (Gurtam)',
  categoria: 'Rastreo GPS',
  queHace: 'Trae la posición y el recorrido real de cada unidad, para que el mapa deje de dibujar líneas ilustrativas y los tiempos de espera se midan solos.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: 'Con el token que generas en tu cuenta de Wialon. No pedimos tu usuario ni tu contraseña: desde el 1-oct-2015 Wialon ya no permite autenticarse así.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_posiciones', 'leer_recorrido', 'leer_unidades'],
  claveAlmacen: 'wialon',
  fuente: {
    url: 'https://help.wialon.com/en/api/user-guide/api-reference/token/login',
    queConfirma: 'La API remota vive en {host}/wialon/ajax.html con `svc=token/login&params={"token":…}`; la respuesta trae el identificador de sesión en el campo `eid`, que después se manda como parámetro `sid`. El camino viejo `core/login` con usuario y contraseña dejó de ser válido el 1-oct-2015.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Servidor de Wialon',
      forma: 'url',
      requerida: true,
      // Gurtam tiene varios centros de datos y Wialon Local es on-premise: el
      // host NO es constante. Cablearlo dejaría fuera a cualquier flota que no
      // esté en el hosting global, que en México es muy común porque los
      // integradores locales revenden su propia instancia.
      ayuda: 'El host de la API de tu cuenta. Hosting global: hst-api.wialon.com. Hay centros de datos regionales (hst-api.wialon.us, .eu, .org) y si tu proveedor te dio un Wialon Local, es la dirección de tu sitio de monitoreo.',
      ejemplo: 'https://hst-api.wialon.com',
    },
    {
      clave: 'token',
      rotulo: 'Token de acceso de Wialon',
      forma: 'secreto',
      requerida: true,
      ayuda: 'Se genera desde tu cuenta de Wialon (formulario de login extendido) y son 72 caracteres. Un token sin usar se borra solo a los 100 días, aunque le hayas puesto duración ilimitada.',
      ejemplo: '72 caracteres',
    },
  ],
  probar: (v, http) => probarConGuardas(WIALON, v, async () => {
    const endpoint = `${base(v.base_url, 'https://hst-api.wialon.com')}/wialon/ajax.html`;
    // POST con el token en el CUERPO y no en el query string, aunque la doc
    // muestre el ejemplo con GET. Un token en la URL acaba en el log de acceso
    // del proveedor, en el de cualquier proxy en medio y en el historial del
    // navegador si alguien lo pega. El servidor acepta las dos formas.
    const r = await http({
      url: endpoint,
      metodo: 'POST',
      encabezados: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cuerpo: new URLSearchParams({
        svc: 'token/login',
        params: JSON.stringify({ token: v.token ?? '' }),
      }).toString(),
    });
    if (r.estado < 200 || r.estado >= 300) return veredictoHttp(r, endpoint, 'Wialon');

    const d = json(r.cuerpo);
    if (d === null) return cuerpoIlegible(endpoint, 'Wialon');
    // AQUÍ ESTÁ EL BUG QUE ESTO EVITA: Wialon contesta 200 con `{"error":8}`
    // cuando el token no sirve. Sin esta rama, credencial mala = "conectada".
    if (typeof d.error === 'number') {
      return {
        ok: false,
        detalle: `Wialon rechazó el token (su código de error ${d.error}). Hay que generarlo de nuevo desde la cuenta, o revisar que el servidor sea el correcto.`,
        verificadoContra: endpoint,
      };
    }
    if (typeof d.eid !== 'string' || d.eid.length === 0) return cuerpoIlegible(endpoint, 'Wialon');
    return {
      ok: true,
      // Se dice lo de los 5 minutos porque cambia lo que hay que construir
      // después: no se puede guardar el `sid` y reusarlo mañana.
      detalle: 'Wialon aceptó el token y abrió sesión. Ojo con lo que sigue: la sesión se muere a los 5 minutos sin actividad, así que la sincronización tiene que renovarla, no guardarla.',
      verificadoContra: endpoint,
    };
  }),
};

// ── Samsara ────────────────────────────────────────────────────────────────

export const SAMSARA: Conector = {
  id: 'samsara',
  nombre: 'Samsara',
  categoria: 'Rastreo GPS',
  queHace: 'Trae posición, recorrido y catálogo de unidades desde la nube de Samsara, sin instalar nada.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: 'Con un token de API que generas en tu tablero de Samsara. Es el único de los cuatro que no necesita abrir sesión: el token viaja en cada petición.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_posiciones', 'leer_recorrido', 'leer_unidades', 'leer_eventos_seguridad'],
  claveAlmacen: 'samsara',
  fuente: {
    url: 'https://developers.samsara.com/docs/authentication',
    queConfirma: 'La API vive en https://api.samsara.com y el token se manda como `Authorization: Bearer <token>`. Los tokens llevan scopes granulares; los nuevos nacen con permisos de lectura. `GET /me` devuelve la organización dueña del token (https://developers.samsara.com/changelog/me-api-endpoint). Los eventos de seguridad viven en `GET /safety-events/stream` y exigen el scope «Read Safety Events & Scores» (https://developers.samsara.com/reference/getsafetyeventsv2stream, consultada 26-ago-2026) — sin ese scope las posiciones entran y los eventos no, y el poller lo reporta con nombre.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'token',
      rotulo: 'Token de API de Samsara',
      forma: 'secreto',
      requerida: true,
      ayuda: 'Se genera en el tablero de Samsara. Con permisos de LECTURA basta: Likida no escribe nada en tu Samsara.',
      ejemplo: 'cadena larga',
    },
  ],
  probar: (v, http) => probarConGuardas(SAMSARA, v, async () => {
    // `/me` y no `/fleet/vehicles`: identifica DE QUÉ CUENTA es el token, que es
    // la pregunta que de verdad importa cuando una flota nos pega un token
    // copiado de otro lado. Además no pagina ni trae datos de nadie.
    //
    // Riesgo declarado: la doc del changelog no publica el scope que exige
    // `/me`. Si un token viene con scopes muy recortados podría rechazarlo
    // aunque sirva para vehículos; en ese caso el mensaje del 403 lo dice y el
    // siguiente paso documentado es `GET /fleet/vehicles`.
    const endpoint = 'https://api.samsara.com/me';
    const r = await http({
      url: endpoint,
      metodo: 'GET',
      encabezados: { Authorization: `Bearer ${v.token ?? ''}` },
    });
    if (r.estado === 403) {
      return {
        ok: false,
        detalle: 'Samsara rechazó la credencial: reconoció el token pero le negó el permiso (403). Suele ser un token con los scopes recortados. Hay que darle lectura de flota, o probar contra /fleet/vehicles.',
        verificadoContra: endpoint,
      };
    }
    const veredicto = veredictoHttp(r, endpoint, 'Samsara');
    // Samsara SÍ usa códigos HTTP de verdad, a diferencia de los otros tres.
    // Aun así el cuerpo se revisa: un proxy corporativo que conteste 200 con
    // una página de login pasaría el `estado` y se leería como conectado.
    if (veredicto.ok && json(r.cuerpo) === null) return cuerpoIlegible(endpoint, 'Samsara');
    return veredicto;
  }),
};

// ── Geotab (MyGeotab) ──────────────────────────────────────────────────────

export const GEOTAB: Conector = {
  id: 'geotab',
  nombre: 'Geotab (MyGeotab)',
  categoria: 'Rastreo GPS',
  queHace: 'Trae posición, recorrido y unidades de MyGeotab para cruzar los tiempos reales contra la liquidación.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: 'Con el nombre de tu base de datos, un usuario y su contraseña. Conviene crear un usuario de solo lectura para Likida en vez de dar el de una persona: la sesión se cae en cuanto esa persona cambie su contraseña.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_posiciones', 'leer_recorrido', 'leer_unidades'],
  claveAlmacen: 'geotab',
  fuente: {
    url: 'https://developers.geotab.com/myGeotab/apiReference/methods/Authenticate/',
    queConfirma: 'MyGeotab expone JSON-RPC sobre HTTPS en https://[servidor]/apiv1. El método `Authenticate` recibe `database`, `userName` y `password`, y devuelve un `LoginResult` con `credentials` (que incluye `sessionId`) y un `path`: si `path` no es "ThisServer", las llamadas siguientes van a ESE servidor. La sesión vive 14 días y `Authenticate` está limitado a 10 peticiones por minuto (https://developers.geotab.com/myGeotab/guides/concepts/index.html).',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Servidor de MyGeotab',
      forma: 'url',
      requerida: false,
      // No es requerida porque my.geotab.com es la puerta federada y funciona
      // para todos: contesta el `path` del servidor real. Pedirla obligatoria
      // dejaría trabado a un cliente que no sabe cuál es su servidor, que es
      // la mayoría.
      ayuda: 'Déjalo vacío salvo que tu proveedor te haya dado un servidor propio: my.geotab.com sabe redirigir a donde vive tu base de datos.',
      ejemplo: 'https://my.geotab.com',
    },
    {
      clave: 'database',
      rotulo: 'Nombre de tu base de datos en Geotab',
      forma: 'texto',
      requerida: true,
      ayuda: 'Es el mismo que escribes al entrar a MyGeotab.',
    },
    {
      clave: 'usuario',
      rotulo: 'Usuario de Geotab',
      forma: 'correo',
      requerida: true,
      ayuda: 'Normalmente es un correo. Mejor uno creado para Likida, con permisos de solo lectura.',
    },
    {
      clave: 'password',
      rotulo: 'Contraseña de ese usuario',
      forma: 'secreto',
      requerida: true,
      ayuda: 'Geotab no ofrece token de API: pide la contraseña del usuario. Si la cambian, la conexión se cae y hay que volver a capturarla.',
    },
  ],
  probar: (v, http) => probarConGuardas(GEOTAB, v, async () => {
    const endpoint = `${base(v.base_url, 'https://my.geotab.com')}/apiv1`;
    const r = await http({
      url: endpoint,
      metodo: 'POST',
      encabezados: { 'Content-Type': 'application/json' },
      cuerpo: JSON.stringify({
        method: 'Authenticate',
        params: { database: v.database, userName: v.usuario, password: v.password },
      }),
    });
    if (r.estado < 200 || r.estado >= 300) return veredictoHttp(r, endpoint, 'Geotab');

    const d = json(r.cuerpo);
    if (d === null) return cuerpoIlegible(endpoint, 'Geotab');
    // JSON-RPC transporta sus errores DENTRO de una respuesta 200. Un
    // `InvalidUserException` llega con estado 200 y cuerpo `{"error":{…}}`.
    if (d.error !== undefined && d.error !== null) {
      return {
        ok: false,
        detalle: 'Geotab rechazó las credenciales (respondió con un error de autenticación). Hay que revisar el nombre de la base de datos, el usuario y la contraseña. Ojo también con el tope de 10 intentos de autenticación por minuto.',
        verificadoContra: endpoint,
      };
    }
    const resultado = d.result;
    const credenciales = typeof resultado === 'object' && resultado !== null
      ? (resultado as Record<string, unknown>).credentials
      : undefined;
    if (typeof credenciales !== 'object' || credenciales === null) return cuerpoIlegible(endpoint, 'Geotab');

    // El `path` se dice en el detalle porque es LA trampa de Geotab: si la base
    // vive en otro servidor y la sincronización sigue pegándole a my.geotab.com,
    // todas las consultas de datos fallan aunque el login haya salido bien.
    const ruta = typeof resultado === 'object' && resultado !== null
      ? (resultado as Record<string, unknown>).path
      : undefined;
    const servidor = typeof ruta === 'string' && ruta !== '' && ruta !== 'ThisServer'
      ? ` Tu base vive en ${ruta}: las consultas de datos van a ese servidor, no a este.`
      : '';
    return {
      ok: true,
      detalle: `Geotab aceptó las credenciales y abrió sesión.${servidor}`,
      verificadoContra: endpoint,
    };
  }),
};

// ── Navixy ─────────────────────────────────────────────────────────────────

export const NAVIXY: Conector = {
  id: 'navixy',
  nombre: 'Navixy',
  categoria: 'Rastreo GPS',
  queHace: 'Trae posición, recorrido y unidades desde Navixy, que en México suele venir de la mano de un integrador local.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: 'Con una API key de Navixy. La API key es lo correcto y no el usuario/contraseña: no caduca, sobrevive a un cambio de contraseña y no se muere al cerrar sesión.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_posiciones', 'leer_recorrido', 'leer_unidades'],
  claveAlmacen: 'navixy',
  fuente: {
    url: 'https://www.navixy.com/docs/navixy-api/user-api/authentication',
    queConfirma: 'La credencial viaja como `Authorization: NVX <hash o api key>`. Las bases son regionales (https://api.eu.navixy.com/v2, https://api.us.navixy.com/v2) — no existe un `api.navixy.com` sin región. `POST /user/auth` con `login` y `password` devuelve un `hash` de sesión que caduca a los 30 días de inactividad; una API key es "lo mismo con vida infinita" (https://www.navixy.com/docs/navixy-api/user-api/backend-api/resources/commons/api-keys). `user/get_info` es la consulta de solo lectura que valida cualquiera de las dos.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Servidor de Navixy',
      forma: 'url',
      requerida: true,
      // Requerida y sin valor por omisión A PROPÓSITO: no existe un host
      // global. Poner uno de los dos como default mandaría a media base de
      // clientes contra el continente equivocado, y el error que devolvería
      // sería "credencial inválida" — mandando a buscar el problema al token.
      ayuda: 'Navixy no tiene un servidor único: Europa es https://api.eu.navixy.com/v2 y América es https://api.us.navixy.com/v2. Si tu proveedor te montó una instancia propia, es la suya. Pregúntaselo a quien te vendió el rastreo.',
      ejemplo: 'https://api.us.navixy.com/v2',
    },
    {
      clave: 'api_key',
      rotulo: 'API key de Navixy',
      forma: 'secreto',
      requerida: true,
      ayuda: 'Se crea desde tu cuenta (hasta 20 por cuenta) y no caduca. Si solo tienes usuario y contraseña, tu proveedor puede generarte una; es preferible, porque la sesión de usuario se cae a los 30 días o cuando alguien cambie la contraseña.',
    },
  ],
  probar: (v, http) => probarConGuardas(NAVIXY, v, async () => {
    const endpoint = `${base(v.base_url, 'https://api.us.navixy.com/v2')}/user/get_info`;
    const r = await http({
      url: endpoint,
      metodo: 'GET',
      encabezados: { Authorization: `NVX ${v.api_key ?? ''}` },
    });
    if (r.estado < 200 || r.estado >= 300) return veredictoHttp(r, endpoint, 'Navixy');

    const d = json(r.cuerpo);
    if (d === null) return cuerpoIlegible(endpoint, 'Navixy');
    // Navixy marca el resultado con `success`. NO se investigó con qué código
    // HTTP viaja un rechazo, así que el criterio es el campo del cuerpo y la
    // duda se resuelve en contra: `success` ausente o distinto de `true` es
    // "no se pudo comprobar", nunca "conectado".
    if (d.success !== true) {
      return {
        ok: false,
        detalle: 'Navixy no confirmó la credencial (su respuesta no trae éxito). Hay que revisar la API key y, sobre todo, que el servidor sea el de tu región: una key buena contra el servidor equivocado se ve igual que una key mala.',
        verificadoContra: endpoint,
      };
    }
    return { ok: true, detalle: 'Navixy aceptó la API key.', verificadoContra: endpoint };
  }),
};

// ── El genérico ────────────────────────────────────────────────────────────

/**
 * Los tres patrones de autenticación que cubren el mercado.
 *
 * Es el vocabulario que el cliente (o su integrador) elige en pantalla. No
 * incluye OAuth con redirección: eso no se puede configurar con un formulario
 * de credenciales, necesita registrar una aplicación con el proveedor, y
 * fingir que sí cabría aquí sería el tipo de promesa que este archivo evita.
 */
export const PATRONES_AUTH = {
  bearer: 'Token en la cabecera Authorization: Bearer',
  cabecera: 'Token en una cabecera con nombre propio',
  query: 'Token como parámetro en la dirección',
} as const;

export type PatronAuth = keyof typeof PATRONES_AUTH;

export const GPS_GENERICO: Conector = {
  id: 'gps_generico',
  nombre: 'Otro proveedor de rastreo',
  categoria: 'Rastreo GPS',
  queHace: 'Conecta el rastreo que ya tienes aunque no sea ninguno de los de arriba — que es el caso más común: 131 flotas del censo piden "GPS" sin nombrar marca.',
  // NO es `api_en_vivo` aunque `probar()` llame de verdad, y la diferencia no
  // es un tecnicismo: `api_en_vivo` significa "sabemos hablar con este sistema
  // y lo verificamos contra su documentación". Aquí el endpoint lo pone el
  // cliente, así que lo que sabemos hablar depende de qué nos den. Marcarlo
  // verde sería prometer una integración que todavía no existe.
  formaDeConectar: 'requiere_piloto',
  comoConectaHoy: 'Tu proveedor nos pasa su documentación y nos da una dirección de prueba. Con eso probamos la credencial de verdad y escribimos la lectura de posiciones contra SU formato — no contra uno adivinado.',
  paraSubirDeEscalon: 'Las credenciales y la documentación de tu proveedor. Con un endpoint de solo lectura que responda, el adaptador se termina en la primera semana; sin él, cualquier cosa que escribiéramos sería a ciegas.',
  capacidades: ['leer_posiciones'],
  // 'otro' es uno de los valores que admite el constraint
  // `rastreo_proveedor_dominio` de la migración 0050. La tabla también admite
  // 'traccar', que hoy no tiene adaptador: se dice en el reporte en vez de
  // fabricarle uno sin haber leído su documentación.
  claveAlmacen: 'otro',
  // SIN FUENTE, y ese es exactamente el punto: no hay una documentación que
  // citar porque no hay un proveedor. `nivelDeFuente` lo declara
  // `sin_verificar` y la prueba del registro impide que alguien lo suba a
  // `api_en_vivo` sin traer la URL de un fabricante.
  fuente: null,
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Dirección de prueba que da tu proveedor',
      forma: 'url',
      requerida: true,
      ayuda: 'Una dirección de SOLO LECTURA de su API — la que devuelve tus unidades o tu perfil. Pídesela a quien te vendió el rastreo junto con su documentación.',
      ejemplo: 'https://api.tuproveedor.com/v1/vehiculos',
    },
    {
      clave: 'patron',
      rotulo: 'Cómo se manda la credencial',
      forma: 'texto',
      requerida: true,
      ayuda: `Lo dice la documentación de tu proveedor. Uno de: ${Object.keys(PATRONES_AUTH).join(', ')}.`,
      ejemplo: 'bearer',
    },
    {
      clave: 'nombre_campo',
      rotulo: 'Nombre de la cabecera o del parámetro',
      forma: 'texto',
      requerida: false,
      ayuda: 'Solo si el patrón es "cabecera" o "query". Por ejemplo X-API-Key, o token.',
      ejemplo: 'X-API-Key',
    },
    {
      clave: 'token',
      rotulo: 'Token o llave de tu proveedor',
      forma: 'secreto',
      requerida: true,
      ayuda: 'La credencial que te dio tu proveedor de rastreo.',
    },
  ],
  probar: (v, http) => probarConGuardas(GPS_GENERICO, v, async () => {
    const patron = (v.patron ?? '').trim().toLowerCase();
    if (!(patron in PATRONES_AUTH)) {
      return sinApiQueProbar(
        `No reconozco la forma de autenticación «${v.patron ?? ''}». Tiene que ser una de: ${Object.keys(PATRONES_AUTH).join(', ')}.`,
      );
    }
    const campo = (v.nombre_campo ?? '').trim();
    if ((patron === 'cabecera' || patron === 'query') && campo === '') {
      return sinApiQueProbar('Con esa forma de autenticación hace falta el nombre de la cabecera o del parámetro; sin él no se puede armar la petición.');
    }

    const url = new URL(v.base_url ?? '');
    const encabezados: Record<string, string> = {};
    const token = v.token ?? '';
    if (patron === 'bearer') encabezados.Authorization = `Bearer ${token}`;
    else if (patron === 'cabecera') encabezados[campo] = token;
    else url.searchParams.set(campo, token);

    // GET y nada más. El genérico es el que más fácil se usaría para "probar"
    // contra un endpoint de escritura por descuido de quien lo configura, y
    // este método es el único candado que hay contra eso.
    const r = await http({ url: url.toString(), metodo: 'GET', encabezados });
    const mostrable = patron === 'query'
      // La URL con el token adentro NO se devuelve: `verificadoContra` se
      // guarda y se enseña en el panel.
      ? `${url.origin}${url.pathname}`
      : url.toString();
    const veredicto = veredictoHttp(r, mostrable, 'Tu proveedor');
    if (!veredicto.ok) return veredicto;
    return {
      ...veredicto,
      detalle: `${veredicto.detalle} Falta lo que no se puede hacer sin verlo: leer sus posiciones en el formato que devuelva. Manda su documentación y esa parte se escribe contra su respuesta real.`,
    };
  }),
};

/** Los de rastreo, en orden de qué tan seguido aparecen en el censo. */
export const CONECTORES_GPS: readonly Conector[] = [
  // `gps_generico` va primero por evidencia, no por humildad: 131 empresas
  // piden GPS sin marca contra 9 que nombran Samsara. La lista ordenada por
  // fama de marca describiría un mercado que no es el mexicano.
  GPS_GENERICO,
  SAMSARA,
  WIALON,
  GEOTAB,
  NAVIXY,
];

/** Lo que el genérico necesita del proveedor. Sirve para pedírselo por escrito. */
export function loQueFaltaDelProveedor(): readonly string[] {
  return [
    'La documentación de su API (o el enlace).',
    'Una dirección de solo lectura que devuelva las unidades o el perfil.',
    'Una credencial de prueba con permisos de lectura.',
    'Cómo se manda esa credencial: cabecera Bearer, cabecera propia o parámetro.',
  ];
}

/** Para que un llamador no tenga que exportar cada constante por separado. */
export function conectorGpsPorId(id: string): Conector | null {
  return CONECTORES_GPS.find((c) => c.id === id) ?? null;
}

/** Tipo de utilería: el `Http` que espera `probar()`. Reexportado por comodidad. */
export type { Http, ValoresCredencial };
