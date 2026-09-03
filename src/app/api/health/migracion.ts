import { readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, OP-P1 (BLOQUEANTE) · ¿LA BASE VA A LA PAR DEL CÓDIGO?
//
// Producción corría con la base en la migración 0271 mientras `master` ya
// pedía la forma 0272 de `poliza_datos_tenant`. Dos verdades (código y
// esquema) que solo coincidían si un humano recordaba el orden «migrar →
// verificar → [deploy]». Nada lo medía desde fuera.
//
// Aquí se comparan las dos:
//   · CÓDIGO: la última migración del repo, leída en BUILD por `next.config.ts`
//     e inlineada como `LIKIDA_MIGRACION_CODIGO` (el bundle de la función
//     excluye `supabase/**`, así que en Vercel no hay carpeta que leer). En la
//     Mac y en vitest se lee la carpeta directamente.
//   · BASE: `migraciones_aplicadas()` (0234), que devuelve lo que
//     `supabase_migrations.schema_migrations` registra. El prefijo de cuatro
//     dígitos sale del `nombre` (`0271_mcp_oauth_rol`), no del `version`, que
//     en Supabase es un sello de tiempo. Las cuatro primeras migraciones
//     entraron sin prefijo y se ignoran: lo que importa es la MÁS ALTA.
//
// Si la base no se puede leer, se dice (`base: null` + `motivo`) y el health
// se degrada: un cotejo que no pudo hacerse no es un cotejo verde.
//
// La llamada a Supabase NO vive aquí: `route.ts` la inyecta (`LectorAplicadas`).
// Este módulo se queda con la aritmética de prefijos, que es lo que hay que
// poder probar sin base — y el conteo de la frontera de datos
// (`frontera_datos_guardiana.test.ts`) no crece por un archivo más que llame
// a la base.
// ═══════════════════════════════════════════════════════════════════════════

export interface Migracion {
  /** Último prefijo registrado como aplicado en la base, o `null` si no se pudo leer. */
  base: string | null;
  /** Último prefijo en `supabase/migrations` del código que corre. */
  codigo: string | null;
  /** Cuántas migraciones le faltan a la base. `null` si algún lado no se pudo leer. */
  atras: number | null;
  /** Solo cuando algo no cuadra: por qué. */
  motivo?: string;
  /**
   * TODOS los prefijos que la base registra como aplicados (no solo el más
   * alto), o `null` si no se pudo leer. ARQUITECTURA 25 (MEDIO): `base`/`atras`
   * cotejan MÁXIMO contra MÁXIMO, que es fail-open cuando una rama cortada
   * abajo aterriza con un prefijo MENOR al máximo ya aplicado en producción —
   * `atras` sale en 0 con esa migración sin aplicar. `compuerta-deploy.mjs`
   * SÍ tiene el repo local (a diferencia de G5 en `ingenieria.ts`, que
   * declara por escrito que no lo tiene) y con este campo puede cotejar el
   * CONJUNTO completo, no solo la cima.
   */
  aplicados: string[] | null;
}

const PREFIJO = /^(\d{4})_/;

/** La última migración del repo: la inlineada en build, o la carpeta si está a mano. */
export function migracionDelCodigo(): string | null {
  const inlineada = process.env.LIKIDA_MIGRACION_CODIGO;
  if (typeof inlineada === 'string' && /^\d{4}$/.test(inlineada)) return inlineada;
  try {
    const prefijos = readdirSync('supabase/migrations')
      .map((f) => PREFIJO.exec(f)?.[1])
      .filter((p): p is string => p !== undefined)
      .sort();
    return prefijos.length > 0 ? prefijos[prefijos.length - 1] : null;
  } catch {
    return null;
  }
}

/** El prefijo más alto entre los nombres que la base registró como aplicados. */
export function ultimaMigracionAplicada(filas: Array<{ nombre?: unknown }>): string | null {
  let max: string | null = null;
  for (const f of filas) {
    const p = typeof f.nombre === 'string' ? PREFIJO.exec(f.nombre)?.[1] : undefined;
    if (p !== undefined && (max === null || p > max)) max = p;
  }
  return max;
}

/** TODOS los prefijos (sin repetir, ordenados) que la base registra aplicados. */
export function prefijosAplicados(filas: Array<{ nombre?: unknown }>): string[] {
  const vistos = new Set<string>();
  for (const f of filas) {
    const p = typeof f.nombre === 'string' ? PREFIJO.exec(f.nombre)?.[1] : undefined;
    if (p !== undefined) vistos.add(p);
  }
  return [...vistos].sort();
}

/** Puro, para probarlo: arma el veredicto a partir de los dos prefijos. */
export function cotejar(base: string | null, codigo: string | null, motivoBase?: string, aplicados: string[] | null = null): Migracion {
  if (codigo === null) {
    return { base, codigo, atras: null, aplicados: null, motivo: 'no se pudo saber la última migración del código (LIKIDA_MIGRACION_CODIGO ausente y sin carpeta supabase/migrations)' };
  }
  if (base === null) {
    return { base, codigo, atras: null, aplicados: null, motivo: motivoBase ?? 'no se pudo leer qué migración tiene aplicada la base' };
  }
  const atras = Math.max(0, Number(codigo) - Number(base));
  if (atras > 0) {
    return { base, codigo, atras, aplicados, motivo: `la base va ${atras} migración(es) atrás del código: aplica ${siguiente(base)}..${codigo} antes de desplegar` };
  }
  return { base, codigo, atras: 0, aplicados };
}

function siguiente(prefijo: string): string {
  return String(Number(prefijo) + 1).padStart(4, '0');
}

/** Lo que `route.ts` inyecta: una llamada a `migraciones_aplicadas()` que
 *  reporta el error por valor, como todo supabase-js. */
export type LectorAplicadas = () => Promise<{ data: unknown; error: { message: string } | null }>;

/** Lee la base y coteja. NUNCA lanza: un fallo de lectura es `base: null` con motivo. */
export async function cotejarMigracion(leerAplicadas: LectorAplicadas): Promise<Migracion> {
  const codigo = migracionDelCodigo();
  try {
    const { data, error } = await leerAplicadas();
    if (error) return cotejar(null, codigo, `migraciones_aplicadas() no contestó: ${error.message}`);
    const r = data as { disponible?: unknown; motivo?: unknown; filas?: unknown } | null;
    if (!r || r.disponible !== true || !Array.isArray(r.filas)) {
      return cotejar(null, codigo, typeof r?.motivo === 'string' ? r.motivo : 'migraciones_aplicadas() no devolvió el registro');
    }
    const filas = r.filas as Array<{ nombre?: unknown }>;
    return cotejar(ultimaMigracionAplicada(filas), codigo, undefined, prefijosAplicados(filas));
  } catch (e) {
    return cotejar(null, codigo, `migraciones_aplicadas() lanzó: ${e instanceof Error ? e.message : String(e)}`);
  }
}
