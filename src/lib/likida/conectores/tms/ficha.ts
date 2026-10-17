// ═══════════════════════════════════════════════════════════════════════════
// FICHA DEL CONECTOR «API DE LECTURA DEL SISTEMA DE GESTIÓN DE TRANSPORTE DEL CLIENTE»:
// qué credenciales pide y cómo se PRUEBA de verdad (login + un GET de bajo costo).
//
// SOLO LECTURA: la ficha no declara ninguna capacidad de escritura y `probar()` solo hace
// POST al login y GET de una página de un registro. Cuenta de servicio, sin correo personal.
//
// SUPUESTOS (BLOQUEO EXTERNO: la documentación del login del cliente no existe todavía, por
// eso la ficha queda `requiere_piloto` con `fuente: null` y nada de aquí se presenta como
// verificado contra una instancia real):
//  · SUPUESTO: el login es `POST <base_url><ruta_login>` con JSON `{usuario, clave}` y el token
//    viene en `token`, `access_token` o `data.token`.
//  · SUPUESTO: el GET de bajo costo es la primera página (tam=1) de un registro de liquidaciones,
//    con `Authorization: Bearer <token>`.
// Cuando llegue la documentación se corrigen SOLO las constantes de abajo.
//
// Reglas que hace cumplir `probarTmsApiLectura`:
//  · El `detalle` jamás contiene la clave, el usuario ni el token (se redactan siempre).
//  · No se sigue ningún redirect (el transporte real ya usa redirect manual): un 302 se lee como
//    «no se sabe», nunca como credencial buena.
//  · Un 200 con cuerpo HTML es una página de acceso o un proxy, no la API: «no se sabe».
//  · Error de red / DNS / timeout / 5xx → «no se sabe»: no culpa a la credencial.
//  · Sin reintentos ni esperas: es un botón que alguien está mirando.
// ═══════════════════════════════════════════════════════════════════════════
import {
  probarConGuardas, veredictoHttp,
  type CampoCredencial, type Http, type RespuestaHttp, type ResultadoPrueba, type ValoresCredencial,
} from '../tipos';

export const NOMBRE_TMS_API_LECTURA = 'La API de lectura de tu sistema de transporte';

/** SUPUESTO: ruta del login cuando el cliente no la da. */
export const RUTA_LOGIN_POR_DEFECTO = '/api/login';
/** SUPUESTO: GET de bajo costo (una sola fila de liquidaciones). */
export const RUTA_PRUEBA_LECTURA = '/api/liquidaciones?pagina=1&tam=1';

export const FRASE_PAGINA_DE_ACCESO = 'parece una página de acceso, no la API';

export const CREDENCIALES_TMS_API_LECTURA: readonly CampoCredencial[] = [
  {
    clave: 'base_url',
    rotulo: 'Dirección de la API de tu sistema de transporte',
    forma: 'url',
    requerida: true,
    ayuda: 'La que te da tu área de sistemas. Tiene la forma https://api.tuempresa.com — sin la ruta del login.',
    ejemplo: 'https://api.tuempresa.com',
  },
  {
    clave: 'usuario',
    rotulo: 'Usuario de servicio',
    forma: 'texto',
    requerida: true,
    // Requisito del cliente: la cuenta de servicio NO lleva correo personal.
    ayuda: 'Una cuenta de servicio de solo lectura creada para Likida. No uses el correo ni el usuario de una persona.',
  },
  {
    clave: 'clave',
    rotulo: 'Contraseña de la cuenta de servicio',
    forma: 'secreto',
    requerida: true,
    ayuda: 'La de esa cuenta de servicio. Se guarda cifrada y no se vuelve a mostrar.',
  },
  {
    clave: 'ruta_login',
    rotulo: 'Ruta del inicio de sesión',
    forma: 'texto',
    requerida: false,
    ayuda: `Déjala vacía si no te dieron una. Por omisión se usa ${RUTA_LOGIN_POR_DEFECTO}.`,
    ejemplo: '/api/login',
  },
  {
    clave: 'ambiente',
    rotulo: 'Ambiente',
    forma: 'texto',
    requerida: false,
    ayuda: 'Escribe prueba o produccion. Conviene empezar por el ambiente de prueba si tu equipo de sistemas lo tiene.',
    ejemplo: 'prueba',
  },
];

