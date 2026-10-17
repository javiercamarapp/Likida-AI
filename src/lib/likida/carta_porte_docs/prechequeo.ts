// ═══════════════════════════════════════════════════════════════════════════
// PRE-CHEQUEO DE LAS 3 CAUSAS DE «NO SE LIGA» (T-A3-25) — antes de enviar al TMS.
//
// Un CCP no se liga por tres razones (33c4d51b 28:16): (1) el número del cliente
// que paga está mal, (2) la caja está mal, (3) no hay requerimiento (cae como
// prerrequerimiento). Aquí se revisan las tres ANTES de subir la plantilla.
//
// · Cliente: el número interno viene del catálogo del cliente; el agente NO lo
//   inventa. Si falta → `revisar` (una persona lo resuelve).
// · Caja: `caja_numero` en el documento y, si el TMS la expone, existente allá.
// · Reque: `consultarReque` del puerto. `no_existe` → `pendiente_reque`; si no se
//   puede saber → `desconocido` y manda la política `siTmsDesconocido`.
// · Prerrequerimiento: NO se puede detectar desde Likida; se traduce a caja + reque
//   (la prueba con el cliente queda en el runbook, T-A3-41).
//
// Función casi pura: solo habla con el puerto, con timeout; un lanzamiento o un
// valor raro del puerto es `desconocido`, jamás una excepción. Nunca consulta sin
// `tenantId`. Sin datos reales: opera sobre la extracción y el puerto.
// ═══════════════════════════════════════════════════════════════════════════

import type { Extraccion } from './campos';
import type { ConsultaExistencia, Existencia, SalidaTms } from './tms_puerto';

export type EstadoCausa = 'ok' | 'falta' | 'desconocido';
export interface ResultadoCausa { estado: EstadoCausa; detalle: string }
export type AccionPrechequeo = 'enviar' | 'pendiente_reque' | 'revisar';

export interface ResultadoPrechequeo {
  cliente: ResultadoCausa;
  caja: ResultadoCausa;
  reque: ResultadoCausa;
  accion: AccionPrechequeo;
  /** Por qué no se envía (null si `accion` es `enviar`). */
  motivo: string | null;
}

export interface ContextoPrechequeo {
  tenantId: string;
  /** Puerto del TMS; sin él (o sin sus consultas opcionales) las causas quedan `desconocido`. */
  salida?: SalidaTms;
  /** `cp_salida_config.si_tms_desconocido`. Por omisión `retener` (lo prudente). */
  siTmsDesconocido?: 'retener' | 'enviar';
  /** Número interno ya resuelto del catálogo; si falta se lee `numero_cliente_interno` de la extracción. */
  clienteInterno?: string | null;
  timeoutMs?: number;
}

export const TIMEOUT_PRECHEQUEO_MS = 5000;

const texto = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

async function consultar(
  fn: ((e: ConsultaExistencia) => Promise<Existencia>) | undefined, e: ConsultaExistencia, timeoutMs: number,
): Promise<Existencia> {
  if (!fn) return 'desconocido';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      fn(e),
      new Promise<'desconocido'>((resolve) => { timer = setTimeout(() => resolve('desconocido'), timeoutMs); }),
    ]);
    return r === 'existe' || r === 'no_existe' ? r : 'desconocido';
  } catch {
    return 'desconocido';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function prechequear(doc: Extraccion, ctx: ContextoPrechequeo): Promise<ResultadoPrechequeo> {
  const timeoutMs = ctx.timeoutMs ?? TIMEOUT_PRECHEQUEO_MS;
  const politica = ctx.siTmsDesconocido ?? 'retener';
  const tenantId = texto(ctx.tenantId);
  const clienteInterno = texto(ctx.clienteInterno) ?? texto(doc.campos.numero_cliente_interno?.valor);
  const caja = texto(doc.campos.caja_numero?.valor);
  const folio = texto(doc.campos.folio_cliente?.valor);

  const cliente: ResultadoCausa = clienteInterno
    ? { estado: 'ok', detalle: 'El número de cliente interno está resuelto.' }
    : { estado: 'falta', detalle: 'Falta el número de cliente interno: no está en el catálogo del cliente y el agente no lo inventa.' };

  const sinConsulta = (detalle: string): ResultadoCausa => ({ estado: 'desconocido', detalle });
  let cajaR: ResultadoCausa;
  let reque: ResultadoCausa;

  if (tenantId === null) {
    // Guardia: sin tenant no se consulta nada.
    cajaR = caja ? sinConsulta('No se consultó el TMS: falta el identificador de la flota.') : { estado: 'falta', detalle: 'El documento no trae número de caja.' };
    reque = sinConsulta('No se consultó el TMS: falta el identificador de la flota.');
    return { cliente, caja: cajaR, reque, accion: 'revisar', motivo: 'Falta el identificador de la flota; no se puede consultar el TMS.' };
  }

  // Caja y reque se consultan en paralelo: el tope total es un solo timeout.
  const consulta = clienteInterno === null ? null : { tenantId, clienteInterno, caja, folio };
  const [rCaja, rReque] = await Promise.all([
    caja !== null && consulta ? consultar(ctx.salida?.consultarCaja?.bind(ctx.salida), consulta, timeoutMs) : Promise.resolve<Existencia>('desconocido'),
    consulta ? consultar(ctx.salida?.consultarReque?.bind(ctx.salida), consulta, timeoutMs) : Promise.resolve<Existencia>('desconocido'),
  ]);

  if (caja === null) cajaR = { estado: 'falta', detalle: 'El documento no trae número de caja.' };
  else if (clienteInterno === null) cajaR = sinConsulta('La caja viene en el documento; no se consultó el TMS porque falta el cliente.');
  else cajaR = rCaja === 'existe' ? { estado: 'ok', detalle: 'La caja existe en el TMS.' }
    : rCaja === 'no_existe' ? { estado: 'falta', detalle: 'La caja no existe en el TMS.' }
      : sinConsulta('La caja viene en el documento; no se pudo verificar en el TMS.');

  if (clienteInterno === null) reque = sinConsulta('No se consultó el requerimiento: falta el número de cliente interno.');
  else reque = rReque === 'existe' ? { estado: 'ok', detalle: 'El requerimiento existe en el TMS.' }
    : rReque === 'no_existe' ? { estado: 'falta', detalle: 'El requerimiento no existe en el TMS.' }
      : sinConsulta('No se pudo verificar el requerimiento.');

  // Cliente o caja malos los arregla una persona; sin reque se espera a que exista.
  if (cliente.estado === 'falta') return { cliente, caja: cajaR, reque, accion: 'revisar', motivo: cliente.detalle };
  if (cajaR.estado === 'falta') return { cliente, caja: cajaR, reque, accion: 'revisar', motivo: cajaR.detalle };
  if (reque.estado === 'falta') return { cliente, caja: cajaR, reque, accion: 'pendiente_reque', motivo: reque.detalle };
  if (reque.estado === 'desconocido' && politica === 'retener') {
    return { cliente, caja: cajaR, reque, accion: 'pendiente_reque', motivo: 'No se pudo verificar el requerimiento.' };
  }
  return { cliente, caja: cajaR, reque, accion: 'enviar', motivo: null };
}
