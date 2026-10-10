// ═══════════════════════════════════════════════════════════════════════════
// PUT /v1/viajes/{id}/sitios — qué sitio espera cada hito de un viaje: el de CARGA (contra el que se valida la
// llegada a carga) y el de DESCARGA. Cuerpo (al menos uno; `null` desasigna):
//
//   { "origen": "PL-ZAP", "destino": "<uuid del sitio>" }
//
// Cada lado es el CÓDIGO del sitio (el del sistema del cliente) o su id, y se resuelve DENTRO de la flota de la
// credencial: un sitio de otra flota es «no existe». Sin sitio asignado, las llegadas del viaje se quedan «sin
// dato» al validarlas (nunca «no coincide»). PUT es idempotente.
//
// ── ÁREA `administracion` (como PUT /v1/viajes/{id}/citas) ───────────────────
// «No existe el viaje» y «no es de tu flota» contestan lo MISMO (404).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { UUID } from '@/lib/likida/conductor/lectura';
import { asignarSitiosViaje } from '@/lib/likida/conductor/repo_validacion';
import { abrir, errorApi, fallo } from '../../../_comun';
import { leerCuerpo } from '../../../_escritura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  if (!UUID.test(id)) return errorApi('parametro_invalido', 'El id del viaje tiene que ser un uuid.');

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const o = cuerpo.cuerpo;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return errorApi('parametro_invalido', 'El cuerpo tiene que ser un objeto JSON.');
  const cuerpoObj = o as Record<string, unknown>;
  const desconocidas = Object.keys(cuerpoObj).filter((k) => k !== 'origen' && k !== 'destino');
  if (desconocidas.length > 0) return errorApi('parametro_invalido', `Llaves desconocidas: ${desconocidas.slice(0, 5).join(', ')}. Las válidas son: origen, destino.`);
  if (!('origen' in cuerpoObj) && !('destino' in cuerpoObj)) return errorApi('parametro_invalido', 'Manda `origen`, `destino` o los dos.');

  const cambio: { origen?: string | null; destino?: string | null } = {};
  for (const lado of ['origen', 'destino'] as const) {
    if (!(lado in cuerpoObj)) continue;
    const v = cuerpoObj[lado];
    if (v === null) { cambio[lado] = null; continue; }
    if (typeof v !== 'string' || v.trim() === '' || v.trim().length > 40 && !UUID.test(v.trim())) {
      return errorApi('parametro_invalido', `\`${lado}\` es el código o el id del sitio (o null para desasignar).`);
    }
    cambio[lado] = v.trim();
  }

  try {
    const r = await asignarSitiosViaje(acceso.tenantId, id.toLowerCase(), cambio);
    if (r === 'viaje_no_encontrado') return errorApi('no_encontrado', 'No hay un viaje con ese id en tu flota.');
    if (r === 'sitio_no_encontrado') return errorApi('parametro_invalido', 'Alguno de los sitios no existe en tu catálogo (se busca por código o id).');
    return NextResponse.json({ datos: { viajeId: id.toLowerCase(), ...cambio } });
  } catch (e) {
    return fallo('v1.viaje_sitios', e, { tenant: acceso.tenantId, viaje: id });
  }
}
