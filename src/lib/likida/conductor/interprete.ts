import {
  PREFIJO_BOTON, leerBotonConductor, type Contacto, type Lugar, type RespuestaSenalVida, type TipoHito,
} from './tipos';
import { leerBotonParada, type MotivoParada } from './paradas';

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
  /** Botón «Registrar ahora»: el hito que se le recordó (`hito`) o, si no lo trae, el activo. */
  | { clase: 'registrar_activo'; hito: TipoHito | null }
  | { clase: 'problema' }
  | { clase: 'pedir_ubicacion' }
  /** «Sigo cargando / descargando» (botón): sigue en el lugar, sin registrar nada nuevo. */
  | { clase: 'sigue'; lugar: Lugar }
  /** Botón «Aún no voy de regreso». */
  | { clase: 'aun_no_regreso' }
  /** P2: respuesta de botón al «¿sigues bien?» de la señal de vida (no cambia hitos). */
  | { clase: 'senal_vida'; respuesta: RespuestaSenalVida };

export interface Interpretacion {
  intencion: Intencion;
  contacto: Contacto | null;
  /** `foto` (0483): el aviso lo dio una foto con pie «andén»/«sello»/«recibido», no un texto. */
  via: 'regla' | 'boton' | 'llm' | 'foto';
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
    'diesel', 'gasolina', 'gasolinera', 'gasolineria', 'magna', 'premium', 'combustible', 'litros?', 'lts', 'pesos', 'monto', 'factura', 'ticket',
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
const RE_LLEGADA = /\b(llegue|llegamos|ya llego|llegada|ya estoy aqui|estoy aqui|estamos aqui|ya estamos|ya entre|ya entramos|ya estoy dentro|en (el |la )?(anden|andenes|porteria|garita|patio|destino|planta|cedis|puerta)|ya en destino)\b/;

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
    case P.recordatorioRegistrar: return base({ clase: 'registrar_activo', hito: b.hito });
    case P.recordatorioProblema: return base({ clase: 'problema' });
    case P.pedirUbicacion: return base({ clase: 'pedir_ubicacion' });
    case P.senalVidaEstoy: return base({ clase: 'senal_vida', respuesta: 'estoy' });
    case P.senalVidaCargar: return base({ clase: 'senal_vida', respuesta: 'voy_a_cargar' });
    case P.senalVidaBien: return base({ clase: 'senal_vida', respuesta: 'estoy_bien' });
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

// ═══════════════════════════════════════════════════════════════════════════
// LA PARADA QUE INICIA EL CHOFER (T-A5-38) — «parada», «me detuve por tráfico», «ya continúo» y sus botones.
//
// Va APARTE de `Intencion` a propósito: la parada no es un hito y `decidir` (maquina.ts, protegida) no la conoce; meterla en la
// unión obligaría a esa máquina a tratarla. Quien atiende al chofer (atender.ts; el cableado es de T-A5-39) debe preguntar por la
// parada ANTES que por el hito: «parada por tráfico» contiene «tráfico», que para `interpretarTexto` es un retraso.
//
// Mismos candados que el intérprete de hitos: nada de preguntas, palabras de OTRO tema (avería, choque, diésel…: una avería es un
// problema para el jefe, no una parada) y más de dos palabras ajenas dejan pasar el mensaje; y si el mensaje habla de un hito
// («ya llegué a la parada») NO es una parada.
// ═══════════════════════════════════════════════════════════════════════════

export type IntencionParada =
  /** `motivo` null = no lo dijo: se le muestra la lista de motivos. */
  | { clase: 'parada'; motivo: MotivoParada | null }
  | { clase: 'continuo' };

export interface InterpretacionParada {
  intencion: IntencionParada;
  via: 'regla' | 'boton';
  confianza: number;
  /** Solo botones: el viaje del payload (el llamador comprueba que sea del chofer). */
  viajeId?: string;
}

const RE_PARADA = /\b(parada|paradita|detencion|me detuve|me pare|me estoy deteniendo|me voy a detener|nos detuvimos|nos paramos|estoy detenido|estoy parado|estamos parados|estamos detenidos|voy a parar|voy a descansar|pernocto|pernocta|pernoctando|pernoctar)\b/;
const RE_CONTINUO = /\b(continuo|continue|continuamos|reanudo|reanude|reanudamos|sigo mi camino|sigo mi ruta|ya sigo|ya seguimos|ya arranque|ya voy en camino|ya voy de nuevo|ya estoy en marcha)\b/;
/** Cualquier cosa que SÍ es un hito del ciclo (no se incluye el retraso: «parada por tráfico» lo trae). */
const RE_HITO_DEL_CICLO = [
  RE_LLEGADA, RE_SALIDA, RE_SALIDA_CARGA, RE_SALIDA_DESCARGA, RE_EN_PROCESO_CARGA, RE_EN_PROCESO_DESCARGA, RE_REGRESO, RE_SIN_CONTACTO,
  ...RE_CORRECCION,
];
const RE_MOTIVO_PERNOCTA = /\b(pernocto|pernocta|pernoctando|pernoctar|dormir|dormire)\b/;
const RE_MOTIVO_TRAFICO = /\b(trafico|transito|embotellamiento|congestion|congestionado)\b/;
const RE_MOTIVO_DESCANSO = /\b(descanso|descansar|descansando|descanse)\b/;
const RE_MOTIVO_RETEN = /\b(reten|inspeccion|revision|operativo)\b/;

const VOCABULARIO_PARADA = new Set((
  'parada paradita detencion detuve pare deteniendo detener detuvimos paramos detenido parado parados detenidos parar descansar ' +
  'descanso descansando descanse pernocto pernocta pernoctando pernoctar dormir dormire trafico transito embotellamiento congestion ' +
  'congestionado reten inspeccion revision operativo motivo continuo continue continuamos reanudo reanude reanudamos sigo mi ruta ' +
  'seguimos arranque marcha camino de nuevo'
).split(' '));

function motivoDeTexto(n: string): MotivoParada | null {
  if (RE_MOTIVO_PERNOCTA.test(n)) return 'pernocta';
  if (RE_MOTIVO_RETEN.test(n)) return 'reten';
  if (RE_MOTIVO_TRAFICO.test(n)) return 'trafico';
  if (RE_MOTIVO_DESCANSO.test(n)) return 'descanso';
  return null;
}

/** El texto libre → parada/continuo, o `null` si no lo es (sigue su camino). Pura y sin I/O. */
export function interpretarParadaTexto(texto: string | undefined): InterpretacionParada | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (texto.length > MAX_LARGO_REGLAS) return null;
  if (/[?¿]/.test(texto)) return null;
  const n = normalizar(texto);
  if (!n) return null;
  if (OTRO_TEMA.test(n)) return null;
  if (RE_HITO_DEL_CICLO.some((re) => re.test(n))) return null;
  const ajenas = n.split(' ').filter((t) => !VOCABULARIO.has(t) && !VOCABULARIO_PARADA.has(t) && !/^\d+$/.test(t));
  if (ajenas.length > 2) return null;

