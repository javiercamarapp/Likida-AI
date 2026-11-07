import { after } from 'next/server';
import { registrarEventoSeguridad } from './eventos';
import { huellaCuenta, redDeCabeceras, type RedEvento } from './evento_red';

// ═══════════════════════════════════════════════════════════════════════════
// LOS REGISTROS DE ACCESO DE CT-SEG-11: login fallido, llave v1 inválida, ruta
// negada, exporte de dinero y cambio de rol. Un solo sitio donde se decide QUÉ
// se guarda de cada uno (nunca el correo, nunca la llave, nunca el query) para
// que los llamadores sean una línea y no puedan filtrar de más.
//
// REGLA: todas son best-effort total y se llaman con `void`: vigilar un camino
// jamás puede tumbarlo. Cada una atrapa todo, incluida la lectura de cabeceras.
// ═══════════════════════════════════════════════════════════════════════════

/** La red de la petición en curso (server action, route handler o componente de servidor); undefined si no hay petición. */
export async function redDeSolicitudActual(): Promise<RedEvento | undefined> {
  try {
    const { headers } = await import('next/headers');
    return redDeCabeceras(await headers());
  } catch {
    return undefined;
  }
}

/**
 * Corre el registro y, dentro de una petición, lo ata a `after()` de Next: en Vercel el trabajo que sigue a la respuesta se congela si
 * nadie lo espera, y un `void` pelón perdía justo los registros de los caminos que redirigen (login, callback). Fuera de una petición
 * (pruebas, scripts) `after` lanza y se sigue con la promesa suelta, como el resto de los escritores de eventos.
 */
function seguro(f: () => Promise<void>): Promise<void> {
  const p = (async () => { try { await f(); } catch { /* best-effort total */ } })();
  try { after(p); } catch { /* fuera de una petición */ }
  return p;
}

// Exportes que sacan dinero de la flota (liquidaciones, póliza, facturas de proveedor, conciliaciones, peajes). Los de jornada,
// FAQs del vigía, convenios, carta porte y el PDF suelto no son «de dinero» y no se registran: el ruido no es cobertura.
const EXPORTE_DINERO = /^\/api\/export\/(liquidaciones|liquidaciones-externas|poliza|facturas-proveedor|bitacora-conciliada|bitacora-peaje|peajes-[a-z]+)(\/|$)/;

export function esExporteDeDinero(pathname: string): boolean {
  return EXPORTE_DINERO.test(pathname);
}

// Segunda lista (R7-A2), SOLO para exigir el segundo factor (`exporte_dinero` de stepup.ts); la bitácora de arriba sigue con la suya, así
// que ampliar una no ensucia la otra. Son los exportes de dinero MÁS los que, sin estar en la bitácora, también entregan cifras:
//   · /api/export/pdf/[id]: el PDF de la liquidación (lo que se le paga a cada operador).
//   · /api/export/convenios?tipo=completo: tarifas y requisitos de cobro. Los tipos `instrucciones`, `texto` y `plantilla` no traen
//     dinero (la ruta ni lo lee de la base), así que NO piden el paso.
// /api/export/jornada queda FUERA a propósito: es el registro de jornada del art. 132 LFT (horas, no pesos; ver la nota de su ruta).
const EXPORTE_PDF_LIQUIDACION = /^\/api\/export\/pdf\/[^/]+\/?$/;
const EXPORTE_CONVENIOS = /^\/api\/export\/convenios\/?$/;

/** ¿Esta descarga exige segundo factor reciente a dueño y contador? Recibe la URL completa porque `convenios` depende de `?tipo=`. */
export function exporteExigeStepUp(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (esExporteDeDinero(u.pathname) || EXPORTE_PDF_LIQUIDACION.test(u.pathname)) return true;
  if (EXPORTE_CONVENIOS.test(u.pathname)) return (u.searchParams.get('tipo')?.trim() ?? '') === 'completo';
  return false;
}

/**
 * Se registra cuando la puerta común AUTORIZA la descarga (no cuando termina: una descarga autorizada que luego da 409 también
 * quedó intentada). Solo la ruta, nunca el query (que trae los filtros pedidos y a veces el `?tenant=` de un superadmin).
 */
