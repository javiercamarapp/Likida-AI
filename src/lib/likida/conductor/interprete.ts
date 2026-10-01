import {
  PREFIJO_BOTON, leerBotonConductor, type Contacto, type Lugar, type TipoHito,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ QUISO DECIR EL CHOFER — reglas deterministas, español de México.
//
// Va PRIMERO y es la única ruta que decide sin costo ni latencia: botones de las
// plantillas (el payload lo elegimos nosotros) y texto libre («ya llegué», «ya
// estoy en andén», “me atiende Juan de recibo”, «ya cargué», «salgo para allá»).
// El modelo (llm.ts) es SOLO respaldo para lo que estas reglas no entienden.
//
// ── POR QUÉ UN INTÉRPRETE ACOTADO Y NO UNO GENEROSO ─────────────────────────
// El daño del falso positivo es asimétrico: un mensaje que este módulo se come
// por error NUNCA llega al agente de liquidación, y «llegué a cargar diésel en
// Querétaro» es un gasto, no un hito. Tres candados:
//   1. PALABRAS DE OTRO TEMA (diésel, caseta, ticket, llanta, choque…): si salen,
//      el mensaje sigue su camino sin importar qué verbos traiga.
//   2. VOCABULARIO: lo que no es vocabulario conocido ni el nombre de un contacto
//      cuenta como «palabra ajena»; con más de DOS el mensaje ya trae contenido
//      que este módulo no entiende y sigue su camino.
//   3. Una PREGUNTA nunca es un hito («¿ya llegué?», «¿ya llegaste?»).
//
// El LUGAR (carga/descarga) sale de las palabras del mensaje. Si el mensaje dice
// «ya llegué» a secas, el lugar es `null` y lo decide la máquina de estados mirando
// QUÉ hitos del viaje ya están registrados (maquina.ts): así una llegada al origen
// no sella la llegada al destino.
// ═══════════════════════════════════════════════════════════════════════════

export type Intencion =
  | { clase: 'llegada'; lugar: Lugar | null }
  | { clase: 'salida'; lugar: Lugar | null }
  /** «cargando» / «descargando»: ya está en el lugar y sigue ahí. */
  | { clase: 'en_proceso'; lugar: Lugar }
  | { clase: 'regreso' }
  | { clase: 'retraso'; minutos: number | null }
  | { clase: 'sin_contacto' }
  /** Solo dio el contacto («me atiende Juan de recibo»). */
  | { clase: 'contacto'; lugar: Lugar | null }
  /** Retirar lo último; `como` re-registra otro hito en su lugar (botón «Es en descarga»). */
  | { clase: 'correccion'; como: TipoHito | null }
  /** Botón «Registrar ahora»: el hito que se le estaba pidiendo. */
  | { clase: 'registrar_activo' }
  | { clase: 'problema' }
  | { clase: 'pedir_ubicacion' }
  /** «Sigo cargando / descargando» (botón): sigue en el lugar, sin registrar nada nuevo. */
  | { clase: 'sigue'; lugar: Lugar }
  /** Botón «Aún no voy de regreso». */
  | { clase: 'aun_no_regreso' };

export interface Interpretacion {
  intencion: Intencion;
  contacto: Contacto | null;
  via: 'regla' | 'boton' | 'llm';
  confianza: number;
  /** Solo botones: el viaje que trae el payload (el llamador comprueba que sea del chofer). */
  viajeId?: string;
}

/** Minúsculas, sin acentos, sin puntuación ni emoji, espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sin acentos pero CONSERVANDO la ñ (para no volver «Muñoz» «Munoz»). */
function sinAcentosConEnie(texto: string): string {
  return texto
    .replace(/ñ/g, '\u0001').replace(/Ñ/g, '\u0002')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ').replace(/\u0002/g, 'Ñ');
}

const MAX_LARGO_REGLAS = 160;

// ── Palabras de OTRO tema: si aparece una, esto no es un hito ───────────────
const OTRO_TEMA = new RegExp(
  '\\b(' + [
    'diesel', 'gasolina', 'magna', 'premium', 'combustible', 'litros?', 'lts', 'pesos', 'monto', 'factura', 'ticket',
    'tickets', 'comprobante', 'comprobantes', 'peaje', 'peajes', 'caseta', 'casetas', 'viatico', 'viaticos', 'hotel',
    'comida', 'comi', 'talacha', 'llanta', 'ponche', 'aceite', 'mecanico', 'mecanica', 'averia', 'descompuso', 'choque',
    'choque', 'chocamos', 'choco', 'volcadura', 'volcamos', 'accidente', 'robo', 'robaron', 'asalto', 'asaltaron',
    'herido', 'heridos', 'lesionado', 'lesionados', 'ambulancia', 'grua', 'multa', 'infraccion', 'liquidacion', 'anticipo',
  ].join('|') + ')\\b',
);

// ── Vocabulario conocido (para contar «palabras ajenas») ────────────────────
const VOCABULARIO = new Set((
  'ya estoy estamos aqui alla alli en el la los las un una al a de del y e o ahorita ahora mismo jefe patron buen buenos ' +
  'dias tardes noches gracias por favor fav amigo compa oiga hola que mi me se voy vamos vengo mas ok okay si claro para con ' +
  'llegue llegamos llego llegando llegada entre entramos dentro afuera anden andenes porteria garita puerta patio planta ' +
  'cedis cedi destino origen cliente tienda sucursal almacen bodega recibo recibir recibe reciben recibio atiende atienden ' +
  'atendio atendieron atendiendo contacto sin nadie nada hay tengo todavia aun no he hable con reporte presente pregunte ' +
  'cargar carga cargue cargamos cargaron cargando cargado descargar descarga descargue descargamos descargaron descargando ' +
  'descargado embarque embarques entrega entregar entregue sali salimos salgo salida voy camino rumbo regreso regresando ' +
  'regrese vuelta base terminal casa retraso retrasado retrasada atrasado atrasada tarde tardar tardo trafico transito ' +
  'minutos minuto min hora horas hr hrs media quede quedo listo liberaron liberado dieron termine terminamos esta equivoque ' +
  'confundi fue error mio corrijo corrige cancela cancelalo deshaz era es lo eso quita nuevo otra otro unos unas es son ' +
  'recoger recolectar recoleccion recogi esperando formado fila presente dentro lleg ya'
).split(' '));

const NOMBRES_PROHIBIDOS = new Set([
  'ya', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'alguien', 'nadie', 'cliente', 'gente', 'personal',
  'senor', 'senora', 'ahorita', 'ahora', 'todavia', 'aun', 'mas', 'tarde', 'luego', 'enseguida', 'que', 'quien',
  'este', 'esta', 'ese', 'esa', 'mi', 'tu', 'su', 'persona', 'chavo', 'chava', 'muchacho', 'muchacha', 'jefe',
  'supervisor', 'encargado', 'encargada', 'guardia', 'vigilante', 'porteria', 'anden', 'recibo', 'embarques', 'almacen',
]);

const TITULOS = '(?:(?:el|la|don|dona|doña|senor|señor|senora|señora|sr|sra|ing|ingeniero|ingeniera|lic|licenciado|licenciada|jefe|supervisor|encargado)\\.?\\s+)*';
const NOMBRE = '([\\p{L}]{2,20}(?:\\s+[\\p{L}]{2,20})?)';
const COLA = '(?:\\s+(?:de\\s+la|del\\s+area\\s+de|del|de|en\\s+el|en\\s+la|en)\\s+([\\p{L}]{2,25}(?:\\s+[\\p{L}]{2,25}){0,2}))?';
const FIN = '(?=\\s*(?:[,.;]|$)|\\s+(?:y|pero|ya|que|porque|para|dice|me)\\b)';

const PATRONES_CONTACTO: RegExp[] = [
  new RegExp(`\\b(?:me\\s+atiend(?:e|en|io|ieron)|me\\s+recib(?:e|en|io|ieron)|me\\s+esta\\s+(?:atendiendo|recibiendo)|me\\s+va\\s+a\\s+(?:atender|recibir))\\s+${TITULOS}${NOMBRE}${COLA}${FIN}`, 'iud'),
  new RegExp(`\\b(?:me\\s+report(?:e|o)\\s+con|report(?:e|o)\\s+con|me\\s+present(?:e|o)\\s+con|habl(?:e|o)\\s+con|pregunt(?:e|o)\\s+por)\\s+${TITULOS}${NOMBRE}${COLA}${FIN}`, 'iud'),
  new RegExp(`\\b(?:el|mi)\\s+contacto\\s+es\\s+${TITULOS}${NOMBRE}${COLA}${FIN}`, 'iud'),
  new RegExp(`\\b(?:atiende|recibe)\\s+${TITULOS}${NOMBRE}${COLA}${FIN}`, 'iud'),
];

const AREAS_DESCARGA = /\b(recib\w*|descarga|entrega\w*|cliente|tienda|sucursal|cedis|destino|mostrador)\b/;
const AREAS_CARGA = /\b(embarque\w*|despacho|carga|shipping|salida|planta|produccion|origen|logistica)\b/;

function titulo(palabra: string): string {
  return palabra.charAt(0).toLocaleUpperCase('es-MX') + palabra.slice(1).toLocaleLowerCase('es-MX');
}

/** Extrae «con quién se reportó»; `null` si no hay un nombre creíble. Pura. */
export function extraerContacto(texto: string): Contacto | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  // Se busca sobre una copia SIN acentos y con la puntuación en espacios (misma
  // longitud que el original), y el nombre se recorta del original por posición:
  // «López» no pierde su acento ni «Muñoz» su eñe.
  const alineado = sinAcentosConEnie(texto).replace(/[^\p{L}\p{N}\s.,;]/gu, ' ');
  const mismoLargo = alineado.length === texto.length;
  for (const re of PATRONES_CONTACTO) {
    const m = re.exec(alineado);
    if (!m) continue;
    const idx = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices;
    const crudo = mismoLargo && idx?.[1] ? texto.slice(idx[1][0], idx[1][1]) : m[1];
    const palabras = crudo.trim().split(/\s+/).filter((p) => !NOMBRES_PROHIBIDOS.has(sinAcentosConEnie(p).toLowerCase()));
    // Una palabra prohibida AL INICIO invalida el contacto («me atiende alguien»).
    if (palabras.length === 0 || NOMBRES_PROHIBIDOS.has(sinAcentosConEnie(crudo.trim().split(/\s+/)[0]).toLowerCase())) continue;
    const nombre = palabras.slice(0, 2).map(titulo).join(' ');
    if (nombre.length < 2 || nombre.length > 60) continue;
    let area: string | null = null;
    if (m[2]) {
      const a = m[2].replace(/\s+/g, ' ').trim().toLocaleLowerCase('es-MX').replace(/^(?:el|la|los|las|area|de)\s+/u, '').slice(0, 40).trim();
      if (a.length >= 2) area = a;
    }
    return { nombre, area };
  }
  return null;
}