  // «ya continúo» gana si vienen las dos («ya continúo después de la parada»). «Sigo cargando» es del ciclo: no entra aquí.
  if (RE_CONTINUO.test(n) && !/\b(carg\w*|descarg\w*)\b/.test(n)) {
    return { intencion: { clase: 'continuo' }, via: 'regla', confianza: 0.9 };
  }
  if (RE_PARADA.test(n)) {
    return { intencion: { clase: 'parada', motivo: motivoDeTexto(n) }, via: 'regla', confianza: 0.9 };
  }
  return null;
}

/** El payload de un botón de la parada → intención. El motivo del botón es el del vocabulario cerrado (no se interpreta). */
export function interpretarBotonParada(texto: string | undefined): InterpretacionParada | null {
  const b = leerBotonParada(texto);
  if (!b) return null;
  const base = (intencion: IntencionParada): InterpretacionParada => ({ intencion, via: 'boton', confianza: 1, viajeId: b.viajeId });
  switch (b.accion) {
    case 'abrir': return base({ clase: 'parada', motivo: null });
    case 'motivo': return base({ clase: 'parada', motivo: b.motivo });
    case 'continuo': return base({ clase: 'continuo' });
  }
}

/** Botón primero, texto después (el botón no pasa por reglas). */
export function interpretarParada(texto: string | undefined): InterpretacionParada | null {
  return interpretarBotonParada(texto) ?? interpretarParadaTexto(texto);
}

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-43 — LA RAMPA DE DESCARGA Y EL «¿CÓMO DESCARGAS?» (R16). Reglas puras, sin I/O.
//
// Cuatro respuestas cerradas (SÍ / NO / NO APLICA / EN ESPERA) más el número de rampa si la hay. El cliente pidió trabajar por
// excepciones (no pedir tanto detalle): el número es opcional y «no aplica» solo ofrece una pregunta OPCIONAL de cómo descarga.
// Los botones llevan su propio lector (como la parada): tipos.ts es del núcleo del ciclo. El llamador SIEMPRE comprueba que el viaje
// del botón sea del chofer.
// ═══════════════════════════════════════════════════════════════════════════

