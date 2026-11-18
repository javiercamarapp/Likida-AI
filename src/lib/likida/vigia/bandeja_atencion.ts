// ═══════════════════════════════════════════════════════════════════════════
// BANDEJA DE ATENCIÓN del Vigía (servicio al cliente): lo que se DERIVA de los datos que el tablero ya lee.
//
// Pura y determinista. No lee la base ni manda nada: recibe `DatosTablero` (que arma `cargarTablero`) y devuelve, por conversación,
// su prioridad, su estado de atención, quién la contesta y cuánto lleva sin respuesta. Nada se inventa: cada nivel sale de un dato
// real de la conversación (molestia, espera contra el SLA de la flota, nivel de escalamiento, respuesta por aprobar, prioridad del
// mensaje) y cada motivo se muestra junto al nivel para que quien lo lee pueda comprobarlo.
//
// GUARDIA: esto solo ORDENA y FILTRA lo que ya existe. No toca los umbrales de escalamiento ni dispara ningún envío.
// ═══════════════════════════════════════════════════════════════════════════
import type { ConversacionTablero, DatosTablero } from './repo';

export type PrioridadBandeja = 'urgente' | 'alta' | 'normal';
export const PRIORIDADES_BANDEJA: readonly PrioridadBandeja[] = ['urgente', 'alta', 'normal'];

/** El estado de atención de un hilo activo (uno solo, el más urgente que le corresponda). */
export type EstadoAtencion = 'por_aprobar' | 'escalada' | 'sin_responder' | 'con_persona' | 'al_dia';
export const ESTADOS_ATENCION: readonly EstadoAtencion[] = ['por_aprobar', 'escalada', 'sin_responder', 'con_persona', 'al_dia'];

/** Las categorías que explican la prioridad (se traducen en pantalla; nunca viaja el texto del cliente). */
export type MotivoBandeja = 'muy_molesto' | 'molesto' | 'sla_vencido' | 'escalada_n2' | 'escalada_n1' | 'por_aprobar' | 'prioridad_alta';

export interface FilaBandeja {
  id: string;
  clienteId: string | null;
  clienteNombre: string | null;
  contactoNombre: string | null;
  prioridad: PrioridadBandeja;
  motivos: MotivoBandeja[];
  estado: EstadoAtencion;
  control: 'agente' | 'humano';
  /** Si lo lleva una persona y se sabe quién (la que tocó «Yo me encargo»); null = no consta. */
  responsableNombre: string | null;
  /** Cuántas respuestas propuestas por el agente esperan aprobación en este hilo. */
  porAprobar: number;
  escalamientoNivel: number;
  molestiaNivel: number;
  /** Desde cuándo el cliente espera respuesta (null = nadie espera). */
  sinRespuestaDesde: string | null;
  /** Minutos enteros esperando (0 si nadie espera). */
  esperaMin: number;
  /** ¿Pasó el plazo de respuesta de la flota? */
  slaVencido: boolean;
  ultimoMensajeCliente: string | null;
  ultimaEntradaEn: string | null;
}

export interface FiltrosBandeja {
  estado: EstadoAtencion | '';
  prioridad: PrioridadBandeja | '';
  clienteId: string;
}

export const SIN_FILTROS: FiltrosBandeja = { estado: '', prioridad: '', clienteId: '' };

const RANGO: Record<PrioridadBandeja, number> = { urgente: 0, alta: 1, normal: 2 };

export function minutosDesde(iso: string | null, ahoraMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((ahoraMs - t) / 60_000));
}

/**
 * La prioridad de UNA conversación y por qué:
 *  · urgente — cliente muy molesto (nivel 3), escalada al nivel 2, o molesto/escalada con el plazo de respuesta ya vencido;
 *  · alta    — cliente molesto, escalada al nivel 1, plazo de respuesta vencido, mensaje de prioridad alta, o una respuesta
 *              propuesta por el agente esperando a una persona;
 *  · normal  — todo lo demás (esperando dentro del plazo, o al día).
 * El plazo es el de la flota (`slaRespuestaMin`), el mismo con el que el panel cuenta los «sin respuesta».
 */
