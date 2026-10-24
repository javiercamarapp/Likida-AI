// ═══════════════════════════════════════════════════════════════════════════
// CCP (complemento de carta porte) hacia el TMS: carga y consulta de reque (T-TMS-11).
//
// ÚNICO archivo del conector con capacidad de ESCRITURA, y por eso lleva tres candados:
//   1. `modo` = 'ensayo' | 'real', con 'ensayo' por defecto: en ensayo devuelve el payload que
//      enviaría y NO toca la red (patrón del candado de `facturacion/modo.ts`).
//   2. Bandera por flota `tms_escritura_habilitada`: en modo 'real' sin ella, error claro y cero red.
//      La bandera se INYECTA (`opciones.bandera`); su almacén persistente es una decisión pendiente
//      (ver nota de la tarea), por eso aquí no se lee ninguna tabla ni se inventa una migración.
//   3. Especificación del endpoint (`EspecificacionCcp`): el cliente NO la ha entregado (BLOQUEO
//      EXTERNO). Sin ella, `NoEspecificado` y NINGUNA llamada: no se inventa ruta.
//
// Reglas del cliente que implementa:
//  · Antes de subir, verificar que el reque exista; si no existe, queda PENDIENTE (no se pierde ni se
//    reprocesa a ciegas) y se avisa UNA vez.
//  · Las tres causas por las que un CCP «no se liga» (cliente, caja, pre-requerimiento) las decide el
//    TMS; aquí solo se transporta lo que el TMS conteste, sin interpretarlo.
//  · Reintentos con tope (3 por omisión) y alerta única: tres fallos → UNA alerta, no una por intento ni
//    una por cada llamada posterior con la misma plantilla.
//  · Idempotencia por huella de la plantilla: la misma plantilla no se sube dos veces.
// No timbra ni crea viaje/CCP propio: solo transporta la plantilla que genera el agente de carta porte.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { huella } from './huella';
import type { PeticionSesion, ResultadoSesion } from './sesion';

/** Lo único que este archivo necesita de la sesión: `SesionTms` lo cumple. */
export interface SesionEscrituraTms {
  peticion(p: PeticionSesion): Promise<ResultadoSesion>;
}

/** Lo que el cliente debe entregar para que el endpoint deje de ser un hueco. Hoy NO existe. */
export interface EspecificacionCcp {
  carga: { ruta: string; metodo?: 'POST'; /** Nombre del campo que lleva la plantilla. */ campo_plantilla: string };
  consulta: {
    ruta: string;
    /** Nombre del parámetro de query con la referencia del reque. */
    parametro_ref: string;
    /** Campo de la respuesta que dice si el reque ya tiene complemento ligado (opcional). */
    campo_ligado?: string;
  };
}

/** La plantilla multi-hoja la genera otro módulo; aquí solo viaja. */
export type PlantillaCcp = Uint8Array | Record<string, unknown>;

export interface AlmacenCcp {
  subida(huellaPlantilla: string): boolean | Promise<boolean>;
  marcarSubida(huellaPlantilla: string): void | Promise<void>;
  alertada(huellaPlantilla: string): boolean | Promise<boolean>;
  marcarAlertada(huellaPlantilla: string): void | Promise<void>;
}

/** SOLO para pruebas y modo ensayo: no sobrevive a la invocación, así que `cargarCcp` en modo real ya no lo usa por omisión. */
export function almacenCcpEnMemoria(): AlmacenCcp {
  const subidas = new Set<string>();
  const alertadas = new Set<string>();
  return {
    subida: (h) => subidas.has(h),
    marcarSubida: (h) => { subidas.add(h); },
    alertada: (h) => alertadas.has(h),
    marcarAlertada: (h) => { alertadas.add(h); },
  };
}

export interface OpcionesCcp {
  /** `null`/ausente = el cliente no entregó la especificación. */
  especificacion?: EspecificacionCcp | null;
  /** Por omisión 'ensayo'. */
  modo?: 'ensayo' | 'real';
  /** Bandera por flota `tms_escritura_habilitada`. Por omisión APAGADA. */
  bandera?: () => boolean | Promise<boolean>;
  almacen?: AlmacenCcp;
  /** Aviso al operador; se llama UNA vez por plantilla. */
  alertar?: (mensaje: string) => void | Promise<void>;
  /** Intentos de carga (por omisión 3). */
  intentos?: number;
  /** Pausa entre intentos; las pruebas inyectan una que no duerme. */
  esperar?: (ms: number) => Promise<void>;
  /** Referencia del reque al que pertenece la plantilla; se verifica antes de subir si se da. */
  refReque?: string;
}

export const INTENTOS_CCP_POR_OMISION = 3;

export type ResultadoCarga =
  | { estado: 'no_especificado'; motivo: string }
  | { estado: 'bandera_apagada'; motivo: string }
  | { estado: 'sin_almacen'; motivo: string }
  | { estado: 'ensayo'; payload: { ruta: string; metodo: 'POST'; cuerpo: Record<string, unknown> }; huella: string }
  | { estado: 'ya_subida'; huella: string }
  | { estado: 'reque_pendiente'; motivo: string; huella: string }
  | { estado: 'subida'; huella: string; intentos: number }
  | { estado: 'fallo'; motivo: string; huella: string; intentos: number; alertada: boolean };

export type ResultadoReque =
  | { estado: 'no_especificado'; motivo: string }
  | { estado: 'pendiente'; motivo: string }
  | { estado: 'existe'; ligado: boolean }
  | { estado: 'error'; motivo: string };