export const ESTADOS_RAMPA = ['si', 'no', 'no_aplica', 'en_espera'] as const;
export type EstadoRampa = typeof ESTADOS_RAMPA[number];

export function esEstadoRampa(valor: unknown): valor is EstadoRampa {
  return typeof valor === 'string' && (ESTADOS_RAMPA as readonly string[]).includes(valor);
}

/** Cómo se llama cada estado en la lista (≤ 24 caracteres: tope del título de una fila de lista de WhatsApp). */
export const ETIQUETA_RAMPA: Readonly<Record<EstadoRampa, string>> = {
  si: 'Sí, me dieron rampa', no: 'No', no_aplica: 'No aplica', en_espera: 'En espera',
};

export const PREFIJO_RAMPA = {
  /** Un estado de la lista: `rampa_estado_<estado>:<viaje>`. */
  estado: 'rampa_estado_',
  /** Botón «Más opciones» de la primera página (WhatsApp limita a tres botones por mensaje). */
  mas: 'rampa_mas',
  /** Botón «Omitir» de la pregunta opcional «¿cómo descargas?». */
  omitirComo: 'rampa_como_omitir',
} as const;

export type BotonRampa =
  | { accion: 'estado'; estado: EstadoRampa; viajeId: string }
  | { accion: 'mas'; viajeId: string }
  | { accion: 'omitir_como'; viajeId: string };

const UUID_RAMPA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El texto es el payload de uno de los botones de la rampa? Anclado, con el uuid validado y el estado del vocabulario. */
export function leerBotonRampa(texto: string | undefined): BotonRampa | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  if (t.length > 128) return null;
  const partes = t.split(':');
  if (partes.length !== 2) return null;
  const [prefijo, viajeId] = partes;
  if (!UUID_RAMPA.test(viajeId)) return null;
  const id = viajeId.toLowerCase();
  if (prefijo === PREFIJO_RAMPA.omitirComo) return { accion: 'omitir_como', viajeId: id };
  if (prefijo === PREFIJO_RAMPA.mas) return { accion: 'mas', viajeId: id };
  if (prefijo.startsWith(PREFIJO_RAMPA.estado)) {
    const estado = prefijo.slice(PREFIJO_RAMPA.estado.length);
    return esEstadoRampa(estado) ? { accion: 'estado', estado, viajeId: id } : null;
  }
  return null;
}

export interface RespuestaRampa {
  estado: EstadoRampa;
  /** La rampa asignada («7», «B2»); solo con `estado = 'si'`. */
  numero: string | null;
  via: 'boton' | 'regla';
}

const MAX_LARGO_RAMPA = 80;
const NUMERO_RAMPA = '([a-z]?\\d{1,3}[a-z]?)';
const RE_RAMPA_NA = /\b(no aplica|n a|na|no hay (?:rampa|rampas|anden|andenes)|sin rampa|a pie de calle|a ras de piso|a granel|en patio|en la calle)\b/;
const RE_RAMPA_ESPERA = /\b(en espera|espera|esperando|me dijeron que espere|me formaron|estoy formado|en fila|todavia no me asignan|aun no me asignan|no me han asignado)\b/;
const RE_RAMPA_NUMERO = new RegExp(`^(?:(?:ya )?(?:estoy )?(?:en|me dieron|me asignaron|me tocó|me toco|la|el)\\s+)?(?:(?:la|el)\\s+)?(?:rampa|anden|puerta|dock|muelle)?\\s*(?:numero|num|no)?\\s*${NUMERO_RAMPA}$`);

