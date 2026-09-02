import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { acotada } from '@/lib/likida/presupuesto';
import { agregar, contarAlucinaciones } from '@/lib/admin/qa-verdad';
import { leerUltimasLecturas, type LecturaFoto } from '@/lib/admin/qa-storage';
import type { EstadoCorrida } from '@/lib/likida/agentes/corridas';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE CALIDAD (Frente F) — los lectores de /admin/calidad-evals.
//
// La página fue un empty-state honesto («Likida no tiene pipeline de
// evaluación») hasta que dejó de ser verdad por partes: EVALOPS (0134) mide
// el examen del analista, agente_corrida (0102) registra el veredicto de
// cada corrida, y el banco de QA (0239/0246) mide la precisión del OCR campo
// por campo contra verdad de terreno. Tres fuentes MEDIDAS, dispersas en
// tres pantallas. Este módulo las junta — no mide nada nuevo, y lo que sigue
// sin fuente (feedback 👍/👎, CSAT) la página lo sigue diciendo con su razón.
//
// Regla de la casa en las tres: quien no puede leer LANZA o devuelve el error
// por valor — el tablero dice «no se pudo leer», jamás un cero con cara de
// sistema sano.
// ═══════════════════════════════════════════════════════════════════════════

export interface CalidadCorridas {
  total: number;
  ok: number;
  parcial: number;
  fallo: number;
  porAgente: Array<{ agente: string; ok: number; parcial: number; fallo: number }>;
}

/** PURA. Cuenta veredictos por agente; los agentes con fallos van primero —
 *  es un tablero de calidad, lo roto se enseña arriba. */
export function resumirCorridas(
  filas: ReadonlyArray<{ agente: string; estado: EstadoCorrida }>,
): CalidadCorridas {
  const por = new Map<string, { ok: number; parcial: number; fallo: number }>();
  let ok = 0; let parcial = 0; let fallo = 0;
  for (const f of filas) {
    const c = por.get(f.agente) ?? { ok: 0, parcial: 0, fallo: 0 };
    c[f.estado] += 1;
    por.set(f.agente, c);
    if (f.estado === 'ok') ok++; else if (f.estado === 'parcial') parcial++; else fallo++;
  }
  const porAgente = [...por.entries()]
    .map(([agente, c]) => ({ agente, ...c }))
    .sort((a, b) => (b.fallo - a.fallo) || (b.parcial - a.parcial) || a.agente.localeCompare(b.agente));
  return { total: filas.length, ok, parcial, fallo, porAgente };
}

/** Los veredictos de TODAS las corridas de agentes desde `desdeIso` (cruza
 *  tenants a propósito: es la consola de calidad del superadmin). LANZA si
 *  no completa — el mismo criterio que `ultimasCorridas`. */
export async function getCalidadCorridas(desdeIso: string): Promise<CalidadCorridas> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<{ agente: string; estado: EstadoCorrida }>(
    (d, h) => acotada(
      admin.from('agente_corrida')
        .select('agente, estado', conteo(d))
        .gte('inicio', desdeIso)
        .order('inicio', { ascending: false })
        .order('id', { ascending: true })
        .range(d, h),
      'calidad.corridas',
    ),
    'calidad.corridas',
  );
  return resumirCorridas(filas);
}

export interface CalidadOcr {
  /** Fotos del banco con al menos una medición. */
  fotosMedidas: number;
  camposOk: number;
  camposMal: number;
  camposNoMedidos: number;
  /** % de campos correctos SOBRE LO MEDIDO (ok/(ok+mal)) — o `null` cuando
   *  no hay un solo campo medido: eso no es 0%, es «sin medición». */
  precisionPct: number | null;
  alucinaciones: number;
  ultimaMedicionEn: string | null;
}

/** PURA. Agrega las últimas lecturas del banco con la MISMA aritmética que
 *  el panel de QA (`agregar`/`contarAlucinaciones` de qa-verdad) — dos
 *  fórmulas distintas para «la precisión del OCR» serían dos cifras. */
export function resumirLecturas(lecturas: ReadonlyArray<LecturaFoto>): CalidadOcr {
  const mediciones = lecturas.map((l) => l.medicion);
  const a = agregar(mediciones);
  const ultima = lecturas
    .map((l) => l.corridaEn)
    .reduce<string | null>((max, v) => (max === null || v > max ? v : max), null);
  return {
    fotosMedidas: lecturas.length,
    camposOk: a.ok,
    camposMal: a.mal,
    camposNoMedidos: a.noMedidos,
    // `exactitud` viene null-safe de `agregar` (null con 0 medidos — jamás
    // un 0%/100% sobre una medición que no existe).
    precisionPct: a.exactitud === null ? null : a.exactitud * 100,
    alucinaciones: contarAlucinaciones(mediciones),
    ultimaMedicionEn: ultima,
  };
}

/** La última medición de cada foto del banco, agregada. El error viene POR
 *  VALOR (herencia de `leerUltimasLecturas`) y aquí se relanza: el que pinta
 *  ya decide qué decir. */
export async function getCalidadOcr(): Promise<CalidadOcr> {
  const r = await leerUltimasLecturas(supabaseAdmin());
  if (!r.ok) throw new Error(r.error);
  return resumirLecturas([...r.datos.values()]);
}
