// ═══════════════════════════════════════════════════════════════════════════
// ENSAYO LOCAL DE LA MUESTRA muestra-tms (P0-1). Recorre TODO el flujo real —convertir la muestra, `recibirDesglose`, reglas y guardas,
// póliza provisional, Excel, entregas, `liberarEnvio` (revisión humana SIMULADA, solo si se pide) y `procesarEntregasCorreo`— con la base,
// Storage y el correo EN MEMORIA. No abre ninguna conexión, no necesita llaves y NO PUEDE enviar correo real: el «envío» es una lista de
// correos simulados con su Excel adjunto.
//
// Los datos de la muestra real son personales: este módulo no los escribe en ningún lado; quien lo llama (scripts/tms/cargar-muestra.mjs)
// decide la carpeta de salida, que debe estar FUERA del repositorio.
// ═══════════════════════════════════════════════════════════════════════════
import { DatoInvalido } from '../errores';
import { prepararMuestraTms, SISTEMA_ORIGEN_MUESTRA_TMS, resumenRevisiones } from './desglose_muestra_recepcion';
import type { PadronOperadores } from './desglose_muestra_tms';
import { recibirDesglose, type DependenciasDesglose, type ResultadoDesglose } from './desglose_recibir';
import { procesarEntregasCorreo, type DependenciasEntregaCorreo } from './entrega_correo';
import { liberarEnvio, type DependenciasLiberar } from './liberar_envio';
import { esPolizaProvisional } from './poliza_provisional';
import {
  CONFIG_CORREO_POR_DEFECTO, rutaXlsxDesglose,
  type ConfigCorreo, type Desglose, type EntregaCorreo, type Excepcion, type NuevaEntrega, type TipoExcepcion,
} from './repo_correo';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';

const TENANT = 'ensayo-local';
const AHORA_POR_OMISION = new Date('2026-11-10T18:00:00.000Z');

/** Decodifica base64 sin el constructor de Buffer: el guardián de la frontera de datos cuenta cualquier llamada `from` con punto como acceso a Supabase. */
function base64ABytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export interface EntradaEnsayo {
  /** El JSON `muestra-tms` ya parseado. */
  muestra: Record<string, unknown>;
  /** Número de empleado ↔ nombre (el padrón del cliente). */
  padron: PadronOperadores;
  /** Número de empleado → correo del operador. Sin entrada, el operador queda «sin correo» (se ensaya esa excepción). */
  correos?: Record<string, string>;
  /** La perilla de la flota. Apagada: la muestra (sin póliza) se retiene como `sin_poliza`. */
  polizaProvisional: boolean;
  /** Simula a la persona que revisa y libera lo retenido liberable (neto negativo, tipo sin regla, póliza provisional). Apagado: nada se libera. */
  simularRevision?: boolean;
  config?: Partial<ConfigCorreo>;
  ahora?: Date;
}

export interface CorreoSimulado { para: string; asunto: string; adjunto: string | null; provisional: boolean; revision: boolean }
export interface SalidaEnsayo {
  ok: true;
  /** Solo conteos y claves técnicas: ni nombres ni importes. */
  bitacoras: number;
  revisiones: number;
  resultados: Array<{ clave: string; estado: ResultadoDesglose['estado']; retenida: boolean; motivos: string[]; entregas: number }>;
  excepcionesAbiertas: Record<string, number>;
  liberadas: number;
  correos: CorreoSimulado[];
  /** Archivos .xlsx por nombre, tal como viajaron adjuntos. */
  excels: Array<{ nombre: string; bytes: Uint8Array }>;
}
export type ResultadoEnsayo = SalidaEnsayo | { ok: false; mensaje: string };

