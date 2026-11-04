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

async function seguro(f: () => Promise<void>): Promise<void> {
  try { await f(); } catch { /* best-effort total */ }
}

// Exportes que sacan dinero de la flota (liquidaciones, póliza, facturas de proveedor, conciliaciones, peajes). Los de jornada,
// FAQs del vigía, convenios, carta porte y el PDF suelto no son «de dinero» y no se registran: el ruido no es cobertura.
const EXPORTE_DINERO = /^\/api\/export\/(liquidaciones|liquidaciones-externas|poliza|facturas-proveedor|bitacora-conciliada|bitacora-peaje|peajes-[a-z]+)(\/|$)/;

export function esExporteDeDinero(pathname: string): boolean {
  return EXPORTE_DINERO.test(pathname);
}

/**
 * Se registra cuando la puerta común AUTORIZA la descarga (no cuando termina: una descarga autorizada que luego da 409 también
 * quedó intentada). Solo la ruta, nunca el query (que trae los filtros pedidos y a veces el `?tenant=` de un superadmin).
 */
export async function registrarExporteDinero(a: { url: string; tenantId: string; rol: string; userId?: string | null }): Promise<void> {
  await seguro(async () => {
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
  await seguro(async () => {
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
  await seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'api_v1', tipo: 'llave_invalida', severidad: 'media',
      detalle: { ruta: new URL(req.url).pathname, motivo },
      red: redDeCabeceras(req.headers),
    });
  });
}

/** Una ruta de API negada por el perfil de la flota o por el área de la llave/rol. Informativa: no es un ataque, es cobertura. */
export async function registrarApiNegada(a: { tenantId: string | null | undefined; pathname: string; causa: 'perfil' | 'area_llave' | 'area_rol' }): Promise<void> {
  await seguro(async () => {
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
  await seguro(async () => {
    await registrarEventoSeguridad({
      origen: 'auth', tipo: 'cambio_rol', severidad: a.a === 'flota_admin' ? 'alta' : 'media',
      tenantId: a.tenantId, actor: a.actorId,
      detalle: { usuario: a.usuarioId, de: a.de, a: a.a },
      red: await redDeSolicitudActual(),
    });
  });
}
