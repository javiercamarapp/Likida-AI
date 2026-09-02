// GET /.well-known/oauth-authorization-server — RFC 8414: dónde están
// authorize, token y registro, y qué soporta este servidor de autorización
// (code + PKCE S256 + refresh, clientes públicos por DCR). Público: es
// descubrimiento, no datos.

import { NextResponse } from 'next/server';
import { metadataServidorAutorizacion } from '@/lib/mcp/metadata';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(metadataServidorAutorizacion(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
