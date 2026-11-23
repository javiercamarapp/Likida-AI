// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTA «VACÍA» DEL EQUIPO — «enterado», «reviso», «en un momento»: acusa recibo pero NO contesta lo que se pidió.
//
// Medido sobre 5 grupos reales: entre 8 % y 12 % de los mensajes del equipo son acuses así; y entre 1.6 % y 3 % de las peticiones
// del cliente (más en los grupos con respuesta lenta) se «cierran» con un acuse y el dato llega más de una hora después o nunca. Hoy
// cualquier mensaje del equipo cierra el pendiente (`segmentarHilos`); este módulo permite, SOLO si la flota lo enciende
// (`acusesVaciosNoCierran`), no contarlo como atención. Determinista: una lista cerrada de palabras, sin modelo.
//
// Conservador a propósito: si el mensaje trae un número, una hora, una liga o más de 8 palabras NO es vacío (puede ser el dato).
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from './entrada';

const PALABRAS_VACIAS: ReadonlySet<string> = new Set([
  'enterado', 'enterada', 'enterados', 'reviso', 'revisando', 'revisamos', 'checo', 'checamos', 'vemos', 'valido', 'validamos', 'verifico', 'verificamos',
  'ok', 'okey', 'okay', 'va', 'vale', 'listo', 'lista', 'claro', 'sale', 'gracias', 'recibido', 'entendido',
  'de', 'acuerdo', 'ahorita', 'ahora', 'mismo', 'en', 'un', 'momento', 'momentito', 'tantito', 'poco', 'seguida', 'enseguida', 'al',
  'permiteme', 'permitame', 'dejame', 'dejenme', 'checar', 'revisar', 'verificar', 'ello', 'proceso', 'ya', 'te', 'les', 'le', 'lo', 'nos', 'la',
  'confirmo', 'confirmamos', 'aviso', 'avisamos', 'informo', 'informamos', 'pendiente', 'pendientes', 'estamos', 'estoy', 'quedo', 'quedamos',
  'buen', 'buenos', 'buenas', 'dia', 'dias', 'tardes', 'noches', 'con', 'gusto', 'que', 'si', 'por', 'supuesto', 'favor', 'porfa',
  'team', 'equipo', 'chicos', 'chicas', 'amigo', 'estimado', 'y',
]);

/** ¿El mensaje del equipo solo acusa recibo (sin dar el dato)? Vacío o ilegible cuenta como vacío. */
export function esRespuestaVacia(texto: string): boolean {
  const n = normalizar(texto ?? '');
  if (!n) return true;
  if (n.length > 60 || /\d/.test(n) || /https?:|www\./i.test(texto)) return false;
  const palabras = n.split(' ');
  return palabras.length <= 8 && palabras.every((p) => PALABRAS_VACIAS.has(p));
}
