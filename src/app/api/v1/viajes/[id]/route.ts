// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/viajes/{id} — un viaje, por su uuid.
//
// ── EL IDOR VIVE AQUÍ, NO EN LA LISTA ────────────────────────────────────
//
// Una lista filtrada por tenant es difícil de equivocar; un detalle por id es
// la forma canónica del fallo, porque el id llega del cliente y basta con
// olvidarse de un `.eq('tenant_id', …)` para servir el viaje de otra flota a
// quien adivine un uuid. Este archivo no arma la consulta: se la pide a
// `getLibroViaje(tenantId, viajeId)`, que filtra por LOS DOS y devuelve `null`
// cuando el viaje no es de esta flota. `tenantId` sale de `abrir()`, o sea de
// la credencial; `viajeId` es lo único que aporta la URL.
//
// "No existe" y "no es tuyo" contestan lo MISMO (404). Distinguirlos convierte
// la ruta en un oráculo de existencia: con un 403 para "no es tuyo", cualquiera
// puede enumerar qué uuids son viajes reales de otras flotas. Es el mismo
// criterio que ya aplica `/api/export/pdf/[id]`.
//
// ── AQUÍ NO SALE UN PESO ─────────────────────────────────────────────────
//
// Mismo criterio que la lista: el área es `operacion` y el dinero del viaje
// vive en `/v1/viajes/{id}/contribucion`, gateado por `dinero`. `getLibroViaje`
// SÍ trae ingreso, comprobado, contribución, margen y cobranza; esta ruta los
// deja fuera a propósito, para que un jefe de tráfico pueda consumir el detalle
// operativo sin que se le abran las finanzas de la empresa.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getLibroViaje, type Documental } from '@/lib/likida/libro_viaje';
import { abrir, errorApi, fallo } from '../../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ViajeDetalleApi {
  id: string;
  folio: string;
  /** `Monterrey → Querétaro`, o el único extremo capturado, o `null`. */
  ruta: string | null;
  fechaInicio: string | null;
  estatus: string;
  cliente: string | null;
  /** Número económico. `null` = el viaje entró por WhatsApp y no trae unidad. */
  unidad: string | null;
  operador: string | null;
  /** `null` = el viaje todavía no se cuadró. Con id, hay liquidación cerrada. */
  liquidacionId: string | null;
  /** Cuántos comprobantes llegaron y cuántos traen CFDI. Son CONTEOS, no
   *  importes: por eso esta ruta puede seguir siendo de área `operacion`. */
  documental: Documental;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  // Un id con forma equivocada le llega a Postgres como `invalid input syntax
  // for type uuid` y eso sube como excepción: sería un 500 por una petición
  // mal escrita, y el log se llenaría de errores que no son fallos nuestros.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return errorApi('parametro_invalido', 'El id del viaje tiene que ser un uuid.');
  }

  try {
    const renglon = await getLibroViaje(acceso.tenantId, id);
    // `null` significa AHORA una sola cosa —no existe en esta flota— porque
    // `exigir()` traduce el error por valor de supabase-js a excepción. Sin eso
    // una base caída se leería como "ese viaje no existe" y contestaríamos 404
    // sobre un viaje real.
    if (!renglon) return errorApi('no_encontrado', 'No hay un viaje con ese id en tu flota.');

    const datos: ViajeDetalleApi = {
      id: renglon.viajeId,
      folio: renglon.folio,
      ruta: renglon.ruta,
      fechaInicio: renglon.fechaInicio,
      estatus: renglon.estatus,
      cliente: renglon.cliente,
      unidad: renglon.unidad,
      operador: renglon.operador,
      liquidacionId: renglon.liquidacionId,
      documental: renglon.documental,
    };
    return NextResponse.json({ datos });
  } catch (e) {
    return fallo('v1.viaje_detalle', e, { tenant: acceso.tenantId, viaje: id });
  }
}
