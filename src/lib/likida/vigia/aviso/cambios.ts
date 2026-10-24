// Reenvío si cambia, y casos de borde: operador que se niega, cancelación (T-A4-18).
//
// 747a3730 02:40: «todavía me los pueden cambiar por diversas situaciones, porque el operador se negó a viaje y ya somos
// menos». Un aviso ya dado puede quedar viejo. Esta pasada revisa los avisos recientes y decide, fila por fila:
//
//  - CAMBIÓ lo que el cliente ve (caja, placas, unidad, operador…) → otra VERSIÓN (+1) con las líneas «cambió la unidad:
//    U-101 → U-205». El «antes» es lo último que el cliente RECIBIÓ (la versión enviada); si nunca salió nada, la versión
//    nueva es el aviso completo y la anterior queda `reemplazado`. La versión `enviado` no se toca jamás (historia).
//  - ANTI-RUIDO: se espera a que el programa se calme (`debounce_min` desde el último cambio relevante), hay un máximo de
//    reenvíos por fila (`max_reenvios`; lo que pasa de ahí NO se envía y deja una alerta interna «cambia demasiado») y no
//    se reenvía lo que no cambia nada visible (COMENTARIOS, color/estatus, un valor que volvió a lo que ya se avisó).
//  - SE CANCELA (la fila pasa a CANCELACIONES, deja de venir en el programa o ya no existe) tras haber avisado → NO sale
//    nada solo: queda un BORRADOR «Se canceló el servicio…» en `pendiente_confirmacion`, canal `ejecutivo_copia`, que un
//    humano confirma. Si el aviso nunca salió, simplemente se descarta lo pendiente.
//
// GUARDIAS: nada sale a un cliente aquí (solo se crean/cierran filas de la bandeja); el modo `confirmar` nunca aprueba
// (mismo `estadoSegunModo` que la generación); el borrador de cancelación y las alertas internas JAMÁS nacen `aprobado`
// ni en canal de cliente. La alerta interna nace `sin_destinatario` y sin cliente: la bandeja la muestra, el envío no la
// toma (solo envía `aprobado`, y de `sin_destinatario` no se llega a `aprobado` sin pasar por la confirmación humana).
//
// B1 (define si el cambio de color/estatus también cuenta): hoy NO cuenta; sí cuentan caja, unidad, operador y placas.
// El cambio de CITA no tiene renglón en el texto del aviso (el compositor no lo trae): no genera reenvío; ver notas.
// Sin logs: nada del programa ni de los avisos sale a ningún registro.

import { createHash } from 'node:crypto';
import { MAX_TEXTO_AL_CLIENTE } from '../enviar';
import { acotada } from '../../presupuesto';
import { IDS_POR_TANDA } from '../../pg';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { componerAviso, type CambioAviso } from './compositor';
import {
  TOPE_FILAS_POR_PASADA, estadoSegunModo, evaluarTiempo, fechaLocal, valoresDeAviso, type DepsGenerar,
} from './generar';
import { CAMPOS_AVISO, CAMPOS_SENSIBLES, camposVisibles, filtrarOperador, type CampoAviso } from './privacidad';
import { AvisoSinMigrar, type EstadoAviso, type FilaDelPrograma, type CanalAviso } from './repo';
import { resolverFila } from './resolver';

/** Cuánto atrás se buscan avisos para revisar (días). La ventana de generación es de 48 h. */
export const DIAS_REVISION = 7;
export const TOPE_AVISOS_LEIDOS = 2_000;
/** Campos de `programa_despacho_cambio` que cuentan como cambio del viaje (los que pide el cliente). */
export const CAMPOS_RELEVANTES: readonly string[] = ['caja', 'unidad', 'cita_en', 'cita_texto'];

export type TipoAvisoRegistro = 'inicial' | 'actualizacion' | 'cancelacion' | 'alerta_cambia_demasiado';
type Valores = Partial<Record<CampoAviso, string | null>>;

/** Estados en los que un aviso todavía no salió y puede cerrarse por una versión posterior. */
const SIN_ENVIAR: readonly EstadoAviso[] = ['borrador', 'pendiente_confirmacion', 'aprobado', 'fallido'];

// ── Puertos ─────────────────────────────────────────────────────────────────

export interface AvisoRegistro {
  id: string;
  filaId: string;
  clienteId: string | null;
  version: number;
  estado: EstadoAviso;
  canal: CanalAviso;
  texto: string;
  huella: string;
  datos: Record<string, unknown>;
  creadoEn: string;
}