/** Lo que dijo el chofer sobre la rampa. `null` si no es una respuesta de rampa (el mensaje sigue su camino). Pura. */
export function interpretarRampaTexto(texto: string | undefined): RespuestaRampa | null {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_LARGO_RAMPA) return null;
  const n = normalizar(texto);
  if (!n) return null;
  if (RE_RAMPA_NA.test(n)) return { estado: 'no_aplica', numero: null, via: 'regla' };
  if (RE_RAMPA_ESPERA.test(n)) return { estado: 'en_espera', numero: null, via: 'regla' };
  const m = RE_RAMPA_NUMERO.exec(n);
  if (m && /\d/.test(m[1])) return { estado: 'si', numero: m[1].toUpperCase(), via: 'regla' };
  if (/^(si|sip|simon|claro|ya me dieron rampa|tengo rampa|hay rampa)$/.test(n)) return { estado: 'si', numero: null, via: 'regla' };
  if (/^(no|nel|nop|no hay)$/.test(n)) return { estado: 'no', numero: null, via: 'regla' };
  return null;
}

/** El payload de un botón de la rampa → respuesta. El estado del botón es el del vocabulario cerrado (no se interpreta). */
export function interpretarBotonRampa(texto: string | undefined): (RespuestaRampa & { viajeId: string }) | null {
  const b = leerBotonRampa(texto);
  if (!b || b.accion !== 'estado') return null;
  return { estado: b.estado, numero: null, via: 'boton', viajeId: b.viajeId };
}

/** Botón primero, texto después. */
export function interpretarRampa(texto: string | undefined): RespuestaRampa | null {
  return interpretarBotonRampa(texto) ?? interpretarRampaTexto(texto);
}

const MAX_COMO_DESCARGA = 120;

/**
 * La respuesta libre a «¿cómo descargas?» (a pie de calle, a granel…): se guarda tal cual, una sola línea, sin enlaces ni teléfonos
 * ni correos. `null` si no hay nada utilizable (la pregunta es opcional: no responder no pasa nada).
 */
export function limpiarComoDescarga(texto: string | undefined): string | null {
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t || /https?:|www\.|@|\d{7,}/i.test(t)) return null;
  return t.slice(0, MAX_COMO_DESCARGA);
}

// ═══════════════════════════════════════════════════════════════════════════
// EL RESULTADO DE LA DESCARGA (T-A5-46, R19) — «descarga completa», «no me recibieron», «regreso con la caja cargada».
//
// Va APARTE de `Intencion` (no es un hito). SOLO se consulta con la pregunta abierta (resultado_descarga.ts lo comprueba): fuera de ahí
// «no me recibieron» sigue su camino como cualquier mensaje. Mismos candados: nada de preguntas y texto corto.
// ═══════════════════════════════════════════════════════════════════════════

export type OpcionResultadoTexto = 'completa' | 'no_recibida' | 'caja_cargada';

const RE_NO_RECIBIDA = /\b(no (me )?(recibieron|recibio|aceptaron|quisieron recibir|dejaron descargar|descargaron)|rechazaron (la )?(carga|caja|mercancia)|no recibieron (la )?(carga|caja|mercancia))\b/;
const RE_CAJA_CARGADA = /\b(caja (va |viene |sigue )?(cargada|llena)|(llevo|regreso con|regreso a patio con|vengo con) (la )?(caja|carga|mercancia)( cargada| llena)?|cargada a patio|con carga a patio)\b/;
const RE_COMPLETA = /^(ya )?(se )?(descarga )?(completa|completo|todo|descargo todo|descargue todo|descargaron todo)$|\bdescarga completa\b|\b(se )?descargo (todo|completo)\b|\bdescargue todo\b/;

export function leerTextoResultadoDescarga(texto: string | undefined): OpcionResultadoTexto | null {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 120 || /[?¿]/.test(texto)) return null;
  const n = normalizar(texto);
  if (RE_NO_RECIBIDA.test(n)) return 'no_recibida';
  if (RE_CAJA_CARGADA.test(n)) return 'caja_cargada';
  if (RE_COMPLETA.test(n)) return 'completa';
  return null;
}
