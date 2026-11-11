import { z } from 'zod';
import { redactarTexto } from './casos-regresion';
import type { ItemClasificado } from './guardia';
import { claveDeItem, huellaDeClave } from './guardia';

// ═══════════════════════════════════════════════════════════════════════════
// AGENTE DE DIAGNÓSTICO DE SOLO LECTURA (F14-C, PLAN-MAESTRO §10.4).
//
// Cuando se abre una alerta S1/S2, lee evidencia (latidos, errores de ejecución, bitácora, quema) y escribe un diagnóstico con
// causa probable, evidencia citada y arreglo PROPUESTO. Aparece en Aprobaciones/Tu turno para que el dueño lo apruebe o descarte.
//
// REGLAS (en código, no en el prompt):
//   · SOLO LECTURA: este módulo no importa ningún cliente de base ni de red; todo lo que toca el mundo entra por `Puertos`
//     (ver `diagnostico-puertos.ts`). Su única salida es UNA pieza propuesta; nunca ejecuta ni cambia nada.
//   · Nunca toca dinero, datos personales, fiscal ni su propia autonomía: la evidencia se redacta antes de salir al modelo y
//     un arreglo que roce esas clases lleva la marca «lo decide el dueño».
//   · TOPE DE GASTO: US$20 al mes por omisión (`DIAGNOSTICO_TOPE_USD`), medido con `agente_corrida.costo_usd`. Si el gasto no se
//     puede leer, FALLA CERRADO (no llama). Al llegar al tope deja de llamar al modelo y avisa en la campana.
//   · "Inconclusivo" es una respuesta válida; sin cita no hay causa raíz.
//   · APAGADO por omisión: `DIAGNOSTICO_ALERTAS=encendido`.
// ═══════════════════════════════════════════════════════════════════════════

export const TOPE_POR_OMISION_USD = 20;
/** Cota superior de una llamada (entrada acotada y 900 tokens de salida): se reserva antes de llamar. */
export const COSTO_MAX_LLAMADA_USD = 0.25;
export const MAX_DIAGNOSTICOS_POR_PASADA = 2;
export const AGENTE_DIAGNOSTICO = 'especialistas_incidente';
export const TIPO_PIEZA_DIAGNOSTICO = 'diagnostico_alerta';
export const ORIGEN_CORRIDA = 'diagnostico_f14';

export const diagnosticoEncendido = (env: NodeJS.ProcessEnv = process.env): boolean => env.DIAGNOSTICO_ALERTAS === 'encendido';

