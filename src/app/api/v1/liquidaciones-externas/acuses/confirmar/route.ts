// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/liquidaciones-externas/acuses/confirmar — el sistema del cliente
// confirma que YA leyó (y registró) estos acuses de choferes.
//
// Cuerpo: `{ "ids": [ … ] }` (1 a 200). Cada elemento es `{ "id", "respuestaEn" }` (los
// dos campos tal como los devolvió `GET …/acuses`: confirma SOLO ese acuse; si el chofer
// cambió su respuesta entre la lectura y la confirmación, sale en `cambiaron` y NO se
// confirma) o el uuid suelto (forma anterior: confirma lo que haya en ese momento). Responde qué ids se confirmaron ahora, cuáles ya
// estaban confirmadas (un reintento es inocuo: IDEMPOTENTE) y cuáles no aplican
// (no existen en esta flota o todavía no tienen acuse; no se distingue cuál para
// no revelar liquidaciones ajenas).
//
// Área `administracion`: confirmar es una escritura que decide qué sale en la
// siguiente lectura del integrador.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, fallo } from '../../../_comun';
import { leerCuerpo, validar } from '../../../_escritura';
import { validarConfirmaciones } from './validar_ids';
import { confirmarAcusesLeidos } from '@/lib/likida/liquidacion_externa/servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const v = validar('v1.liquidaciones_externas.acuses_confirmar', () => validarConfirmaciones(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;

  try {
    // A37-S11-02: lo que el integrador LEYÓ (`respuestaEn` por id) viaja al servicio; sin él (solo el uuid) no hay candado.
    const leidos = new Map(v.valor.filter((c) => c.respuestaEn !== null).map((c) => [c.id, c.respuestaEn as string]));
    const r = await confirmarAcusesLeidos(acceso.tenantId, v.valor.map((c) => c.id), 'api', undefined, leidos.size > 0 ? leidos : undefined);
    return NextResponse.json({ datos: r });
  } catch (e) {
    return fallo('v1.liquidaciones_externas.acuses_confirmar', e, { tenant: acceso.tenantId });
  }
}
