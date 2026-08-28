// ═══════════════════════════════════════════════════════════════════════════
// EL BLOG — los artículos como datos tipados, no como dependencia nueva.
//
// Por qué NO MDX ni un parser de markdown: el repo no trae ninguno, y un
// parser a mano es exactamente la clase de código que se audita mal. Un
// artículo es una lista de bloques tipados; la página los pinta con el
// sistema de diseño y el compilador vigila la forma.
//
// CÓMO PUBLICAN LOS AGENTES DE CRECIMIENTO (el enganche con la cola):
// el agente de contenido produce su pieza a `cola_aprobacion` (tipo
// 'articulo'); cuando Javier la aprueba en Tu Turno, la pieza entra a ESTE
// archivo por el mismo mecanismo con el que el bus ya edita encargos: un PR.
// Publicar sigue siendo un merge — nunca un INSERT directo a producción, por
// la misma razón que las piezas de redes: lo publicado con la marca pasa por
// el tap de Javier y por CI (las pruebas estructurales de abajo corren sobre
// cada artículo nuevo).
//
// REGLAS DE CONTENIDO (probadas en articulos.test.ts):
//  - Cada artículo cita su fundamento (las fichas de normas/ verificadas) —
//    jamás afirmar lo que el corpus no cubre; la duda se manda al contador.
//  - Prohibido "clientes reales" (la frase de la casa es "en pláticas con
//    transportistas como Grupo GAL y Transportes Innovativos").
//  - Prohibido "hasta un X%" (guia-de-marca §4).
//  - Sin guiones largos (—) en el cuerpo: regla de los textos de marketing.
// ═══════════════════════════════════════════════════════════════════════════

import type { TemaNormativo } from '../normas/consulta';

export type BloqueArticulo =
  | { t: 'p'; texto: string }
  | { t: 'h2'; texto: string }
  | { t: 'ul'; items: string[] }
  | { t: 'cita'; texto: string; fuente: string };

