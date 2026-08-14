// ═══════════════════════════════════════════════════════════════════════════
// LA MEMORIA NORMATIVA, CONSULTABLE
//
// `normas/` existía desde antes como documentación: 21 fichas que el código
// CITA en comentarios pero que nadie podía leer. El contador de una flota no
// tenía a quién preguntarle "¿qué necesito para el estímulo del 50% de peaje?"
// más que a su propio contador — y Likida, que aplica ese estímulo en cada
// liquidación, se quedaba callado.
//
// POR QUÉ ESTO NO ES UN RAG VECTORIAL, Y NO DEBE SERLO:
//
// Handle presume "chatea con tus registros", y en el video se ven sus pasos
// reales: `Counting sor_policy… ✓ Found 674`. Eso NO es búsqueda por
// embeddings, es consulta estructurada sobre su sistema de registro — que es
// exactamente lo que `chat-tools.ts` ya hace aquí (kpis_flota, viajes_flota,
// motor_fiscal). Copiar un vector store para el chat sería copiar algo que
// Handle no tiene.
//
// Y para ESTE corpus sería peor que inútil. Un embedding devuelve "lo más
// parecido" y no sabe distinguir una LEY de un criterio no vinculativo, ni una
// ficha verificada contra el DOF de una que salió de un blog. Aquí eso es LA
// pregunta: `jerarquia` y `estado_verificacion` deciden si el producto puede
// afirmar algo o tiene que callarse. Un corpus de 21 fichas con jerarquía
// declarada se recupera mejor con puntaje explícito que con similitud opaca —
// y el resultado se puede explicar, que es el requisito cuando alguien va a
// tomar una decisión fiscal con la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El nivel normativo. NO es adorno: confundirlos es el error más caro del
 * dominio (normas/README.md). Una regla de la RMF no puede contradecir a la
 * ley, y un criterio no vinculativo no obliga a nadie — dice qué considera el
 * SAT una práctica indebida.
 */
export type Jerarquia = 1 | 2 | 3 | 4 | 5;

/** Si el producto puede afirmar lo que dice la ficha, y con qué respaldo. */
export type EstadoVerificacion =
  | 'verificado_fuente_primaria'
  | 'evidencia_corroborante'
  | 'sin_verificar'
  | 'contradicho';

export interface Norma {
  /** Nombre del archivo en `normas/` — la liga entre índice y fuente. */
  archivo: string;
  id: string;
  tipo: string;
  jerarquia: number;
  instrumento: string;
  /** Ausente en las fichas que no son normas legales (política de comercio). */
  articulo_o_regla?: string;
  titulo?: string;
  estado_verificacion: string;
  fuente_url?: string;
  verificado_el?: string;
  /** Cómo la cita el código — para poder ir del texto legal al lugar donde se aplica. */
  citasEnCodigo: readonly string[];
}

/** Qué puede decir el producto con cada estado. Sale del README de `normas/`. */
export const PUEDE_AFIRMARSE: Record<string, { puede: boolean; rotulo: string; nota: string }> = {
  verificado_fuente_primaria: {
    puede: true,
    rotulo: 'Verificado en la fuente',
    nota: 'Se leyó el texto en el DOF, el SAT o diputados.gob.mx.',
  },
  evidencia_corroborante: {
    puede: true,
    rotulo: 'Corroborado',
    nota: 'Varias fuentes coinciden, pero no se leyó el documento original. Confírmalo con tu contador antes de decidir sobre él.',
  },
  sin_verificar: {
    puede: false,
    rotulo: 'Sin verificar',
    nota: 'Viene de una sola fuente secundaria. Likida no afirma nada con esta ficha.',
  },
  contradicho: {
    puede: false,
    rotulo: 'Contradicho',
    nota: 'Dos fuentes se contradicen y no se resolvió. Likida no afirma nada con esta ficha.',
  },
};

export const JERARQUIA_ROTULO: Record<number, string> = {
  1: 'Ley',
  2: 'Reglamento',
  3: 'Resolución Miscelánea / RFA',
  4: 'Anexo o ficha de trámite',
  5: 'Criterio no vinculativo',
  // No es normativa: es cómo se porta un portal de autofacturación. Vive en el
  // corpus porque el código depende de sus plazos, y en el nivel más bajo
  // porque un término de un comercio no obliga a nadie más que a ese comercio.
  6: 'Política de comercio',
};

const SIN_ACENTOS = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Recuperación por puntaje EXPLICABLE — el reemplazo honesto de un embedding.
 *
 * Cada término de la consulta suma según DÓNDE aparece, y el porqué del orden
 * se puede leer sin abrir un modelo:
 *   · el artículo o regla vale más que el título (quien teclea "20-A" busca ESE
 *     artículo, no todo lo que lo menciona),
 *   · el título más que el instrumento,
 *   · y la jerarquía desempata: entre una ley y un criterio que empatan en
 *     texto, manda la ley.
 *
 * Sin coincidencias devuelve VACÍO, no "lo más parecido". Un embedding siempre
 * contesta algo, y en materia fiscal contestar algo parecido es peor que no
 * contestar.
 */
export function buscarNormas(normas: readonly Norma[], consulta: string): Norma[] {
  const terminos = SIN_ACENTOS(consulta).split(/\s+/).filter((t) => t.length >= 2);
  if (terminos.length === 0) return [];

  const puntuadas = normas.map((n) => {
    const articulo = SIN_ACENTOS(`${n.articulo_o_regla ?? ''} ${n.id}`);
    const titulo = SIN_ACENTOS(n.titulo ?? '');
    const instrumento = SIN_ACENTOS(`${n.instrumento} ${n.tipo} ${n.citasEnCodigo.join(' ')}`);

    let puntos = 0;
    for (const t of terminos) {
      if (articulo.includes(t)) puntos += 6;
      if (titulo.includes(t)) puntos += 3;
      if (instrumento.includes(t)) puntos += 1;
    }
    return { n, puntos };
  });

  return puntuadas
    .filter((p) => p.puntos > 0)
    .sort((a, b) => (b.puntos - a.puntos) || (a.n.jerarquia - b.n.jerarquia) || a.n.id.localeCompare(b.n.id))
    .map((p) => p.n);
}
