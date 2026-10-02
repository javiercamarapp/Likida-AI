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
import { leerCuerpo, validar, CampoInvalido } from '../../../_escritura';
import { confirmarAcusesLeidos, MAX_IDS_CONFIRMACION } from '@/lib/likida/liquidacion_externa/servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarIds(crudo: unknown): string[] {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw new CampoInvalido('cuerpo', 'El cuerpo tiene que ser un objeto `{ "ids": [...] }`.');
  }
  const extra = Object.keys(crudo as Record<string, unknown>).filter((k) => k !== 'ids');
  if (extra.length > 0) throw new CampoInvalido(extra[0], `Campo desconocido: \`${extra[0].slice(0, 40)}\`. Solo se acepta \`ids\`.`);
  const ids = (crudo as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new CampoInvalido('ids', '`ids` tiene que ser una lista con al menos un id.');
  if (ids.length > MAX_IDS_CONFIRMACION) throw new CampoInvalido('ids', `\`ids\` admite hasta ${MAX_IDS_CONFIRMACION} ids por llamada.`);
  return ids.map((id, i) => {
    if (typeof id !== 'string' || !UUID.test(id)) throw new CampoInvalido(`ids[${i}]`, `\`ids[${i}]\` tiene que ser el uuid de una liquidación.`);
    return id.toLowerCase();
  });
}

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
