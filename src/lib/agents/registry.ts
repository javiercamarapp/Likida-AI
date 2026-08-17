// Fuente única de verdad de los agentes de Likida. A diferencia de atiende
// (~18 agentes médicos), Likida es mono-propósito: un agente de liquidación.

import type { AgentConfig, AgentName } from './types';

export const AGENT_REGISTRY: Record<AgentName, AgentConfig> = {
  orchestrator: {
    name: 'orchestrator',
    role: 'router',
    description: 'Clasifica el mensaje entrante y decide si arrancar una liquidación',
    tools: [],
    systemPromptKey: 'orchestrator',
  },
  liquidacion: {
    name: 'liquidacion',
    role: 'cuadre', // Claude Sonnet — razonamiento con dinero de por medio
    description:
      'El Ayudante de Ruta: acompaña al operador por WhatsApp durante el viaje (dudas, estado, política, emergencias), cuadra sus comprobantes contra el anticipo y la política, y cierra la liquidación',
    // extraer_comprobante corre en el pipeline al llegar la foto (el LLM no
    // pasa bytes de imagen); el agente ve el gasto extraído como contexto.
    // `estado_viaje` (17-ago-2026) es lectura pura: la foto del viaje para
    // contestar dudas en ruta sin correr el cuadre completo.
    tools: ['consultar_politica', 'cuadrar_viaje', 'guardar_liquidacion', 'estado_viaje'],
    systemPromptKey: 'liquidacion',
  },
};
