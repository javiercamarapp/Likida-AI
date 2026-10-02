import { logger } from '@/lib/logger';
import { limpiarResumen, type Destino } from './escalamiento';
import { AGENTES_VIGILADOS, resumirSalud, type EntradaSalud } from './salud_agentes';

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DE SALUD DE LOS AGENTES — «si un agente falla, el orquestador NOTIFICA» sin que nadie pregunte.
//
// Antes la salud de los agentes solo se miraba cuando alguien le preguntaba al asistente (`salud_agentes`). Ahora el
// cron `escalar` barre cada flota (con claim: mig. 0652) y, por cada agente con una FALLA de verdad, abre UNA tarea
// `falla_de_agente` para la persona que le toca (mesa de control, jefe de tráfico, contador o liquidación). La tarea
// entra al tablero y a las notificaciones del panel, y —si la flota encendió el aviso (apagado por defecto)— sale el
// correo (`aviso_escalacion.ts`).
//
// REGLAS:
//  · UNA tarea abierta por (flota, agente): la llave es `barrido:<agente>`; el índice único parcial de la 0650 hace
//    que dos barridos no abran dos. Mientras la falla siga, la tarea sigue abierta (sin recordatorios en bucle).
//  · SE CIERRA SOLA cuando el agente vuelve a la normalidad (nota «se resolvió solo»), y nunca por una lectura ciega:
//    si alguna fuente no se pudo leer (`lecturaIncompleta`) la tarea se queda como está. «No sé» no es «sano».
//  · Solo FALLAS (`SaludAgente.fallas`): un entorno que nunca ha latido o una corrida «a medias» no abren tareas.
//  · El resumen es una frase fija por agente + las fallas ya recortadas; pasa por `limpiarResumen` (sin números largos,
//    correos ni ligas) como toda tarea.
// ═══════════════════════════════════════════════════════════════════════════

export const PREFIJO_BARRIDO = 'barrido:';

export const llaveBarrido = (agente: string): string => `${PREFIJO_BARRIDO}${agente}`;

export interface TareaDeSistema { destino: Destino; resumen: string; dedupe: string }

export type ResultadoAbrirTarea = 'creada' | 'ya_abierta' | 'no_disponible';

export interface DepsBarrido {
  salud(tenantId: string, ahora: Date): Promise<EntradaSalud>;
  abrirTarea(tenantId: string, t: TareaDeSistema): Promise<ResultadoAbrirTarea>;
  /** Las llaves `barrido:*` de las tareas ABIERTAS de la flota; `null` si no se pudo leer. */
  tareasAbiertas(tenantId: string): Promise<string[] | null>;
  /** Cierra la tarea abierta con esa llave. `true` si la cerró. */
  cerrarTarea(tenantId: string, dedupe: string, nota: string): Promise<boolean>;
}

export interface PlanBarrido {
  abrir: Array<TareaDeSistema & { agente: string }>;
  /** Agentes sin falla y con lectura completa: sus tareas abiertas pueden cerrarse. */
  sanos: string[];
}

/** Puro: de la salud de una flota, qué tareas corresponde abrir y qué agentes están sanos. */
export function planBarrido(entrada: EntradaSalud): PlanBarrido {
  const salud = resumirSalud(entrada);
  const destinoDe = new Map(AGENTES_VIGILADOS.map((a) => [a.id, a.destino] as const));
  const plan: PlanBarrido = { abrir: [], sanos: [] };
  for (const a of salud.agentes) {
    if (a.fallas.length > 0) {
      const resumen = limpiarResumen(`${a.etiqueta}: ${a.fallas.join('; ')}. Revísalo en ${a.ver}.`);
      plan.abrir.push({ agente: a.agente, destino: destinoDe.get(a.agente) ?? 'mesa_de_control', resumen, dedupe: llaveBarrido(a.agente) });
    } else if (!a.lecturaIncompleta) {
      plan.sanos.push(a.agente);
    }
  }
  return plan;
}

export interface ResultadoBarridoFlota { abiertas: number; yaAbiertas: number; cerradas: number; noDisponible: boolean; agentesConFalla: number }

/** Barre UNA flota. Lanza solo si no pudo LEER la salud (el llamador lo registra y el claim acorta el reintento). */
export async function barrerSaludDeFlota(tenantId: string, ahora: Date, deps: DepsBarrido): Promise<ResultadoBarridoFlota> {
  const r: ResultadoBarridoFlota = { abiertas: 0, yaAbiertas: 0, cerradas: 0, noDisponible: false, agentesConFalla: 0 };
  const plan = planBarrido(await deps.salud(tenantId, ahora));
  r.agentesConFalla = plan.abrir.length;

  for (const t of plan.abrir) {
    const res = await deps.abrirTarea(tenantId, { destino: t.destino, resumen: t.resumen, dedupe: t.dedupe });
    if (res === 'creada') r.abiertas++;
    else if (res === 'ya_abierta') r.yaAbiertas++;
    else { r.noDisponible = true; break; }   // la tabla no existe (base sin migrar): no se insiste con el resto
  }

  if (!r.noDisponible && plan.sanos.length > 0) {
    const abiertas = await deps.tareasAbiertas(tenantId);
    for (const dedupe of abiertas ?? []) {
      const agente = dedupe.slice(PREFIJO_BARRIDO.length);
      if (!dedupe.startsWith(PREFIJO_BARRIDO) || !plan.sanos.includes(agente)) continue;
      if (await deps.cerrarTarea(tenantId, dedupe, 'Se resolvió solo: el agente volvió a la normalidad en el último barrido.')) r.cerradas++;
    }
  }
  if (r.abiertas > 0 || r.cerradas > 0) logger.info('orquestador.barrido_flota', { tenantId, ...r });
  return r;
}
