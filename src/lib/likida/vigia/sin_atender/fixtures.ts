// Datos ficticios para las pruebas del motor. Sin nombres reales de clientes ni personas.
import { TZ_MX } from '@/lib/formato';
import type { ChatEntrada, MensajeChat, RolChat } from './tipos';

/** Miércoles 14-oct-2026 10:00 hora de México (UTC-6, sin horario de verano). */
export const T0_MS = Date.parse('2026-10-14T16:00:00Z');
export const ZONA = TZ_MX;
export const CLIENTE_A = 'a1a1a1a1a1a1';
export const CLIENTE_B = 'b2b2b2b2b2b2';
export const OPERADOR_1 = 'c3c3c3c3c3c3';

export const enMin = (min: number): string => new Date(T0_MS + min * 60_000).toISOString();

export function msg(min: number, rol: RolChat, texto: string, autorHash?: string, extra: Partial<MensajeChat> = {}): MensajeChat {
  return { enviadoEn: enMin(min), rol, autorHash: autorHash ?? (rol === 'equipo' ? OPERADOR_1 : CLIENTE_A), texto, ...extra };
}
export const cli = (min: number, texto: string, autorHash?: string): MensajeChat => msg(min, 'cliente', texto, autorHash);
export const eq = (min: number, texto: string): MensajeChat => msg(min, 'equipo', texto);

export function chat(mensajes: MensajeChat[], extra: Partial<ChatEntrada> = {}): ChatEntrada {
  return { chatId: 'grupo-a', nombre: 'Grupo A', critico: false, mensajes, ...extra };
}

/** PRNG determinista (mulberry32) para barajar sin Math.random. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function barajar<T>(lista: readonly T[], azar: () => number): T[] {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i -= 1) { const j = Math.floor(azar() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
