// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE /api/mcp — de qué flota habla esta sesión MCP, y qué alcanza.
//
// Es el equivalente de `_comun.ts` para la puerta MCP, con una diferencia
// deliberada: aquí NO hay rama de cookie. Un cliente MCP no es un navegador
// con sesión del panel; llega SIEMPRE con `Authorization: Bearer`, y ese
// Bearer es una de DOS credenciales que ya nacen atadas a una flota:
//
//   · una LLAVE de API por flota (`lk_live_…`, /dashboard/llaves-api), con su
//     área acotada — el camino para Claude Code y para pruebas locales;
//   · un TOKEN de acceso OAuth (`lk_mcp_at_…`), emitido por /mcp/autorizar
//     contra la sesión del panel — el camino para Claude.ai y ChatGPT.
//
// EL TENANT SALE DE LA CREDENCIAL. PUNTO. No hay parámetro, header ni campo
// del protocolo que pueda cambiarlo: la credencial YA trae `tenant_id`
// resuelto, y si no se puede resolver, se falla cerrado diciendo por qué.
// ═══════════════════════════════════════════════════════════════════════════

import { llaveDelHeader, resolverLlave } from '@/lib/auth/llave-api';
import { areaDeLlaveAlcanza } from '@/app/api/v1/_comun';
import { puedeVerArea, type Area } from '@/lib/auth/visibilidad';
import { validarAcceso, PREFIJO_ACCESO, PREFIJO_REFRESCO, PREFIJO_CODIGO } from '@/lib/mcp/oauth';
import type { ActorBitacora } from '@/lib/likida/bitacora_escritura';

export interface CredencialMcp {
  tenantId: string;
  /** `llave:<area>` o el rol de la persona (`flota_admin`, `contador`…). */
  rol: string;
  /** ¿Esta credencial alcanza para el área que pide una herramienta? */
  alcanza: (area: Area) => boolean;
  /** Con qué se firma la bitácora de cada consulta. */
  actor: ActorBitacora;
  /** `llave` o `oauth` — para el log y la bitácora, nunca para autorizar. */
  via: 'llave' | 'oauth';
}

export type ResultadoCredencial =
  | { ok: true; credencial: CredencialMcp }
  | { ok: false; status: 401 | 503; motivo: string };

/**
 * Resuelve el header `Authorization` de una petición MCP.
 *
 * Falla cerrado en los dos sentidos de siempre: credencial mala → 401 con
 * texto único; base que no contesta → 503, NUNCA 401 (un bache de red
 * respondido como «no autorizado» haría que Claude descartara un token bueno
 * y le pidiera al usuario reconectar).
 */
export async function resolverCredencialMcp(authorization: string | null): Promise<ResultadoCredencial> {
  const bearer = llaveDelHeader(authorization);
  if (!bearer) {
    return { ok: false, status: 401, motivo: 'Falta la credencial. Conecta Likida desde tu cliente (OAuth) o usa una llave de API.' };
  }

  if (bearer.startsWith(PREFIJO_ACCESO)) {
    const r = await validarAcceso(bearer);
    if (!r.ok) {
      return r.error === 'no_disponible'
        ? { ok: false, status: 503, motivo: r.detalle }
        : { ok: false, status: 401, motivo: r.detalle };
    }
    const rol = r.acceso.rol;
    return {
      ok: true,
      credencial: {
        tenantId: r.acceso.tenantId,
        rol,
        alcanza: (area) => puedeVerArea(rol, area),
        actor: { id: r.acceso.userId, email: r.acceso.userEmail },
        via: 'oauth',
      },
    };
  }

  // Un refresco o un código pegados donde va el acceso NO se «aprovechan»:
  // cada credencial sirve solo para lo suyo, y decir cuál llegó ayuda a
  // quien configura sin regalarle nada a quien prueba.
  if (bearer.startsWith(PREFIJO_REFRESCO) || bearer.startsWith(PREFIJO_CODIGO)) {
    return { ok: false, status: 401, motivo: 'Esa credencial no es un token de acceso. Vuelve a conectar Likida desde tu cliente.' };
  }

  const l = await resolverLlave(bearer);
  if (!l.ok) return { ok: false, status: l.status, motivo: l.motivo };
  return {
    ok: true,
    credencial: {
      tenantId: l.tenantId,
      rol: `llave:${l.area}`,
      alcanza: (area) => areaDeLlaveAlcanza(l.area, area),
      // Una llave no es una persona: se firma como sistema y el detalle de la
      // bitácora dice la vía. El id de la llave no es un actor del dominio.
      actor: 'sistema',
      via: 'llave',
    },
  };
}