/** El lugar que sugiere el área del contacto («de recibo» → descarga). */
export function lugarDeArea(area: string | null): Lugar | null {
  if (!area) return null;
  const a = normalizar(area);
  if (AREAS_DESCARGA.test(a)) return 'descarga';
  if (AREAS_CARGA.test(a)) return 'carga';
  return null;
}

function minutosDe(n: string): number | null {
  if (/\bmedia\s+hora\b/.test(n)) return 30;
  if (/\buna\s+hora\b/.test(n)) return 60;
  const h = /\b(\d{1,2})\s*(?:hora|horas|hr|hrs)\b/.exec(n);
  if (h) return Math.min(Number(h[1]) * 60, 240);
  const m = /\b(\d{1,3})\s*(?:min|mins|minuto|minutos)\b/.exec(n);
  if (m) return Math.min(Math.max(Number(m[1]), 5), 240);
  return null;
}

const RE_CORRECCION = [
  /\b(me equivoque|me confundi|fue (un )?error|error mio|por error|corrijo|correccion|corrige|deshaz|quita(lo)? eso|cancela(lo)?|no era)\b/,
  /\b(todavia|aun|ahorita|apenas) no (he )?(llegado|llego|llegue|salido|sali|salgo|cargado|cargue|descargado|descargue|regreso|regresado|termino)\b/,
  /\bno he (llegado|salido|cargado|descargado|regresado|terminado)\b/,
  /\bno (llegue|sali|cargue|descargue)\b/,
];
const RE_SIN_CONTACTO = /\b(sin contacto|(aun|todavia) no tengo contacto|no tengo contacto|nadie me atiende|no me atiende nadie|no hay nadie|no se quien)\b/;
const RE_RETRASO = /\b(retraso|retrasado|retrasada|atrasado|atrasada|voy tarde|llego tarde|me voy a tardar|me tardo|me atrase|me retrase|trafico|transito|voy llegando)\b/;
const RE_LLEGADA_FUTURA = /\b(llego|llegare|llegaria)\s+(en|a las|como a las|dentro de)\b/;
const RE_EN_PROCESO_CARGA = /\b(estoy cargando|me estan cargando|ya cargando|cargando|en carga|estan cargando)\b/;
const RE_EN_PROCESO_DESCARGA = /\b(estoy descargando|me estan descargando|ya descargando|descargando|en descarga|empezamos a descargar|empezaron a descargar|estan descargando)\b/;
const RE_SALIDA_CARGA = /\b(ya )?(cargue|cargamos|me cargaron|termine de cargar|terminamos de cargar|ya esta cargado|ya quede cargado|ya cargaron|salgo de (la )?(carga|planta)|sali de (la )?(carga|planta))\b/;
const RE_SALIDA_DESCARGA = /\b(ya )?(descargue|descargamos|me descargaron|termine de descargar|terminamos de descargar|ya quede descargado|ya descargaron|sali de(l)? (cedis|destino|cliente|descarga)|ya me liberaron|me liberaron)\b/;
const RE_SALIDA = /\b(sali|salimos|salgo|ya me voy|me voy|me retiro|me dieron salida|ya salgo|salida)\b/;
const RE_REGRESO = /\b(de regreso|voy de regreso|vengo de regreso|regresando|de vuelta|voy de vuelta|ya regreso|me regreso|rumbo a (la )?(base|terminal|patio|casa))\b/;
const RE_LLEGADA = /\b(llegue|llegamos|ya llego|llegada|ya estoy aqui|estoy aqui|estamos aqui|ya estamos|ya entre|ya entramos|ya estoy dentro|en (el )?(anden|andenes|porteria|garita|patio|destino|planta|cedis)|ya en destino)\b/;