/** Frases llanas para los fallos de RED (no son veredicto sobre la credencial). */
export const FRASE_DNS = 'no resuelve el nombre (DNS)';
export const FRASE_TIEMPO = 'no conectó a tiempo (probable firewall)';
export const FRASE_RECHAZO = 'el servidor rechazó la conexión';
export const FRASE_403_IP = 'respondió 403 (probable lista de IP permitidas)';

/** Distingue DNS / tiempo agotado / conexión rechazada por código o texto del error; `null` si no se reconoce. */
export function clasificarErrorDeRed(e: unknown): 'dns' | 'tiempo' | 'rechazo' | null {
  const partes: string[] = [];
  let actual: unknown = e;
  for (let i = 0; i < 3 && actual != null; i++) {
    if (typeof actual === 'object') {
      const o = actual as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof o.code === 'string') partes.push(o.code);
      if (typeof o.message === 'string') partes.push(o.message);
      actual = o.cause;
    } else {
      partes.push(String(actual));
      actual = null;
    }
  }
  const t = partes.join(' ');
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(t)) return 'dns';
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|time-?d?\s?out|timeout|aborted/i.test(t)) return 'tiempo';
  if (/ECONNREFUSED|ECONNRESET/i.test(t)) return 'rechazo';
  return null;
}

function fraseDeRed(e: unknown): string {
  switch (clasificarErrorDeRed(e)) {
    case 'dns': return FRASE_DNS;
    case 'tiempo': return FRASE_TIEMPO;
    case 'rechazo': return FRASE_RECHAZO;
    default: return e instanceof Error ? e.message : String(e);
  }
}

function resultado(
  ok: boolean, detalle: string, verificadoContra: string | null, sobreLaCredencial: ResultadoPrueba['sobreLaCredencial'],
): ResultadoPrueba {
  return { ok, detalle, verificadoContra, sobreLaCredencial };
}

/** Quita del texto cualquier secreto capturado (clave, usuario) o recibido (token). */
function redactar(texto: string, secretos: ReadonlyArray<string | undefined>): string {
  let t = texto;
  for (const s of secretos) if (s) t = t.split(s).join('[oculto]');
  return t;
}

const pareceHtml = (r: RespuestaHttp): boolean => {
  const tipo = r.encabezados?.['content-type'] ?? '';
  return /text\/html/i.test(tipo) || /^\s*(<!doctype\s+html|<html|<head|<body|<form)/i.test(r.cuerpo);
};

