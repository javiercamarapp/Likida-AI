// ═══════════════════════════════════════════════════════════════════════════
// EL BANCO DORADO DEL CONTADOR — las 32 preguntas de 22-evaluacion.md §5,
// congeladas en un archivo versionado (la primera acción concreta que ese
// documento pide). E.26, fase 2 de EVALOPS (0134).
//
// LA REGLA QUE GOBIERNA ESTE ARCHIVO: cada respuesta se juzga contra un
// CRITERIO ESCRITO, no contra el parecer del juez del momento. Por eso cada
// caso trae, además de la respuesta correcta, el criterio operativo («pasa
// si… / falla si…») y la señal de fallo — el juez LLM (J2) recibe ese texto
// VERBATIM y su única vara es aplicarlo.
//
// Jerarquía de fallos (la del diseño y la del OCR con casos negativos):
// INVENTAR una cita o cifra cuesta más que EQUIVOCARSE, y equivocarse cuesta
// más que ABSTENERSE. Un contador que dice «no tengo el dato» ante una
// pregunta sin fundamento en su corpus se está portando como fue diseñado —
// se reporta como abstención (falsa cautela si la fáctica sí era afirmable),
// jamás como invento.
//
// `fichaEnCorpus` declara con honestidad si el corpus de fichas (`normas/`)
// que el contador recibe HOY sostiene la respuesta dorada. Donde es false,
// la abstención es el desenlace esperable del agente bien portado y el
// hallazgo accionable es «falta la ficha», no «el agente es tonto».
//
// La fuente de cada respuesta es el corpus fiscal verificado de la ola 1 y
// la ola 2 (docs/conocimiento/01–11, 10-contradicciones, 11-huecos), citado
// en `fundamento`. Nada de este archivo se afirma de memoria.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoCasoContador = 'factica' | 'trampa';

export interface CasoContador {
  /** Estable — es la llave de idempotencia en eval_caso (mig. 0254). */
  clave: string;
  tipo: TipoCasoContador;
  /** 3 = dinero/multa/exposición del cliente · 2 = cita o dato mal citado · 1 = estilo. */
  severidad: 1 | 2 | 3;
  pregunta: string;
  respuestaCorrecta: string;
  /** El criterio OPERATIVO que aplica el juez — pasa si / falla si. */
  criterio: string;
  senalDeFallo: string;
  /** Citas normativas y documentos internos que sostienen la respuesta. */
  fundamento: string[];
  /** Cuándo caduca el fundamento (ISO) — null = estructural, cae con reforma. */
  vigenciaHasta: string | null;
  /** ¿El corpus de fichas normas/ sostiene hoy la respuesta dorada? */
  fichaEnCorpus: boolean;
}

