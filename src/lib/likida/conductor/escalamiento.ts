import { logger } from '@/lib/logger';
import { normalizarTelefonoWa } from '../wa_ventana';
import { telefonosJefe, resolverCuentaOficina } from '../contactos';
import type { HitoFila } from './tipos';
import { cargarContactosTrafico, ultimaPosicionUnidad, type ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// A QUIÉN SE ESCALA — niveles por terminal.
//
//   NIVEL 1  el PATIO RESPONSABLE de la terminal del viaje (contacto nivel 1 de
//            esa terminal; si no hay, el nivel 1 de toda la flota).
//   NIVEL 2  el JEFE GENERAL (contacto nivel 2 de la terminal o de toda la flota).
//
// Sin ningún contacto configurado en un nivel, ese nivel cae al jefe de la flota
// (`app_user`, el mismo que recibe la escalación de «viaje no aceptado»). Y un
// teléfono que ya recibió el nivel 1 NO recibe el 2: subir el aviso a la misma
// persona no escala nada.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContactoTrafico {
  nombre: string;
  telefono: string;
  nivel: 1 | 2;
  /** `null` = toda la flota. */
  terminalId: string | null;
}

export interface Destino {
  nombre: string;
  telefono: string;
}

/** Máximo de personas a las que se avisa en UN nivel: más es ruido, no escalamiento. */
export const MAX_DESTINOS_POR_NIVEL = 3;

function delNivel(contactos: readonly ContactoTrafico[], nivel: 1 | 2, terminalId: string | null): ContactoTrafico[] {
  const delNivel = contactos.filter((c) => c.nivel === nivel);
  const delaTerminal = terminalId ? delNivel.filter((c) => c.terminalId === terminalId) : [];
  return delaTerminal.length > 0 ? delaTerminal : delNivel.filter((c) => c.terminalId === null);
}

/**
 * Pura: a quién avisar en `nivel`. `jefeFlota` es el teléfono del jefe de la flota
 * (respaldo). `yaAvisados` son teléfonos que ya recibieron un nivel anterior.
 */
export function elegirDestinatarios(
  contactos: readonly ContactoTrafico[],
  jefeFlota: string | null,
  terminalId: string | null,
  nivel: 1 | 2,
  yaAvisados: readonly string[] = [],
): Destino[] {
  const excluidos = new Set(yaAvisados.map(normalizarTelefonoWa));
  let elegidos: Destino[] = delNivel(contactos, nivel, terminalId).map((c) => ({ nombre: c.nombre, telefono: c.telefono }));
  // El nivel 1 sin patio configurado cae al jefe general configurado; sin ninguno, al jefe de la flota.
  if (elegidos.length === 0 && nivel === 1) {
    elegidos = delNivel(contactos, 2, terminalId).map((c) => ({ nombre: c.nombre, telefono: c.telefono }));
  }
  if (elegidos.length === 0 && jefeFlota) elegidos = [{ nombre: 'Jefe de la flota', telefono: jefeFlota }];

  const vistos = new Set<string>();
  const salida: Destino[] = [];
  for (const d of elegidos) {
    const t = normalizarTelefonoWa(d.telefono);
    if (!t || excluidos.has(t) || vistos.has(t)) continue;
    vistos.add(t);
    salida.push(d);
    if (salida.length >= MAX_DESTINOS_POR_NIVEL) break;
  }
  return salida;
}

/** Los destinatarios reales de un nivel (lee contactos y, de respaldo, el jefe de la flota). Lanza si la base no contesta. */
export async function destinatariosEscalacion(tenantId: string, terminalId: string | null, nivel: 1 | 2): Promise<Destino[]> {
  const contactos = await cargarContactosTrafico(tenantId);
  const jefe = (await telefonosJefe([tenantId]))[tenantId] ?? null;
  // Para excluir al nivel 1 del nivel 2 se recalcula lo que habría recibido el 1.
  const nivel1 = nivel === 2 ? elegirDestinatarios(contactos, jefe, terminalId, 1).map((d) => d.telefono) : [];
  return elegirDestinatarios(contactos, jefe, terminalId, nivel, nivel1);
}

/** ¿Este teléfono puede acusar escalaciones de esta flota? (contacto de tráfico, o cuenta de oficina de ESA flota). */
export async function puedeAcusar(tenantId: string, telefono: string): Promise<boolean> {
  const t = normalizarTelefonoWa(telefono);
  const contactos = await cargarContactosTrafico(tenantId);
  if (contactos.some((c) => normalizarTelefonoWa(c.telefono) === t)) return true;
  const cuenta = await resolverCuentaOficina(telefono).catch((e) => {
    logger.error('conductor.acuse_cuenta_no_resuelta', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });
  return Boolean(cuenta && cuenta.tenantId === tenantId);
}

/** La última ubicación que se conoce del viaje, en una línea (parámetro de plantilla: sin saltos). */
export async function ubicacionConocida(viaje: ViajeContexto, hitos: readonly HitoFila[], ahora: Date): Promise<string> {
  const hace = (iso: string): string => {
    const min = Math.max(0, Math.round((ahora.getTime() - new Date(iso).getTime()) / 60_000));
    return min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
  };
  const liga = (lat: number, lng: number) => `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
  try {
    if (viaje.unidadId) {
      const p = await ultimaPosicionUnidad(viaje.tenantId, viaje.unidadId, ahora);
      if (p) return `${hace(p.medidaEn)}: ${liga(p.lat, p.lng)}`;
    }
  } catch (e) {
    logger.warn('conductor.ubicacion_no_leida', { viaje: viaje.id, err: e instanceof Error ? e.message : String(e) });
  }
  const conPin = [...hitos].filter((h) => h.lat !== null && h.lng !== null && h.recibidoEn)
    .sort((a, b) => new Date(b.recibidoEn!).getTime() - new Date(a.recibidoEn!).getTime())[0];
  if (conPin) return `${hace(conPin.recibidoEn!)}: ${liga(conPin.lat!, conPin.lng!)}`;
  return 'sin ubicación reciente';
}