function jsonObjeto(cuerpo: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(cuerpo);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extraerToken(obj: Record<string, unknown>): string | null {
  const candidatos: unknown[] = [
    obj.token, obj.access_token,
    typeof obj.data === 'object' && obj.data !== null ? (obj.data as Record<string, unknown>).token : undefined,
  ];
  for (const c of candidatos) if (typeof c === 'string' && c !== '') return c;
  return null;
}

function urlBase(v: string): string | null {
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:') return null;
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function probarTmsApiLectura(v: ValoresCredencial, http: Http): Promise<ResultadoPrueba> {
  const nombre = NOMBRE_TMS_API_LECTURA;
  return probarConGuardas({ credenciales: CREDENCIALES_TMS_API_LECTURA, nombre }, v, async () => {
    const usuario = (v.usuario ?? '').trim();
    const clave = v.clave ?? '';
    const raiz = urlBase(v.base_url ?? '');
    if (raiz === null) {
      return resultado(false, 'La dirección no es una URL https válida (por ejemplo https://api.tuempresa.com). No se llamó a nadie.', null, 'no_se_sabe');
    }
    const rutaLogin = (v.ruta_login ?? '').trim() || RUTA_LOGIN_POR_DEFECTO;
    const endpointLogin = raiz + (rutaLogin.startsWith('/') ? rutaLogin : `/${rutaLogin}`);
    const limpiar = (t: string, extra?: string): string => redactar(t, [clave, usuario, extra]);

    // 1) Login.
    let login: RespuestaHttp;
    try {
      login = await http({
        url: endpointLogin,
        metodo: 'POST',
        encabezados: { 'content-type': 'application/json', accept: 'application/json' },
        cuerpo: JSON.stringify({ usuario, clave }),
      });
    } catch (e) {
      return resultado(false, limpiar(`No se pudo hablar con ${nombre}: ${fraseDeRed(e)}. Un error de red, de DNS o de tiempo NO significa que la credencial sea mala; significa que no se pudo comprobar.`), null, 'no_se_sabe');
    }
    if (login.estado >= 300 && login.estado < 400) {
      return resultado(false, `${nombre} contestó una redirección (${login.estado}) al iniciar sesión y no se siguió. Suele ser una página de acceso web en medio, no la API: NO se puede afirmar que la credencial sirva.`, endpointLogin, 'no_se_sabe');
    }
    if (login.estado >= 200 && login.estado < 300 && pareceHtml(login)) {
      return resultado(false, `${nombre} contestó 200 al iniciar sesión, pero ${FRASE_PAGINA_DE_ACCESO}. NO se puede afirmar que la credencial sirva.`, endpointLogin, 'no_se_sabe');
    }
    const veredictoLogin = veredictoHttp(login, endpointLogin, nombre);
    if (!veredictoLogin.ok) {
      const extra = login.estado === 403 ? ` ${nombre} ${FRASE_403_IP}. Si la credencial es correcta, pregunta a tu área de sistemas si un firewall o una lista de IP permitidas está bloqueando a Likida.` : '';
      return { ...veredictoLogin, detalle: limpiar(veredictoLogin.detalle + extra) };
    }
    const cuerpoLogin = jsonObjeto(login.cuerpo);
    const token = cuerpoLogin ? extraerToken(cuerpoLogin) : null;
    if (typeof token !== 'string') {
      return resultado(false, `${nombre} contestó 200 al iniciar sesión, pero no con un token que se pueda usar. Suele ser un portal o un proxy en medio. NO se puede afirmar que la credencial sirva.`, endpointLogin, 'no_se_sabe');
    }

    // 2) Un GET de bajo costo con el token.
    const endpointLectura = raiz + RUTA_PRUEBA_LECTURA;
    let lectura: RespuestaHttp;
    try {
      lectura = await http({
        url: endpointLectura,
        metodo: 'GET',
        encabezados: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
    } catch (e) {
      return resultado(false, limpiar(`El inicio de sesión funcionó, pero no se pudo leer de ${nombre}: ${fraseDeRed(e)}. No se pudo comprobar la lectura.`, token), endpointLogin, 'no_se_sabe');
    }
    if (lectura.estado >= 300 && lectura.estado < 400) {
      return resultado(false, `${nombre} contestó una redirección (${lectura.estado}) al leer y no se siguió. NO se puede afirmar que la credencial sirva.`, endpointLectura, 'no_se_sabe');
    }
    if (lectura.estado >= 200 && lectura.estado < 300) {
      if (pareceHtml(lectura)) {
        return resultado(false, `${nombre} contestó 200 al leer, pero ${FRASE_PAGINA_DE_ACCESO}. NO se puede afirmar que la credencial sirva.`, endpointLectura, 'no_se_sabe');
      }
      return resultado(true, `${nombre} aceptó el inicio de sesión y contestó una lectura de prueba (${lectura.estado}). Solo se leyó una fila; no se escribió nada.`, endpointLectura, 'sirve');
    }
    const v2 = veredictoHttp(lectura, endpointLectura, nombre);
    const extra2 = lectura.estado === 403 ? ` ${FRASE_403_IP}: pregunta a tu área de sistemas si una lista de IP permitidas está bloqueando a Likida.` : '';
    return { ...v2, detalle: limpiar(v2.detalle + extra2, token) };
  });
}
