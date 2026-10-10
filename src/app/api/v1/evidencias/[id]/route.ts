// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/evidencias/{id} — abre la foto de evidencia de un hito (sello, andén, sello de recibido).
//
// Contesta 302 a una URL FIRMADA de 10 minutos del bucket privado `comprobantes`: el archivo nunca es público
// y el enlace caduca. Área `operacion`; la evidencia se busca SIEMPRE dentro de la flota de la credencial, y
// la ruta se firma solo si cuelga del prefijo de esa flota (doble candado). «No existe», «es de otra flota» y
// «ya se purgó por retención» contestan lo mismo (404).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { UUID } from '@/lib/likida/conductor/lectura';
import { rutaDeEvidencia, urlFirmadaEvidencia } from '@/lib/likida/conductor/repo_validacion';
import { abrir, errorApi, fallo } from '../../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  if (!UUID.test(id)) return errorApi('parametro_invalido', 'El id de la evidencia tiene que ser un uuid.');
  const noExiste = () => errorApi('no_encontrado', 'No hay una evidencia con ese id en tu flota (o ya se purgó por retención).');

  try {
    const ruta = await rutaDeEvidencia(acceso.tenantId, id.toLowerCase());
    if (!ruta) return noExiste();
    const url = await urlFirmadaEvidencia(acceso.tenantId, ruta);
    if (!url) return noExiste();
    return NextResponse.redirect(url, 302);
  } catch (e) {
    return fallo('v1.evidencia', e, { tenant: acceso.tenantId, evidencia: id });
  }
}
