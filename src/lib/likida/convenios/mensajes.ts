import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import type { PlantillaRespaldo } from '@/lib/meta/enviar_con_fallback';
import { ETIQUETA_CATEGORIA, type Categoria, type Instruccion, type LadoViaje, type Momento } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE SE LE DICE AL OPERADOR — puro, sin I/O.
//
// Tres salidas del mismo material (la foto de instrucciones del viaje):
//   1. al DESPACHAR el viaje: todas las del momento `despacho`/`ambos`, de las dos plantas.
//   2. al ACERCARSE a la planta: solo las `acercamiento`/`ambos` de ESA planta (origen o destino).
//   3. la respuesta a «¿por dónde entro?»: el perfil, por tema.
//
// Los parámetros de plantilla de Meta NO admiten saltos de línea, tabuladores ni cuatro espacios
// seguidos: la versión de plantilla va en UNA línea («Por dónde entras: … · Con quién te reportas: …»);
// el texto libre (ventana de 24 h abierta) sí lleva una línea por instrucción.
// ═══════════════════════════════════════════════════════════════════════════

export const PLANTILLA_DESPACHO = 'convenio_instrucciones_despacho_v1';
export const PLANTILLA_ACERCAMIENTO = 'convenio_instrucciones_acercamiento_v1';

/** Un parámetro de plantilla de Meta cabe en ~1,024; se deja margen para el resto del cuerpo. */
const MAX_PIEZA_PLANTILLA = 700;

const una = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** Las instrucciones que tocan en este momento. Para el acercamiento solo las de la planta a la que se acerca. */
export function seleccionar(foto: readonly Instruccion[], momento: Exclude<Momento, 'ambos'>, lado?: LadoViaje): Instruccion[] {
  return foto
    .filter((i) => i.momento === momento || i.momento === 'ambos')
    .filter((i) => momento !== 'acercamiento' || !lado || i.lugar === lado || i.lugar === 'ambos')
    .slice()
    .sort((a, b) => a.orden - b.orden);
}

/** Antepone el lado cuando la instrucción es de una sola planta y el mensaje cubre las dos (el despacho). */
function conLado(i: Instruccion, mostrarLado: boolean): string {
  if (!mostrarLado || i.lugar === 'ambos') return i.texto;
  return `${i.lugar === 'origen' ? 'Al cargar' : 'Al descargar'}: ${i.texto}`;
}

/** Una línea por instrucción, agrupadas por categoría en el orden de la foto. */
export function textoLista(ins: readonly Instruccion[], mostrarLado: boolean): string {
  const grupos = new Map<Categoria, string[]>();
  for (const i of ins) grupos.set(i.categoria, [...(grupos.get(i.categoria) ?? []), conLado(i, mostrarLado)]);
  return [...grupos.entries()].map(([c, ts]) => `• ${ETIQUETA_CATEGORIA[c]}: ${ts.join('; ')}`).join('\n');
}

/** La misma lista en UNA línea, apta para un parámetro de plantilla (sin saltos). */
export function piezaPlantilla(ins: readonly Instruccion[], mostrarLado: boolean): string {
  const grupos = new Map<Categoria, string[]>();
  for (const i of ins) grupos.set(i.categoria, [...(grupos.get(i.categoria) ?? []), una(conLado(i, mostrarLado))]);
  const linea = [...grupos.entries()].map(([c, ts]) => `${ETIQUETA_CATEGORIA[c]}: ${ts.join('; ')}`).join(' · ');
  return linea.length <= MAX_PIEZA_PLANTILLA ? linea : `${linea.slice(0, MAX_PIEZA_PLANTILLA - 1).trimEnd()}…`;
}

const primerNombre = (n: string | null | undefined): string => {
  const p = una(n ?? '').split(' ')[0];
  return p ? p.slice(0, 40) : 'chofer';
};
const lugarCorto = (t: string | null | undefined, defecto: string): string => una(t ?? '').slice(0, 60) || defecto;

export interface ContextoMensaje {
  operadorNombre: string | null;
  folio: string;
  origen: string | null;
  destino: string | null;
}

export interface MensajeInstrucciones {
  texto: string;
  plantilla: PlantillaRespaldo;
}

/** El mensaje del despacho, o `null` si el convenio no trae nada para este momento (no se manda un mensaje vacío). */
export function armarMensajeDespacho(ctx: ContextoMensaje, foto: readonly Instruccion[]): MensajeInstrucciones | null {
  const ins = seleccionar(foto, 'despacho');
  if (ins.length === 0) return null;
  const nombre = primerNombre(ctx.operadorNombre);
  const ruta = `${lugarCorto(ctx.origen, 'el origen')} → ${lugarCorto(ctx.destino, 'el destino')}`;
  const texto =
    `Hola ${nombre}, estas son las instrucciones de tu viaje ${ctx.folio} (${ruta}):\n${textoLista(ins, true)}\n` +
    'Si tienes dudas, escríbeme «¿por dónde entro?» o avisa a tu jefe de tráfico.';
  return {
    texto,
    plantilla: { nombre: PLANTILLA_DESPACHO, ...opcionesDeEnvio(PLANTILLA_DESPACHO, { cuerpo: [nombre, ctx.folio, ruta, piezaPlantilla(ins, true)] }) },
  };
}