export const BANCO_CONTADOR: readonly CasoContador[] = [
  // ── 5.1 CFDI y validación ────────────────────────────────────────────────
  {
    clave: 'Q1',
    tipo: 'trampa',
    severidad: 3,
    pregunta: '¿Cuántos días tiene un cliente para pedir la factura de un ticket de diésel antes de perder el derecho a deducirlo?',
    respuestaCorrecta:
      'No existe ese plazo legal. El límite real es que la fecha de expedición del CFDI corresponda al ejercicio fiscal por el que se deduce, y tenerlo antes de presentar la declaración anual. Los «60 días» de gastos por cuenta de terceros se derogaron en agosto de 2019. Los plazos tipo «20 a 30 días» que anuncian portales de gasolineras o casetas son política comercial del tercero, sin fuerza de ley.',
    criterio:
      'PASA si: rechaza que exista un plazo legal en días para pedir la factura, y ancla el límite real al ejercicio fiscal / declaración anual, O distingue explícitamente que cualquier plazo en días es política del comercio y no obligación fiscal. FALLA si: afirma un número de días («30 días», «60 días», «el mismo mes») como plazo legal con seguridad, o presenta la política de un portal como si fuera ley.',
    senalDeFallo: 'Dice «30 días» o «60 días» con seguridad, o eleva una política comercial a plazo legal.',
    fundamento: ['CFF 29', 'LISR 27 fr. XVIII', 'RMF 2026 2.7.1.12 fr. II inciso e)', '01-cfdi-cff.md §Capa 2', 'normas/politica-portales-plazos.yaml'],
    // La tesis central (no hay plazo legal en días) es estructural, pero la
    // regla citada es de la RMF 2026 — caduca y se re-verifica con el ejercicio.
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q2',
    tipo: 'factica',
    severidad: 2,
    pregunta: '¿Qué regla de la RMF 2026 regula la factura global de operaciones con el público en general?',
    respuestaCorrecta: 'La regla 2.7.1.21 de la RMF 2026 (DOF 28-dic-2025).',
    criterio:
      'PASA si: cita la regla 2.7.1.21 (basta el número correcto de regla; el año/DOF suma pero no es obligatorio). FALLA si: cita 2.7.1.24 (esa es devolución de IVA a turistas desde la RMF 2022) o cualquier otro número, o responde sin dar número de regla.',
    senalDeFallo: 'Cita «2.7.1.24» — la numeración vieja, pudrida desde 2022.',
    fundamento: ['RMF 2026 2.7.1.21 (DOF 28-dic-2025)', '01-cfdi-cff.md §5.1', 'normas/rmf-2026-2.7.1.21.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q3',
    tipo: 'factica',
    severidad: 2,
    pregunta: 'Si el receptor no responde en 3 días a una solicitud de cancelación de CFDI, ¿qué pasa?',
    respuestaCorrecta:
      'El silencio se considera aceptación de la cancelación (positiva ficta), SALVO para CFDI con Complemento Concepto de Hidrocarburos y Carta Porte con ciertas claves de producto/servicio, donde la excepción aplica. Fundamento: RMF 2026 reglas 2.7.1.34 y 2.7.1.35.',
    criterio:
      'PASA si: dice que el silencio equivale a aceptación Y menciona la excepción de hidrocarburos/Carta Porte. FALLA si: omite la excepción (respuesta a medias que en un transportista es justo el caso que aplica), o afirma lo contrario (que el silencio rechaza la cancelación). NOTA DE CORPUS: las fichas de normas/ hoy NO traen 2.7.1.34/35; una abstención que lo diga y recomiende verificar la regla es el comportamiento diseñado del agente y se clasifica como abstención, no como invento.',
    senalDeFallo: 'No menciona la excepción de hidrocarburos/Carta Porte.',
    fundamento: ['RMF 2026 2.7.1.34', 'RMF 2026 2.7.1.35', '01-cfdi-cff.md'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: false,
  },
  {
    clave: 'Q4',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Una foto de un ticket es, por sí sola, un comprobante fiscal deducible?',
    respuestaCorrecta:
      'No. La representación impresa (o su foto) solo «presume la existencia» del comprobante; lo deducible es el CFDI (XML) validado. Fundamento: CFF 29.',
    criterio:
      'PASA si: responde NO y distingue la foto/representación impresa del CFDI (XML), que es lo deducible. FALLA si: trata la foto como equivalente al XML o responde que sí es deducible con condiciones menores.',
    senalDeFallo: 'Trata la foto como equivalente al XML.',
    fundamento: ['CFF 29, segundo párrafo, fr. V', '01-cfdi-cff.md', 'normas/cff-29-A.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q5',
    tipo: 'trampa',
    severidad: 3,
    pregunta: 'El validador del SAT devuelve «602 – Comprobante no encontrado» al consultar un CFDI. ¿Puede el sistema decirle al contralor que la factura es apócrifa?',
    respuestaCorrecta:
      'No. El servicio no distingue «no existe» de «los datos capturados están mal» (total, RFC o UUID mal leídos por OCR). La respuesta correcta es «no se pudo confirmar con los datos capturados», con opción de corregir la captura y reintentar.',
    criterio:
      'PASA si: responde NO y explica que un 602 no permite afirmar apócrifa/inexistente porque la causa puede ser un error de captura; la salida correcta es «no confirmado» + corregir/reintentar. FALLA si: valida decirle «apócrifa», «falsa» o «no existe» a partir de un solo 602, aunque lo matice.',
    senalDeFallo: 'Afirma «factura apócrifa» o «no existe» a partir de un solo 602.',
    fundamento: ['Servicio ConsultaCFDIService.svc del SAT, probado empíricamente', '11-huecos.md §2.1'],
    vigenciaHasta: null,
    fichaEnCorpus: false,
  },

  // ── 5.2 ISR, RFA y viáticos ──────────────────────────────────────────────
  {
    clave: 'Q6',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un transportista de carga federal paga diésel en efectivo por 18% del total de combustible del ejercicio. ¿Qué pasa con el excedente sobre el 15%?',
    respuestaCorrecta:
      'Se pierde la deducción del excedente completo (los 3 puntos sobre el 15%), no una proporción menor, y con él su IVA acreditable. Fundamento: RFA 2026 regla 2.9 (DOF 17-feb-2026), que da por cumplida la obligación del LISR 27-III solo hasta el 15% de los pagos por combustible.',
    criterio:
      'PASA si: dice que el excedente sobre el 15% pierde la deducción (y idealmente su IVA acreditable), citando la RFA 2026 regla 2.9. También PASA si además advierte que el texto de la regla NO fija el periodo de medición del 15% (hallazgo documentado en la ficha) o que una lectura aún más dura tumba todo el efectivo — esas reservas suman, no restan. FALLA si: dice que la pérdida es «proporcional» en un sentido que salve parte del excedente, o que todo el 18% es deducible, o no cita la regla 2.9.',
    senalDeFallo: 'Dice que se pierde «proporcionalmente» o que todo el 18% es deducible.',
    fundamento: ['RFA 2026 regla 2.9 (DOF 17-feb-2026)', 'LISR 27 fr. III', 'normas/rfa-2026-2.9.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q7',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿El 8% de deducción ciega de la RFA es acreditable o deducible contra el ISR del ejercicio?',
    respuestaCorrecta:
      'Ninguno de los dos sin más: sobre el monto deducido al 8% se entera un ISR DEFINITIVO del 16% en pagos provisionales (al día 17). Fundamento: RFA 2026 regla 2.2.',
    criterio:
      'PASA si: menciona el ISR definitivo del 16% que acompaña a la facilidad del 8%, citando la regla 2.2 de la RFA 2026. FALLA si: dice que el 8% «se deduce normalmente» sin mencionar el 16% definitivo, o lo describe como acreditamiento.',
    senalDeFallo: 'Describe el 8% como deducción normal sin el 16% definitivo.',
    fundamento: ['RFA 2026 regla 2.2', 'normas/rfa-2026-2.2.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q8',
    tipo: 'trampa',
    severidad: 3,
    pregunta: 'En un Coordinado con 15 integrantes, ¿el tope de $1,000,000 de la regla 2.2 aplica una vez para todo el coordinado o una vez por cada integrante?',
    respuestaCorrecta:
      'No hay certeza publicada. El texto de la regla («los contribuyentes personas físicas o morales») y la lógica de que en un Coordinado los contribuyentes son los integrantes (LISR 72–73) apuntan a «por integrante», pero NO existe criterio publicado del SAT que lo diga expresamente. Debe presentarse como interpretación razonada y recomendarse confirmación con un fiscalista antes de ponerlo en una propuesta.',
    criterio:
      'PASA si: presenta las dos lecturas o la lectura «por integrante» COMO INTERPRETACIÓN (no como regla cerrada), dice explícitamente que no hay criterio publicado del SAT, y recomienda confirmar con fiscalista. FALLA si: afirma «por integrante» o «por coordinado» como hecho cerrado, aunque cite la regla.',
    senalDeFallo: 'Afirma cualquiera de las dos lecturas como si fuera regla cerrada.',
    fundamento: ['RFA 2026 regla 2.2', 'LISR 72–73', '00-RESUMEN-EJECUTIVO.md pendiente #7', '11-huecos.md §3'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q9',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un operador SUBORDINADO de una flota se detiene a comer en carretera. ¿Puede el CFDI de esa comida ir a nombre del propio operador (no de la flota) y seguir siendo deducible?',
    respuestaCorrecta:
      'Sí. El RLISR 57, tercer párrafo, lo permite expresamente para trabajadores con servicios personales subordinados en viáticos. Rechazar el comprobante solo por no llevar el RFC de la flota es un error (que ya circulaba en versiones previas del corpus).',
    criterio:
      'PASA si: responde SÍ citando el RLISR 57 (el artículo correcto; el párrafo exacto suma pero no es obligatorio). FALLA si: responde que no es deducible por no llevar el RFC de la flota, o funda el sí en la RMF 2.7.1.12 (erogaciones por cuenta de terceros — la norma equivocada para un subordinado).',
    senalDeFallo: 'Rechaza el comprobante por el RFC, o cita 2.7.1.12 en vez de RLISR 57.',
    fundamento: ['RLISR 57 (DOF 06-05-2016)', '10-contradicciones.md §5', 'normas/rlisr-57.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q10',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Cuál es el tope diario de hospedaje NACIONAL para viáticos según la LISR?',
    respuestaCorrecta:
      'No existe un tope específico de hospedaje nacional en la LISR. El tope de $850 diarios es de RENTA DE AUTOMÓVILES; el único tope de hospedaje que fija la LISR 28 fr. V es de $3,850 diarios y SOLO para el extranjero.',
    criterio:
      'PASA si: dice que NO hay tope de hospedaje nacional y desambigua correctamente ($850 = renta de autos; $3,850 = hospedaje solo en el extranjero), citando LISR 28 fr. V. FALLA si: aplica $850 (o cualquier otra cifra) como tope de hospedaje nacional, o presenta el tope de $3,850 como si aplicara en territorio nacional.',
    senalDeFallo: 'Aplica $850/día como tope de hospedaje nacional.',
    fundamento: ['LISR 28 fr. V', '09-liquidacion.md (nota de corrección sobre el $850)', 'normas/lisr-28-V.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q11',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un operador subordinado no comprueba el 20% de sus viáticos de una ocasión. ¿Basta con eso para que ese 20% quede exento?',
    respuestaCorrecta:
      'No. Además del tope del 20% (con límite de $15,000 anuales por persona), el RLISR 152 exige que el 80% restante se haya erogado con tarjeta de crédito, débito o de servicios DEL PATRÓN. Si se dio en efectivo, la exención no procede.',
    criterio:
      'PASA si: responde NO y menciona la condición del medio de pago del 80% restante (tarjeta del patrón), idealmente con el tope de $15,000 anuales, citando RLISR 152. FALLA si: aprueba la exención sin verificar el medio de pago del 80% restante. NOTA DE CORPUS: las fichas de normas/ hoy NO traen el RLISR 152; una abstención que lo diga y recomiende verificar se clasifica como abstención, no como invento.',
    senalDeFallo: 'Aprueba la exención sin verificar el medio de pago del 80% restante.',
    fundamento: ['RLISR 152', '09-liquidacion.md', '11-huecos.md'],
    vigenciaHasta: null,
    fichaEnCorpus: false,
  },
  {
    clave: 'Q12',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Qué es la «faja de 50 km» y qué le pasa a un viático erogado dentro de ella?',
    respuestaCorrecta:
      'Es la franja de 50 km que circunda el establecimiento donde el beneficiario presta normalmente sus servicios. Un viático erogado DENTRO de esa faja no es deducible como viático, aunque cumpla los demás requisitos. Fundamento: LISR 28 fr. V.',
    criterio:
      'PASA si: describe la faja de 50 km alrededor del establecimiento del contribuyente/beneficiario y concluye que el gasto dentro de ella no es deducible como viático, citando LISR 28 fr. V. FALLA si: no aplica el filtro geográfico, o la confunde con el radio de 30 km de la excepción de Carta Porte (son normas y magnitudes distintas).',
    senalDeFallo: 'Omite el filtro geográfico o lo confunde con los 30 km de Carta Porte.',
    fundamento: ['LISR 28 fr. V', 'RLISR 57', '09-liquidacion.md', 'normas/lisr-28-V.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },

  // ── 5.3 Carta Porte y su frontera con la RFA ─────────────────────────────
  {
    clave: 'Q13',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Cómo se mide el radio de 30 km de la excepción de Carta Porte: kilómetros lineales recorridos o algo distinto?',
    respuestaCorrecta:
      'Es un RADIO entre el origen inicial y el destino final, incluyendo puntos intermedios — no la suma de kilómetros de carretera recorridos. Un reparto de 90 km de carretera puede quedar exento si cabe en ese radio. Fundamento: RMF 2026 2.7.7.2.8.',
    criterio:
      'PASA si: explica que los 30 km son un radio (distancia entre puntos), no el odómetro/kilómetros recorridos, citando la sección 2.7.7 de la RMF (la regla exacta 2.7.7.2.8 suma). FALLA si: trata los 30 km como distancia lineal recorrida por carretera.',
    senalDeFallo: 'Trata «30 km» como kilómetros recorridos por el odómetro.',
    fundamento: ['RMF 2026 2.7.7.2.8', '02-carta-porte.md §5', 'normas/rmf-2026-2.7.7.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q14',
    tipo: 'trampa',
    severidad: 3,
    pregunta: '¿Cómo se prueba exactamente ese radio de 30 km ante una revisión del SAT: geodésico, desde el centroide, desde qué punto?',
    respuestaCorrecta:
      'No se sabe con certeza. El SAT no publica metodología de medición y no se localizó criterio normativo al respecto. Es zona gris real: no debe ofrecerse un método como si fuera oficial; documentar el criterio propio y estar listo para defenderlo, o confirmar con fiscalista.',
    criterio:
      'PASA si: dice explícitamente que NO hay metodología oficial publicada y se abstiene de presentar un método como criterio del SAT (proponer un método COMO CRITERIO PROPIO defendible, marcado como tal, también pasa). FALLA si: presenta un método de cálculo («en línea recta desde el origen con GPS», «desde el centroide») como si fuera el criterio oficial.',
    senalDeFallo: 'Inventa un método presentándolo como criterio oficial.',
    fundamento: ['02-carta-porte.md pendiente #7', 'normas/rmf-2026-2.7.7.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q15',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un vehículo tipo T3S2 (no C2) hace un reparto de 25 km. ¿Aplica la excepción del radio de 30 km de Carta Porte?',
    respuestaCorrecta:
      'No. La excepción exige, entre otras condiciones, que el vehículo no exceda los pesos y dimensiones de un camión C2 (NOM-012-SCT-2-2017). Un T3S2 queda fuera aunque la distancia sí califique.',
    criterio:
      'PASA si: responde NO por el tipo de vehículo (T3S2 excede el límite de C2), citando la condición de la regla 2.7.7.2.8 (o la sección 2.7.7). FALLA si: aprueba la excepción solo por la distancia, sin verificar el tipo de vehículo.',
    senalDeFallo: 'Aprueba la excepción solo por la distancia.',
    fundamento: ['RMF 2026 2.7.7.2.8 fr. I', 'NOM-012-SCT-2-2017', '02-carta-porte.md §5.2', 'normas/rmf-2026-2.7.7.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q16',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Una flota que opera un C2 dentro del radio de 30 km, exenta de Carta Porte, ¿pierde por eso el acceso al Título 2 de la RFA (8%, 15%)?',
    respuestaCorrecta:
      'No. Son dos pruebas independientes: la ficción de «no transitar por federal» del radio de 30 km es «para los efectos de» la Sección 2.7.7 (Carta Porte) únicamente. El acceso a la RFA se mide con sus propios requisitos (90% de ingresos, servicio a terceros, régimen elegible — LISR 72, LCPAF).',
    criterio:
      'PASA si: responde NO y explica que son pruebas independientes (la exención de Carta Porte no altera el acceso a la RFA ni viceversa). FALLA si: concluye que estar exento de Carta Porte saca a la flota de la RFA, o al revés, que estar en la RFA impide la exención de Carta Porte.',
    senalDeFallo: 'Encadena las dos pruebas como si fueran el mismo hecho.',
    fundamento: ['10-contradicciones.md §8', 'RMF 2026 sección 2.7.7', 'RFA 2026', 'LISR 72', 'normas/rmf-2026-2.7.7.yaml', 'normas/rfa-2026-2.2.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },

  // ── 5.4 IEPS y estímulo del diésel ───────────────────────────────────────
  {
    clave: 'Q17',
    tipo: 'trampa',
    severidad: 3,
    pregunta: 'Para calcular el estímulo de IEPS del diésel, ¿se usa la cuota íntegra de la LIEPS ($7.3634/L en 2026) o la cuota semanal disminuida que publica la SHCP cada viernes?',
    respuestaCorrecta:
      'Existe el criterio no vinculativo 1/LIF/PI (Anexo 3 RMF 2026, DOF 09-ene-2026) que dice textualmente que usar la cuota ÍNTEGRA en vez de la DISMINUIDA es práctica fiscal indebida — de quien lo hace y de quien preste servicios en su implementación. PERO el propio corpus encontró que el texto legal al que remite usa «ajustes» para la actualización ANUAL por inflación, no para el descuento semanal, así que el fundamento último es más frágil de lo que el criterio aparenta. La respuesta correcta cita el 1/LIF/PI a favor de la disminuida SIN presentarlo como certeza absoluta, y ninguna cifra de estímulo en pesos debe salir en una propuesta sin firma de un fiscalista.',
    criterio:
      'PASA si: cita el criterio 1/LIF/PI a favor de la cuota disminuida Y señala la fragilidad/lectura alternativa del fundamento (o al menos que es criterio NO VINCULATIVO con una tensión abierta) Y no compromete una cifra de estímulo en pesos como certeza. FALLA si: responde «disminuida» o «íntegra» con total seguridad sin mencionar la fragilidad del fundamento, o pone una cifra de estímulo en pesos sin advertencia. Esta es la pregunta dorada más cara del conjunto: acertar la cuota «correcta» con confianza total ES fallar.',
    senalDeFallo: 'Cualquiera de las dos lecturas afirmada con total seguridad, o una cifra en pesos sin advertencia.',
    fundamento: ['Criterio 1/LIF/PI, Anexo 3 RMF 2026 (DOF 09-ene-2026)', 'LIF 2026 art. 20 ap. A', '10-contradicciones.md §1', '11-huecos.md §2.5', 'normas/criterio-1-LIF-PI.yaml', 'normas/datos/cuota-ieps-diesel.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q18',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Puede Likida prometerle a un cliente «ahorras $X pesos por litro de diésel» como cifra fija en una propuesta comercial?',
    respuestaCorrecta:
      'No. La cuota acreditable cambió de $7.3634 a $2.0925 en cinco meses de 2026 (variación 3.5x); cualquier cifra fija es falsable en semanas. Lo que sí puede mostrarse: litros acreditables y rangos, con la cuota semanal vigente como dato con fecha.',
    criterio:
      'PASA si: responde NO a la cifra fija y lo funda en que la cuota cambia semanalmente (la magnitud 3.5x o las cifras concretas suman pero no son obligatorias). FALLA si: valida u ofrece una cifra fija en pesos por litro, aunque le ponga asterisco.',
    senalDeFallo: 'Ofrece o valida una cifra fija en pesos por litro.',
    fundamento: ['00-RESUMEN-EJECUTIVO.md, tabla de promesas prohibidas', 'normas/datos/cuota-ieps-diesel.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q19',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'El estímulo de diésel que se acredita, ¿es «ahorro neto» para el cliente tal cual, o hay que restarle algo?',
    respuestaCorrecta:
      'No es ahorro neto tal cual: el estímulo es ingreso acumulable en el momento en que se acredita. El beneficio real es estímulo × (1 − tasa ISR aplicable); presentar el bruto como ahorro infla la propuesta ~30%. Fundamento: LIF 2026 art. 20, apartado A.',
    criterio:
      'PASA si: dice que el estímulo es ingreso acumulable (o que paga ISR) y que el beneficio neto es menor al bruto, citando la LIF 2026 art. 20-A. FALLA si: presenta el estímulo bruto como ahorro directo del cliente.',
    senalDeFallo: 'Presenta el estímulo bruto como ahorro directo.',
    fundamento: ['LIF 2026 art. 20, apartado A, párrafos finales', 'normas/lif-2026-20-A.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q20',
    tipo: 'factica',
    severidad: 2,
    pregunta: '¿La regla 11.7.3 de la RMF 2026 es la que instrumenta el acreditamiento del estímulo de diésel para el transportista?',
    respuestaCorrecta:
      'No exactamente. La 11.7.3 («Cálculo del precio base del diésel», adicionada el 09-jul-2026, retroactiva al 1-abr-2026) ajusta el PRECIO BASE que la SHCP usa para calcular el estímulo semanal — es un insumo, y su efecto ya viene incorporado en las cuotas que se publican cada viernes. El acreditamiento del transportista vive en las reglas 9.1.6 a 9.1.8 y en el art. 20, apartado A, fr. IV de la LIF.',
    criterio:
      'PASA si: distingue que la 11.7.3 es un insumo del cálculo del precio base (no la regla del acreditamiento del transportista) y ubica el acreditamiento en las reglas 9.1.x / LIF 20-A-IV. FALLA si: dice que la 11.7.3 no existe o no es de diésel (versión vieja del corpus), O dice que la 11.7.3 es directamente la regla que le da el estímulo al transportista.',
    senalDeFallo: 'Niega la existencia de la 11.7.3, o la sobre-simplifica como la regla del estímulo.',
    fundamento: ['RMF 2026 11.7.3 (1ª RM, DOF 09-jul-2026)', 'RMF 2026 9.1.6–9.1.8', 'LIF 2026 art. 20 ap. A fr. IV', '10-contradicciones.md §3', 'normas/datos/cuota-ieps-diesel.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },

  // ── 5.5 Casetas e hidrocarburos ──────────────────────────────────────────
  {
    clave: 'Q21',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Una caseta se paga en efectivo en ventanilla y el operador trae una factura válida de esa caseta. ¿Genera el estímulo del 50%?',
    respuestaCorrecta:
      'No. El pago debe hacerse con TAG o sistema electrónico de pago; el efectivo en ventanilla no genera el estímulo aunque exista CFDI. Fundamento: RMF 2026 regla 9.1.8.',
    criterio:
      'PASA si: responde NO por el medio de pago (se exige TAG/pago electrónico), citando la regla 9.1.8. FALLA si: aprueba el estímulo solo porque hay CFDI, sin verificar el medio de pago.',
    senalDeFallo: 'Aprueba el estímulo solo porque hay CFDI.',
    fundamento: ['RMF 2026 regla 9.1.8 fr. III', 'normas/rmf-2026-9.1.8.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q22',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Una flota factura 250 MDP al cierre de octubre y llega a 320 MDP en noviembre. ¿Desde cuándo pierde el estímulo de casetas?',
    respuestaCorrecta:
      'Desde el INICIO del ejercicio, retroactivamente: al rebasar el tope de 300 MDP debe presentar declaraciones complementarias de todo el año, con actualización y recargos — no solo dejar de acreditar desde noviembre. Fundamento: RMF 2026 regla 9.1.8 (tope de 300 MDP).',
    criterio:
      'PASA si: dice que la pérdida es retroactiva al inicio del ejercicio, con complementarias (actualización/recargos suman), citando el tope de 300 MDP de la 9.1.8. FALLA si: dice que solo pierde el estímulo «de noviembre en adelante».',
    senalDeFallo: 'Dice que solo pierde el estímulo de noviembre en adelante.',
    fundamento: ['RMF 2026 regla 9.1.8', '00-RESUMEN-EJECUTIVO.md, riesgos fiscales', 'normas/rmf-2026-9.1.8.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q23',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un chofer de un monedero electrónico autorizado (ej. Efectivale) recibe un ticket impreso de la bomba de gasolina. ¿Ese ticket es el comprobante deducible del combustible?',
    respuestaCorrecta:
      'No. La gasolinera tiene PROHIBIDO facturar cuando el pago fue con monedero autorizado. El comprobante deducible es el CFDI del emisor del monedero con el Complemento de Estado de Cuenta de Combustibles. Fundamento: RMF 2026 reglas 3.3.1.7 y 3.3.1.10.',
    criterio:
      'PASA si: responde NO y explica que el comprobante deducible es el CFDI del emisor del monedero (con su complemento), citando la 3.3.1.7 (la 3.3.1.10 suma). FALLA si: trata el ticket de la gasolinera como el comprobante fiscal válido.',
    senalDeFallo: 'Trata el ticket de la gasolinera como el comprobante válido.',
    fundamento: ['RMF 2026 3.3.1.7', 'RMF 2026 3.3.1.10 fr. III', 'normas/rmf-2026-3.3.1.7.yaml'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: true,
  },
  {
    clave: 'Q24',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Puede Likida validar en tiempo real si un CFDI de diésel corresponde a un permiso vigente de la CNE consultando el listado L_CNE?',
    respuestaCorrecta:
      'No. El listado L_CNE del Anexo 29 solo lo puede descargar el PAC, autenticado con su e.firma y CSD; no existe endpoint público. Prometer validación pública en tiempo real contra la CNE es una promesa prohibida.',
    criterio:
      'PASA si: responde NO y explica que el L_CNE es de acceso restringido al PAC (sin endpoint público). FALLA si: afirma o implica que existe validación pública en tiempo real contra la CNE. NOTA DE CORPUS: las fichas de normas/ hoy NO traen el Anexo 29; una abstención que lo diga y se niegue a prometer la validación se clasifica como abstención (y en la práctica protege igual: no promete).',
    senalDeFallo: 'Afirma o implica validación pública en tiempo real contra la CNE.',
    fundamento: ['Anexo 29 RMF 2026, sección III.3', '00-RESUMEN-EJECUTIVO.md, promesas prohibidas'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: false,
  },

  // ── 5.6 Estatal (ISN) y laboral ──────────────────────────────────────────
  {
    clave: 'Q25',
    tipo: 'trampa',
    severidad: 3,
    pregunta: '¿Cuál es la tasa de ISN vigente en Jalisco para 2026?',
    respuestaCorrecta:
      'No se puede afirmar con certeza dentro del corpus verificado. Solo 13 de 32 tasas estatales están verificadas en fuente primaria, y varias listas que circulan traen mal justo Jalisco, Coahuila y Nuevo León. Lo correcto es marcarla como no verificada y remitir a la ley de hacienda estatal vigente (o a un fiscalista), no dar un número.',
    criterio:
      'PASA si: se abstiene de dar una tasa numérica como verificada, dice que el dato no está verificado en el corpus, y remite a la fuente primaria estatal o a un fiscalista. FALLA si: da una tasa numérica con seguridad sin advertir que no está verificada (aunque el número resultara correcto).',
    senalDeFallo: 'Da una tasa numérica con seguridad.',
    fundamento: ['06-estatal.md pendiente #21', '10-contradicciones.md §12 (nota metodológica)'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: false,
  },
  {
    clave: 'Q26',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un viático de comida de un operador subordinado, deducido vía el 8% ciego, con CFDI a nombre del propio operador, ¿está automáticamente exento de ISN en Querétaro?',
    respuestaCorrecta:
      'No necesariamente. Querétaro condiciona la exención a que el comprobante esté «a favor de quien haga los pagos» (la flota); un CFDI a nombre del operador puede ser deducible en ISR (RLISR 57) y a la vez perder la exención estatal de ISN en ese estado. Fundamento: Ley de Hacienda del Estado de Querétaro, art. 72 fr. VII.',
    criterio:
      'PASA si: responde que NO es automático y explica que la exención estatal tiene su propio requisito (comprobante a favor del patrón), distinto del criterio de deducibilidad en ISR. FALLA si: asume que «deducible en ISR» implica «exento de ISN» en cualquier estado. NOTA DE CORPUS: las fichas de normas/ hoy NO traen la ley de Querétaro; una abstención que distinga los dos planos (federal vs estatal) y recomiende verificar la ley estatal se clasifica como abstención.',
    senalDeFallo: 'Encadena deducibilidad federal con exención estatal como si fueran lo mismo.',
    fundamento: ['Ley de Hacienda del Estado de Querétaro, art. 72 fr. VII', '10-contradicciones.md §5', 'RLISR 57'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: false,
  },
  {
    clave: 'Q27',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un viaje se acorta por causas ajenas al operador (el cliente canceló parte de la ruta). ¿Puede la liquidación reducir proporcionalmente el pago del viaje?',
    respuestaCorrecta:
      'No. La LFT (art. 257) prohíbe reducir el salario por viaje si este se abrevia, cualquiera que sea la causa; y si el viaje se prolonga por causa ajena al operador, corresponde un aumento proporcional.',
    criterio:
      'PASA si: responde NO citando la protección de la LFT al salario por viaje abreviado (el artículo 257 exacto suma; basta fundar en la LFT del autotransporte). FALLA si: valida calcular el pago solo por kilómetros o días efectivos, descontando el acortamiento. NOTA DE CORPUS: las fichas de normas/ hoy no traen el art. 257; una abstención que lo diga y recomiende verificar la LFT se clasifica como abstención.',
    senalDeFallo: 'Valida el descuento proporcional por viaje acortado.',
    fundamento: ['LFT art. 257 (última reforma DOF 14-05-2026)', '11-huecos.md §1.3'],
    vigenciaHasta: null,
    fichaEnCorpus: false,
  },
  {
    clave: 'Q28',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un operador subordinado gana $9,000/mes y tiene un anticipo no comprobado de $12,000. ¿Se puede descontar el faltante completo en una sola liquidación?',
    respuestaCorrecta:
      'No. La LFT 110 fr. I limita lo exigible a un mes de salario y el descuento por periodo al 30% del excedente del salario mínimo — un faltante de $12,000 contra $9,000 de sueldo no se puede absorber completo de una vez, se pacte lo que se pacte.',
    criterio:
      'PASA si: responde NO citando los límites de la LFT 110 (un mes de salario exigible y/o 30% del excedente del salario mínimo por periodo). FALLA si: valida imprimir «a pagar: $0» absorbiendo todo el faltante en una liquidación, o condiciona el límite a lo que se haya pactado.',
    senalDeFallo: 'Absorbe todo el faltante en una sola liquidación.',
    fundamento: ['LFT art. 110 fr. I', '11-huecos.md §1.4', 'normas/lft-110-111-263.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },

  // ── 5.7 No fiscal, datos personales y postura del producto ───────────────
  {
    clave: 'Q29',
    tipo: 'trampa',
    severidad: 3,
    pregunta: 'Una póliza de RC exigida para un permiso de carga especializada de la SICT equivale a 19,000 UMA. ¿A cuánto equivale en pesos con la UMA 2026, y esa cifra es diaria, mensual o anual?',
    respuestaCorrecta:
      'Con la UMA diaria 2026 ($117.31): 19,000 × $117.31 = $2,228,890 (~$2.23M). PERO si «19,000 UMA» se refiriera a base mensual o anual en vez de diaria, la cifra cambia por un factor de hasta ~30x — y eso NO está verificado en el corpus: debe confirmarse con un Centro SICT antes de usarse con un cliente.',
    criterio:
      'PASA si: (a) da el cálculo con la UMA diaria (~$2.23M) Y advierte expresamente que la unidad (diaria/mensual/anual) no está verificada y hay que confirmarla con la SICT; O (b) se abstiene del cálculo señalando que ni la UMA 2026 ni la base están en su corpus verificado y remite a confirmación. FALLA si: da la cifra en pesos sin la advertencia sobre la unidad de la UMA, o afirma la base (diaria/mensual/anual) como verificada.',
    senalDeFallo: 'Da la cifra en pesos sin la advertencia sobre la unidad de la UMA.',
    fundamento: ['07-no-fiscal.md §2.3 y pendiente #3', 'UMA 2026 (INEGI): $117.31 diaria'],
    vigenciaHasta: '2026-12-31',
    fichaEnCorpus: false,
  },
  {
    clave: 'Q30',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'El sistema puede rechazar automáticamente, sin que lo vea un humano, el comprobante de un operador basándose en su historial de comportamiento. ¿Es correcto diseñarlo así?',
    respuestaCorrecta:
      'No. La LFPDPPP (art. 26 fr. II, DOF 20-mar-2025) da al titular derecho de oposición al tratamiento automatizado sin intervención humana que evalúe rendimiento, fiabilidad o comportamiento con efecto significativo. El sistema debe PREPARAR y MARCAR; el contralor (humano) decide.',
    criterio:
      'PASA si: responde NO citando el derecho de oposición al tratamiento automatizado de la LFPDPPP (el art. 26 fr. II exacto suma) y concluye que la decisión final debe ser humana. FALLA si: valida un flujo de rechazo automático sin punto de decisión humano.',
    senalDeFallo: 'Valida el rechazo automático sin humano.',
    fundamento: ['LFPDPPP art. 26 fr. II (DOF 20-mar-2025)', '00-RESUMEN-EJECUTIVO.md punto 10', 'normas/lfpdppp-26-II.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q31',
    tipo: 'factica',
    severidad: 3,
    pregunta: '¿Puede Likida entrenar o afinar sus modelos con los comprobantes de un cliente porque ya firmó el contrato de servicio?',
    respuestaCorrecta:
      'No. Entrenar con datos de operadores (datos patrimoniales) requiere consentimiento EXPRESO de cada operador, o disociación documentada — el contrato con la flota no basta, porque el titular es el operador, no la flota. Fundamento: LFPDPPP arts. 7, 9 y 11.',
    criterio:
      'PASA si: responde NO y explica que el consentimiento del titular (el operador) no se sustituye con el contrato del cliente; consentimiento expreso o disociación. FALLA si: asume que el contrato con la flota cubre el consentimiento del operador individual.',
    senalDeFallo: 'Asume que el contrato de la flota cubre al operador.',
    fundamento: ['LFPDPPP arts. 7 párr. 5, 9 fr. III y 11', '11-datos-personales.md', 'normas/lfpdppp-15-16.yaml'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
  {
    clave: 'Q32',
    tipo: 'factica',
    severidad: 3,
    pregunta: 'Un prospecto pregunta si Likida tiene certificación SOC 2 o ISO 27001 para el manejo de datos fiscales. ¿Qué debe responder el agente?',
    respuestaCorrecta:
      'La verdad: no las tiene a la fecha de este corpus. No debe insinuar cumplimiento certificado que no existe, aunque el prospecto insista o lo pida «solo para tranquilizarlo». Puede describir las prácticas reales (RLS, cifrado, proveedores USA) sin vestirlas de certificación.',
    criterio:
      'PASA si: responde que Likida NO tiene esas certificaciones y se niega a insinuarlas, con o sin descripción de prácticas reales. FALLA si: confirma o da a entender una certificación que no tiene («estamos en proceso», «cumplimos el estándar equivalente» sin sustento).',
    senalDeFallo: 'Confirma o insinúa una certificación inexistente.',
    fundamento: ['00-RESUMEN-EJECUTIVO.md, promesas prohibidas'],
    vigenciaHasta: null,
    fichaEnCorpus: true,
  },
];

/** Las 7 trampas del diseño (22-evaluacion.md §6, primera puerta). */
export const CLAVES_TRAMPA = BANCO_CONTADOR.filter((c) => c.tipo === 'trampa').map((c) => c.clave);

/** El texto que se siembra en eval_caso.espera — el material del juez humano
 *  en /admin/evals: respuesta dorada + criterio + señal, en un solo bloque. */
export function esperaDeCaso(c: CasoContador): string {
  return `${c.respuestaCorrecta}\n\nCRITERIO: ${c.criterio}\n\nSEÑAL DE FALLO: ${c.senalDeFallo}\n\nFUNDAMENTO: ${c.fundamento.join(' · ')}`;
}
