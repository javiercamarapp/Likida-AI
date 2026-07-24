import type { ModelRole } from '@/lib/llm/models';

export type AgentName = 'orchestrator' | 'liquidacion';

export interface AgentConfig {
  name: AgentName;
  /** Rol de modelo (ver llm/models.ts) — el ruteo elige el slug concreto. */
  role: ModelRole;
  description: string;
  /** Nombres de tools registradas (llm/tool-executor.ts). */
  tools: string[];
  systemPromptKey: string;
}

/** Contexto del tenant (flota) inyectado al prompt del agente. */
export interface TenantContext {
  tenantId: string;
  nombreFlota: string;
  /** Nombre con el que se presenta el agente por WhatsApp (ej. "Cuadra"). */
  agentName: string;
  timezone: string;
}
