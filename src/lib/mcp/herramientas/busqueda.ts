// ═══════════════════════════════════════════════════════════════════════════
// `search` y `fetch` — el par que ChatGPT EXIGE con este nombre y esta forma.
//
// Fuera del developer mode (y en Deep Research / company knowledge), ChatGPT
// solo consume servidores MCP que expongan exactamente estas dos
// herramientas de lectura: `search(query)` → lista de resultados con
// `id`/`title`/`url`, y `fetch(id)` → documento con `id`/`title`/`text`/
// `url`/`metadata` — cada una devuelta como `structuredContent` Y como el
// mismo JSON en el content de texto. (Documentado en
// developers.openai.com/api/docs/mcp, verificado 28-ago-2026.)
//
// Aquí «documento» = un viaje de la flota. La búsqueda cruza folio, origen y
// destino; el fetch devuelve el estado operativo SIEMPRE, y la sección de
// dinero SOLO si la credencial alcanza el área `dinero` — una llave de
// tablero (`operacion`) busca y lee viajes sin ver un peso.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { appUrl } from '@/lib/env';
import { fechaCorta } from '@/lib/formato';
import { getLibroViaje } from '@/lib/likida/libro_viaje';
import { buscarViajesTexto, rotuloViaje, type ViajeOperativo } from './viajes';
import { contarRenglon } from './dinero';
import type { ContextoHerramienta, Herramienta, ResultadoHerramienta } from '../tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function urlDeViaje(id: string): string {
  return `${appUrl()}/dashboard/${id}`;
}

// ── search ─────────────────────────────────────────────────────────────────

const esquemaSearch = z.object({
  query: z.string().min(1).max(200)
    .describe('Qué buscar: un folio de viaje, un origen o un destino (por ejemplo «Monterrey» o «F-0123»).'),
});

function aResultado(v: ViajeOperativo): { id: string; title: string; url: string } {
  return {
    id: v.id,
    title: `${rotuloViaje(v)}${v.fechaInicio ? ` · ${fechaCorta(v.fechaInicio)}` : ''}`,
    url: urlDeViaje(v.id),
  };
}

async function ejecutarSearch(tenantId: string, args: z.infer<typeof esquemaSearch>): Promise<ResultadoHerramienta> {
  const viajes = await buscarViajesTexto(tenantId, args.query);
  const estructurado = { results: viajes.map(aResultado) };
  return {
    // ChatGPT pide el MISMO objeto como JSON en el texto — no una prosa.
    texto: JSON.stringify(estructurado),
    estructurado,
  };
}

export const herramientaSearch: Herramienta<z.infer<typeof esquemaSearch>> = {
  nombre: 'search',
  titulo: 'Buscar viajes',
  descripcion:
    'Busca viajes de tu flota por folio, origen o destino y devuelve una lista de resultados con id, título y liga al panel. Úsala para encontrar el viaje del que se habla; el detalle se pide después con fetch. Solo lectura.',
  area: 'operacion',
  esquema: esquemaSearch,
  ejecutar: ejecutarSearch,
};

// ── fetch ──────────────────────────────────────────────────────────────────

const esquemaFetch = z.object({
  id: z.string().min(1).max(80)
    .describe('El id de un resultado devuelto por search.'),
});

async function ejecutarFetch(
  tenantId: string,
  args: z.infer<typeof esquemaFetch>,
  ctx: ContextoHerramienta,
): Promise<ResultadoHerramienta> {
  if (!UUID.test(args.id.trim())) {
    return { texto: `No existe un documento con id «${args.id}». Los ids salen de search; no se arman a mano.` };
  }
  const renglon = await getLibroViaje(tenantId, args.id.trim());
  if (!renglon) {
    return { texto: `No existe un documento con id «${args.id}» en tu flota.` };
  }

  const veDinero = ctx.alcanza('dinero');
  const textoDoc = veDinero
    ? contarRenglon(renglon)
    : [
        `Viaje ${renglon.folio}${renglon.ruta ? ` · ${renglon.ruta}` : ''}${renglon.fechaInicio ? ` · inició ${fechaCorta(renglon.fechaInicio)}` : ''}`,
        `Estatus: ${renglon.estatus === 'en_cuadre' ? 'en cuadre' : renglon.estatus}${renglon.unidad ? ` · Unidad: ${renglon.unidad}` : ''}`,
        `Comprobantes: ${renglon.documental.rotulo}`,
        'Las cifras de dinero de este viaje no están al alcance de esta credencial.',
      ].join('\n');

  const documento = {
    id: renglon.viajeId,
    title: `Viaje ${renglon.folio}${renglon.ruta ? ` · ${renglon.ruta}` : ''}`,
    text: textoDoc,
    url: urlDeViaje(renglon.viajeId),
    metadata: { estatus: renglon.estatus, fechaInicio: renglon.fechaInicio },
  };
  return { texto: JSON.stringify(documento), estructurado: documento };
}

export const herramientaFetch: Herramienta<z.infer<typeof esquemaFetch>> = {
  nombre: 'fetch',
  titulo: 'Detalle de un viaje',
  descripcion:
    'Devuelve el detalle de un viaje a partir del id que entregó search: estado operativo y de comprobantes siempre, y las cifras de dinero solo si tu acceso las alcanza. Solo lectura.',
  area: 'operacion',
  esquema: esquemaFetch,
  ejecutar: ejecutarFetch,
};
