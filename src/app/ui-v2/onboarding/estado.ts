import type { Modo } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO DEL ONBOARDING — la interfaz está AISLADA para poder cambiar de almacén sin tocar el resto.
//
// Hoy: localStorage (cosmético, por usuario y flota, con la clave hasheada; nunca el id en claro). Lo que se DERIVA de datos
// (avance de Puesta en marcha, conexiones activas) no se guarda: se recalcula cada vez y un «completado» guardado nunca se cree.
//
// CAMBIO NECESARIO PARA GUARDARLO EN SERVIDOR (no se hizo: requiere migración y aquí no se crean):
//   tabla `onboarding_estado (user_id uuid, tenant_id uuid, estado jsonb, actualizado_en timestamptz, primary key (user_id, tenant_id))`
//   con RLS «solo mi fila» y un endpoint GET/PUT. Entonces se escribe `AlmacenEstado` sobre ese endpoint y se pasa a
//   `crearEstado(...)`; ni el motor ni la tarjeta cambian. Hasta entonces el estado vive en el navegador y se pierde al cambiar
//   de equipo, lo cual solo repite una invitación, nunca expone ni altera datos de negocio.
// ═══════════════════════════════════════════════════════════════════════════

export interface EstadoOnboarding {
  /** Ya se le mostró la invitación al recorrido. */
  visto: boolean;
  /** «No volver a mostrar»: apaga la invitación y las pistas. El recorrido sigue disponible en la Guía. */
  descartado: boolean;
  /** Último modo elegido. */
  modo: Modo | null;
  /** Rutas cuya pista contextual ya se descartó. */
  pistas: string[];
}
export const ESTADO_VACIO: EstadoOnboarding = Object.freeze({ visto: false, descartado: false, modo: null, pistas: [] });
const MAX_PISTAS = 60;

/** Lo que el resto del código necesita de un almacén. `leer` nunca lanza. */
export interface AlmacenEstado {
  leer(): EstadoOnboarding;
  /** Devuelve el estado resultante aunque no se haya podido persistir. */
  guardar(parche: Partial<EstadoOnboarding>): EstadoOnboarding;
}

/** Subconjunto de Storage que se usa (permite probar con un almacén falso). */
export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Hash corto (FNV-1a, 8 hex) del ámbito. No es criptográfico: solo evita dejar el id en claro en el navegador. */
export function hashCorto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const claveEstado = (ambito: string) => `likida:onb:v1:${hashCorto(ambito)}`;
/** Interruptor para apagar el onboarding en un navegador (soporte, pruebas): `localStorage['likida:onb:desactivado']='1'`. */
export const CLAVE_DESACTIVADO = 'likida:onb:desactivado';

export function normalizar(crudo: unknown): EstadoOnboarding {
  if (!crudo || typeof crudo !== 'object') return { ...ESTADO_VACIO, pistas: [] };
  const c = crudo as Record<string, unknown>;
  const pistas = Array.isArray(c.pistas) ? c.pistas.filter((x): x is string => typeof x === 'string' && x.startsWith('/dashboard')).slice(0, MAX_PISTAS) : [];
  return { visto: c.visto === true, descartado: c.descartado === true, modo: c.modo === 'corto' || c.modo === 'completo' ? c.modo : null, pistas };
}

/** Almacén sobre localStorage. Todo dentro de try/catch: modo privado, cuota llena o sin `window` solo significan «no se recuerda». */
export function crearEstadoLocal(ambito: string, almacen: Almacen | null): AlmacenEstado {
  const clave = claveEstado(ambito);
  const leer = (): EstadoOnboarding => {
    try { const t = almacen?.getItem(clave); return t ? normalizar(JSON.parse(t)) : normalizar(null); } catch { return normalizar(null); }
  };
  return {
    leer,
    guardar(parche) {
      const siguiente = normalizar({ ...leer(), ...parche });
      try { almacen?.setItem(clave, JSON.stringify(siguiente)); } catch { /* el flujo sigue en memoria */ }
      return siguiente;
    },
  };
}

export function onboardingDesactivado(almacen: Almacen | null): boolean {
  try { return almacen?.getItem(CLAVE_DESACTIVADO) === '1'; } catch { return false; }
}

/** ¿Hay que invitar al recorrido? Solo la primera vez, sin descarte, y nunca a quien mira «como» otro (superadmin). */
export function debeInvitar(e: EstadoOnboarding, opciones: { soloLectura: boolean; desactivado: boolean }): boolean {
  return !e.visto && !e.descartado && !opciones.soloLectura && !opciones.desactivado;
}
export function debeMostrarPista(e: EstadoOnboarding, ruta: string, opciones: { soloLectura: boolean; desactivado: boolean }): boolean {
  return !e.descartado && !e.pistas.includes(ruta) && !opciones.desactivado && !opciones.soloLectura;
}
