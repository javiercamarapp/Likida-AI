// Fuente única de verdad de los agentes de Cuadra. A diferencia de atiende
// (~18 agentes médicos), Cuadra es mono-propósito: un agente de liquidación.

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
      'Recibe comprobantes del operador por WhatsApp, los cuadra contra el anticipo y la política, detecta diferencias y cierra la liquidación',
    tools: [
      'extraer_comprobante',
      'consultar_politica',
      'validar_cfdi',
      'cuadrar_viaje',
      'guardar_liquidacion',
    ],
    systemPromptKey: 'liquidacion',
  },
};
