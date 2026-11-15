// ═══════════════════════════════════════════════════════════════════════════
// EL DICCIONARIO DE DISPARADORES DE LA VIGILANCIA NORMATIVA.
//
// Cruza el TÍTULO de una nota del DOF contra las frases que, según
// `.claude/skills/vigilancia-normativa/SKILL.md`, mueven alguna ficha de
// `normas/*.yaml`. NO interpreta la ley: dice «esto se publicó y toca el tema
// X». La lectura la hace una persona.
//
// Normalización: minúsculas y sin acentos, para que «Miscelánea», «MISCELANEA»
// y «miscelanea» sean la misma palabra (el DOF publica títulos en las tres
// formas según la sección).
//
// Los archivos de `fichasPosibles` son una ayuda, no un veredicto: un mapa
// simple tema → fichas. `disparadores.test.ts` exige que cada archivo nombrado
// exista en `normas/`, así que renombrar una ficha sin actualizar esto falla.
// ═══════════════════════════════════════════════════════════════════════════

/** Minúsculas, sin acentos ni diacríticos, espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Disparador {
  /** Etiqueta legible que sale en el aviso. */
  etiqueta: string;
  /** Frase ya normalizada (minúsculas, sin acentos). */
  frase: string;
  /** Si `true`, la frase debe ir entre límites de palabra (p. ej. «anexo»). */
  palabra?: boolean;
  /** Archivos de `normas/` que podrían verse afectados. */
  fichas: readonly string[];
}

const RMF = ['rmf-2026-2.7.1.21.yaml', 'rmf-2026-2.7.1.29.yaml', 'rmf-2026-2.7.1.48.yaml', 'rmf-2026-2.7.7.yaml', 'rmf-2026-3.3.1.7.yaml', 'rmf-2026-9.1.7.yaml', 'rmf-2026-9.1.8.yaml'] as const;
const RFA = ['rfa-2026-2.1.yaml', 'rfa-2026-2.2.yaml', 'rfa-2026-2.3.yaml', 'rfa-2026-2.5.yaml', 'rfa-2026-2.9.yaml'] as const;
const CFF = ['cff-29-A.yaml', 'cff-30.yaml', 'cff-69-B.yaml', 'cff-89-90.yaml', 'criterio-1-CFF-PI.yaml'] as const;
const ISR = ['lisr-27-III.yaml', 'lisr-28-V.yaml', 'lisr-28-XX.yaml', 'lisr-72-73.yaml', 'rlisr-57.yaml'] as const;
const IVA = ['liva-5.yaml', 'rliva-3-fr-II.yaml'] as const;
const LIF = ['lif-2026-20-A.yaml', 'criterio-1-LIF-PI.yaml'] as const;
const DATOS = ['lfpdppp-15-16.yaml', 'lfpdppp-2-XII-XX.yaml', 'lfpdppp-26-II.yaml', 'lfpdppp-59.yaml'] as const;
const AUTOTRANSPORTE = ['tesis-autotransporte.yaml', 'nom-087-sct-2-2017.yaml', 'reglamento-transito-83.yaml', 'red-nacional-autopistas.yaml'] as const;

export const DISPARADORES: readonly Disparador[] = [
  { etiqueta: 'Miscelánea Fiscal', frase: 'miscelanea fiscal', fichas: RMF },
  { etiqueta: 'facilidades administrativas', frase: 'facilidades administrativas', fichas: RFA },
  { etiqueta: 'Resolución de Facilidades', frase: 'resolucion de facilidades', fichas: RFA },
  { etiqueta: 'Ley de Ingresos', frase: 'ley de ingresos', fichas: LIF },
  { etiqueta: 'Código Fiscal', frase: 'codigo fiscal', fichas: CFF },
  { etiqueta: 'Impuesto sobre la Renta', frase: 'impuesto sobre la renta', fichas: ISR },
  { etiqueta: 'valor agregado', frase: 'valor agregado', fichas: IVA },
  { etiqueta: 'producción y servicios', frase: 'produccion y servicios', fichas: LIF },
  { etiqueta: 'datos personales', frase: 'datos personales', fichas: DATOS },
  { etiqueta: 'autotransporte', frase: 'autotransporte', fichas: AUTOTRANSPORTE },
  { etiqueta: 'Anexo', frase: 'anexo', palabra: true, fichas: RMF },
  { etiqueta: 'Nota Aclaratoria', frase: 'nota aclaratoria', fichas: [...RMF, ...RFA] },
  { etiqueta: 'Fe de erratas', frase: 'fe de erratas', fichas: [...RMF, ...RFA] },
];

/** Etiqueta del aviso de la cuota semanal del IEPS al diésel. No se calcula nada: solo se señala. */
export const ETIQUETA_DIESEL = 'cuota diésel';
const FICHAS_DIESEL = ['lif-2026-20-A.yaml'] as const;

function contiene(normalizado: string, frase: string, palabra: boolean): boolean {
  if (!palabra) return normalizado.includes(frase);
  // Límites de palabra a mano: `\b` de JS no entiende más que ASCII y aquí el texto ya viene sin acentos, pero así
  // el patrón no se arma con una cadena dinámica (regla de seguridad del repo contra RegExp con entrada variable).
  let desde = 0;
  for (;;) {
    const i = normalizado.indexOf(frase, desde);
    if (i < 0) return false;
    const antes = i === 0 ? ' ' : normalizado[i - 1];
    // Plural simple: «Anexos 1, 3 y 20» es el título real de la RMF, no «Anexo».
    let fin = i + frase.length;
    if (normalizado[fin] === 's') fin += 1;
    const despues = fin >= normalizado.length ? ' ' : normalizado[fin];
    const esLetra = (c: string) => /[a-z0-9]/.test(c);
    if (!esLetra(antes) && !esLetra(despues)) return true;
    desde = i + 1;
  }
}

export interface Clasificacion {
  etiquetas: string[];
  fichas: string[];
}

/** ¿El título toca algún disparador? Devuelve las etiquetas y las fichas posibles (sin duplicados), o `null`. */
export function clasificarTitulo(titulo: string): Clasificacion | null {
  const t = normalizar(titulo);
  if (t === '') return null;
  const etiquetas: string[] = [];
  const fichas = new Set<string>();
  for (const d of DISPARADORES) {
    if (contiene(t, d.frase, d.palabra === true)) {
      etiquetas.push(d.etiqueta);
      for (const f of d.fichas) fichas.add(f);
    }
  }
  // Cuota/estímulo del diésel: el viernes (vespertina) sale la publicación semanal. «cuota» + «estímulo» + «diésel»,
  // o «estímulo» + «diésel» (el Acuerdo suele titularse por los estímulos). No se interpreta ni se calcula nada.
  if (t.includes('diesel') && (t.includes('estimulo') || t.includes('cuota'))) {
    etiquetas.push(ETIQUETA_DIESEL);
    for (const f of FICHAS_DIESEL) fichas.add(f);
  }
  return etiquetas.length === 0 ? null : { etiquetas, fichas: [...fichas] };
}
