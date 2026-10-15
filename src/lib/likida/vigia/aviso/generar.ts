// Generación de avisos desde el programa de despacho (T-A4-17).
//
// c90787e0 21:33: «si quedamos que un embarque sale hoy a las 10:00, mándame a las 7:00 la información del tractor
// asignado». Esta pasada recorre las filas visibles de hoy y de las próximas 48 h, decide cuáles están LISTAS
// (T-A4-13), las resuelve a cliente/unidad/caja/operador (T-A4-11), compone el texto (T-A4-14, con la política de
// privacidad de T-A4-12) y deja un `vigia_aviso` en la bandeja (0797).
//
// QUÉ NO HACE: no envía nada a nadie. Solo crea avisos. Sin fila de configuración o con `habilitado=false` la pasada
// no hace nada (falla cerrado). Sin destinatario resuelto el aviso queda `sin_destinatario`, visible, no se pierde.
//
// Reglas de tiempo (con `horas_antes_cita` = N y cita C):
//  - ahora < C − N h  → todavía no se genera (`muyTemprano`).
//  - ahora > C        → ya no se genera (`citaPasada`): avisar el equipo de un viaje que ya salió no sirve.
//  - cita sin hora («DIRECTO», o ausente) o N = null → se genera en cuanto la fila está lista.
//
// Idempotencia: una fila que ya tiene CUALQUIER aviso (incluido uno descartado o sin destinatario) no vuelve a generar
// aquí; el cambio de contenido es reenvío (T-A4-18). Si dos pasadas compiten, el único (flota, fila, huella) de la 0797
// hace ganar a la primera y la otra cuenta un `duplicado`, no un error.
//
// Acotada: a lo sumo `TOPE_FILAS_POR_PASADA` filas se procesan (resolver + componer + insertar) por pasada; las listas
// de más se cuentan en `omitidas` y `acotada=true` (la siguiente pasada las toma). El recorrido de lectura también
// tiene tope (`TOPE_FILAS_LEIDAS`) y se declara si lo alcanza.
// Logs: solo un resumen de contadores `vigia.aviso.generado` (T-A4-42). Nada del programa ni de los avisos (texto, cliente,
// operador, teléfono, placas) sale a ningún registro.

import { logger } from '@/lib/logger';
import { componerAviso, type ConfigCompositor } from './compositor';
import {
  evaluarListo, type ConfigListo, type FilaParaListo, type TipoSeccionAviso,
} from './listo';
import {
  CAMPOS_SENSIBLES, camposVisibles, filtrarOperador, type CampoAviso, type PoliticaPrivacidad,
} from './privacidad';
import {
  AvisoSinMigrar, PAGINA_FILAS, type ConfigAviso, type FilaDelPrograma, type NuevoAviso, type RepoAviso,
} from './repo';
import { resolverFila, type DepsResolver, type FilaResuelta, type OperadorResuelto } from './resolver';
import type { ContextoAutonomia } from './politica';
import type { Ccp, Transito } from '../programa/normalizar';

export const TOPE_FILAS_POR_PASADA = 200;
export const TOPE_FILAS_LEIDAS = 5_000;
export const VENTANA_HORAS = 48;

const CCP_VALIDOS: readonly Ccp[] = ['listo', 'despachado', 'pend_reque', 'pend_ccp', 'falta_complemento', 'vacio', 'desconocido'];
const TIPOS_VALIDOS: readonly TipoSeccionAviso[] = ['IMPORTACION', 'EXPORTACION', 'CANCELACIONES', 'DOMESTICO', 'MOV_VACIO'];

export interface DepsGenerar {
  repo: RepoAviso;
  /** Accesos de la flota a resolver; su `tenantId` debe ser el de la pasada. */
  resolver: DepsResolver;
  politica?: PoliticaPrivacidad | null;
  compositor?: ConfigCompositor;
  /**
   * ¿Puede ESTE aviso salir solo? Lo decide la política de T-A4-20 (`crearAutonomoPermitido` en `politica.ts`):
   * confirmaciones sin editar por cliente, aviso completo, kill switches. Sin esta función el valor es «no»: aun con
   * `modo='autonomo'` el aviso queda pendiente de confirmación.
   */
  autonomoPermitido?: (tenantId: string, ctx?: ContextoAutonomia) => Promise<boolean>;
}

