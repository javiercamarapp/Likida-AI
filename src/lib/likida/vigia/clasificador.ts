// ═══════════════════════════════════════════════════════════════════════════
// EL CLASIFICADOR DE INTENCIÓN: reglas primero, modelo barato después.
//
//   1. limpiar el texto y buscar señales de manipulación;
//   2. REGLAS (intencion.ts): si reconocen el mensaje, listo — sin modelo;
//   3. si no, y SOLO si el texto no trae señal de inyección, el modelo del rol
//      `vigia_cliente` con salida estructurada. Su respuesta es un enum que
//      aquí se vuelve a validar:
//        · una intención fuera del dominio, o `baja` (solo por regla), → `otro`;
//        · confianza menor a 0.6 → `otro` (ante la duda, un humano);
//        · una caída del modelo o del presupuesto → `otro` con clasificador
//          `ninguno`. Nunca se adivina.
//
// El modelo NO recibe nada que no sea el mensaje (ni datos del viaje, ni del
// tenant) y NO emite texto libre: no hay forma de que una instrucción metida en
// el mensaje lo haga decir o hacer algo distinto de elegir una etiqueta.
// ═══════════════════════════════════════════════════════════════════════════
import { limpiarTexto, detectarInyeccion } from './entrada';
import { clasificarPorReglas } from './intencion';
import type { Clasificacion, Intencion } from './tipos';

/** Lo que el modelo puede elegir. `baja` NO está: solo la regla determinista da de baja. */
export const INTENCIONES_MODELO = [
  'ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'saludo', 'otro',
] as const;

export const CONFIANZA_MINIMA_MODELO = 0.6;

export interface PuertoModelo {
  /** Devuelve la etiqueta cruda del modelo, o `null` si no contestó. Puede lanzar. */
  clasificar(texto: string): Promise<{ intencion: unknown; confianza: unknown } | null>;
}

export interface ResultadoClasificacion extends Clasificacion {
  /** El texto ya limpio (el que se guarda y se usa en adelante). */
  textoLimpio: string;
}

export async function clasificar(textoCrudo: unknown, modelo?: PuertoModelo | null): Promise<ResultadoClasificacion> {
  const textoLimpio = limpiarTexto(textoCrudo);
  const senales: string[] = [];
  if (detectarInyeccion(textoLimpio)) senales.push('inyeccion');

  const porReglas = clasificarPorReglas(textoLimpio);
  if (porReglas) return { ...porReglas, senales: [...senales], textoLimpio };

  const otro = (clasificador: 'modelo' | 'ninguno', extra: string[] = []): ResultadoClasificacion => ({
    intencion: 'otro', secundarias: [], confianza: 0, clasificador, senales: [...senales, ...extra], textoLimpio,
  });

  // Texto vacío, o con intento de manipulación: el modelo ni lo ve.
  if (!textoLimpio) return otro('ninguno', ['vacio']);
  if (senales.includes('inyeccion')) return otro('ninguno');
  if (!modelo) return otro('ninguno');

  let crudo: { intencion: unknown; confianza: unknown } | null;
  try {
    crudo = await modelo.clasificar(textoLimpio);
  } catch {
    return otro('ninguno', ['modelo_caido']);
  }
  if (!crudo) return otro('ninguno', ['modelo_sin_respuesta']);

  const etiqueta = typeof crudo.intencion === 'string' ? crudo.intencion : '';
  const confianza = typeof crudo.confianza === 'number' && Number.isFinite(crudo.confianza)
    ? Math.min(1, Math.max(0, crudo.confianza)) : 0;
  if (!(INTENCIONES_MODELO as readonly string[]).includes(etiqueta)) {
    return { ...otro('modelo', ['modelo_etiqueta_invalida']), confianza };
  }
  if (confianza < CONFIANZA_MINIMA_MODELO) return { ...otro('modelo', ['modelo_baja_confianza']), confianza };
  return {
    intencion: etiqueta as Intencion, secundarias: [], confianza, clasificador: 'modelo', senales, textoLimpio,
  };
}