export interface FilaActual extends FilaDelPrograma {
  visible: boolean;
}

export interface CambioRegistro {
  filaId: string;
  campo: string;
  antes: string | null;
  despues: string | null;
  en: string;
}

export interface ParametrosReenvio {
  maxReenvios: number;
  debounceMin: number;
}

export interface RepoCambios {
  /** `null` = la flota no tiene fila de configuración. */
  parametros(tenantId: string): Promise<ParametrosReenvio | null>;
  /** Avisos (cualquier versión y estado) creados desde `desdeIso`. */
  avisosRecientes(tenantId: string, desdeIso: string, limite: number): Promise<AvisoRegistro[]>;
  /** Estado actual de esas filas del programa (visibles o no). Las que ya no existen no vienen. */
  filasPorIds(tenantId: string, ids: string[]): Promise<FilaActual[]>;
  cambiosDeFilas(tenantId: string, filaIds: string[], desdeIso: string): Promise<CambioRegistro[]>;
  /**
   * Cierra un aviso que NO salió. Condicional al estado que se leyó: `false` = ya cambió (otra pasada o un humano).
   * Un aviso `enviado` no se puede cerrar por aquí (el tipo de `hacia` y el trigger de la 0797 lo impiden).
   */
  cambiarEstado(
    tenantId: string, avisoId: string, desde: EstadoAviso, hacia: 'reemplazado' | 'descartado', motivo: string,
  ): Promise<boolean>;
}

export interface DepsCambios extends DepsGenerar {
  cambios: RepoCambios;
}

export interface AlertaInterna {
  tipo: 'cambia_demasiado' | 'cancelacion';
  filaId: string;
}

export interface ResultadoCambios {
  estado: 'ok' | 'apagado' | 'sin_migrar';
  /** Filas con avisos que se revisaron. */
  revisadas: number;
  /** Nada visible distinto de lo último avisado. */
  sinCambio: number;
  /** Hubo cambios en el programa pero ninguno afecta lo que el cliente ve (COMENTARIOS, color, un valor que volvió). */
  ignoradas: number;
  /** El programa todavía se está moviendo (debounce). */
  esperando: number;
  /** Versiones nuevas creadas. */
  reenvios: number;
  /** Versiones anteriores sin enviar que se cerraron por la nueva. */
  reemplazados: number;
  /** Pendientes cerrados porque el valor volvió a lo que el cliente ya tenía. */
  revertidos: number;
  /** Cambios que no se enviaron por pasar de `max_reenvios`. */
  excedidos: number;
  /** Borradores «Se canceló el servicio…» creados. */
  cancelaciones: number;
  /** Pendientes descartados porque el servicio se canceló antes de avisar. */
  descartadosPorCancelacion: number;
  /** Versiones creadas con datos por confirmar (p. ej. unidad sin placas registradas). */
  incompletas: number;
  /** Sin destinatario resuelto en el reenvío. */
  sinDestinatario: number;
  /** El viaje ya pasó: no se actualiza. */
  pasadas: number;
  /** Avisos sin la base de comparación (`datos.valores`): no se tocan. */
  sinBase: number;
  /** Otra pasada ganó la misma versión o el mismo contenido. */
  duplicados: number;
  /** El estado cambió entre leer y cerrar. */
  carreras: number;
  omitidas: number;
  acotada: boolean;
  alertas: AlertaInterna[];
}

function vacio(estado: ResultadoCambios['estado']): ResultadoCambios {
  return {
    estado, revisadas: 0, sinCambio: 0, ignoradas: 0, esperando: 0, reenvios: 0, reemplazados: 0, revertidos: 0,
    excedidos: 0, cancelaciones: 0, descartadosPorCancelacion: 0, incompletas: 0, sinDestinatario: 0, pasadas: 0,
    sinBase: 0, duplicados: 0, carreras: 0, omitidas: 0, acotada: false, alertas: [],
  };
}

// ── Utilidades puras ────────────────────────────────────────────────────────

function tipoDe(a: AvisoRegistro): TipoAvisoRegistro | null {
  const t = a.datos.tipo;
  return t === 'cancelacion' || t === 'alerta_cambia_demasiado' || t === 'actualizacion' || t === 'inicial' ? t : null;
}

