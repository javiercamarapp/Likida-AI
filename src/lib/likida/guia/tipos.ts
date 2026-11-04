// Contrato de la guía de onboarding (SPEC-ONBOARDING-GUIA 2.2 a 2.4). Datos puros: sin React, sin DOM, sin base.
// Es lo primero que se congela: el motor, el estado en servidor, las señales y los eventos se apoyan en estos tipos.

export type PistaGuia = 'dueno_ca' | 'dueno' | 'contador' | 'encargado' | 'nomina' | 'vendedor' | 'superadmin' | 'operador' | 'supervisor_patio';
export const PISTAS_GUIA: readonly PistaGuia[] = ['dueno_ca', 'dueno', 'contador', 'encargado', 'nomina', 'vendedor', 'superadmin', 'operador', 'supervisor_patio'];

/** Las pistas que se renderizan en el panel. `operador` y `supervisor_patio` son el catálogo del canal de WhatsApp (tipo `mensaje`). */
export const PISTAS_DE_PANEL: readonly PistaGuia[] = PISTAS_GUIA.filter((p) => p !== 'operador' && p !== 'supervisor_patio');

export type TipoPasoGuia = 'ir' | 'orientar' | 'hacer' | 'practicar' | 'cierre' | 'mensaje';

/** Señales que el servidor sabe medir. Una señal nueva se registra en `senales.ts`; no hay señales sueltas en los pasos. */
export const IDS_SENAL = [
  'coordinadores', 'archivos_recibidos', 'tms_probada', 'correo_desglose_activo', 'correo_plataforma', 'operadores_con_correo',
  'unidades_activas', 'supervisores', 'revisor_cp', 'simulacro_muestra', 'desglose_entregado_real', 'peajes_archivo',
  'documento_aprobado', 'declaracion_cp', 'sitios', 'programa_vigia', 'llave_emitida', 'mfa_activo', 'legal_aceptado',
  'viaje_con_aviso', 'operador_alta_nuevo', 'prospecto_cambio_estado',
] as const;
export type IdSenal = (typeof IDS_SENAL)[number];

export type ResultadoSenal = { estado: 'si' | 'no' | 'sin_dato'; n?: number };

export type Deteccion =
  | { via: 'dom'; evento: 'click' | 'input' | 'change' | 'submit'; ancla: string }
  | { via: 'senal'; senal: IdSenal; modo: 'cambia' | 'existe' }
  /** Solo como complemento de algo que no se puede medir. Se rotula «confirmado por ti» y nunca cuenta como medido. */
  | { via: 'declarada'; clave: string }
  | { via: 'ninguna' };

/** Estados de un paso (SPEC 2.3). `hecho` lleva su evidencia. */
export type EstadoPasoGuia = 'pendiente' | 'activo' | 'esperando' | 'hecho' | 'ya_hecho' | 'omitido' | 'sin_dato' | 'en_espera' | 'bloqueado';
export type EvidenciaPaso = 'medido' | 'confirmado';

export interface VisualRef { tipo: 'ilu' | 'demo' | 'gesto' | 'escena' | 'ninguno'; id: string }

export interface PasoGuia {
  /** Inmutable y único: 'PM2-03'. No se reutiliza ni se renumera. */
  id: string;
  /** Sube si cambia el sentido del paso (invalida los completados guardados). */
  version: number;
  pista: PistaGuia;
  pantalla: string;
  ancla: string | null;
  tipo: TipoPasoGuia;
  titulo: string;
  texto: string;
  ayuda?: string;
  visual: VisualRef;
  deteccion: Deteccion;
  /** «Aprieta aquí → objetivo»: obligatorio en `hacer` y `practicar` (pide UNA acción, dicha exactamente). */
  accion?: { verbo: string; objetivo: string };
  perfil?: 'cinco_agentes' | 'sin_perfil';
  /** `hacer`: pasa a `sin_dato` tras este tiempo sin acción. Defecto 90 000 ms. */
  tiempoLimiteMs?: number;
  /** Texto aprobado por Javier. `false` = no se publica. */
  aprobado: boolean;
  tarea?: string;
}

export const MAX_TITULO_GUIA = 48;
export const MAX_TEXTO_GUIA = 180;
export const MAX_AYUDA_GUIA = 400;

// ── Estado guardado (v1) ────────────────────────────────────────────────────

export type InvitacionGuia = 'pendiente' | 'vista' | 'ahora_no' | 'descartada';
export interface RecorridoGuardado {
  paso: string;
  hechos: string[];
  omitidos: string[];
  confirmados: string[];
  inicio: string;
  fin: string | null;
  version: number;
}
export interface EstadoGuia {
  v: 1;
  invitacion: InvitacionGuia;
  ofertas: number;
  modo: 'corto' | 'completo' | null;
  recorridos: Record<string, RecorridoGuardado>;
  tareas: Record<string, string>;
  pistas: string[];
  declaraciones: Record<string, { valor: boolean; en: string }>;
  prefs: { reducirMovimiento: boolean | null };
  celebrados: string[];
  importado?: boolean;
}

/** Lo que se puede cambiar de una vez: cada llave presente REEMPLAZA a la del estado, salvo `recorridos`, `tareas` y `declaraciones`, que se fusionan por clave. */
export type ParcheEstadoGuia = Partial<Omit<EstadoGuia, 'v'>>;

// ── Eventos de aprendizaje (SPEC 2.8): lista cerrada, sin PII, sin texto libre ──

export const TIPOS_EVENTO_GUIA = [
  'invitacion_vista', 'invitacion_ahora_no', 'invitacion_descartada', 'guia_inicio', 'paso_visto', 'paso_hecho_senal',
  'paso_hecho_confirmado', 'paso_ya_hecho', 'paso_omitido', 'paso_sin_dato', 'guia_abandono', 'guia_terminada', 'tarea_lograda',
  'repeticion', 'retomar', 'ayuda_abierta', 'demo_vista', 'demo_pausa', 'simulacro_enviado',
] as const;
export type TipoEventoGuia = (typeof TIPOS_EVENTO_GUIA)[number];

/** Lo que manda el navegador. El servidor completa tenant, actor, rol y pista; el navegador no los decide. */
export interface EventoGuiaEntrante {
  tipo: TipoEventoGuia;
  recorrido?: string;
  pasoId?: string;
  valorMs?: number;
  valorN?: number;
  canal: 'movil' | 'escritorio';
  reducido?: boolean;
}
