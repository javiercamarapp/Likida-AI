// GET /.well-known/oauth-protected-resource — la misma metadata (RFC 9728)
// SIN el sufijo de path: hay clientes que la buscan en la raíz del host.
// Sirve el mismo documento que la variante /api/mcp para que ninguno de los
// dos caminos de descubrimiento se quede a oscuras.

import { NextResponse } from 'next/server';
import { metadataRecursoProtegido } from '@/lib/mcp/metadata';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(metadataRecursoProtegido(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
