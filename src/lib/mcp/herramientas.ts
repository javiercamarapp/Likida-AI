// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO Y EL DESPACHADOR de herramientas MCP.
//
// El despachador es la SEGUNDA puerta (la primera es la credencial, en la
// ruta): valida los argumentos contra el esquema y exige el ÁREA de la
// herramienta contra la credencial ANTES de ejecutar nada. Una herramienta
// de dinero con una llave de tablero no se ejecuta y lo dice — el mismo
// fail-closed de `abrir()` en /v1.
//
// TODAS las herramientas son de solo lectura y así se declaran al cliente
// (`annotations.readOnlyHint`). La bitácora de cada llamada la anota la
// ruta, que es quien conoce al actor.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import type { Area } from '@/lib/auth/visibilidad';
import type { ContextoHerramienta, Herramienta, ResultadoHerramienta } from './tipos';
import { herramientaListarViajes } from './herramientas/viajes';
import {
  herramientaCuadreViaje, herramientaPorFacturar, herramientaResumenFiscal, herramientaMetricasFlota,
} from './herramientas/dinero';
import { herramientaUnidadesVigencias } from './herramientas/unidades';
import { herramientaSearch, herramientaFetch } from './herramientas/busqueda';

// El tipo del argumento se borra en el catálogo A PROPÓSITO: cada
// herramienta valida su forma con zod antes de ejecutar (`despachar`), y el
// catálogo no necesita saberla. El doble cast es el peaje de que
// `Herramienta<T>` sea invariante en T; lo que protege de verdad es el
// `safeParse` del despachador, no este tipo.
const CATALOGO = [
  herramientaListarViajes,
  herramientaUnidadesVigencias,
  herramientaCuadreViaje,
  herramientaPorFacturar,
  herramientaResumenFiscal,
  herramientaMetricasFlota,
  herramientaSearch,
  herramientaFetch,
] as unknown as ReadonlyArray<Herramienta<never>>;

export function catalogoHerramientas(): ReadonlyArray<Herramienta<never>> {
  return CATALOGO;
}

/** La entrada de `tools/list` para el cliente, con el esquema en JSON Schema. */
export function describirHerramientas(): Array<Record<string, unknown>> {
  return CATALOGO.map((h) => ({
    name: h.nombre,
    title: h.titulo,
    description: h.descripcion,
    inputSchema: z.toJSONSchema(h.esquema),
    annotations: {
      title: h.titulo,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

export type ResultadoDespacho =
  | { ok: true; resultado: ResultadoHerramienta; area: Area }
  /** La herramienta no existe: error de PROTOCOLO (-32602), no de ejecución. */
  | { ok: false; tipo: 'desconocida'; mensaje: string }
  /** Argumentos que no pasan el esquema: error de ejecución que el modelo
   *  puede corregir (isError: true con el detalle). */
  | { ok: false; tipo: 'argumentos'; mensaje: string }
  /** La credencial no alcanza el área: se dice sin ejecutar. */
  | { ok: false; tipo: 'sin_permiso'; area: Area; mensaje: string };

export async function despacharHerramienta(
  nombre: string,
  args: unknown,
  tenantId: string,
  alcanza: (area: Area) => boolean,
): Promise<ResultadoDespacho> {
  const h = CATALOGO.find((x) => x.nombre === nombre);
  if (!h) {
    return { ok: false, tipo: 'desconocida', mensaje: `No existe la herramienta «${nombre}».` };
  }
  // Cualquiera de las áreas declaradas alcanza (TC-N4); sin lista, solo `area`.
  if (!(h.areasQueAlcanzan ?? [h.area]).some((a) => alcanza(a))) {
    return {
      ok: false,
      tipo: 'sin_permiso',
      area: h.area,
      mensaje: h.area === 'dinero'
        ? 'Tu acceso no ve las cifras de dinero de la flota. Pídele al dueño de la cuenta un acceso con esa área si te corresponde.'
        : 'Tu acceso no tiene esta parte de la flota al alcance.',
    };
  }
  const v = h.esquema.safeParse(args ?? {});
  if (!v.success) {
    const detalle = v.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
    return { ok: false, tipo: 'argumentos', mensaje: `Argumentos inválidos: ${detalle}` };
  }
  const contexto: ContextoHerramienta = { alcanza };
  const resultado = await h.ejecutar(tenantId, v.data as never, contexto);
  return { ok: true, resultado, area: h.area };
}