export interface Articulo {
  slug: string;
  titulo: string;
  resumen: string;
  /** ISO yyyy-mm-dd — fecha de publicación. */
  fecha: string;
  /**
   * El TEMA del corpus (`normas/consulta.ts`) que esta pieza cubre. Es un
   * campo obligatorio y no una etiqueta suelta: el agente `contenido_fiscal`
   * (0230) elige qué escribir restando los temas ya cubiertos del catálogo de
   * temas citables, y sin esta liga tendría que adivinar la cobertura leyendo
   * la prosa. `import type` a propósito — el tipo se borra al compilar, así
   * que la página pública del blog no arrastra el índice de normas.
   */
  tema: TemaNormativo;
  /** Las fichas del corpus que fundamentan la pieza (se pintan al pie). */
  fundamento: string[];
  bloques: BloqueArticulo[];
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS REGLAS EDITORIALES, COMO FUNCIÓN Y NO SOLO COMO PRUEBA.
//
// `articulos.test.ts` ya las afirma sobre los artículos PUBLICADOS: es la
// puerta del merge. Pero desde la 0230 hay un agente que REDACTA borradores
// con un modelo, y ese texto tiene que pasar por la misma vara ANTES de
// entrar a la bandeja — si no, la única red sería el ojo de Javier leyendo la
// pieza, que es exactamente lo que estas reglas existen para no depender de.
//
// Vive AQUÍ y no en el agente porque la regla es del BLOG, no del agente: el
// día que otra pieza escriba para /blog, hereda la vara sin copiarla.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las violaciones editoriales de un texto, cada una redactada para que un
 * humano entienda qué se rompió. Vacío = pasó. PURA.
 */
export function revisarReglasEditoriales(texto: string): string[] {
  const faltas: string[] = [];
  const t = texto.toLowerCase();
  if (/clientes?\s+reales/.test(t)) {
    faltas.push('dice "clientes reales" — ninguna empresa ha firmado; la frase de la casa es "en pláticas con transportistas como Grupo GAL y Transportes Innovativos"');
  }
  // La marca prohíbe el "hasta un X%" (guia-de-marca §4): promete un techo
  // que nadie midió y que el lector va a cruzar contra su propio PDF.
  if (/hasta un \d/.test(t)) {
    faltas.push('trae un "hasta un X%" — la marca lo prohíbe: es un techo sin fuente');
  }
  if (texto.includes('—')) {
    faltas.push('trae guion largo (—) — los textos de marketing de la casa no los usan');
  }
  if (/te recuperamos|garantizamos/.test(t)) {
    faltas.push('promete recuperar o garantizar — quien acredita es el contador; Likida entrega el dato y la bitácora');
  }
  // Si nombra a las dos flotas con las que hay conversaciones, tiene que ser
  // con la frase honesta y completa. Nombrarlas a secas las convierte en
  // clientes por implicación.
  if ((t.includes('grupo gal') || t.includes('innovativos')) && !t.includes('en pláticas')) {
    faltas.push('nombra a Grupo GAL o a Transportes Innovativos sin la frase "en pláticas" — sin ella se leen como clientes');
  }
  return faltas;
}

export const ARTICULOS: Articulo[] = [
  {
    slug: 'peajes-50-por-ciento-bitacora',
    titulo: 'El 50% de tus casetas es acreditable. La bitácora es lo que casi nadie arma.',
    resumen:
      'La LIF 2026 permite acreditar el 50% del peaje pagado en la Red Nacional de Autopistas de Cuota. El requisito que tumba el estímulo no es la caseta: es la bitácora conciliada.',
    fecha: '2026-08-27',
    tema: 'peajes_y_casetas',
    fundamento: ['LIF 2026, art. 20 apartado A (estímulo de peaje)', 'RMF 2026, regla 9.1.8 (requisitos y bitácora)', 'Red Nacional de Autopistas de Cuota (término fiscal, no coloquial)'],
    bloques: [
      {
        t: 'p',
        texto:
          'Si tu flota cruza casetas todos los días, una parte de ese gasto es acreditable contra tu ISR: el 50% del importe pagado, sin IVA. No es un rumor de contador; es un estímulo publicado en la Ley de Ingresos de la Federación.',
      },
      { t: 'h2', texto: 'Lo que la ley pide, en tres condiciones' },
      {
        t: 'ul',
        items: [
          'Que el peaje sea de la Red Nacional de Autopistas de Cuota. Es un término fiscal con lista propia: no toda caseta del país entra, y hay puentes de cuota sobre carretera libre que sí.',
          'Que se pague con medios electrónicos (TAG, tarjeta). El efectivo no deja el rastro que la regla exige.',
          'Que exista la bitácora: qué unidad cruzó, cuándo, por dónde, contra qué CFDI. Esta es la condición que casi ninguna flota cumple.',
        ],
      },
      {
        t: 'cita',
        texto:
          'La bitácora que casi nadie arma es dinero que casi nadie acredita.',
        fuente: 'RMF 2026, regla 9.1.8, fracción II',
      },
      { t: 'h2', texto: 'Por qué casi nadie lo cobra' },
      {
        t: 'p',
        texto:
          'Porque la bitácora exige cruzar tres fuentes que viven separadas: el estado de cuenta del TAG, los CFDI del emisor del peaje y los viajes reales de cada unidad. Hacerlo a mano, cada mes, para toda la flota, es una semana de trabajo de alguien. La mayoría decide que no vale la pena y deja el 50% en la mesa.',
      },
      {
        t: 'p',
        texto:
          'Ese cruce es exactamente el tipo de trabajo que un sistema hace mejor que una persona: conciliar el desglose del emisor contra los gastos de caseta de cada viaje y dejar la bitácora lista para tu contador. Es una de las piezas que construimos primero en Likida, y hoy está en pláticas de prueba con transportistas como Grupo GAL y Transportes Innovativos.',
      },
      {
        t: 'p',
        texto:
          'Una honestidad final: el estímulo lo acredita tu contador, no nosotros. Lo que Likida entrega es el dato conciliado y la bitácora citable. Si quieres dimensionar cuánto es en tu caso, la calculadora de esta página usa las mismas reglas del motor y te enseña los supuestos.',
      },
    ],
  },
  {
    slug: 'ieps-diesel-litros-no-pesos',
    titulo: 'El estímulo del diésel se calcula en litros. Desconfía de quien te lo dé en pesos.',
    resumen:
      'El estímulo IEPS de diésel es cuota semanal del DOF por litros. La cuota cambió de $7.36 a $2.09 en cinco meses: cualquier cifra en pesos sin fecha de cuota está inflada o vencida.',
    fecha: '2026-08-27',
    tema: 'diesel_y_combustible',
    fundamento: ['LIF 2026, art. 20 apartado A (estímulo IEPS de diésel)', 'Criterio LIF-PI: la cuota aplicable es la DISMINUIDA semanal del DOF', 'LIF 20-A, cuarto párrafo (medios de pago admitidos)'],
    bloques: [
      {
        t: 'p',
        texto:
          'Hay una trampa aritmética en el estímulo del diésel que infla propuestas comerciales todos los días: dar el número en pesos. El estímulo no es el IEPS que viene trasladado en tu CFDI. Es la cuota disminuida que publica el DOF cada semana, multiplicada por tus litros.',
      },
      { t: 'h2', texto: 'Por qué los pesos engañan' },
      {
        t: 'p',
        texto:
          'La cuota cambia cada semana. En cinco meses de 2026 pasó de $7.3634 a $2.0925 por litro. Una calculadora que te enseña pesos con la cuota de hace tres meses te está enseñando un número que tu contador va a desinflar enfrente de ti. El dato que no cambia, y el que tu contador multiplica por la cuota de la semana en que cargaste, son tus litros elegibles.',
      },
      {
        t: 'ul',
        items: [
          'El estímulo aplica solo a diésel para tus unidades, no a gasolina.',
          'El pago debe hacerse con monedero, tarjeta, cheque nominativo o transferencia: el cuarto párrafo del 20-A no admite efectivo y no tiene la válvula del 15% que la facilidad de ISR sí concede.',
          'El estímulo es ingreso acumulable: tu neto real es el estímulo por (1 menos tu tasa de ISR). Cualquier propuesta que omita esta línea te está vendiendo el número bruto.',
        ],
      },
      {
        t: 'cita',
        texto: 'La cuota aplicable es la disminuida que publica el DOF, con los ajustes que correspondan. Usar la cuota entera es un error de cálculo.',
        fuente: 'Criterio sobre LIF y acuerdos del DOF (ficha verificada del corpus de Likida)',
      },
      { t: 'h2', texto: 'Qué hacemos distinto' },
      {
        t: 'p',
        texto:
          'El panel de Likida entrega el dato duro: cuántos litros elegibles cargó tu flota, leídos de tus tickets y CFDI reales. La cifra en pesos la construye tu contador con la cuota fechada de cada semana. Es menos espectacular que un numerote en la primera pantalla, y es la diferencia entre una herramienta fiscal y un folleto.',
      },
    ],
  },
  {
    slug: 'carta-porte-quien-si-quien-no',
    titulo: 'Carta Porte: quién sí la necesita, quién no, y por qué nadie debería contestarte eso a la ligera',
    resumen:
      'El complemento Carta Porte depende de si el viaje pisa carretera federal y de quién transporta qué. La multa por equivocarse es real; la respuesta correcta empieza por un árbol de decisión, no por una corazonada.',
    fecha: '2026-08-27',
    tema: 'carta_porte',
    fundamento: ['RMF 2026, reglas 2.7.7.2.1 y 2.7.7.2.8 (árbol de obligación y excepción local)', 'RMF 2026, regla 2.7.7.1.1 (responsabilidad por los datos que cada parte aporta)', 'Complemento Carta Porte 3.1 (estructura del SAT)'],
    bloques: [
      {
        t: 'p',
        texto:
          'La pregunta llega igual en todas las flotas: este viaje, ¿lleva Carta Porte o no? Y la respuesta honesta es que depende de datos concretos del viaje: si pisa carretera federal, qué se transporta, para quién, y en qué tramo. Contestar sin esos datos es adivinar con multa de por medio.',
      },
      { t: 'h2', texto: 'El árbol, resumido' },
      {
        t: 'ul',
        items: [
          'Traslado que pisa carretera federal: lleva complemento Carta Porte. La regla general es esa y las excepciones son pocas y específicas.',
          'Traslado exclusivamente local (sin tramo federal): puede caer en la excepción de la regla 2.7.7.2.8, y ese "puede" exige revisar el caso, no asumirlo.',
          'La regla 2.7.7.1.1 reparte la responsabilidad: cada parte responde por los datos que aporta. Los datos de la mercancía son del cliente; los del transporte, tuyos.',
        ],
      },
      { t: 'h2', texto: 'Los dos errores caros' },
      {
        t: 'p',
        texto:
          'El primero: no emitirla cuando tocaba. El segundo, menos conocido: afirmarle al cliente "no necesitas" sin que nadie firme esa decisión. Si la autoridad opina distinto, esa frase dicha a la ligera es tuya. Por eso en Likida el agente de Carta Porte nunca declara una exención solo: pide la declaración con botones, la registra firmada, y arma el borrador validado con los 37 campos del complemento 3.1 para que se timbre en tu facturador.',
      },
      {
        t: 'p',
        texto:
          'Si operas con carta porte todos los días, el ahorro no está en un PDF bonito: está en no capturar dos veces, no inventar claves y no cargar con decisiones que no eran tuyas. Así lo estamos probando en pláticas con transportistas como Grupo GAL y Transportes Innovativos.',
      },
    ],
  },
];

export function articuloPorSlug(slug: string): Articulo | null {
  return ARTICULOS.find((a) => a.slug === slug) ?? null;
}