export function prioridadDeConversacion(
  c: Pick<ConversacionTablero, 'molestiaNivel' | 'escalamientoNivel' | 'sinRespuestaDesde' | 'prioridad'>,
  porAprobar: number, slaMin: number, ahoraMs: number,
): { prioridad: PrioridadBandeja; motivos: MotivoBandeja[]; slaVencido: boolean } {
  const espera = minutosDesde(c.sinRespuestaDesde, ahoraMs);
  const slaVencido = c.sinRespuestaDesde !== null && espera >= slaMin;
  const motivos: MotivoBandeja[] = [];
  if (c.molestiaNivel >= 3) motivos.push('muy_molesto');
  else if (c.molestiaNivel >= 2) motivos.push('molesto');
  if (slaVencido) motivos.push('sla_vencido');
  if (c.escalamientoNivel >= 2) motivos.push('escalada_n2');
  else if (c.escalamientoNivel === 1) motivos.push('escalada_n1');
  if (porAprobar > 0) motivos.push('por_aprobar');
  if ((c.prioridad ?? 0) >= 2) motivos.push('prioridad_alta');

  const molesto = c.molestiaNivel >= 2;
  const escalada = c.escalamientoNivel > 0;
  let prioridad: PrioridadBandeja = 'normal';
  if (c.molestiaNivel >= 3 || c.escalamientoNivel >= 2 || (slaVencido && (molesto || escalada))) prioridad = 'urgente';
  else if (molesto || escalada || slaVencido || porAprobar > 0 || (c.prioridad ?? 0) >= 2) prioridad = 'alta';
  return { prioridad, motivos, slaVencido };
}

/** El estado de atención: lo más urgente que le corresponda a este hilo. */
export function estadoDeAtencion(
  c: Pick<ConversacionTablero, 'control' | 'sinRespuestaDesde' | 'escalamientoNivel'>, porAprobar: number,
): EstadoAtencion {
  if (porAprobar > 0) return 'por_aprobar';
  if (c.escalamientoNivel > 0 && c.sinRespuestaDesde !== null) return 'escalada';
  if (c.sinRespuestaDesde !== null) return 'sin_responder';
  if (c.control === 'humano') return 'con_persona';
  return 'al_dia';
}

/** Las filas de la bandeja, ya con su prioridad y estado, SIN ordenar ni filtrar. */
export function filasDeBandeja(d: Pick<DatosTablero, 'config' | 'conversaciones' | 'pendientes' | 'gerentes'>, ahoraMs: number): FilaBandeja[] {
  const porAprobar = new Map<string, number>();
  for (const p of d.pendientes) porAprobar.set(p.conversacionId, (porAprobar.get(p.conversacionId) ?? 0) + 1);
  const nombreDe = new Map(d.gerentes.map((g) => [g.id, g.nombre]));
  return d.conversaciones.map((c): FilaBandeja => {
    const n = porAprobar.get(c.id) ?? 0;
    const p = prioridadDeConversacion(c, n, d.config.slaRespuestaMin, ahoraMs);
    return {
      id: c.id, clienteId: c.clienteId ?? null, clienteNombre: c.clienteNombre, contactoNombre: c.contactoNombre,
      prioridad: p.prioridad, motivos: p.motivos, estado: estadoDeAtencion(c, n), control: c.control,
      responsableNombre: c.control === 'humano' && c.tomadaPor ? nombreDe.get(c.tomadaPor) ?? null : null,
      porAprobar: n, escalamientoNivel: c.escalamientoNivel, molestiaNivel: c.molestiaNivel,
      sinRespuestaDesde: c.sinRespuestaDesde, esperaMin: minutosDesde(c.sinRespuestaDesde, ahoraMs), slaVencido: p.slaVencido,
      ultimoMensajeCliente: c.ultimoMensajeCliente, ultimaEntradaEn: c.ultimaEntradaEn,
    };
  });
}