/**
 * El texto libre → intención, o `null` si NO es un hito (sigue al agente).
 * Pura y sin I/O.
 */
export function interpretarTexto(texto: string | undefined): Interpretacion | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (texto.length > MAX_LARGO_REGLAS) return null;
  if (/[?¿]/.test(texto)) return null;

  const n = normalizar(texto);
  if (!n) return null;
  if (OTRO_TEMA.test(n)) return null;

  const contacto = extraerContacto(texto);

  // Palabras ajenas = lo que no es vocabulario ni parte del contacto. Más de dos
  // y el mensaje trae contenido que esto no entiende.
  const delContacto = new Set(
    contacto ? normalizar(`${contacto.nombre} ${contacto.area ?? ''}`).split(' ').filter(Boolean) : [],
  );
  const ajenas = n.split(' ').filter((t) => !VOCABULARIO.has(t) && !delContacto.has(t) && !/^\d+$/.test(t));
  if (ajenas.length > 2) return null;

  const tieneCarga = /\b(cargar|carga|cargue|cargando|cargado|cargamos|cargaron|embarque|embarques|origen|recoger|recolectar|recoleccion|recogi|planta)\b/.test(n);
  const tieneDescarga = /\b(descargar|descarga|descargue|descargando|descargado|descargamos|descargaron|destino|cedis|cedi|recibo|entrega|entregar|entregue|cliente|sucursal|tienda)\b/.test(n);
  let lugar: Lugar | null = tieneCarga && !tieneDescarga ? 'carga' : tieneDescarga && !tieneCarga ? 'descarga' : null;
  if (!lugar && contacto) lugar = lugarDeArea(contacto.area);

  const r = (intencion: Intencion, confianza = 0.95): Interpretacion => ({ intencion, contacto, via: 'regla', confianza });

  if (RE_CORRECCION.some((re) => re.test(n))) return { intencion: { clase: 'correccion', como: null }, contacto: null, via: 'regla', confianza: 0.9 };
  if (RE_SIN_CONTACTO.test(n)) return { intencion: { clase: 'sin_contacto' }, contacto: null, via: 'regla', confianza: 0.95 };
  if (RE_RETRASO.test(n) || RE_LLEGADA_FUTURA.test(n)) {
    return { intencion: { clase: 'retraso', minutos: minutosDe(n) }, contacto: null, via: 'regla', confianza: 0.9 };
  }

  if (RE_SALIDA_CARGA.test(n)) return r({ clase: 'salida', lugar: 'carga' });
  if (RE_SALIDA_DESCARGA.test(n)) return r({ clase: 'salida', lugar: 'descarga' });
  if (RE_EN_PROCESO_DESCARGA.test(n)) return r({ clase: 'en_proceso', lugar: 'descarga' });
  if (RE_EN_PROCESO_CARGA.test(n)) return r({ clase: 'en_proceso', lugar: 'carga' });
  if (RE_REGRESO.test(n)) return r({ clase: 'regreso' });
  if (RE_LLEGADA.test(n)) return r({ clase: 'llegada', lugar });
  if (RE_SALIDA.test(n)) return r({ clase: 'salida', lugar }, 0.9);

  // Solo dio el contacto, sin verbo de hito: «me atiende Juan de recibo».
  if (contacto) return r({ clase: 'contacto', lugar }, 0.9);
  return null;
}

