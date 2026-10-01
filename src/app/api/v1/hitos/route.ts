// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/hitos — los hitos del viaje (llegada a carga, salida de carga, llegada a
// descarga, salida de descarga, regreso) que el Agente 5 «Conductor» pide al chofer
// por WhatsApp, para el TMS/SAP de la flota.
//
// ── QUÉ ES CADA HORA ───────────────────────────────────────────────────────
// `horaMensaje` es la del MENSAJE del chofer según Meta; `recibidoEn`, cuándo lo
// recibió Likida. NINGUNA es telemetría del evento físico (el chofer puede avisar
// tarde): el cliente que cruce esto contra su GPS tiene que saberlo.
//
// ── AQUÍ NO SALE UN PESO NI EL TEXTO CRUDO ──────────────────────────────────
// Área `operacion`: un tablero de tráfico lo lee. Sí salen el contacto en andén y
// las coordenadas (lo que el cliente pidió); no el texto que escribió el chofer.
//
// Siempre acotado por la flota de la credencial; `viajeId`/`folio` solo FILTRAN
// dentro de ella. Sincronización incremental: `?desde=<ISO>` (lo actualizado
// desde entonces) o el feed `/v1/hitos/eventos`.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { leerFiltrosHitos } from '@/lib/likida/conductor/lectura';
import { leerHitos } from '@/lib/likida/conductor/repo';
import { abrir, leerPagina, sobre, errorApi, fallo } from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  const filtros = leerFiltrosHitos(req.url);
  if ('error' in filtros) return errorApi('parametro_invalido', filtros.error);

  try {
    const { filas, hayMas } = await leerHitos(acceso.tenantId, filtros.ok, pag.pagina.limite, pag.pagina.desplazamiento);
    return NextResponse.json(sobre(filas, pag.pagina, null, { hayMas }));
  } catch (e) {
    return fallo('v1.hitos', e, { tenant: acceso.tenantId });
  }
}