/** Versiones que le llegan (o le llegarían) al cliente: el aviso inicial y sus actualizaciones. */
function paraCliente(a: AvisoRegistro): boolean {
  const t = tipoDe(a);
  return t === null || t === 'inicial' || t === 'actualizacion';
}

function leerValores(datos: Record<string, unknown>): Valores | null {
  const v = datos.valores;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Valores = {};
  for (const c of CAMPOS_AVISO) {
    const x = (v as Record<string, unknown>)[c];
    if (typeof x === 'string') out[c] = x;
    else if (x === null) out[c] = null;
  }
  return out;
}

function diferencias(antes: Valores, despues: Valores, visibles: ReadonlySet<CampoAviso>): CambioAviso[] {
  const out: CambioAviso[] = [];
  for (const campo of CAMPOS_AVISO) {
    if (!visibles.has(campo) || CAMPOS_SENSIBLES.includes(campo)) continue;
    const a = antes[campo] ?? null;
    const d = despues[campo] ?? null;
    if (a !== d) out.push({ campo, antes: a, despues: d });
  }
  return out;
}

const sha = (s: string): string => createHash('sha256').update(s.normalize('NFC')).digest('hex');
const recorta = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function textoCancelacion(base: Valores | null): string {
  const caja = base?.caja?.trim();
  const unidad = base?.unidad?.trim();
  const con = [caja ? `caja ${caja}` : null, unidad ? `unidad ${unidad}` : null].filter(Boolean).join(' y ');
  return recorta(con ? `Se canceló el servicio programado con ${con}.` : 'Se canceló el servicio programado.', MAX_TEXTO_AL_CLIENTE);
}

function refFila(base: Valores | null): string {
  const partes = [base?.caja ? `caja ${base.caja}` : null, base?.unidad ? `unidad ${base.unidad}` : null].filter(Boolean);
  return partes.length > 0 ? partes.join(', ') : 'sin caja ni unidad';
}

// ── La pasada ───────────────────────────────────────────────────────────────

