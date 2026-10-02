// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/liquidaciones-externas/acuses/confirmar — el sistema del cliente
// confirma que YA leyó (y registró) estos acuses de choferes.
//
// Cuerpo: `{ "ids": ["<uuid de liquidación>", …] }` (1 a 200 ids; los `id` que
// devolvió `GET …/acuses`). Responde qué ids se confirmaron ahora, cuáles ya
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
import { validarIds } from './validar_ids';
import { confirmarAcusesLeidos } from '@/lib/likida/liquidacion_externa/servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const v = validar('v1.liquidaciones_externas.acuses_confirmar', () => validarIds(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;

  try {
    const r = await confirmarAcusesLeidos(acceso.tenantId, v.valor, 'api');
    return NextResponse.json({ datos: r });
  } catch (e) {
    return fallo('v1.liquidaciones_externas.acuses_confirmar', e, { tenant: acceso.tenantId });
  }
}