const NO_ESPECIFICADO = 'El cliente aún no entregó la especificación del endpoint de CCP; no se llama a nada.';

export function huellaPlantilla(plantilla: PlantillaCcp): string {
  if (plantilla instanceof Uint8Array) return createHash('sha256').update(plantilla).digest('hex');
  return huella('ccp_reque', 'plantilla', { contenido: plantilla });
}

function cuerpoDe(espec: EspecificacionCcp, plantilla: PlantillaCcp): Record<string, unknown> {
  const valor = plantilla instanceof Uint8Array
    ? { base64: Buffer.from(plantilla).toString('base64') }
    : plantilla;
  return { [espec.carga.campo_plantilla]: valor };
}

function leerRuta(obj: unknown, ruta: string): unknown {
  let v: unknown = obj;
  for (const parte of ruta.split('.')) {
    if (parte === '__proto__' || parte === 'constructor' || parte === 'prototype') return undefined;
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[parte];
  }
  return v;
}

/** Lectura: ¿existe el reque y está ligado? 404 = aún no existe = pendiente. */
export async function consultarReque(
  sesion: SesionEscrituraTms, ref: string, opciones: Pick<OpcionesCcp, 'especificacion'> = {},
): Promise<ResultadoReque> {
  const espec = opciones.especificacion;
  if (!espec) return { estado: 'no_especificado', motivo: NO_ESPECIFICADO };
  const res = await sesion.peticion({ ruta: espec.consulta.ruta, query: { [espec.consulta.parametro_ref]: ref } });
  if (!res.ok) return { estado: 'error', motivo: res.motivo };
  const { estado, cuerpo } = res.r;
  if (estado === 404) return { estado: 'pendiente', motivo: 'El reque todavía no existe en el sistema de transporte.' };
  if (estado < 200 || estado >= 300) return { estado: 'error', motivo: `La consulta de reque contestó ${estado}, que no es lo esperado.` };
  let json: unknown;
  try { json = JSON.parse(cuerpo); } catch { return { estado: 'error', motivo: 'La consulta de reque no contestó un JSON legible.' }; }
  const ligado = espec.consulta.campo_ligado ? Boolean(leerRuta(json, espec.consulta.campo_ligado)) : false;
  return { estado: 'existe', ligado };
}

/** ESCRITURA. Ver los tres candados al inicio del archivo. */
export async function cargarCcp(
  sesion: SesionEscrituraTms, plantilla: PlantillaCcp, opciones: OpcionesCcp = {},
): Promise<ResultadoCarga> {
  const modo = opciones.modo ?? 'ensayo';
  const espec = opciones.especificacion;
  if (!espec) return { estado: 'no_especificado', motivo: NO_ESPECIFICADO };

  const h = huellaPlantilla(plantilla);

  if (modo === 'ensayo') {
    return { estado: 'ensayo', huella: h, payload: { ruta: espec.carga.ruta, metodo: 'POST', cuerpo: cuerpoDe(espec, plantilla) } };
  }

  const habilitada = opciones.bandera ? await opciones.bandera() : false;
  if (habilitada !== true) {
    return { estado: 'bandera_apagada', motivo: 'La carga al sistema de transporte está apagada para esta flota (tms_escritura_habilitada).' };
  }

  // A37-S38-09: en modo real la idempotencia necesita un almacén PERSISTENTE inyectado; el de memoria arranca vacío en cada
  // invocación serverless y subiría la misma plantilla otra vez. Sin almacén: cero red (fail-closed).
  const almacen = opciones.almacen;
  if (!almacen) {
    return { estado: 'sin_almacen', motivo: 'La carga real exige un almacén persistente de huellas (idempotencia); sin él no se sube nada.' };
  }
  if (await almacen.subida(h)) return { estado: 'ya_subida', huella: h };

  const alertar = async (mensaje: string): Promise<boolean> => {
    if (await almacen.alertada(h)) return false;
    await almacen.marcarAlertada(h);
    await opciones.alertar?.(mensaje);
    return true;
  };

  if (opciones.refReque !== undefined) {
    const reque = await consultarReque(sesion, opciones.refReque, { especificacion: espec });
    if (reque.estado === 'pendiente') {
      await alertar('El reque no existe todavía; el CCP queda pendiente hasta que se cree.');
      return { estado: 'reque_pendiente', motivo: reque.motivo, huella: h };
    }
    if (reque.estado === 'error') {
      return { estado: 'fallo', motivo: reque.motivo, huella: h, intentos: 0, alertada: await alertar(reque.motivo) };
    }
  }

  const tope = Math.max(1, Math.floor(opciones.intentos ?? INTENTOS_CCP_POR_OMISION));
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let motivo = 'sin intentos';
  let intentos = 0;
  while (intentos < tope) {
    if (intentos > 0) await esperar(1_000 * 2 ** (intentos - 1));
    intentos += 1;
    const res = await sesion.peticion({ ruta: espec.carga.ruta, metodo: 'POST', cuerpo: cuerpoDe(espec, plantilla) });
    if (res.ok && res.r.estado >= 200 && res.r.estado < 300) {
      await almacen.marcarSubida(h);
      return { estado: 'subida', huella: h, intentos };
    }
    motivo = res.ok ? `La carga contestó ${res.r.estado}.` : res.motivo;
    // Credencial rechazada: reintentar solo bloquearía la cuenta.
    if (!res.ok && res.falla === 'credencial') break;
  }
  const alertada = await alertar(`La carga de CCP falló tras ${intentos} intento(s): ${motivo}`);
  return { estado: 'fallo', motivo, huella: h, intentos, alertada };
}
