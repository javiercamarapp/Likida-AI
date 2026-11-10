import { supabaseAdmin } from '@/lib/supabase/admin';
import { ahoraMs } from '@/lib/saludo';

// ═══════════════════════════════════════════════════════════════════════════
// PRESUPUESTO DE ERROR Y ALERTA POR QUEMA (F14-A, PLAN-MAESTRO §10.2).
//
// Sobre los cinco SLO que la guardia ya mide (`slo.ts`): para cada uno que sea
// cuantificable como «eventos buenos / eventos totales», el presupuesto es
// 100 % menos el objetivo sobre 30 días, y la QUEMA es qué tan rápido se
// consume (quema 1 = se agota justo al cierre de la ventana de 30 días).
//
// Alerta en DOS ventanas (tabla de referencia de Google SRE): una ventana larga
// dice que el problema es real, una corta dice que sigue ocurriendo ahora. Las
// dos tienen que superar el umbral.
//
// TODOS LOS UMBRALES Y OBJETIVOS SON INICIALES: «a calibrar con datos
// reales». Hoy hay 4 flotas y 24 viajes; casi todo nace «sin medir».
//
// REGLA DE LA CASA: sin denominador suficiente el estado es `sin_medir`. Jamás
// se pinta 0 de quema ni un verde de cortesía — cero ≠ ciego.
//
// Este módulo es PURA + un lector. No agrega cron ni toca vercel.json: la
// guardia que ya corre cada 5 minutos podrá llamar a `evaluarSlosEnQuema`.
// ═══════════════════════════════════════════════════════════════════════════

/** Denominador mínimo POR VENTANA (el mismo 5 de `slo.ts`). */
export const MUESTRA_MINIMA_QUEMA = 5;

export const NOTA_CALIBRACION = 'umbrales iniciales — a calibrar con datos reales';

export type VentanaClave = '5m' | '30m' | '1h' | '6h' | '3d' | '30d';