export interface ResultadoGeneracion {
  /** `apagado` = sin fila de config o `habilitado=false`; `sin_migrar` = la 0797 no está en la base. */
  estado: 'ok' | 'apagado' | 'sin_migrar';
  /** Filas leídas de la ventana. */
  leidas: number;
  /** Filas que ya tenían algún aviso. */
  yaTenian: number;
  noListas: number;
  muyTemprano: number;
  citaPasada: number;
  creados: number;
  pendientesConfirmacion: number;
  aprobados: number;
  sinDestinatario: number;
  /** Otra pasada ganó el mismo aviso (huella o versión repetida). */
  duplicados: number;
  /** Listas que no se procesaron por el tope de la pasada. */
  omitidas: number;
  /** true si se alcanzó algún tope (de proceso o de lectura). */
  acotada: boolean;
}

function vacio(estado: ResultadoGeneracion['estado']): ResultadoGeneracion {
  return {
    estado, leidas: 0, yaTenian: 0, noListas: 0, muyTemprano: 0, citaPasada: 0, creados: 0,
    pendientesConfirmacion: 0, aprobados: 0, sinDestinatario: 0, duplicados: 0, omitidas: 0, acotada: false,
  };
}

/** AAAA-MM-DD de un instante en una zona IANA. */
export function fechaLocal(instante: Date, zona: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instante);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function zonaValida(zona: string): boolean {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zona }); return true; } catch { return false; }
}

/** Traduce la configuración guardada a la de `evaluarListo`. Lo vacío o desconocido cae al valor por defecto. */
export function configListoDe(c: ConfigAviso): Partial<ConfigListo> {
  const ccp = c.ccpListos.map((x) => x.trim().toLowerCase()).filter((x): x is Ccp => (CCP_VALIDOS as readonly string[]).includes(x));
  const secciones = c.secciones.map((x) => x.trim().toUpperCase()).filter((x): x is TipoSeccionAviso => (TIPOS_VALIDOS as readonly string[]).includes(x));
  const out: Partial<ConfigListo> = { exigirTransito: c.exigirTransito };
  if (ccp.length > 0) out.ccpListos = ccp;
  if (secciones.length > 0) out.secciones = secciones;
  return out;
}

type Tiempo = 'ahora' | 'muy_temprano' | 'cita_pasada';

/** Dónde está `ahora` respecto de la ventana de aviso de la cita. */
export function evaluarTiempo(citaEn: string | null, horasAntes: number | null, ahora: Date): Tiempo {
  if (!citaEn) return 'ahora';
  const cita = Date.parse(citaEn);
  if (Number.isNaN(cita)) return 'ahora';
  const t = ahora.getTime();
  if (t > cita) return 'cita_pasada';
  if (horasAntes != null && t < cita - horasAntes * 3_600_000) return 'muy_temprano';
  return 'ahora';
}

function paraListo(f: FilaDelPrograma): FilaParaListo {
  return { tipo: f.tipo as TipoSeccionAviso, caja: f.caja, unidad: f.unidad, ccp: f.ccp as Ccp, transito: f.transito as Transito };
}

function fuentes(r: FilaResuelta): Record<string, string> {
  const o: Record<string, string> = {};
  if (r.unidad?.fuentePlacas) o.placas_unidad = r.unidad.fuentePlacas;
  if (r.caja?.fuentePlacas) o.placas_caja = r.caja.fuentePlacas;
  if (r.caja?.fuenteEstado) o.estado_caja = r.caja.fuenteEstado;
  if (r.operador) o.operador = r.operador.fuente;
  return o;
}