/** Tope mensual en USD. Sin variable: 20. Variable puesta pero ilegible o ≤ 0: 0 (falla cerrado, nunca "sin tope"). */
export function topeMensualUsd(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.DIAGNOSTICO_TOPE_USD;
  if (v === undefined || v.trim() === '') return TOPE_POR_OMISION_USD;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const EsquemaDiagnostico = z.object({
  causa_probable: z.string().max(600),
  confianza: z.enum(['alta', 'media', 'baja', 'inconclusivo']),
  evidencia: z.array(z.object({ fuente: z.string().max(60), cita: z.string().max(300) })).max(8),
  arreglo_propuesto: z.string().max(800),
});
export type SalidaDiagnostico = z.infer<typeof EsquemaDiagnostico>;

export interface EvidenciaDiagnostico { fuente: string; texto: string }

export interface Puertos {
  /** Gasto del mes en USD, o `null` si no se pudo medir (cualquier fila sin costo o error de lectura). */
  gastoMesUsd(): Promise<number | null>;
  leerEvidencia(item: ItemClasificado): Promise<EvidenciaDiagnostico[]>;
  llamarModelo(p: { system: string; usuario: string }): Promise<{ data: SalidaDiagnostico; costoUsd: number; modelo: string }>;
  /** La única escritura de contenido: una pieza propuesta en la bandeja de aprobación. */
  proponer(p: { huella: string; prioridad: 'normal' | 'urgente'; titulo: string; cuerpo: string }): Promise<void>;
  /** Anota el gasto (medido, o cota superior si la llamada falló). */
  registrarGasto(p: { costoUsd: number; ok: boolean; huella: string }): Promise<void>;
}

export type EstadoDiagnostico = 'apagado' | 'ok' | 'tope' | 'gasto_ilegible' | 'sin_alertas';

export interface ResultadoDiagnostico {
  estado: EstadoDiagnostico;
  diagnosticados: string[];
  gastoMesUsd: number | null;
  topeUsd: number;
  /** Para el latido de la guardia (la campana lo lee). */
  detalle: { estado: EstadoDiagnostico; gastoMesUsd: number | null; topeUsd: number };
}

const SYSTEM = [
  'Eres un diagnosticador de SOLO LECTURA de la plataforma Likida. Recibes una alerta y la evidencia que la rodea.',
  'Responde SOLO con el JSON pedido. Reglas: (1) cada afirmación de causa debe apoyarse en una cita literal de la evidencia;',
  '(2) si la evidencia no basta, confianza = "inconclusivo" y dilo; (3) propones un arreglo, NUNCA lo ejecutas;',
  '(4) no propongas tocar dinero, cobros, datos personales, fiscal, la autonomía de un agente, umbrales, despliegues ni migraciones:',
  'si el arreglo pasa por ahí, di que lo decide el dueño. (5) No hay datos personales en la evidencia: no los inventes.',
].join(' ');

const PROHIBIDO = /\b(cobr\w*|reembols\w*|pago\w*|saldo\w*|precio\w*|cfdi|timbr\w*|carta porte|arco|chofer\w*|autonom\w*|umbral\w*|despleg\w*|merge|migraci\w*|stripe|rfc)\b/i;

/** PURA. Valida la salida del modelo: sin cita no hay causa raíz. */
export function endurecerSalida(s: SalidaDiagnostico): SalidaDiagnostico {
  if (s.confianza !== 'inconclusivo' && s.evidencia.length === 0) {
    return { ...s, confianza: 'inconclusivo', causa_probable: `Inconclusivo: el modelo no citó evidencia. (${s.causa_probable.slice(0, 200)})` };
  }
  return s;
}

/** PURA. El cuerpo de la pieza que ve el dueño. Todo pasa por la redacción de datos personales. */
export function cuerpoDePieza(item: ItemClasificado, s: SalidaDiagnostico, modelo: string): string {
  const roza = PROHIBIDO.test(s.arreglo_propuesto);
  const l = [
    `Alerta ${item.severidad}: ${item.titulo}`,
    `Regla: ${item.regla}`,
    '',
    `Causa probable (${s.confianza}): ${s.causa_probable}`,
    '',
    'Evidencia citada:',
    ...(s.evidencia.length > 0 ? s.evidencia.map((e) => `- [${e.fuente}] ${e.cita}`) : ['- (ninguna)']),
    '',
    `Arreglo PROPUESTO (no se ejecuta): ${s.arreglo_propuesto}`,
    ...(roza ? ['', 'ATENCIÓN: el arreglo toca una clase que nunca se automatiza (dinero, datos personales, fiscal, autonomía o producción). Lo decide el dueño.'] : []),
    '',
    `Generado por ${modelo} en solo lectura. Aprobar = lo acepto como diagnóstico; rechazar = lo descarto. Ninguna de las dos ejecuta nada.`,
  ].join('\n');
  return redactarTexto(l).texto;
}

/**
 * Diagnostica las alertas S1/S2 NUEVAS, con tope de gasto. No lanza: cualquier fallo de un puerto se traduce en un estado.
 * `yaDiagnosticadas` son huellas de alertas ya atendidas (no se paga dos veces por la misma).
 */
export async function diagnosticarAlertas(
  nuevos: readonly ItemClasificado[], yaDiagnosticadas: readonly string[], p: Puertos,
  opts: { encendido?: boolean; topeUsd?: number } = {},
): Promise<ResultadoDiagnostico> {
  const topeUsd = opts.topeUsd ?? topeMensualUsd();
  const cierra = (estado: EstadoDiagnostico, gasto: number | null, hechos: string[] = []): ResultadoDiagnostico =>
    ({ estado, diagnosticados: hechos, gastoMesUsd: gasto, topeUsd, detalle: { estado, gastoMesUsd: gasto, topeUsd } });

  if (!(opts.encendido ?? diagnosticoEncendido())) return cierra('apagado', null);
  const urgentes = nuevos.filter((i) => (i.severidad === 'S1' || i.severidad === 'S2'))
    .map((i) => ({ i, huella: huellaDeClave(claveDeItem(i)) }))
    .filter((x) => !yaDiagnosticadas.includes(x.huella));
  if (urgentes.length === 0) return cierra('sin_alertas', null);

  let gasto: number | null;
  try { gasto = await p.gastoMesUsd(); } catch { gasto = null; }
  if (gasto === null || !Number.isFinite(gasto)) return cierra('gasto_ilegible', null);
  if (gasto >= topeUsd) return cierra('tope', gasto);

  const hechos: string[] = [];
  for (const { i, huella } of urgentes.slice(0, MAX_DIAGNOSTICOS_POR_PASADA)) {
    // Se reserva la cota de UNA llamada antes de hacerla: el tope no se cruza por una llamada que arranca justo debajo de él.
    if (gasto + COSTO_MAX_LLAMADA_USD > topeUsd) return cierra(hechos.length > 0 ? 'ok' : 'tope', gasto, hechos);
    let costo = COSTO_MAX_LLAMADA_USD;
    let anotado = false;
    try {
      const evidencia = await p.leerEvidencia(i);
      const usuario = redactarTexto([
        `ALERTA ${i.severidad}: ${i.titulo}`, `Regla: ${i.regla}`, `Fuente: ${i.fuente}`, '',
        ...evidencia.map((e) => `[${e.fuente}] ${e.texto}`),
      ].join('\n')).texto.slice(0, 8_000);
      const r = await p.llamarModelo({ system: SYSTEM, usuario });
      costo = Number.isFinite(r.costoUsd) && r.costoUsd >= 0 ? r.costoUsd : COSTO_MAX_LLAMADA_USD;
      const salida = endurecerSalida(EsquemaDiagnostico.parse(r.data));
      await p.registrarGasto({ costoUsd: costo, ok: true, huella });
      anotado = true;
      gasto += costo;
      await p.proponer({
        huella, prioridad: i.severidad === 'S1' ? 'urgente' : 'normal',
        titulo: redactarTexto(`Diagnóstico propuesto: ${i.titulo}`).texto.slice(0, 190),
        cuerpo: cuerpoDePieza(i, salida, r.modelo),
      });
      hechos.push(huella);
    } catch {
      // Una llamada fallida pudo cobrarse: se anota la cota (jamás un 0 que se lea como gratis) y se sigue con la siguiente pasada.
      if (!anotado) {
        try { await p.registrarGasto({ costoUsd: costo, ok: false, huella }); } catch { /* el gasto no se pudo anotar: la próxima lectura lo dirá */ }
        gasto += costo;
      }
    }
  }
  return cierra('ok', gasto, hechos);
}