export async function procesarCambios(tenantId: string, ahora: Date, deps: DepsCambios): Promise<ResultadoCambios> {
  if (deps.resolver.tenantId !== tenantId) {
    throw new Error('procesarCambios: el resolver pertenece a otra flota');
  }

  let config;
  let params: ParametrosReenvio | null;
  try {
    config = await deps.repo.leerConfig(tenantId);
    if (!config || !config.habilitado) return vacio('apagado');
    params = await deps.cambios.parametros(tenantId);
  } catch (e) {
    if (e instanceof AvisoSinMigrar) return vacio('sin_migrar');
    throw e;
  }
  if (!params) return vacio('apagado');

  const r = vacio('ok');
  const desdeIso = new Date(ahora.getTime() - DIAS_REVISION * 86_400_000).toISOString();
  const todos = await deps.cambios.avisosRecientes(tenantId, desdeIso, TOPE_AVISOS_LEIDOS);
  if (todos.length >= TOPE_AVISOS_LEIDOS) r.acotada = true;

  const porFila = new Map<string, AvisoRegistro[]>();
  for (const a of todos) {
    const g = porFila.get(a.filaId);
    if (g) g.push(a); else porFila.set(a.filaId, [a]);
  }
  for (const g of porFila.values()) g.sort((x, y) => x.version - y.version);

  const ids = [...porFila.keys()];
  if (ids.length === 0) return r;
  const filas = new Map((await deps.cambios.filasPorIds(tenantId, ids)).map((f) => [f.id, f]));
  const cambiosPorFila = new Map<string, CambioRegistro[]>();
  for (const c of await deps.cambios.cambiosDeFilas(tenantId, ids, desdeIso)) {
    const g = cambiosPorFila.get(c.filaId);
    if (g) g.push(c); else cambiosPorFila.set(c.filaId, [c]);
  }

  const hoy = fechaLocal(ahora, config.zona);
  let trabajadas = 0;

  for (const [filaId, grupo] of porFila) {
    const versiones = grupo.filter(paraCliente);
    const vigente = versiones[versiones.length - 1];
    // Sin versión para el cliente, o una que ya no está viva (descartada, sin destinatario, reemplazada): no hay qué actualizar.
    if (!vigente || !(['enviado', ...SIN_ENVIAR] as EstadoAviso[]).includes(vigente.estado)) continue;
    r.revisadas++;

    const fila = filas.get(filaId) ?? null;
    const citaIso = fila ? fila.citaEn : (typeof vigente.datos.cita === 'string' ? vigente.datos.cita : null);
    if ((fila && fila.fecha < hoy) || evaluarTiempo(citaIso, null, ahora) === 'cita_pasada') { r.pasadas++; continue; }

    const enviadas = versiones.filter((a) => a.estado === 'enviado');
    const baseEnviada = enviadas[enviadas.length - 1] ?? null;
    const sinEnviar = versiones.filter((a) => SIN_ENVIAR.includes(a.estado));
    const siguienteVersion = grupo[grupo.length - 1].version + 1;

    // ── Se cancela / desaparece ───────────────────────────────────────────
    if (!fila || !fila.visible || fila.tipo === 'CANCELACIONES') {
      if (trabajadas >= TOPE_FILAS_POR_PASADA) { r.omitidas++; r.acotada = true; continue; }
      trabajadas++;
      for (const a of sinEnviar) {
        if (await deps.cambios.cambiarEstado(tenantId, a.id, a.estado, 'descartado', 'el servicio se canceló o ya no viene en el programa')) {
          r.descartadosPorCancelacion++;
        } else r.carreras++;
      }
      if (!baseEnviada || grupo.some((a) => tipoDe(a) === 'cancelacion')) continue;
      const res = await deps.repo.insertarAviso(tenantId, {
        filaId, clienteId: vigente.clienteId, version: siguienteVersion,
        huella: sha(`cancelacion|${filaId}|${siguienteVersion}|${textoCancelacion(leerValores(baseEnviada.datos))}`),
        // Nunca aprobado, nunca canal de cliente: lo confirma y lo manda una persona.
        estado: 'pendiente_confirmacion', canal: 'ejecutivo_copia',
        texto: textoCancelacion(leerValores(baseEnviada.datos)),
        datos: { via: 'proxy', tipo: 'cancelacion', baseVersion: baseEnviada.version, requiere_humano: true },
        motivo: 'cancelación tras avisar: confirmar a mano antes de avisar al cliente',
      });
      if (res === 'duplicado') { r.duplicados++; continue; }
      r.cancelaciones++;
      r.alertas.push({ tipo: 'cancelacion', filaId });
      continue;
    }

    // ── Cambió lo que el cliente ve ───────────────────────────────────────
    const valoresVigente = leerValores(vigente.datos);
    if (!valoresVigente) { r.sinBase++; continue; }
    if (trabajadas >= TOPE_FILAS_POR_PASADA) { r.omitidas++; r.acotada = true; continue; }
    trabajadas++;

    const resuelto = await resolverFila(
      { cliente: fila.cliente, consignatario: fila.consignatario, caja: fila.caja, unidad: fila.unidad, filaId: fila.id, fecha: fila.fecha },
      deps.resolver,
    );
    const visibles = camposVisibles(deps.politica, resuelto.clienteId);
    const operador = filtrarOperador(resuelto.operador, visibles);
    const valores = valoresDeAviso(fila, resuelto, operador, visibles);

    const respectoDelUltimo = diferencias(valoresVigente, valores, visibles);
    const delPrograma = (cambiosPorFila.get(filaId) ?? []).filter((c) => Date.parse(c.en) > Date.parse(vigente.creadoEn));
    const relevantes = delPrograma.filter((c) => CAMPOS_RELEVANTES.includes(c.campo));

    if (respectoDelUltimo.length === 0) {
      if (delPrograma.length > 0) r.ignoradas++; else r.sinCambio++;
      continue;
    }

    // Anti-ruido 1: esperar a que el programa se calme.
    const ultimo = relevantes.reduce((m, c) => Math.max(m, Date.parse(c.en)), 0);
    if (ultimo > 0 && ahora.getTime() - ultimo < params.debounceMin * 60_000) { r.esperando++; continue; }

    // Lo que el cliente RECIBIÓ es la base del «antes»; si no ha recibido nada, el aviso nuevo va completo.
    const valoresRecibidos = baseEnviada ? leerValores(baseEnviada.datos) : null;
    if (baseEnviada && !valoresRecibidos) { r.sinBase++; continue; }
    const cambios = valoresRecibidos ? diferencias(valoresRecibidos, valores, visibles) : [];

    if (valoresRecibidos && cambios.length === 0) {
      // Volvió a lo que el cliente ya tiene: lo pendiente ya no hace falta.
      for (const a of sinEnviar) {
        if (await deps.cambios.cambiarEstado(tenantId, a.id, a.estado, 'descartado', 'el dato volvió a lo ya avisado')) r.revertidos++;
        else r.carreras++;
      }
      continue;
    }

    // Anti-ruido 2: tope de reenvíos por fila.
    if (versiones.length - 1 >= params.maxReenvios) {
      r.excedidos++;
      if (grupo.some((a) => tipoDe(a) === 'alerta_cambia_demasiado')) continue;
      const texto = recorta(
        `Alerta interna: el servicio (${refFila(valoresVigente)}) cambió más de ${params.maxReenvios} veces después del primer aviso. `
        + 'No se envió la última modificación; revísalo y avisa al cliente a mano.', 1000);
      const res = await deps.repo.insertarAviso(tenantId, {
        filaId, clienteId: null, version: siguienteVersion, huella: sha(`exceso|${filaId}|${siguienteVersion}`),
        estado: 'sin_destinatario', canal: 'ejecutivo_copia', texto,
        datos: { via: 'proxy', tipo: 'alerta_cambia_demasiado', interno: true, reenvios: versiones.length - 1 },
        motivo: 'alerta interna: cambia demasiado',
      });
      if (res === 'duplicado') { r.duplicados++; continue; }
      r.alertas.push({ tipo: 'cambia_demasiado', filaId });
      continue;
    }

    const c = componerAviso({
      fila: { caja: fila.caja, unidad: fila.unidad },
      resuelto: { unidad: resuelto.unidad, caja: resuelto.caja, operador },
      visibles, version: valoresRecibidos ? 2 : 1, cambios: valoresRecibidos ? cambios : undefined, config: deps.compositor,
    });
    const hayDestinatario = resuelto.estadoCliente === 'resuelto' && resuelto.clienteId !== null && resuelto.contacto !== null;
    const estado = await estadoSegunModo(tenantId, config, hayDestinatario, deps);
    const incompleto = c.pendientes.length > 0;
    const que = cambios.map((x) => x.campo).join(', ');
    const motivo = recorta(
      `${valoresRecibidos ? `reenvío por cambio (${que})` : 'aviso actualizado antes de salir'}${incompleto ? `; incompleto: falta ${c.pendientes.join(', ')}` : ''}`,
      200);

    const res = await deps.repo.insertarAviso(tenantId, {
      filaId, clienteId: resuelto.clienteId, version: siguienteVersion, huella: c.huella, estado, canal: config.canalDefault,
      texto: c.texto,
      datos: {
        via: 'proxy', tipo: 'actualizacion', baseVersion: baseEnviada?.version ?? null, seccion: fila.tipo, cita: fila.citaEn,
        valores, cambios: cambios.map((x) => ({ campo: x.campo, antes: x.antes, despues: x.despues })),
        campos: [...visibles].sort(), pendientes: c.pendientes, incompleto, faltantes: resuelto.faltantes,
      },
      motivo,
      aprobadoEn: estado === 'aprobado' ? ahora.toISOString() : null,
    });
    if (res === 'duplicado') { r.duplicados++; continue; }
    r.reenvios++;
    if (incompleto) r.incompletas++;
    if (estado === 'sin_destinatario') r.sinDestinatario++;
    // La versión nueva sustituye a lo que no salió; lo ENVIADO queda como historia.
    for (const a of sinEnviar) {
      if (await deps.cambios.cambiarEstado(tenantId, a.id, a.estado, 'reemplazado', `reemplazado por la versión ${siguienteVersion}`)) r.reemplazados++;
      else r.carreras++;
    }
  }
  return r;
}

