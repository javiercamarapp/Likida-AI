// ═══════════════════════════════════════════════════════════════════════════
// EL GUARDIA DE ALERTAS (A0) — la clasificación DETERMINISTA (Fase 2).
//
// El blueprint (agente-guardia-de-alertas.md) es explícito: las reglas
// deterministas CALCULAN la severidad; el LLM solo redacta. Este módulo es
// esa mitad determinista, cableada sobre la bandeja que ya existe
// (getBandejaEscalaciones): toma las 6 fuentes + las fuentes ciegas y
// devuelve cada item con su severidad del runbook (S1/S2/S3/no-incidente),
// su regla aplicada y el formato de escalación §4-paso-5 ya armado.
//
// Lo que este módulo NO hace, por diseño del propio blueprint:
//  · No apaga palancas solo (eso es del copiloto CON confirmación, o del
//    guardia FUTURO cableado como proceso — hoy no existe como proceso).
//  · No le habla a ningún cliente, no promete tiempos, no cierra S1.
//
// La matriz §3, aplicada a las fuentes reales de la bandeja:
//  · Una FUENTE CIEGA es S2 en sí misma (§6: "un guardia que no ve la
//    bandeja y se calla es peor que no tener guardia").
//  · corridasFallo → S2 (una función dejó de operar; nada miente).
//  · arco → S3, y S2 al acercarse el plazo legal (20 días hábiles, LFPDPPP
//    art. 31 — vencerlo es incumplimiento, no molestia).
//  · tickets → S3; vencidos de SLA → S2.
//  · talachas / facturasProveedor / liquidacionesRevisar → S3 (esperan
//    decisión humana; el sistema opera).
//  S1 (el sistema MIENTE o ejecuta de más) no se deriva de la bandeja: se
//  reporta por ALERTA_EMAIL/Sentry y lo clasifica un humano o el guardia
//  futuro — este módulo lo declara en vez de fingir detectarlo.
// ═══════════════════════════════════════════════════════════════════════════

import { getBandejaEscalaciones, type BandejaEscalaciones, type ItemEscalacion } from './escalaciones';

export type Severidad = 'S1' | 'S2' | 'S3' | 'no_incidente';

export interface ItemClasificado {
  severidad: Severidad;
  /** La regla de la matriz que aplicó — citable, no inventada. */
  regla: string;
  fuente: string;
  titulo: string;
  flota: string;
  desde: string;
  vence: string | null;
  /** Dónde se resuelve (de la bandeja misma). */
  href: string | null;
}

export interface ClasificacionGuardia {
  /** Fuentes que NO se pudieron leer — S2 por sí mismas (§6). */
  fuentesCiegas: Array<{ fuente: string; error: string | null }>;
  items: ItemClasificado[];
  /** Conteo por severidad, solo de lo MEDIDO. */
  porSeveridad: Record<Severidad, number>;
  /** El recordatorio honesto: qué NO puede ver esta clasificación. */
  limites: string[];
}

/** Milisegundos → días, para los plazos. */
const DIA_MS = 86_400_000;

function clasificarItem(i: ItemEscalacion, ahoraMs: number): ItemClasificado {
  const base = {
    fuente: i.fuente, titulo: i.titulo, flota: i.tenantNombre,
    desde: i.desde, vence: i.vence, href: i.href,
  };
  const vencido = i.vence !== null && new Date(i.vence).getTime() < ahoraMs;

  if (i.fuente === 'corridas') {
    return { ...base, severidad: 'S2', regla: 'Una corrida de agente quedó en fallo: una función dejó de operar, nada miente (matriz §3·S2).' };
  }
  if (i.fuente === 'arco') {
    const porVencer = i.vence !== null && new Date(i.vence).getTime() - ahoraMs < 5 * DIA_MS;
    if (vencido || porVencer) {
      return { ...base, severidad: 'S2', regla: vencido ? 'Solicitud ARCO con el plazo legal VENCIDO (LFPDPPP art. 31) — incumplimiento, no pendiente.' : 'Solicitud ARCO a menos de 5 días del plazo legal (LFPDPPP art. 31).' };
    }
    return { ...base, severidad: 'S3', regla: 'Solicitud ARCO dentro de plazo — se atiende en el día, no despierta a nadie.' };
  }
  if (i.fuente === 'tickets') {
    if (vencido) {
      return { ...base, severidad: 'S2', regla: 'Ticket con SLA vencido: lo pactado ya se incumplió — sube de la lista del día.' };
    }
    return { ...base, severidad: 'S3', regla: 'Ticket dentro de SLA: contexto y borrador de respuesta, a la lista del día (matriz §3·S3).' };
  }
  // talachas, facturasProveedor, liquidacionesRevisar: decisión humana
  // pendiente con el sistema operando.
  return { ...base, severidad: 'S3', regla: 'Espera decisión humana con el sistema operando (matriz §3·S3) — va a la lista del día.' };
}

/** Clasifica una bandeja YA LEÍDA — pura, probable sin base. */
export function clasificarBandeja(b: BandejaEscalaciones, ahoraMs: number): ClasificacionGuardia {
  const fuentesCiegas = Object.entries(b.fuentes)
    .filter(([, f]) => f.items === null)
    .map(([fuente, f]) => ({ fuente, error: f.error }));

  const items = b.cola.map((i) => clasificarItem(i, ahoraMs));
  const porSeveridad: Record<Severidad, number> = { S1: 0, S2: 0, S3: 0, no_incidente: 0 };
  for (const i of items) porSeveridad[i.severidad]++;
  // Cada fuente ciega cuenta como su propio S2 (§6): no ver no es no haber.
  porSeveridad.S2 += fuentesCiegas.length;

  return {
    fuentesCiegas,
    items,
    porSeveridad,
    limites: [
      'S1 (el sistema miente o ejecuta de más) NO se deriva de esta bandeja: llega por ALERTA_EMAIL/Sentry y lo clasifica un humano — esta clasificación no finge detectarlo.',
      'La matriz de no-incidentes (SAT sin responder, cron saltado por palanca, panel fallando cerrado) vive en el runbook y se aplica ANTES de escalar — un no-incidente no debe llegar a esta cola.',
    ],
  };
}

/** La lectura completa: bandeja real → clasificación. LANZA si la bandeja
 *  entera no se pudo armar (getBandejaEscalaciones ya degrada por fuente). */
export async function clasificacionDeGuardia(ahoraMs: number): Promise<ClasificacionGuardia> {
  const bandeja = await getBandejaEscalaciones(ahoraMs);
  return clasificarBandeja(bandeja, ahoraMs);
}
