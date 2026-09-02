// ═══════════════════════════════════════════════════════════════════════════
// LA PARTE PURA de "piezas del día" — SIN un solo import de servidor.
//
// `TarjetaPieza` ('use client') necesita `partirCopyPorCanal` y la forma de
// `PiezaEstudio`. Si esas dos cosas vivieran en `estudio.ts` (que importa
// `supabaseAdmin`, y de ahí Node builtins como `node:crypto`/`node:async_
// hooks`), un Client Component que importe UN valor de ese archivo arrastra
// el módulo ENTERO al bundle del navegador — el build de Next lo rechaza
// (`UnhandledSchemeError: Reading from "node:crypto"`). Este archivo existe
// para que eso sea estructuralmente imposible: nada de lo que hay aquí toca
// `supabaseAdmin`, Storage ni ningún built-in de Node.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los agentes de `crecimiento.ts` cuyas piezas son CONTENIDO listo para un
 * canal (copy o guion destinado a salir hacia afuera) — a propósito NO
 * incluye `lead_magnet`, `seo_distribucion` ni `alianzas` (esos son partes
 * de diagnóstico interno para Javier, no piezas que se "publiquen") ni
 * `contenido_fiscal` (su aprobación no publica: el artículo entra por un PR,
 * un flujo distinto al de esta pantalla — crecimiento.ts lo dice en su
 * propio comentario). Los seis de abajo sí terminan, cuando Javier aprueba,
 * en algo que se postea.
 */
export const AGENTES_ESTUDIO = [
  'guiones', 'noticias_mercado', 'promos_diarias',
  'visuales', 'video_demo', 'video_marketing',
] as const;

export interface PiezaEstudio {
  id: string;
  tipo: string;
  agente: string;
  titulo: string;
  cuerpo: string;
  fuentes: Record<string, unknown> | null;
  creadoEn: string;
}

export function desdeFilaEstudio(f: Record<string, unknown>): PiezaEstudio {
  return {
    id: String(f.id),
    tipo: String(f.tipo),
    agente: String(f.agente),
    titulo: String(f.titulo),
    cuerpo: String(f.cuerpo),
    fuentes: (f.fuentes as Record<string, unknown> | null) ?? null,
    creadoEn: String(f.creado_en),
  };
}

export interface BloqueCanal {
  canal: string;
  texto: string;
}

/**
 * Parte el cuerpo de una pieza en bloques por canal, cuando el propio agente
 * los marcó así (el formato EXACTO que `copyPorCanal`/`armarPromoDiaria` en
 * crecimiento.ts escriben: una línea `── Canal ──` seguida del texto de ese
 * canal). PURA. Devuelve `null` cuando el cuerpo NO trae esa marca — un
 * guion o un encargo no son "copy por canal", son una pieza sola, y
 * fingir un único canal "General" sería inventarle una estructura que el
 * agente no le dio.
 */
export function partirCopyPorCanal(cuerpo: string): BloqueCanal[] | null {
  const lineas = cuerpo.split('\n');
  const marcador = /^── (.+) ──$/;
  const indices: Array<{ i: number; canal: string }> = [];
  lineas.forEach((linea, i) => {
    const m = marcador.exec(linea.trim());
    if (m) indices.push({ i, canal: m[1] });
  });
  if (indices.length === 0) return null;
  const bloques: BloqueCanal[] = [];
  for (let k = 0; k < indices.length; k++) {
    const desde = indices[k].i + 1;
    const hasta = k + 1 < indices.length ? indices[k + 1].i : lineas.length;
    bloques.push({ canal: indices[k].canal, texto: lineas.slice(desde, hasta).join('\n').trim() });
  }
  return bloques;
}