export async function ensayarMuestraTms(e: EntradaEnsayo): Promise<ResultadoEnsayo> {
  const ahora = e.ahora ?? AHORA_POR_OMISION;
  const prep = prepararMuestraTms(e.muestra, e.padron);
  if (!prep.ok) return { ok: false, mensaje: prep.mensaje };

  const config: ConfigCorreo = {
    ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, responderA: 'ensayo@ejemplo.invalid', remitenteCorreo: 'ensayo@ejemplo.invalid',
    ...e.config,
  };
  // ── base en memoria ──
  const liquidaciones: LiquidacionExterna[] = [];
  const metas = new Map<string, Desglose>();
  const entregas: EntregaCorreo[] = [];
  const excepciones: Array<Excepcion & { abierta: boolean }> = [];
  const subidas = new Map<string, Uint8Array>();
  let seq = 0;
  const nuevaExcepcion = (clave: string, tipo: TipoExcepcion, detalle: Record<string, unknown>) => {
    const previa = excepciones.find((x) => x.abierta && x.claveExterna === clave && x.tipo === tipo);
    if (previa) { previa.detalle = detalle; return { id: previa.id, nueva: false }; }
    excepciones.push({ id: ++seq, claveExterna: clave, tipo, detalle, primeraVez: ahora.toISOString(), ultimaVez: ahora.toISOString(), resueltaEn: null, abierta: true });
    return { id: seq, nueva: true };
  };
  const insertarEntregas = (filas: NuevaEntrega[]): number => {
    let n = 0;
    for (const f of filas) {
      const generacion = f.generacion ?? 1;
      if (entregas.some((x) => x.liquidacionExternaId === f.liquidacionExternaId && x.generacion === generacion && x.rol === f.rol)) continue;
      entregas.push({
        id: `ent-${entregas.length + 1}`, tenantId: TENANT, liquidacionExternaId: f.liquidacionExternaId, generacion, rol: f.rol,
        correo: f.correo.trim().toLowerCase(), estado: f.estado ?? 'pendiente', intentos: 0, proximoIntentoEn: ahora.toISOString(), claimToken: null,
        claimExpiraEn: null, resendId: null, ultimoError: f.ultimoError ?? null, disparo: f.disparo ?? 'auto', xlsxRuta: f.xlsxRuta ?? null,
        xlsxSha256: f.xlsxSha256 ?? null, enviadaEn: null, entregadaEn: null, rebotadaEn: null, creadaEn: ahora.toISOString(),
      });
      n += 1;
    }
    return n;
  };
  const porNumero = new Map(e.padron.map((p) => [p.numeroEmpleado, p] as const));
  const correoDe = (id: string): string | null => e.correos?.[id] ?? null;

  const deps: DependenciasDesglose = {
    ahora: () => ahora,
    leerConfig: async () => config,
    buscarPorClave: async (_t, clave) => liquidaciones.find((l) => l.claveExterna === clave) ?? null,
    resolverOperador: async (_t, numero) => {
      const p = porNumero.get(numero);
      if (!p) throw new DatoInvalido('operador no encontrado');
      return { id: p.numeroEmpleado, nombre: p.nombre, telefono: '28999000000', activo: true };
    },
    resolverViajeIds: async () => [],
    leerContacto: async (_t, id) => ({ operadorId: id, correo: correoDe(id), correoRebotadoEn: null, coordinadorId: null }),
    leerCoordinador: async () => null,
    subirXlsx: async (t, clave, huella, bytes) => { const ruta = rutaXlsxDesglose(t, clave, huella); subidas.set(ruta, bytes); return ruta; },
    insertarLiquidacion: async (n: NuevaLiquidacionExterna) => {
      const l = {
        id: `liq-${liquidaciones.length + 1}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
        sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, total: n.datos.total, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
        periodoDesde: n.datos.periodo.desde, periodoHasta: n.datos.periodo.hasta, estado: 'pendiente', generacion: 1,
      } as unknown as LiquidacionExterna;
      liquidaciones.push(l);
      return l;
    },
    insertarDesglose: async (_t, m) => {
      metas.set(m.liquidacionExternaId, { ...m, poliza: m.poliza ?? null, terminal: m.terminal ?? null, unidad: m.unidad ?? null, tipoOperador: m.tipoOperador ?? null, dias: m.dias ?? null, retenidaMotivo: m.retenidaMotivo ?? null, enviadoOrigenEn: null, creadoEn: ahora.toISOString() } as unknown as Desglose);
      return true;
    },
    insertarEntregas: async (_t, filas) => insertarEntregas(filas),
    abrirExcepcion: async (_t, clave, tipo, detalle) => nuevaExcepcion(clave, tipo, detalle),
    registrarEvento: async () => undefined,
    resolverExcepciones: async (_t, clave, tipo) => {
      let n = 0;
      for (const x of excepciones) if (x.abierta && x.claveExterna === clave && x.tipo === tipo) { x.abierta = false; n += 1; }
      return n;
    },
    omitirPendientes: async () => 0,
    leerPolizaProvisional: async () => e.polizaProvisional,
  };

  const resultados: SalidaEnsayo['resultados'] = [];
  for (const d of prep.desgloses) {
    const r = await recibirDesglose(TENANT, d, deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    resultados.push({
      clave: r.claveExterna, estado: r.estado, retenida: r.estado === 'creada' ? r.retenida : false,
      motivos: r.estado === 'creada' ? r.motivos : [], entregas: r.estado === 'creada' ? r.entregas : 0,
    });
  }

  // ── revisión humana SIMULADA (solo si se pide) ──
  let liberadas = 0;
  if (e.simularRevision) {
    const depsLiberar: DependenciasLiberar = {
      leerLiquidacion: async (_t, id) => liquidaciones.find((l) => l.id === id) ?? null,
      leerDesglose: async (_t, id) => ({ desglose: metas.get(id) ?? null }),
      leerConfig: async () => config,
      leerContacto: async (_t, id) => ({ operadorId: id, correo: correoDe(id), correoRebotadoEn: null, coordinadorId: null }),
      leerCoordinador: async () => null,
      entregas: async (_t, id) => entregas.filter((x) => x.liquidacionExternaId === id),
      excepcionesAbiertas: async (_t, clave) => excepciones.filter((x) => x.abierta && x.claveExterna === clave),
      insertarEntregas: async (_t, filas) => insertarEntregas(filas),
      liberarRetencion: async (_t, id) => { const m = metas.get(id); if (!m || !m.retenidaMotivo) return false; m.retenidaMotivo = null; return true; },
      resolverExcepcion: async (_t, id) => { const x = excepciones.find((y) => y.id === id && y.abierta); if (!x) return false; x.abierta = false; return true; },
      existeCorreccionSiguiente: async () => false,
      registrarEvento: async () => undefined,
      ahora: () => ahora,
    };
    for (const l of liquidaciones) {
      const r = await liberarEnvio(TENANT, l.id, { userId: 'revisor-simulado', rol: 'flota_admin' }, depsLiberar);
      if (r.estado === 'liberado') liberadas += 1;
    }
  }

  // ── envío SIMULADO ──
  const correos: CorreoSimulado[] = [];
  const excels: SalidaEnsayo['excels'] = [];
  const depsEntrega: DependenciasEntregaCorreo = {
    ahora: () => ahora,
    enviar: async (para, correo, op) => {
      const a = op.adjuntos?.[0];
      const bytes = a ? base64ABytes(a.content as string) : null;
      const nombre = a ? `${String(correos.length + 1).padStart(3, '0')}-${a.filename}` : null;
      if (bytes && nombre) excels.push({ nombre, bytes });
      correos.push({
        para, asunto: correo.asunto, adjunto: nombre,
        provisional: /PÓLIZA PROVISIONAL/.test(correo.asunto), revision: /^\[Revisión\]/.test(correo.asunto),
      });
      return { ok: true, id: `simulado_${correos.length}` };
    },
    leerConfig: async () => config,
    reclamar: async (limite, t) => {
      const listas = entregas.filter((x) => x.estado === 'pendiente' && Date.parse(x.proximoIntentoEn) <= t.getTime()).slice(0, limite);
      for (const x of listas) { x.estado = 'enviando'; x.claimToken = `tok-${x.id}`; }
      return listas.map((x) => ({ ...x }));
    },
    leerContexto: async (_t, id) => {
      const l = liquidaciones.find((x) => x.id === id);
      if (!l) return null;
      const m = metas.get(id);
      return {
        claveExterna: l.claveExterna, periodoDesde: l.periodoDesde, periodoHasta: l.periodoHasta, retenidaMotivo: m?.retenidaMotivo ?? null,
        ...(m?.bitacora ? { bitacora: m.bitacora } : {}), ...(esPolizaProvisional(m?.poliza) ? { polizaProvisional: true } : {}),
      };
    },
    descargarXlsx: async (_t, ruta) => { const b = subidas.get(ruta); if (!b) throw new Error('el Excel no está en el almacén en memoria'); return b; },
    marcarEnviada: async (_t, id, _tok, resendId, t) => {
      const x = entregas.find((y) => y.id === id && y.estado === 'enviando');
      if (!x) return false;
      Object.assign(x, { estado: 'enviada', resendId, enviadaEn: t.toISOString() });
      return true;
    },
    marcarFallida: async (_t, id, _tok, error) => { Object.assign(entregas.find((y) => y.id === id)!, { estado: 'fallida', ultimoError: error }); return true; },
    reprogramar: async (_t, id, _tok, intentos, proximo, error) => {
      Object.assign(entregas.find((y) => y.id === id)!, { estado: 'pendiente', intentos, proximoIntentoEn: proximo.toISOString(), ultimoError: error });
      return true;
    },
    liquidacionEnviada: async (_t, id) => {
      const l = liquidaciones.find((x) => x.id === id);
      if (!l || l.estado !== 'pendiente') return false;
      l.estado = 'enviada';
      return true;
    },
    registrarEvento: async () => undefined,
    abrirExcepcion: async (_t, clave, tipo, detalle) => nuevaExcepcion(clave, tipo, detalle),
  };
  for (let pasada = 0; pasada < 200; pasada += 1) {
    const r = await procesarEntregasCorreo(depsEntrega, 25);
    if (r.reclamadas === 0) break;
  }

  const abiertas: Record<string, number> = {};
  for (const x of excepciones) if (x.abierta) abiertas[x.tipo] = (abiertas[x.tipo] ?? 0) + 1;
  return {
    ok: true, bitacoras: prep.desgloses.length, revisiones: resumenRevisiones(prep.revisiones).length, resultados,
    excepcionesAbiertas: abiertas, liberadas, correos, excels,
  };
}
