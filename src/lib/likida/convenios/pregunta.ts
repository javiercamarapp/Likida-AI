import { logger } from '@/lib/logger';
import { ConveniosNoDisponibles, ladoDelViaje, leerLigado, ligarConvenioAViaje, viajeAbiertoDelOperador, type ResultadoLigar, type ViajeLigado } from './repo';
import { responderPerfil, temaDePregunta } from './mensajes';
import type { LadoViaje } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// «¿POR DÓNDE ENTRO?» — el operador le pregunta al agente y el agente le responde con el PERFIL del convenio.
//
// Determinista y sin modelo: reconoce una lista cerrada de frases del oficio (`temaDePregunta`); todo lo demás sigue su
// camino al agente. La respuesta sale SOLO de lo que el convenio dice (foto de instrucciones del viaje): si no hay
// nada, lo dice y lo manda con el jefe de tráfico — nunca inventa una puerta.
//
//   · La pregunta es del operador y del VIAJE ABIERTO que trae; un viaje ajeno no responde.
//   · Un viaje anterior al convenio se liga en el momento (la foto se toma entonces).
//   · La planta que se atiende se deduce de los hitos (antes de salir de la carga, la de origen); si no se sabe, se
//     muestran las dos con su lado.
//   · NUNCA LANZA: sin tablas (base sin migrar) o con un fallo, devuelve `null` y el agente sigue como siempre.
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaPregunta {
  tenantId: string;
  operadorId: string;
  /** El viaje abierto del operador (el de siempre del processor). */
  viajeAbiertoId: string | null;
  texto: string;
}

export interface PuertosPregunta {
  viajeEsDelOperador(tenantId: string, operadorId: string, viajeId: string): Promise<boolean>;
  ligado(tenantId: string, viajeId: string): Promise<ViajeLigado | null>;
  ligar(tenantId: string, viajeId: string): Promise<ResultadoLigar>;
  lado(tenantId: string, viajeId: string): Promise<LadoViaje | null>;
}

export const puertosPreguntaReales: PuertosPregunta = {
  viajeEsDelOperador: viajeAbiertoDelOperador,
  ligado: leerLigado,
  ligar: (t, v) => ligarConvenioAViaje(t, v),
  lado: ladoDelViaje,
};

/** La respuesta para el operador, o `null` si no es una pregunta de este módulo. */
export async function atenderPreguntaConvenio(e: EntradaPregunta, p: PuertosPregunta = puertosPreguntaReales): Promise<string | null> {
  const tema = temaDePregunta(e.texto);
  if (!tema || !e.viajeAbiertoId) return null;
  try {
    if (!(await p.viajeEsDelOperador(e.tenantId, e.operadorId, e.viajeAbiertoId))) return null;
    let ligado = await p.ligado(e.tenantId, e.viajeAbiertoId);
    if (!ligado) {
      const r = await p.ligar(e.tenantId, e.viajeAbiertoId);
      ligado = r.estado === 'ligado' || r.estado === 'ya_ligado' ? r.ligado : null;
    }
    const lado = await p.lado(e.tenantId, e.viajeAbiertoId).catch(() => null);
    const r = responderPerfil(ligado?.instrucciones ?? [], tema, lado);
    logger.info('convenios.pregunta', { viaje: e.viajeAbiertoId, tema, conDatos: !r.sinDatos });
    return r.texto;
  } catch (err) {
    if (!(err instanceof ConveniosNoDisponibles)) logger.error('convenios.pregunta_fallo', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