// ── Acceso a datos ──────────────────────────────────────────────────────────

type ErrorBase = { message: string; code?: string } | null | undefined;
const SIN_MIGRAR = new Set(['42P01', 'PGRST205']);

function exigir(op: string, error: ErrorBase): void {
  if (!error) return;
  if (error.code && SIN_MIGRAR.has(error.code)) throw new AvisoSinMigrar();
  throw new Error(`aviso.cambios.${op}: ${error.message}`);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const COLS_AVISO = 'id, fila_id, cliente_id, version, estado, canal, texto, huella, datos, creado_en';
const COLS_FILA = 'id, fecha, tipo, cliente, consignatario, caja, unidad, cita_en, cita_texto, transito, ccp, visible';
const TOPE_CAMBIOS_LEIDOS = 5_000;

/**
 * Misma disciplina que `crearRepoAviso`: toda consulta lleva `tenant_id`, pasa por `acotada`, un error de la base LANZA,
 * sin `select *`, ids en tandas.
 */
export function crearRepoCambios(): RepoCambios {
  return {
    async parametros(tenantId) {
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso_config')
        .select('max_reenvios, debounce_min').eq('tenant_id', tenantId).maybeSingle(), 'aviso.cambios.parametros');
      exigir('parametros', error);
      if (!data) return null;
      const d = data as Record<string, unknown>;
      return {
        maxReenvios: typeof d.max_reenvios === 'number' ? d.max_reenvios : 3,
        debounceMin: typeof d.debounce_min === 'number' ? d.debounce_min : 10,
      };
    },

    async avisosRecientes(tenantId, desdeIso, limite) {
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .select(COLS_AVISO).eq('tenant_id', tenantId).gte('creado_en', desdeIso)
        .order('creado_en', { ascending: false }).range(0, limite - 1), 'aviso.cambios.avisos_recientes');
      exigir('avisos_recientes', error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), filaId: String(r.fila_id), clienteId: str(r.cliente_id), version: Number(r.version),
        estado: String(r.estado) as EstadoAviso, canal: r.canal === 'cliente_1a1' ? 'cliente_1a1' : 'ejecutivo_copia',
        texto: String(r.texto ?? ''), huella: String(r.huella ?? ''),
        datos: typeof r.datos === 'object' && r.datos !== null && !Array.isArray(r.datos) ? (r.datos as Record<string, unknown>) : {},
        creadoEn: String(r.creado_en),
      }));
    },

    async filasPorIds(tenantId, ids) {
      const out: FilaActual[] = [];
      for (let i = 0; i < ids.length; i += IDS_POR_TANDA) {
        const { data, error } = await acotada(supabaseAdmin().from('programa_despacho_fila')
          .select(COLS_FILA).eq('tenant_id', tenantId).in('id', ids.slice(i, i + IDS_POR_TANDA)), 'aviso.cambios.filas');
        exigir('filas', error);
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          out.push({
            id: String(r.id), fecha: String(r.fecha), tipo: String(r.tipo), cliente: str(r.cliente),
            consignatario: str(r.consignatario), caja: str(r.caja), unidad: str(r.unidad), citaEn: str(r.cita_en),
            citaTexto: str(r.cita_texto), transito: String(r.transito ?? 'vacio'), ccp: String(r.ccp ?? 'vacio'),
            visible: r.visible === true,
          });
        }
      }
      return out;
    },

    async cambiosDeFilas(tenantId, filaIds, desdeIso) {
      const out: CambioRegistro[] = [];
      for (let i = 0; i < filaIds.length; i += IDS_POR_TANDA) {
        const { data, error } = await acotada(supabaseAdmin().from('programa_despacho_cambio')
          .select('fila_id, campo, antes, despues, en').eq('tenant_id', tenantId)
          .in('fila_id', filaIds.slice(i, i + IDS_POR_TANDA)).gte('en', desdeIso)
          .order('en').range(0, TOPE_CAMBIOS_LEIDOS - 1), 'aviso.cambios.cambios');
        exigir('cambios', error);
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          out.push({ filaId: String(r.fila_id), campo: String(r.campo), antes: str(r.antes), despues: str(r.despues), en: String(r.en) });
        }
      }
      return out;
    },

    async cambiarEstado(tenantId, avisoId, desde, hacia, motivo) {
      // A37-S58-01: un aprobado con arriendo VIVO (reclamo_token + reclamo_expira_en futuro) ya lo lleva el cron a Meta;
      // cerrarlo ahora diría «no se enviará» cuando el mensaje sale igual. Solo se cierra sin arriendo o con arriendo vencido.
      let q = supabaseAdmin().from('vigia_aviso')
        .update({ estado: hacia, motivo: recorta(motivo, 200) })
        .eq('tenant_id', tenantId).eq('id', avisoId).eq('estado', desde);
      if (desde === 'aprobado') q = q.or(`reclamo_token.is.null,reclamo_expira_en.lte.${new Date().toISOString()}`);
      const { data, error } = await acotada(q.select('id'), 'aviso.cambios.cambiar_estado');
      exigir('cambiar_estado', error);
      return Array.isArray(data) && data.length > 0;
    },
  };
}
