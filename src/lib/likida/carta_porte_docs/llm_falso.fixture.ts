// Doble del LLM: salidas DETERMINISTAS por guion. Nunca llama a la red.
import type { EntradaLlm, LlmExtractor, NivelModelo, SalidaLlm } from './extractor';
import { RFC } from './documentos_sinteticos.fixture';

export type Item = [valor: string | null, confianza: number, evidencia?: string | null];
export type Fila = Record<string, Item>;

export const MODELO_POR_NIVEL: Record<NivelModelo, { modelo: string; tokensIn: number; tokensOut: number; costoUsd: number }> = {
  1: { modelo: 'google/gemini-3.5-flash-lite', tokensIn: 3000, tokensOut: 600, costoUsd: 0.0024 },
  2: { modelo: 'google/gemini-3.8-flash', tokensIn: 3000, tokensOut: 600, costoUsd: 0.0045 },
  3: { modelo: 'anthropic/claude-sonnet-5.5', tokensIn: 3000, tokensOut: 600, costoUsd: 0.012 },
};

const aItems = (f: Fila) => Object.entries(f).map(([clave, [valor, confianza, evidencia]]) => ({ clave, valor, confianza, evidencia: evidencia ?? null }));

export function salida(nivel: NivelModelo, campos: Fila, mercancias: Fila[] = [], notas: string | null = null): SalidaLlm {
  return { campos: aItems(campos), mercancias: mercancias.map((m) => ({ campos: aItems(m) })), notas, ...MODELO_POR_NIVEL[nivel] };
}

export interface LlmFalso extends LlmExtractor { llamadas: EntradaLlm[] }

/** `guion(entrada)` decide la salida según el nivel y el documento. Lanzar = el modelo falló. */
export function llmFalso(guion: (e: EntradaLlm) => SalidaLlm): LlmFalso {
  const llamadas: EntradaLlm[] = [];
  const f = (async (e: EntradaLlm) => { llamadas.push(e); return guion(e); }) as LlmFalso;
  f.llamadas = llamadas;
  return f;
}

/** Lo que un modelo BUENO leería del PDF de Boreal (con la evidencia literal del texto). */
export function lecturaBoreal(nivel: NivelModelo, conf = 0.97): SalidaLlm {
  return salida(nivel, {
    folio_cliente: ['BOR-77120', conf, 'Orden: BOR-77120'],
    fecha_salida: ['2026-10-16 08:30', conf, 'Fecha de salida: 2026-10-16 08:30'],
    origen_nombre: ['Grupo Boreal SA de CV', conf, 'Remitente: Grupo Boreal SA de CV'],
    origen_rfc: [RFC.boreal, conf, `RFC remitente: ${RFC.boreal}`],
    origen_cp: ['66600', conf, 'CP origen: 66600'],
    origen_estado: ['NL', conf, 'Estado origen: NL'],
    destino_nombre: ['Supermercados del Centro SA de CV', conf, 'Destinatario: Supermercados del Centro SA de CV'],
    destino_rfc: [RFC.destino2, conf, `RFC destinatario: ${RFC.destino2}`],
    destino_cp: ['06600', conf, 'CP destino: 06600'],
    destino_estado: ['CDMX', conf, 'Estado destino: CDMX'],
    operador_nombre: ['Maria Hernandez Soto', conf, 'Operador: Maria Hernandez Soto'],
    unidad_placas: ['XYZ9876', conf, 'Placas: XYZ9876'],
  }, [{
    descripcion: ['Alimentos enlatados', conf, 'Mercancia: Alimentos enlatados'],
    bienes_transp: ['50202300', conf, 'Clave producto: 50202300'],
    cantidad: ['30', conf, 'Cantidad: 30'],
    unidad_texto: ['Toneladas', conf, 'Unidad: Toneladas'],
    peso_kg: ['30', conf, 'Peso: 30 ton'],
    peso_unidad: ['ton', conf, 'Peso: 30 ton'],
  }]);
}