/** Valor de una sola línea; `null` si queda vacío. */
function limpio(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/**
 * Lo que el cliente VE en el aviso, campo por campo (T-A4-18): es la base contra la que se detecta que algo cambió y el
 * «antes» de un reenvío. Solo campos visibles y nunca los sensibles (licencia, vigencia, teléfono): esos no se guardan
 * en `datos` aunque una política los habilite. `operador` ya viene filtrado por privacidad.
 */
export function valoresDeAviso(
  fila: { caja?: string | null; unidad?: string | null },
  resuelto: Pick<FilaResuelta, 'unidad' | 'caja'>,
  operador: OperadorResuelto | null,
  visibles: ReadonlySet<CampoAviso>,
): Partial<Record<CampoAviso, string | null>> {
  const todos: Partial<Record<CampoAviso, string | null>> = {
    caja: limpio(resuelto.caja?.numero) ?? limpio(fila.caja),
    placas_caja: limpio(resuelto.caja?.placas),
    estado_caja: limpio(resuelto.caja?.estado),
    unidad: limpio(resuelto.unidad?.numero) ?? limpio(fila.unidad),
    placas_unidad: limpio(resuelto.unidad?.placas),
    operador_nombre: limpio(operador?.nombre),
  };
  const out: Partial<Record<CampoAviso, string | null>> = {};
  for (const [campo, v] of Object.entries(todos) as Array<[CampoAviso, string | null]>) {
    if (visibles.has(campo) && !CAMPOS_SENSIBLES.includes(campo)) out[campo] = v;
  }
  return out;
}

/**
 * Estado con el que nace un aviso (o un reenvío). Sin destinatario → `sin_destinatario`. Con destinatario →
 * `pendiente_confirmacion`, salvo modo autónomo Y permiso de T-A4-20: solo entonces `aprobado`. El modo `confirmar`
 * jamás aprueba.
 */
export async function estadoSegunModo(
  tenantId: string, config: ConfigAviso, hayDestinatario: boolean, deps: Pick<DepsGenerar, 'autonomoPermitido'>,
  ctx?: ContextoAutonomia,
): Promise<NuevoAviso['estado']> {
  if (!hayDestinatario) return 'sin_destinatario';
  if (config.modo === 'autonomo' && deps.autonomoPermitido && (await deps.autonomoPermitido(tenantId, ctx))) return 'aprobado';
  return 'pendiente_confirmacion';
}

async function armarAviso(
  tenantId: string, fila: FilaDelPrograma, config: ConfigAviso, motivoListo: string, deps: DepsGenerar, ahora: Date,
): Promise<NuevoAviso> {
  const resuelto = await resolverFila(
    { cliente: fila.cliente, consignatario: fila.consignatario, caja: fila.caja, unidad: fila.unidad, filaId: fila.id },
    deps.resolver,
  );
  const visibles: ReadonlySet<CampoAviso> = camposVisibles(deps.politica, resuelto.clienteId);
  // Doble defensa: el operador se filtra aquí y el compositor vuelve a filtrar por `visibles`.
  const operador = filtrarOperador(resuelto.operador, visibles);
  const c = componerAviso({
    fila: { caja: fila.caja, unidad: fila.unidad },
    resuelto: { unidad: resuelto.unidad, caja: resuelto.caja, operador },
    visibles, version: 1, config: deps.compositor,
  });

  const destinatario = resuelto.estadoCliente === 'resuelto' && resuelto.clienteId !== null && resuelto.contacto !== null;
  const estado = await estadoSegunModo(tenantId, config, destinatario, deps, {
    clienteId: resuelto.clienteId, completo: c.pendientes.length === 0, esReenvio: false, cambioOperador: false,
  });

  const motivo = destinatario
    ? motivoListo
    : `sin destinatario (${resuelto.faltantes.filter((x) => x === 'sin_cliente' || x === 'cliente_ambiguo' || x === 'sin_contacto').join(', ') || 'sin contacto'}); ${motivoListo}`;

  return {
    filaId: fila.id,
    clienteId: resuelto.clienteId,
    version: 1,
    huella: c.huella,
    estado,
    canal: config.canalDefault,
    texto: c.texto,
    // Solo QUÉ campos entraron y de dónde salió cada uno; ni teléfonos ni licencias.
    datos: {
      via: 'proxy',
      tipo: 'inicial',
      valores: valoresDeAviso(fila, resuelto, operador, visibles),
      seccion: fila.tipo,
      cita: fila.citaEn,
      campos: [...visibles].sort(),
      pendientes: c.pendientes,
      fuentes: fuentes(resuelto),
      faltantes: resuelto.faltantes,
    },
    motivo: motivo.length > 200 ? `${motivo.slice(0, 199)}…` : motivo,
    aprobadoEn: estado === 'aprobado' ? ahora.toISOString() : null,
  };
}

export async function generarAvisos(tenantId: string, ahora: Date, deps: DepsGenerar): Promise<ResultadoGeneracion> {
  if (deps.resolver.tenantId !== tenantId) {
    throw new Error('generarAvisos: el resolver pertenece a otra flota');
  }

  let config: ConfigAviso | null;
  try {
    config = await deps.repo.leerConfig(tenantId);
  } catch (e) {
    if (e instanceof AvisoSinMigrar) return vacio('sin_migrar');
    throw e;
  }
  if (!config || !config.habilitado) return vacio('apagado');

  const zona = zonaValida(config.zona) ? config.zona : 'America/Mexico_City';
  const desde = fechaLocal(ahora, zona);
  const hasta = fechaLocal(new Date(ahora.getTime() + VENTANA_HORAS * 3_600_000), zona);
  const cfgListo = configListoDe(config);
  const r = vacio('ok');

  for (let desp = 0; ; desp += PAGINA_FILAS) {
    if (desp >= TOPE_FILAS_LEIDAS) { r.acotada = true; break; }
    const pagina = await deps.repo.filasVisibles(tenantId, desde, hasta, desp, PAGINA_FILAS);
    r.leidas += pagina.length;
    if (pagina.length === 0) break;

    const existentes = new Set((await deps.repo.avisosDeFilas(tenantId, pagina.map((f) => f.id))).map((a) => a.filaId));
    for (const fila of pagina) {
      if (existentes.has(fila.id)) { r.yaTenian++; continue; }
      const ev = evaluarListo(paraListo(fila), cfgListo);
      if (!ev.listo) { r.noListas++; continue; }
      const t = evaluarTiempo(fila.citaEn, config.horasAntesCita, ahora);
      if (t === 'muy_temprano') { r.muyTemprano++; continue; }
      if (t === 'cita_pasada') { r.citaPasada++; continue; }
      if (r.creados + r.duplicados >= TOPE_FILAS_POR_PASADA) { r.omitidas++; r.acotada = true; continue; }

      const aviso = await armarAviso(tenantId, fila, config, ev.motivo, deps, ahora);
      const res = await deps.repo.insertarAviso(tenantId, aviso);
      if (res === 'duplicado') { r.duplicados++; continue; }
      r.creados++;
      if (aviso.estado === 'aprobado') r.aprobados++;
      else if (aviso.estado === 'sin_destinatario') r.sinDestinatario++;
      else r.pendientesConfirmacion++;
    }
    if (pagina.length < PAGINA_FILAS) break;
  }
  // Una pasada sin novedad (lo normal, cada 5 min) no escribe nada; con novedad, solo números.
  if (r.creados > 0 || r.duplicados > 0 || r.omitidas > 0 || r.acotada) {
    logger.info('vigia.aviso.generado', {
      tenant: tenantId, creados: r.creados, pendientesConfirmacion: r.pendientesConfirmacion, aprobados: r.aprobados,
      sinDestinatario: r.sinDestinatario, duplicados: r.duplicados, omitidas: r.omitidas, acotada: r.acotada,
    });
  }
  return r;
}
