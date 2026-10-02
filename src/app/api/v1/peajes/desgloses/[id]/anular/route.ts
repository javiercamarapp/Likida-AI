// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/peajes/desgloses/{id}/anular — anula un desglose subido por error
// (archivo de otra flota, periodo equivocado, proveedor mal elegido).
//
// Cuerpo: `{ "motivo": "texto de 1 a 500 caracteres" }` — OBLIGATORIO: una
// anulación sin porqué es justo la que nadie puede defender después.
//
// NO se borra: el desglose queda de constancia con quién y por qué. Deja de
// aparecer en el tablero, de contar en la bitácora RMF 9.1.8, de exportarse y de
// avisar a la oficina; y su archivo de la cola libera la huella, de modo que el
// archivo CORRECTO (o el mismo, ya arreglado) puede volver a mandarse. IDEMPOTENTE:
// anular lo ya anulado responde 200 con `yaAnulado: true`. «No existe» y «no es de
// tu flota» contestan lo mismo (404).
//
// Área `administracion`: anular quita un dato de la contabilidad de la flota.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi, fallo } from '../../../../_comun';
import { leerCuerpo, validar, CampoInvalido } from '../../../../_escritura';
import { anularDesgloseDb } from '@/lib/likida/peajes/datos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarAnulacion(crudo: unknown): string {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw new CampoInvalido('cuerpo', 'El cuerpo tiene que ser un objeto `{ "motivo": "..." }`.');
  }
  const extra = Object.keys(crudo as Record<string, unknown>).filter((k) => k !== 'motivo');
  if (extra.length > 0) throw new CampoInvalido(extra[0], `Campo desconocido: \`${extra[0].slice(0, 40)}\`. Solo se acepta \`motivo\`.`);
  const motivo = (crudo as { motivo?: unknown }).motivo;
  if (typeof motivo !== 'string' || motivo.trim().length === 0) throw new CampoInvalido('motivo', '`motivo` es obligatorio (texto de 1 a 500 caracteres).');
  if (motivo.trim().length > 500) throw new CampoInvalido('motivo', '`motivo` pasa de 500 caracteres.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(motivo)) throw new CampoInvalido('motivo', '`motivo` no puede traer caracteres de control.');
  return motivo.trim();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  if (!UUID.test(id)) return errorApi('parametro_invalido', 'El id del desglose tiene que ser un uuid.');

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const v = validar('v1.peajes.anular', () => validarAnulacion(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;

  try {
    const r = await anularDesgloseDb(acceso.tenantId, id.toLowerCase(), v.valor, `api:${acceso.rol}`);
    if (r === 'no_encontrado') return errorApi('no_encontrado', 'No hay un desglose con ese id en tu flota.');
    return NextResponse.json({ datos: { id: id.toLowerCase(), anulado: true, yaAnulado: r === 'ya_anulado' } });
  } catch (e) {
    return fallo('v1.peajes.anular', e, { tenant: acceso.tenantId, desglose: id });
  }
}
