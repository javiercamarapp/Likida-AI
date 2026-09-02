// GET /.well-known/oauth-protected-resource/api/mcp — RFC 9728 con el path
// del recurso como sufijo, que es la forma en que los clientes MCP derivan
// esta URL desde `https://…/api/mcp`. Público a propósito: es un documento
// de descubrimiento, no enseña nada de nadie.

import { NextResponse } from 'next/server';
import { metadataRecursoProtegido } from '@/lib/mcp/metadata';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(metadataRecursoProtegido(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
