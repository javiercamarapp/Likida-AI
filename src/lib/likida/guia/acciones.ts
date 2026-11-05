'use server';

import { getSessionTenant } from '@/lib/auth/session';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerSenalesAsistente } from '../asistente/senales';
import { GUIA_EVENTOS } from './eventos';
import { procesarLoteEventos, type VentanaEventos } from './lote_eventos';
import { pistaGuiaDe } from './pista';
import { guardarEstado, insertarEventos, leerEstado, type EscrituraEstado, type LecturaEstado } from './repo';
import { leerSenalesGuia } from './senales';
import type { ParcheEstadoGuia, ResultadoSenal } from './tipos';

// Server actions de la guía. La identidad SIEMPRE sale de la sesión del servidor: el navegador nunca dice de quién es el estado.
// «Ver como» (superadmin) es de solo lectura: no escribe estado ni eventos. Todo falla cerrado y sin lanzar al cliente.

export type RespuestaLeer = LecturaEstado | { ok: false; motivo: 'sin_sesion' };
export type RespuestaGuardar = EscrituraEstado | { ok: false; motivo: 'sin_sesion' } | { ok: true; omitido: 'solo_lectura' };

export async function leerEstadoGuia(): Promise<RespuestaLeer> {
  const s = await getSessionTenant();
  if (!s || !s.tenantId) return { ok: false, motivo: 'sin_sesion' };
  return leerEstado(supabaseAdmin(), s.userId, s.tenantId);
}

export async function guardarEstadoGuia(parche: ParcheEstadoGuia, versionEsperada: number): Promise<RespuestaGuardar> {
  const s = await getSessionTenant();
  if (!s || !s.tenantId) return { ok: false, motivo: 'sin_sesion' };
  if (s.rol === 'superadmin') return { ok: true, omitido: 'solo_lectura' };
  if (!Number.isInteger(versionEsperada) || versionEsperada < 0) return { ok: false, motivo: 'version' };
  return guardarEstado(supabaseAdmin(), s.userId, s.tenantId, parche, versionEsperada);
}

/** Lee hasta 10 señales de la flota de la sesión. Lo que la pista de la persona no puede leer vuelve como `sin_dato`. */
export async function leerSenalesDeLaGuia(ids: string[]): Promise<Record<string, ResultadoSenal>> {
  const s = await getSessionTenant();
  if (!s || !s.tenantId || !Array.isArray(ids)) return {};
  const perfil = await perfilDeTenant(s.tenantId).catch(() => null);
  const pista = pistaGuiaDe(s.rol, perfil);
  if (!pista) return {};
  return leerSenalesGuia(ids.filter((i): i is string => typeof i === 'string'), s.tenantId, pista, { db: supabaseAdmin(), leerAsistente: leerSenalesAsistente });
}

// Tope por usuario y minuto: en memoria de la instancia (best effort; el tope duro es el tamaño del lote y el CHECK de la tabla).
const ventana: VentanaEventos = new Map();

/** Registra un lote de eventos sin PII. Apagado por GUIA_EVENTOS hasta que el aviso de privacidad lo mencione (D-OB-8). */
export async function registrarEventosGuia(lote: unknown[]): Promise<{ ok: boolean; guardados: number }> {
  if (!GUIA_EVENTOS) return { ok: false, guardados: 0 };
  const sesion = await getSessionTenant();
  const perfil = sesion?.tenantId ? await perfilDeTenant(sesion.tenantId).catch(() => null) : null;
  return procesarLoteEventos({
    activo: GUIA_EVENTOS, lote, sesion, secreto: process.env.LIKIDA_FLOTA_COOKIE_LLAVE, perfil: perfil ?? null, ahora: Date.now(), ventana,
    guardar: (ctx, l) => insertarEventos(supabaseAdmin(), ctx, l),
  });
}