/** El payload de un botón de las plantillas/mensajes del agente → intención. */
export function interpretarBoton(texto: string | undefined): Interpretacion | null {
  const b = leerBotonConductor(texto);
  if (!b) return null;
  const P = PREFIJO_BOTON;
  const base = (intencion: Intencion): Interpretacion => ({ intencion, contacto: null, via: 'boton', confianza: 1, viajeId: b.viajeId });
  switch (b.prefijo) {
    case P.llegadaCarga: return base({ clase: 'llegada', lugar: 'carga' });
    case P.llegadaDescarga: return base({ clase: 'llegada', lugar: 'descarga' });
    case P.salidaCarga: return base({ clase: 'salida', lugar: 'carga' });
    case P.salidaDescarga: return base({ clase: 'salida', lugar: 'descarga' });
    case P.regreso: return base({ clase: 'regreso' });
    case P.retrasoCarga: return base({ clase: 'retraso', minutos: null });
    case P.sinContactoAnden: return base({ clase: 'sin_contacto' });
    case P.sigueCargando: return base({ clase: 'sigue', lugar: 'carga' });
    case P.sigueDescargando: return base({ clase: 'sigue', lugar: 'descarga' });
    case P.aunNoRegreso: return base({ clase: 'aun_no_regreso' });
    case P.corrigeLlegada: return base({ clase: 'correccion', como: 'llegada_descarga' });
    case P.recordatorioRegistrar: return base({ clase: 'registrar_activo' });
    case P.recordatorioProblema: return base({ clase: 'problema' });
    case P.pedirUbicacion: return base({ clase: 'pedir_ubicacion' });
    default: return null; // `jefe_atiendo` es del jefe, no del chofer
  }
}

/** ¿El texto parece hablar de un hito aunque las reglas no lo entiendan? (compuerta del respaldo LLM) */
export function pareceHablarDeHito(texto: string | undefined): boolean {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 300) return false;
  if (/[?¿]/.test(texto)) return false;
  const n = normalizar(texto);
  if (OTRO_TEMA.test(n)) return false;
  return /\b(llegu\w*|llego|llegando|anden\w*|sali\w*|salgo|salida|cargu\w*|carg\w*|descarg\w*|regres\w*|retras\w*|atras\w*|atiend\w*|recib\w*|planta|cedis|porteria|garita|patio|libre|liberar\w*|entreg\w*|formad\w*|fila|espera\w*)\b/.test(n);
}