/** El mensaje de acercamiento a la planta del `lado`, o `null` si no hay nada que recordar ahí. */
export function armarMensajeAcercamiento(ctx: ContextoMensaje, foto: readonly Instruccion[], lado: LadoViaje): MensajeInstrucciones | null {
  const ins = seleccionar(foto, 'acercamiento', lado);
  if (ins.length === 0) return null;
  const nombre = primerNombre(ctx.operadorNombre);
  const planta = lado === 'origen' ? lugarCorto(ctx.origen, 'la planta de carga') : lugarCorto(ctx.destino, 'la planta de descarga');
  const texto = `Hola ${nombre}, ya vas llegando a ${planta} (viaje ${ctx.folio}). Recuerda:\n${textoLista(ins, false)}`;
  return {
    texto,
    plantilla: { nombre: PLANTILLA_ACERCAMIENTO, ...opcionesDeEnvio(PLANTILLA_ACERCAMIENTO, { cuerpo: [nombre, planta, ctx.folio, piezaPlantilla(ins, false)] }) },
  };
}

// ── «¿POR DÓNDE ENTRO?» ─────────────────────────────────────────────────────

export type TemaPregunta = Categoria | 'todo';

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * ¿El texto es una pregunta por las instrucciones del lugar? Lista cerrada de frases del oficio, ancladas: lo que no
 * reconoce sigue su camino al agente. Devuelve el tema (o `todo`: «¿qué instrucciones tengo?»).
 */
export function temaDePregunta(texto: string): TemaPregunta | null {
  const t = sinAcentos(texto).replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '' || t.length > 140) return null;
  if (/\b(por donde (entro|entrar|ingreso|ingresar|me meto|paso|se entra|es la entrada|es el acceso)|por cual (puerta|caseta|acceso|entrada)|que puerta|cual puerta|donde entro|como entro|donde (me )?(meto|paso))\b/.test(t)) return 'puerta';
  if (/\b(con quien (me )?(reporto|presento|identifico|anuncio|hablo)|a quien (me )?(reporto|presento|busco|pregunto)|donde me (reporto|presento))\b/.test(t)) return 'reportarse';
  if (/\b(que documentos|cuales documentos|que papeles|que papeleria|que debo llevar|que llevo (para|a)|documentos (que )?(llevo|necesito|piden))\b/.test(t)) return 'documentos';
  if (/\b(que horario|a que hora (abren|cierran|recibe|reciben|carga|cargan)|horario de (carga|recibo|descarga))\b/.test(t)) return 'horario';
  if (/\b(que (instrucciones|indicaciones|reglas) (tengo|hay|debo|trae)|instrucciones (del|de la|de mi) (viaje|cliente|planta)|algo (que|a) tomar en cuenta|que debo saber (del|de la|de esta) (cliente|planta|entrega|carga))\b/.test(t)) return 'todo';
  return null;
}

export interface RespuestaPerfil {
  texto: string;
  /** `true` = no había nada registrado: la respuesta lo dice y manda con la persona (nunca inventa). */
  sinDatos: boolean;
}

/**
 * La respuesta a la pregunta del operador con lo que dice el perfil del convenio, sin añadir nada que el convenio no
 * diga. Si el viaje no tiene instrucciones (o no de ese tema), lo dice y remite al jefe de tráfico.
 * `lado` (si se sabe en qué planta está el viaje ahora) filtra las instrucciones de una sola planta.
 */
export function responderPerfil(foto: readonly Instruccion[], tema: TemaPregunta, lado: LadoViaje | null): RespuestaPerfil {
  const relevantes = foto
    .filter((i) => !lado || i.lugar === 'ambos' || i.lugar === lado)
    .filter((i) => tema === 'todo' || i.categoria === tema)
    .slice()
    .sort((a, b) => a.orden - b.orden);
  if (relevantes.length === 0) {
    const que = tema === 'todo' ? 'instrucciones' : `indicaciones de «${ETIQUETA_CATEGORIA[tema].toLowerCase()}»`;
    return {
      sinDatos: true,
      texto: `No tengo ${que} registradas para este viaje. Pregúntale a tu jefe de tráfico antes de entrar. 🙏`,
    };
  }
  return { sinDatos: false, texto: textoLista(relevantes, !lado) };
}