/** Prioridad (urgente primero), luego quien lleva más tiempo esperando, y por último el id (estable). No muta la lista. */
export function ordenarBandeja<T extends Pick<FilaBandeja, 'id' | 'prioridad' | 'esperaMin'>>(filas: readonly T[]): T[] {
  return [...filas].sort((a, b) => RANGO[a.prioridad] - RANGO[b.prioridad] || b.esperaMin - a.esperaMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Aplica los tres filtros (estado, prioridad, cliente). Un filtro vacío no filtra. */
export function filtrarBandeja<T extends Pick<FilaBandeja, 'estado' | 'prioridad' | 'clienteId'>>(filas: readonly T[], f: FiltrosBandeja): T[] {
  return filas.filter((x) => (!f.estado || x.estado === f.estado) && (!f.prioridad || x.prioridad === f.prioridad) && (!f.clienteId || x.clienteId === f.clienteId));
}

/** Lee los filtros del query string. Un valor que no es de la lista se ignora (no se confía en la URL). */
export function filtrosDeUrl(sp: { estado?: string; prioridad?: string; cliente?: string }): FiltrosBandeja {
  const estado = (ESTADOS_ATENCION as readonly string[]).includes(sp.estado ?? '') ? (sp.estado as EstadoAtencion) : '';
  const prioridad = (PRIORIDADES_BANDEJA as readonly string[]).includes(sp.prioridad ?? '') ? (sp.prioridad as PrioridadBandeja) : '';
  const cliente = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.cliente ?? '') ? String(sp.cliente) : '';
  return { estado, prioridad, clienteId: cliente };
}

export interface CifrasBandeja {
  total: number;
  porPrioridad: Record<PrioridadBandeja, number>;
  /** Hilos donde el cliente espera respuesta (con o sin plazo vencido). */
  sinResponder: number;
  /** De esos, los que ya pasaron el plazo de respuesta de la flota. */
  fueraDePlazo: number;
  /** Respuestas propuestas por el agente que esperan a una persona. */
  porAprobar: number;
  /** Minutos del hilo que más lleva esperando (null = nadie espera). */
  masAntiguaMin: number | null;
}

export function cifrasDeBandeja(filas: readonly FilaBandeja[]): CifrasBandeja {
  const esperando = filas.filter((f) => f.sinRespuestaDesde !== null);
  return {
    total: filas.length,
    porPrioridad: {
      urgente: filas.filter((f) => f.prioridad === 'urgente').length,
      alta: filas.filter((f) => f.prioridad === 'alta').length,
      normal: filas.filter((f) => f.prioridad === 'normal').length,
    },
    sinResponder: esperando.length,
    fueraDePlazo: esperando.filter((f) => f.slaVencido).length,
    porAprobar: filas.reduce((n, f) => n + f.porAprobar, 0),
    masAntiguaMin: esperando.length ? Math.max(...esperando.map((f) => f.esperaMin)) : null,
  };
}

/**
 * A quién le toca por NIVEL de escalamiento, con lo que sí hay en las tablas: el nivel 1 es el gerente responsable del contacto
 * (o el jefe de la flota si no tiene) y el nivel 2 el dueño (`escalamiento.ts`); además, las personas de la lista de directores de
 * ese nivel y las de «servicio al cliente» que apliquen al cliente. Devuelve nombres (sin teléfonos ni correos).
 */
export function responsablesPorNivel(
  d: Pick<DatosTablero, 'contactos' | 'gerentes' | 'directores' | 'servicio'>, contactoId: string | null, clienteId: string | null,
): { servicio: string[]; nivel1: string[]; nivel2: string[]; nivel1PorOmision: boolean } {
  const contacto = contactoId ? d.contactos.find((c) => c.id === contactoId) : undefined;
  const gerente = contacto?.gerenteUserId ? d.gerentes.find((g) => g.id === contacto.gerenteUserId)?.nombre ?? null : null;
  const lista = (n: 1 | 2) => (d.directores ?? []).filter((x) => x.nivel === n).map((x) => x.nombre);
  const servicio = (d.servicio ?? []).filter((s) => s.activo && (s.clienteId === null || s.clienteId === clienteId)).map((s) => s.nombre);
  const duenos = d.gerentes.filter((g) => g.rol === 'flota_admin').map((g) => g.nombre).filter((n): n is string => !!n);
  const nivel1 = [...(gerente ? [gerente] : []), ...lista(1)];
  const nivel2 = [...duenos, ...lista(2)];
  return { servicio, nivel1, nivel2, nivel1PorOmision: !gerente };
}
