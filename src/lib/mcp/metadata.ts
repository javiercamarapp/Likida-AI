// Los dos documentos de descubrimiento OAuth del servidor MCP, en un solo
// lugar para que las DOS rutas que los sirven (y las pruebas) digan lo mismo.
//
// · Protected Resource Metadata (RFC 9728): «este recurso se autoriza en tal
//   servidor» — es lo que el cliente lee después del 401 de /api/mcp.
// · Authorization Server Metadata (RFC 8414): dónde están authorize, token y
//   registro, y qué se soporta (code + PKCE S256 + refresh, cliente público).

import { appUrl } from '@/lib/env';
import { SCOPE_LECTURA, recursoCanonico } from '@/lib/mcp/oauth';

export function metadataRecursoProtegido(): Record<string, unknown> {
  return {
    resource: recursoCanonico(),
    authorization_servers: [appUrl()],
    scopes_supported: [SCOPE_LECTURA],
    bearer_methods_supported: ['header'],
    resource_name: 'Likida — los datos de tu flota',
    resource_documentation: `${appUrl()}/api/v1/openapi`,
  };
}

export function metadataServidorAutorizacion(): Record<string, unknown> {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/mcp/autorizar`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/registro`,
    scopes_supported: [SCOPE_LECTURA],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Clientes PÚBLICOS con PKCE: ni Claude ni ChatGPT guardan un secreto
    // nuestro, y un secreto repartido a clientes que no pueden guardarlo no
    // protege nada.
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  };
}
