import { estadoCredencial, sondearLlave, type ResultadoSonda } from '@/lib/llm/credencial';
import { gobiernoIaEncendido } from '@/lib/llm/gobierno';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTADO DE LA IA QUE /admin/consumo ENSEÑA (FUNC-DINERO, P0): ¿el proveedor tiene crédito?, ¿se están emitiendo los avisos de
// 80 % y 100 % del techo?, ¿cuántos días lleva sin registrarse una llamada? Hasta hoy el 402 (crédito agotado) solo salía por
// correo; el 15-oct al 7-nov no hubo una fila de costo y nadie lo vio desde el panel.
//
// NADA se inventa: lo que no se pudo medir llega como `sin_dato` y la pantalla lo dice. La sonda es GET /key de OpenRouter (no
// genera tokens, no cuesta); si no contesta a tiempo, o lanza, el estado es `sin_dato`, nunca «todo bien».
// ═══════════════════════════════════════════════════════════════════════════

export type ClaveEstadoCredito = 'ok' | 'sin_saldo' | 'llave_invalida' | 'sin_llave' | 'sin_permiso' | 'inalcanzable' | 'sin_dato';

export interface EstadoCreditoIa {
  clave: ClaveEstadoCredito;
  /** Saldo restante que reporta el proveedor; `null` = el proveedor no lo da (llave sin tope) o no se pudo leer. */
  restanteUsd: number | null;
}

/** Cuánto se espera a la sonda antes de declarar «sin dato». La sonda tiene su propio tope de 8 s; la página no espera tanto. */
export const ESPERA_SONDA_MS = 4_000;

/** PURA. Convierte lo que devolvió la sonda (o el circuito de esta instancia) en el estado que se pinta. */
export function estadoDeSonda(sonda: ResultadoSonda | null, circuito: { abierto: boolean; clase: 'llave_invalida' | 'sin_saldo' | 'sin_permiso' | null } | null): EstadoCreditoIa {
  if (sonda) {
    if (sonda.estado === 'ok') return { clave: 'ok', restanteUsd: sonda.restanteUsd ?? null };
    if (sonda.estado === 'inalcanzable') return { clave: 'inalcanzable', restanteUsd: null };
    return { clave: sonda.estado, restanteUsd: sonda.restanteUsd ?? null };
  }
  // Sin sonda: solo el circuito de ESTA instancia. Abierto es una mala noticia cierta; cerrado NO prueba que haya crédito.
  if (circuito?.abierto && circuito.clase) return { clave: circuito.clase, restanteUsd: null };
  return { clave: 'sin_dato', restanteUsd: null };
}

/** NUNCA lanza. */
export async function leerEstadoCreditoIa(
  deps: { sondear?: () => Promise<ResultadoSonda>; circuito?: () => ReturnType<typeof estadoCredencial>; esperaMs?: number } = {},
): Promise<EstadoCreditoIa> {
  const sondear = deps.sondear ?? (() => sondearLlave());
  const leerCircuito = deps.circuito ?? (() => estadoCredencial());
  let circuito: { abierto: boolean; clase: 'llave_invalida' | 'sin_saldo' | 'sin_permiso' | null } | null = null;
  try { const c = leerCircuito(); circuito = { abierto: c.abierto, clase: c.clase }; } catch { circuito = null; }
  let sonda: ResultadoSonda | null = null;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    sonda = await Promise.race([
      sondear(),
      new Promise<null>((resolver) => { temporizador = setTimeout(() => resolver(null), deps.esperaMs ?? ESPERA_SONDA_MS); }),
    ]);
  } catch { sonda = null; } finally { if (temporizador) clearTimeout(temporizador); }
  return estadoDeSonda(sonda, circuito);
}

/** ¿Se emiten los avisos de 80 % y 100 %? Depende de `IA_GOBIERNO=encendido` (decisión del dueño, hoy una variable de entorno). */
export function avisosDeTopeEncendidos(env: NodeJS.ProcessEnv = process.env): boolean {
  return gobiernoIaEncendido(env);
}

/**
 * PURA. Días de calendario entre el último día CON gasto de la serie y `hoy` (ambos AAAA-MM-DD, día de México). `null` = la serie
 * no trae ni un día con gasto (no se sabe si nunca hubo o si la ventana no alcanza): se dice «sin dato», no «0 días».
 */
export function diasSinRegistroIa(porDia: ReadonlyArray<{ dia: string; costoUsd: number }>, hoy: string): number | null {
  let ultimo: string | null = null;
  for (const d of porDia) if (d.costoUsd > 0 && (ultimo === null || d.dia > ultimo)) ultimo = d.dia;
  if (ultimo === null) return null;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${ultimo}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

/** Desde cuántos días sin registro se avisa en pantalla (un fin de semana sin tráfico no es una alerta). */
export const DIAS_SIN_REGISTRO_AVISO = 3;