export const VENTANA_MS: Readonly<Record<VentanaClave, number>> = {
  '5m': 5 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '3d': 3 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export type Severidad = 'pagina' | 'ticket';

export interface ReglaQuema {
  id: string;
  severidad: Severidad;
  /** Múltiplo del consumo «normal» del presupuesto que dispara la regla. */
  umbral: number;
  larga: VentanaClave;
  corta: VentanaClave;
}

/** 14.4 (1 h / 5 min) y 6 (6 h / 30 min) para página; 1 (3 d / 6 h) para
 *  ticket. Orden: de la más grave a la menos grave. */
export const REGLAS_QUEMA: readonly ReglaQuema[] = [
  { id: 'pagina_rapida', severidad: 'pagina', umbral: 14.4, larga: '1h', corta: '5m' },
  { id: 'pagina_lenta', severidad: 'pagina', umbral: 6, larga: '6h', corta: '30m' },
  { id: 'ticket_lento', severidad: 'ticket', umbral: 1, larga: '3d', corta: '6h' },
];

export interface DefinicionSloQuema {
  /** Misma clave que `Slo.clave` de `slo.ts`. */
  clave: string;
  nombre: string;
  /** Fracción de eventos buenos esperada, en (0, 1). Inicial. */
  objetivo: number;
  /** De dónde saldrían los eventos buenos/totales. */
  fuente: 'agente_corrida' | 'agente_corrida_duracion' | 'evaluaciones_guardia';
  /** Por qué este SLO no tiene lector vivo todavía (si no lo tiene). */
  sinLectorPorque?: string;
}

/** Los cinco SLO que la guardia ya mide. */
export const SLOS_CON_PRESUPUESTO: readonly DefinicionSloQuema[] = [
  { clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: 0.95, fuente: 'agente_corrida' },
  {
    clave: 'agentes_p95', nombre: 'p95 de duración de corrida', objetivo: 0.95, fuente: 'agente_corrida_duracion',
    sinLectorPorque: 'la base entrega el p95 pero no cuántas corridas duraron más de 120 s por ventana',
  },
  {
    clave: 'wa_inbox', nombre: 'Mensajes de WhatsApp atorados', objetivo: 0.99, fuente: 'evaluaciones_guardia',
    sinLectorPorque: 'es una lectura puntual; la guardia no guarda historial de evaluaciones',
  },
  {
    clave: 'stripe_sellado', nombre: 'Eventos de Stripe sin aplicar', objetivo: 0.99, fuente: 'evaluaciones_guardia',
    sinLectorPorque: 'es una lectura puntual; la guardia no guarda historial de evaluaciones',
  },
  {
    clave: 'bus_ordenes', nombre: 'Órdenes del bus sin atender', objetivo: 0.99, fuente: 'evaluaciones_guardia',
    sinLectorPorque: 'es una lectura puntual; la guardia no guarda historial de evaluaciones',
  },
];

// ── Parte pura ─────────────────────────────────────────────────────────────

export interface Muestra { buenos: number; total: number }
export type MuestrasPorVentana = Partial<Record<VentanaClave, Muestra | null>>;

function muestraValida(m: Muestra | null | undefined): m is Muestra {
  return !!m && Number.isFinite(m.buenos) && Number.isFinite(m.total)
    && m.total >= MUESTRA_MINIMA_QUEMA && m.buenos >= 0 && m.buenos <= m.total;
}

function objetivoValido(o: number): boolean {
  return Number.isFinite(o) && o > 0 && o < 1;
}

/** Quema de una ventana: tasa de error observada / tasa de error permitida.
 *  `null` = sin muestra suficiente (o datos incoherentes): NO es 0. */
export function quemaDe(m: Muestra | null | undefined, objetivo: number): number | null {
  if (!objetivoValido(objetivo) || !muestraValida(m)) return null;
  const tasaError = (m.total - m.buenos) / m.total;
  return tasaError / (1 - objetivo);
}

export interface PresupuestoError {
  /** % del presupuesto de 30 días ya consumido (puede pasar de 100). */
  consumidoPct: number;
  restantePct: number;
  /** Se consumió el 100 % o más: política = no se promueve autonomía ni se
   *  publican cambios de prompt/modelo hasta pasar el examen dorado. */
  agotado: boolean;
}

export function presupuestoDe(m30d: Muestra | null | undefined, objetivo: number): PresupuestoError | null {
  if (!objetivoValido(objetivo) || !muestraValida(m30d)) return null;
  const permitidos = m30d.total * (1 - objetivo);
  const malos = m30d.total - m30d.buenos;
  const consumido = (malos / permitidos) * 100;
  const redondear = (n: number) => Math.round(n * 10) / 10;
  return { consumidoPct: redondear(consumido), restantePct: redondear(Math.max(0, 100 - consumido)), agotado: consumido >= 100 - 1e-9 };
}

export type NivelQuema = 'pagina' | 'ticket' | 'ninguna' | 'sin_medir';

export interface EvaluacionQuema {
  clave: string;
  nombre: string;
  objetivo: number;
  nivel: NivelQuema;
  /** La regla más grave que se disparó, o `null`. */
  regla: string | null;
  quemas: Partial<Record<VentanaClave, number | null>>;
  presupuesto: PresupuestoError | null;
  /** Por qué es `sin_medir` (nunca vacío cuando lo es). */
  razon: string | null;
  nota: string;
}

/** PURA. Evalúa un SLO contra las muestras por ventana. Una ventana sin
 *  denominador suficiente no alerta ni tranquiliza: deja la regla sin evaluar. */
export function evaluarQuema(def: DefinicionSloQuema, muestras: MuestrasPorVentana): EvaluacionQuema {
  const base = { clave: def.clave, nombre: def.nombre, objetivo: def.objetivo, nota: NOTA_CALIBRACION };
  if (!objetivoValido(def.objetivo)) {
    return { ...base, nivel: 'sin_medir', regla: null, quemas: {}, presupuesto: null, razon: 'objetivo sin presupuesto de error (debe estar entre 0 y 1, exclusivo)' };
  }

  const quemas: Partial<Record<VentanaClave, number | null>> = {};
  for (const v of Object.keys(VENTANA_MS) as VentanaClave[]) quemas[v] = quemaDe(muestras[v], def.objetivo);
  const presupuesto = presupuestoDe(muestras['30d'], def.objetivo);

  let evaluables = 0;
  let disparada: ReglaQuema | null = null;
  for (const r of REGLAS_QUEMA) {
    const larga = quemas[r.larga];
    const corta = quemas[r.corta];
    if (larga === null || larga === undefined || corta === null || corta === undefined) continue;
    evaluables++;
    if (larga >= r.umbral && corta >= r.umbral) { disparada = r; break; }
  }

  if (disparada) return { ...base, nivel: disparada.severidad, regla: disparada.id, quemas, presupuesto, razon: null };
  if (evaluables > 0) return { ...base, nivel: 'ninguna', regla: null, quemas, presupuesto, razon: null };
  return {
    ...base, nivel: 'sin_medir', regla: null, quemas, presupuesto,
    razon: `ninguna regla tiene muestra suficiente en sus dos ventanas (mínimo ${MUESTRA_MINIMA_QUEMA} eventos por ventana)`,
  };
}

/** PURA. SLO cuyo lector no existe: `sin_medir` con su porqué. */
export function evaluacionSinLector(def: DefinicionSloQuema): EvaluacionQuema {
  return {
    clave: def.clave, nombre: def.nombre, objetivo: def.objetivo, nivel: 'sin_medir', regla: null,
    quemas: {}, presupuesto: null, nota: NOTA_CALIBRACION,
    razon: def.sinLectorPorque ?? 'sin lector de eventos buenos/totales',
  };
}

// ── El lector (único SLO con historial por ventana: corridas de agentes) ───

export interface LecturaMuestras {
  muestras: MuestrasPorVentana;
  /** Una entrada por ventana que NO se pudo leer. Vacío = todas leídas. */
  errores: string[];
}

/** Lee `slo_agente_corrida` (0162) una vez por ventana. Falla cerrado por
 *  ventana: un error de la base deja ESA ventana en `null` (sin medir) y lo
 *  dice en `errores`; jamás la vuelve un cero. */
export async function leerMuestrasAgentesExito(): Promise<LecturaMuestras> {
  const admin = supabaseAdmin();
  const ahora = ahoraMs();
  const ventanas = Object.keys(VENTANA_MS) as VentanaClave[];
  const errores: string[] = [];
  const muestras: MuestrasPorVentana = {};
  await Promise.all(ventanas.map(async (v) => {
    try {
      const desde = new Date(ahora - VENTANA_MS[v]).toISOString();
      const { data, error } = await admin.rpc('slo_agente_corrida', { p_desde: desde });
      if (error) throw new Error(error.message);
      const r = data as Record<string, unknown> | null;
      const total = typeof r?.total === 'number' ? r.total : null;
      const ok = typeof r?.ok === 'number' ? r.ok : null;
      if (total === null || ok === null) throw new Error('slo_agente_corrida devolvió otra forma');
      muestras[v] = { buenos: ok, total };
    } catch (e) {
      muestras[v] = null;
      errores.push(`${v}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
  return { muestras, errores };
}

/** Evalúa los cinco SLO. Solo `agentes_exito` tiene historial por ventana hoy;
 *  los otros cuatro salen `sin_medir` con su razón, no con una cifra inventada. */
export async function evaluarSlosEnQuema(): Promise<EvaluacionQuema[]> {
  const lectura = await leerMuestrasAgentesExito();
  return SLOS_CON_PRESUPUESTO.map((def) => {
    if (def.clave !== 'agentes_exito') return evaluacionSinLector(def);
    const ev = evaluarQuema(def, lectura.muestras);
    if (ev.nivel === 'sin_medir' && lectura.errores.length > 0) {
      return { ...ev, razon: `no se pudo leer (${lectura.errores.length} ventana(s) con error): ${lectura.errores[0]}` };
    }
    return ev;
  });
}
