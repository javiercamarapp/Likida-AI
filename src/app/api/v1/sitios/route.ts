// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/sitios — el catálogo de sitios (clientes, plantas y andenes) de la flota: nombre, tipo, código,
// centro, radio y de dónde salió el dato. Área `operacion`; siempre acotado a la flota de la credencial.
//
//   ?q=<texto>   busca por nombre o código (≤ 60 caracteres)
//   ?tipo=cliente|planta|anden|patio|punto_interes
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { TIPOS_SITIO, type TipoSitio } from '@/lib/likida/conductor/sitios';
import { listarSitios } from '@/lib/likida/conductor/repo_validacion';
import { abrir, errorApi, fallo } from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;
  const p = new URL(req.url).searchParams;
  const tipo = p.get('tipo');
  if (tipo !== null && tipo !== '' && !(TIPOS_SITIO as readonly string[]).includes(tipo)) {
    return errorApi('parametro_invalido', `\`tipo\` es uno de: ${TIPOS_SITIO.join(', ')}.`);
  }
  try {
    const { sitios, hayMas } = await listarSitios(acceso.tenantId, { busqueda: p.get('q') ?? '', tipo: tipo ? (tipo as TipoSitio) : undefined, limite: 200 });
    return NextResponse.json({ datos: sitios.map((s) => ({
      id: s.id, nombre: s.nombre, tipo: s.tipo, codigo: s.codigo, direccion: s.direccion, lat: s.lat, lng: s.lng, radioM: s.radioM,
      activo: s.activa, fuente: s.fuente, clienteId: s.clienteId, padreId: s.padreId,
    })), hayMas });
  } catch (e) {
    return fallo('v1.sitios', e, { tenant: acceso.tenantId });
  }
}