export async function registrarExporteDinero(a: { url: string; tenantId: string; rol: string; userId?: string | null }): Promise<void> {
  return seguro(async () => {
    const ruta = new URL(a.url).pathname;
    if (!esExporteDeDinero(ruta)) return;
    await registrarEventoSeguridad({
      origen: 'export', tipo: 'exporte_dinero', severidad: 'info',
      tenantId: a.tenantId, actor: a.userId ?? null,
      detalle: { ruta, rol: a.rol },
      red: await redDeSolicitudActual(),
    });
  });
}

/** Un intento de entrada que no terminó en sesión. El actor es una huella de la cuenta, jamás el correo. */
export async function registrarLoginFallido(a: { motivo: string; email?: string | null }): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'auth', tipo: 'login_fallido', severidad: 'media',
      actor: a.email ? huellaCuenta(a.email) : null,
      detalle: { motivo: a.motivo },
      red: await redDeSolicitudActual(),
    });
  });
}

/** Una llave de API que no abre. La red sale de la propia petición; ni la llave ni el query se guardan. */
export async function registrarLlaveInvalida(req: Request, motivo: string): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'api_v1', tipo: 'llave_invalida', severidad: 'media',
      detalle: { ruta: new URL(req.url).pathname, motivo },
      red: redDeCabeceras(req.headers),
    });
  });
}

/** Una ruta de API negada por el perfil de la flota o por el área de la llave/rol. Informativa: no es un ataque, es cobertura. */
export async function registrarApiNegada(a: { tenantId: string | null | undefined; pathname: string; causa: 'perfil' | 'area_llave' | 'area_rol' }): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'api_v1', tipo: 'api_negada', severidad: 'info',
      tenantId: a.tenantId ?? null,
      detalle: { ruta: a.pathname, causa: a.causa },
      red: await redDeSolicitudActual(),
    });
  });
}

/** Un cambio de rol hecho desde el panel. Subir a dueño es escalada de privilegio: severidad alta (avisa). */
export async function registrarCambioRol(a: { tenantId: string; actorId: string; usuarioId: string; de: string; a: string }): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'auth', tipo: 'cambio_rol', severidad: a.a === 'flota_admin' ? 'alta' : 'media',
      tenantId: a.tenantId, actor: a.actorId,
      detalle: { usuario: a.usuarioId, de: a.de, a: a.a },
      red: await redDeSolicitudActual(),
    });
  });
}

/**
 * Un límite de tasa que BLOQUEÓ (CT-SEG-11, F2). Solo la categoría de la llave (`lead`, `mcp`, `peajes`…): la llave completa trae IPs,
 * correos o teléfonos. La emite `rateLimit()` con sus propios frenos (uno por categoría por minuto y por instancia). Informativa.
 */
export async function registrarRateLimit(categoria: string): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'ratelimit', tipo: 'rate_limit', severidad: 'info',
      detalle: { categoria },
      red: await redDeSolicitudActual(),
    });
  });
}

/**
 * Un correo entrante cuya firma (Svix/Resend) no verificó. Se guarda el MOTIVO corto, nunca la firma ni el cuerpo. Media y no alta: el
 * endpoint es público y cualquier escáner lo toca; avisar por correo cada sondeo sería ruido, no cobertura.
 */
export async function registrarFirmaCorreoInvalida(req: Request, motivo: string): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'correo_webhook', tipo: 'firma_invalida', severidad: 'media',
      detalle: { motivo },
      red: redDeCabeceras(req.headers),
    });
  });
}

/** Una página del panel negada por rol o por perfil (redirige sin más). Informativa: es cobertura de quién toca lo que no le toca. */
export async function registrarPaginaNegada(a: { ruta: string; rol: string; causa: 'rol' | 'perfil' | 'superadmin' | 'vendedor'; tenantId?: string | null; userId?: string | null }): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'auth', tipo: 'pagina_negada', severidad: 'info',
      tenantId: a.tenantId ?? null, actor: a.userId ?? null,
      detalle: { ruta: a.ruta.split('?')[0], rol: a.rol, causa: a.causa },
      red: await redDeSolicitudActual(),
    });
  });
}

/** El segundo factor de un superadmin no está al día (sin factor, sin verificar, o no se pudo preguntar). El veredicto dice cuál. */
export async function registrarMfaFallido(a: { veredicto: string; destino: string; via: 'pagina' | 'api'; userId?: string | null }): Promise<void> {
  return seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'auth', tipo: 'mfa_fallido', severidad: 'media',
      actor: a.userId ?? null,
      detalle: { veredicto: a.veredicto, destino: a.destino.split('?')[0], via: a.via },
      red: await redDeSolicitudActual(),
    });
  });
}
