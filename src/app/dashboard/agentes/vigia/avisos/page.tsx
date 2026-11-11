import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { AvisoSinMigrar, crearRepoAviso, type EstadoAviso } from '@/lib/likida/vigia/aviso/repo';
import { crearRepoCambios, type FilaActual } from '@/lib/likida/vigia/aviso/cambios';
import { entregarAviso } from '@/lib/likida/vigia/aviso/entrega';
import {
  agruparPorDia, armarTarjeta, crearDepsCopia, crearRepoBandeja, DIAS_BANDEJA, MAX_TEXTO_AVISO, TOPE_AVISOS_BANDEJA, paraEntrega, validarDatoManual,
  type AvisoBandeja,
} from '@/lib/likida/vigia/aviso/bandeja';
import { AVISO_AUTOMATICO_CONECTADO } from '@/lib/likida/vigia/aviso/conexion';
import { sufijoTenant } from '../../../sufijo';
import { VistaAvisosVigia, type ResultadoAviso } from './vista';
import { VistaConfiguracionAviso, type ConfigPantalla, type OpcionesConfigPantalla, type ResultadoConfig } from './configuracion';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('vigia.vista.sello_avisos_de_viaje') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/avisos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quien decide por los clientes: el dueño y el encargado (igual que el tablero del Vigía). El resto solo mira. */
const DECIDE = ['flota_admin', 'encargado'];
const EDITABLES: readonly EstadoAviso[] = ['pendiente_confirmacion', 'sin_destinatario', 'fallido'];

type Busqueda = { vista?: string; config?: string; tenant?: string; rol?: string; pendientes?: string };

const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');
const fallo = (error: string): ResultadoAviso => ({ ok: false, error });
const bien = (mensaje: string): ResultadoAviso => ({ ok: true, mensaje });
const carrera = (tx: TAgentes = TR_ES.t) => (tx('rest.otra_persona_ya_cambio_este_aviso'));

/**
 * Vuelve a resolver la sesión (cookie) y devuelve el actor si su rol decide por los clientes.
 * A NIVEL DE MÓDULO a propósito (como el `actor` de ../page.tsx): una `'use server'` inline que cierra sobre una función local
 * no es serializable; aquí `sp` entra por parámetro y lo único que la acción captura son strings. El tenant sale de la
 * SESIÓN, nunca del formulario: ninguna acción lee un `tenant_id` del cliente.
 */
async function actor(sp: Busqueda, tenantId: string) {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

/** Lo que cada botón hace. Cada rama vuelve a leer el aviso DE ESTA FLOTA y comprueba que su estado lo permita. */
async function ejecutar(a: { tenantId: string; userId: string }, fd: FormData): Promise<ResultadoAviso> {
  const { t: tx } = await getT('agentes');
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return fallo(tx('rest.aviso_no_valido'));
  const que = texto(fd, 'accion');
  const repo = crearRepoBandeja();
  const av = await repo.obtener(a.tenantId, id);
  if (!av) return fallo(tx('rest.no_encuentro_ese_aviso_en_tu'));
  const ahora = new Date();
  const interno = av.datos.interno === true;

  if (que === 'confirmar') {
    if (interno || av.canal !== 'cliente_1a1' || av.estado !== 'pendiente_confirmacion') return fallo(tx('rest.este_aviso_ya_no_espera_tu'));
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo(tx('rest.el_aviso_de_viaje_esta_apagado'));
    if (!(await repo.aprobar(a.tenantId, id, 'pendiente_confirmacion', a.userId, ahora.toISOString()))) return fallo(carrera(tx));
    if (!AVISO_AUTOMATICO_CONECTADO) {
      return bien(tx('rest.confirmado_pero_el_envio_automatico_esta'));
    }
    return bien(tx('rest.confirmado_sale_en_la_siguiente_revision'));
  }

  if (que === 'copiar') {
    if (interno) return fallo(tx('rest.esta_es_una_alerta_interna_no'));
    if (av.estado === 'aprobado' && av.canal !== 'ejecutivo_copia') return fallo(tx('rest.este_aviso_ya_esta_aprobado_para'));
    if (!['pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario'].includes(av.estado)) return fallo(tx('rest.este_aviso_ya_no_se_puede'));
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo(tx('rest.el_aviso_de_viaje_esta_apagado_2'));
    let estado = av.estado;
    if (estado === 'sin_destinatario') {
      if (!(await repo.reabrir(a.tenantId, id))) return fallo(carrera(tx));
      estado = 'pendiente_confirmacion';
    }
    if (estado !== 'aprobado' && !(await repo.aprobar(a.tenantId, id, estado, a.userId, ahora.toISOString(), 'ejecutivo_copia'))) return fallo(carrera(tx));
    const listo = await repo.obtener(a.tenantId, id);
    if (!listo) return fallo(carrera(tx));
    const r = await entregarAviso(paraEntrega(a.tenantId, listo), crearDepsCopia(a.tenantId, cfg.habilitado, cfg.zona), 'copiar');
    if (r.estado === 'enviado') return bien(tx('rest.listo_quedo_marcado_como_enviado'));
    if (r.estado === 'omitido' && r.motivo === 'aviso_apagado') return fallo(tx('rest.el_aviso_de_viaje_esta_apagado_3'));
    return fallo(tx('rest.otra_persona_esta_procesando_este_aviso'));
  }

  if (que === 'editar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo(tx('rest.este_aviso_ya_no_se_puede_2'));
    const nuevo = texto(fd, 'texto').replace(/\r\n/g, '\n').trim();
    if (nuevo === '') return fallo(tx('rest.el_texto_no_puede_quedar_vacio'));
    if (nuevo.length > MAX_TEXTO_AVISO) return fallo(tx('rest.el_texto_pasa_de_letras_acortalo', { maxTextoAviso: MAX_TEXTO_AVISO }));
    if (nuevo === av.texto) return fallo(tx('rest.no_cambiaste_nada_del_texto'));
    if (!(await repo.editarTexto(a.tenantId, av, nuevo, a.userId, ahora.toISOString()))) return fallo(carrera(tx));
    return bien(tx('rest.texto_guardado_revisalo_y_confirma_cuando'));
  }

  if (que === 'descartar') {
    if (!EDITABLES.includes(av.estado) && av.estado !== 'aprobado') return fallo(tx('rest.este_aviso_ya_no_se_puede_3'));
    const ok = await crearRepoCambios().cambiarEstado(a.tenantId, id, av.estado, 'descartado', tx('rest.descartado_por_una_persona'));
    if (ok) return bien(tx('rest.descartado_no_se_enviara'));
    // A37-S58-01: un aprobado que no se pudo cerrar suele ser porque el envío ya está en curso.
    return fallo(av.estado === 'aprobado' ? tx('rest.este_aviso_se_esta_enviando_en') : carrera(tx));
  }

  if (que === 'capturar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo(tx('rest.este_aviso_ya_no_admite_datos'));
    const v = validarDatoManual({
      operadorNombre: texto(fd, 'operadorNombre'), licencia: texto(fd, 'licencia'), licenciaVence: texto(fd, 'licenciaVence'),
      telefono: texto(fd, 'telefono'), placasUnidad: texto(fd, 'placasUnidad'), placasCaja: texto(fd, 'placasCaja'), estadoCaja: texto(fd, 'estadoCaja'),
      borrar: fd.getAll('borrar').map(String),
    });
    if (!v.ok) return fallo(v.error);
    const r = await repo.guardarDatoManual(a.tenantId, av.filaId, a.userId, v.valor);
    if (r === 'fila_ajena') return fallo(tx('rest.no_encuentro_ese_servicio_en_tu'));
    if (!AVISO_AUTOMATICO_CONECTADO) return bien(tx('rest.datos_guardados_se_usaran_cuando_el'));
    return bien(tx('rest.datos_guardados_el_aviso_se_rehace'));
  }

  return fallo(tx('rest.accion_no_valida'));
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL AVISO (T-A4-23). Todo a nivel de módulo, como `actor` / `ejecutar`.
//
// Se guarda en las columnas de `vigia_aviso_config` (0797) y en `vigia_politica_datos` (0796, regla general de la flota).
// El tenant sale SIEMPRE de la sesión. El servidor valida todo otra vez (la vista solo ayuda); el guardado es idempotente
// (lo que no cambia no se escribe ni se anota) y cada cambio deja en `bitacora_auditoria` quién, cuándo (la fila lo fecha),
// el rol y el antes/después de cada campo. Dueño y encargado cambian la configuración; SOLO la dueña (`flota_admin`)
// habilita datos personales del operador (E6).
// ═══════════════════════════════════════════════════════════════════════════
const ccpOpciones = (tx: TAgentes = TR_ES.t) => ([
  { valor: 'listo', rotulo: tx('rest.listo') }, { valor: 'despachado', rotulo: tx('rest.despachado') }, { valor: 'pend_reque', rotulo: tx('rest.pendiente_de_requerimiento') },
  { valor: 'pend_ccp', rotulo: tx('rest.pendiente_de_carta_porte') }, { valor: 'falta_complemento', rotulo: tx('rest.falta_complemento') },
]);
// CANCELACIONES nunca genera este aviso (lo hace cumplir el evaluador «listo»): no se ofrece.
const seccionesOpciones = (tx: TAgentes = TR_ES.t) => ([
  { valor: tx('rest.importacion'), rotulo: tx('rest.importacion_2') }, { valor: tx('rest.exportacion'), rotulo: tx('rest.exportacion_2') },
  { valor: tx('rest.domestico'), rotulo: tx('rest.domestico_2') }, { valor: 'MOV_VACIO', rotulo: tx('rest.movimiento_en_vacio') },
]);
const operadorCampos = (tx: TAgentes = TR_ES.t) => ([
  { campo: 'licencia', control: 'op_licencia', rotulo: tx('rest.licencia') },
  { campo: 'vigencia', control: 'op_vigencia', rotulo: tx('rest.vigencia_de_la_licencia') },
  { campo: 'telefono', control: 'op_telefono', rotulo: tx('rest.telefono_del_operador') },
] as const);
const LIMITES = { horasAntes: { min: 0, max: 48 }, debounce: { min: 1, max: 120 }, reenvios: { min: 0, max: 10 } } as const;
const opcionesConfig = (tx: TAgentes = TR_ES.t): OpcionesConfigPantalla => ({
  ccp: ccpOpciones(tx), secciones: seccionesOpciones(tx), operador: operadorCampos(tx).map((o) => ({ ...o })), limites: LIMITES,
});
const CCP_DEFECTO = ['listo', 'despachado'];
const SECCIONES_DEFECTO = ['IMPORTACION', 'EXPORTACION'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENTERO = /^\d{1,4}$/;
const SIN_MIGRAR_BASE = new Set(['42P01', 'PGRST205']);
const COLS_CONFIG = 'habilitado, modo, canal_default, ccp_listos, exigir_transito, secciones, horas_antes_cita, ventana_envio, max_reenvios, debounce_min';

type ErrorBase = { message: string; code?: string } | null | undefined;
function exigirBase(op: string, error: ErrorBase): void {
  if (!error) return;
  if (error.code && SIN_MIGRAR_BASE.has(error.code)) throw new AvisoSinMigrar();
  throw new Error(`aviso_config.${op}: ${error.message}`);
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const ordenada = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/** `{}` = sin restricción; `{ desde, hasta }` en HH:MM; cualquier otra forma = ilegible (el aviso no sale hasta corregirla). */
function leerVentana(v: unknown): { ventana: ConfigPantalla['ventana']; ilegible: boolean } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ventana: null, ilegible: true };
  const o = v as Record<string, unknown>;
  const claves = Object.keys(o);
  if (claves.length === 0) return { ventana: null, ilegible: false };
  if (claves.some((k) => k !== 'desde' && k !== 'hasta')) return { ventana: null, ilegible: true };
  const { desde, hasta } = o;
  if (typeof desde !== 'string' || typeof hasta !== 'string' || !HORA.test(desde) || !HORA.test(hasta) || desde === hasta) return { ventana: null, ilegible: true };
  return { ventana: { desde, hasta }, ilegible: false };
}

const CONFIG_DEFECTO: ConfigPantalla = {
  habilitado: false, modo: 'confirmar', canalDefault: 'ejecutivo_copia', ccpListos: CCP_DEFECTO, exigirTransito: false,
  secciones: SECCIONES_DEFECTO, horasAntesCita: null, ventana: null, maxReenvios: 3, debounceMin: 10,
  operador: { licencia: false, vigencia: false, telefono: false },
};

async function leerConfiguracion(tenantId: string): Promise<{ config: ConfigPantalla; ventanaIlegible: boolean }> {
  const db = supabaseAdmin();
  const c = await acotada(db.from('vigia_aviso_config').select(COLS_CONFIG).eq('tenant_id', tenantId).maybeSingle(), 'aviso_config.leer');
  exigirBase('leer', c.error);
  const p = await acotada(db.from('vigia_politica_datos').select('campo, visible').eq('tenant_id', tenantId).is('cliente_id', null), 'aviso_config.leer_politica');
  exigirBase('leer_politica', p.error);
  const visible = (campo: string) => ((p.data ?? []) as Array<{ campo: string; visible: boolean }>).some((r) => r.campo === campo && r.visible === true);
  const operador = { licencia: visible('licencia'), vigencia: visible('vigencia'), telefono: visible('telefono') };
  const r = c.data as Record<string, unknown> | null;
  if (!r) return { config: { ...CONFIG_DEFECTO, operador }, ventanaIlegible: false };
  const { ventana, ilegible } = leerVentana(r.ventana_envio);
  const ccp = lista(r.ccp_listos);
  const secciones = lista(r.secciones);
  return {
    ventanaIlegible: ilegible,
    config: {
      habilitado: r.habilitado === true,
      modo: r.modo === 'autonomo' ? 'autonomo' : 'confirmar',
      canalDefault: r.canal_default === 'cliente_1a1' ? 'cliente_1a1' : 'ejecutivo_copia',
      ccpListos: ccp.length > 0 ? ccp : CCP_DEFECTO,
      exigirTransito: r.exigir_transito === true,
      secciones: secciones.length > 0 ? secciones : SECCIONES_DEFECTO,
      horasAntesCita: typeof r.horas_antes_cita === 'number' ? r.horas_antes_cita : null,
      ventana,
      maxReenvios: typeof r.max_reenvios === 'number' ? r.max_reenvios : CONFIG_DEFECTO.maxReenvios,
      debounceMin: typeof r.debounce_min === 'number' ? r.debounce_min : CONFIG_DEFECTO.debounceMin,
      operador,
    },
  };
}

type Validado = { ok: true; valor: Omit<ConfigPantalla, 'operador'>; operador: ConfigPantalla['operador'] | null } | { ok: false; error: string };

/** Valida el formulario COMPLETO en el servidor. `operador` = null si el formulario no traía la sección (no la puede cambiar). */
function validarConfiguracion(fd: FormData, tx: TAgentes = TR_ES.t): Validado {
  const uno = (k: string) => texto(fd, k).trim();
  const modo = uno('modo');
  if (modo !== 'confirmar' && modo !== 'autonomo') return { ok: false, error: tx('rest.elige_un_modo_de_envio_valido') };
  const canal = uno('canal');
  if (canal !== 'ejecutivo_copia' && canal !== 'cliente_1a1') return { ok: false, error: tx('rest.elige_un_canal_valido') };

  const ccp = ordenada(fd.getAll('ccp').map(String));
  if (ccp.length === 0 || ccp.some((x) => !ccpOpciones(tx).some((o) => o.valor === x))) return { ok: false, error: tx('rest.marca_al_menos_un_estatus_de') };
  const secciones = ordenada(fd.getAll('seccion').map(String));
  if (secciones.length === 0 || secciones.some((x) => !seccionesOpciones(tx).some((o) => o.valor === x))) return { ok: false, error: tx('rest.marca_al_menos_una_seccion_del') };

  const entero = (k: string, min: number, max: number): number | null | 'mal' => {
    const t = uno(k);
    if (t === '') return null;
    if (!ENTERO.test(t)) return 'mal';
    const n = Number(t);
    return n >= min && n <= max ? n : 'mal';
  };
  const horas = entero('horas_antes', LIMITES.horasAntes.min, LIMITES.horasAntes.max);
  if (horas === 'mal') return { ok: false, error: tx('rest.las_horas_antes_de_la_cita', { min: LIMITES.horasAntes.min, max: LIMITES.horasAntes.max }) };
  const debounce = entero('debounce_min', LIMITES.debounce.min, LIMITES.debounce.max);
  if (debounce === null || debounce === 'mal') return { ok: false, error: tx('rest.los_minutos_de_calma_van_de', { min: LIMITES.debounce.min, max: LIMITES.debounce.max }) };
  const reenvios = entero('max_reenvios', LIMITES.reenvios.min, LIMITES.reenvios.max);
  if (reenvios === null || reenvios === 'mal') return { ok: false, error: tx('rest.los_reenvios_por_servicio_van_de', { min: LIMITES.reenvios.min, max: LIMITES.reenvios.max }) };

  const desde = uno('ventana_desde');
  const hasta = uno('ventana_hasta');
  let ventana: ConfigPantalla['ventana'] = null;
  if (desde !== '' || hasta !== '') {
    if (!HORA.test(desde) || !HORA.test(hasta)) return { ok: false, error: tx('rest.el_horario_de_envio_necesita_hora') };
    if (desde === hasta) return { ok: false, error: tx('rest.la_hora_de_inicio_y_la') };
    ventana = { desde, hasta };
  }

  const operador = fd.get('op_presente') === '1'
    ? { licencia: fd.get('op_licencia') === '1', vigencia: fd.get('op_vigencia') === '1', telefono: fd.get('op_telefono') === '1' }
    : null;
  return {
    ok: true, operador,
    valor: {
      habilitado: fd.get('habilitado') === '1', modo, canalDefault: canal, ccpListos: ccp, exigirTransito: fd.get('exigir_transito') === '1',
      secciones, horasAntesCita: horas, ventana, maxReenvios: reenvios, debounceMin: debounce,
    },
  };
}

interface CambioConfig { campo: string; antes: string; despues: string }
const sino = (b: boolean) => (b ? 'sí' : 'no');
const rotuloVentana = (v: ConfigPantalla['ventana'], ilegible = false, tx: TAgentes = TR_ES.t) => (ilegible ? 'ilegible' : v ? `${v.desde}-${v.hasta}` : tx('rest.sin_restriccion_2'));

/** Qué cambió, campo por campo (solo nombres de campo y valores de configuración: nada de datos personales). */
function cambiosDeConfig(antes: ConfigPantalla, ventanaIlegible: boolean, nuevo: ConfigPantalla, tx: TAgentes = TR_ES.t): { config: CambioConfig[]; operador: CambioConfig[] } {
  const cfg: CambioConfig[] = [];
  const poner = (campo: string, a: string, d: string) => { if (a !== d) cfg.push({ campo, antes: a, despues: d }); };
  poner('habilitado', sino(antes.habilitado), sino(nuevo.habilitado));
  poner('modo', antes.modo, nuevo.modo);
  poner('canal_default', antes.canalDefault, nuevo.canalDefault);
  poner('ccp_listos', ordenada(antes.ccpListos).join(','), ordenada(nuevo.ccpListos).join(','));
  poner('exigir_transito', sino(antes.exigirTransito), sino(nuevo.exigirTransito));
  poner('secciones', ordenada(antes.secciones).join(','), ordenada(nuevo.secciones).join(','));
  poner('horas_antes_cita', String(antes.horasAntesCita ?? tx('rest.vacio')), String(nuevo.horasAntesCita ?? tx('rest.vacio')));
  poner('ventana_envio', rotuloVentana(antes.ventana, ventanaIlegible, tx), rotuloVentana(nuevo.ventana, undefined, tx));
  poner('max_reenvios', String(antes.maxReenvios), String(nuevo.maxReenvios));
  poner('debounce_min', String(antes.debounceMin), String(nuevo.debounceMin));
  const op: CambioConfig[] = [];
  for (const o of operadorCampos(tx)) {
    if (antes.operador[o.campo] !== nuevo.operador[o.campo]) op.push({ campo: `operador_${o.campo}`, antes: sino(antes.operador[o.campo]), despues: sino(nuevo.operador[o.campo]) });
  }
  return { config: cfg, operador: op };
}

async function guardarPoliticaOperador(tenantId: string, userId: string, nuevo: ConfigPantalla['operador'], cambiados: readonly string[]): Promise<void> {
  const db = supabaseAdmin();
  const previas = await acotada(db.from('vigia_politica_datos').select('id, campo').eq('tenant_id', tenantId).is('cliente_id', null), 'aviso_config.politica_previa');
  exigirBase('politica_previa', previas.error);
  const filas = (previas.data ?? []) as Array<{ id: string; campo: string }>;
  for (const campo of cambiados) {
    const visible = nuevo[campo as keyof ConfigPantalla['operador']];
    const existente = filas.find((f) => f.campo === campo);
    const r = existente
      ? await acotada(db.from('vigia_politica_datos').update({ visible, updated_by: userId }).eq('tenant_id', tenantId).eq('id', existente.id), 'aviso_config.politica_update')
      : await acotada(db.from('vigia_politica_datos').insert({ tenant_id: tenantId, cliente_id: null, campo, visible, updated_by: userId }), 'aviso_config.politica_insert');
    exigirBase('politica_guardar', r.error);
  }
}

async function guardarConfigBase(tenantId: string, userId: string, v: Omit<ConfigPantalla, 'operador'>): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('vigia_aviso_config').upsert({
    tenant_id: tenantId, habilitado: v.habilitado, modo: v.modo, canal_default: v.canalDefault, ccp_listos: v.ccpListos,
    exigir_transito: v.exigirTransito, secciones: v.secciones, horas_antes_cita: v.horasAntesCita,
    ventana_envio: v.ventana ? { desde: v.ventana.desde, hasta: v.ventana.hasta } : {},
    max_reenvios: v.maxReenvios, debounce_min: v.debounceMin, actualizado_por: userId, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'aviso_config.guardar');
  exigirBase('guardar', error);
}

const DUENA = 'flota_admin';
const falloCfg = (error: string): ResultadoConfig => ({ ok: false, error });

/** Vuelve a resolver la sesión y devuelve al actor con su rol (dueño o encargado). El tenant sale de la SESIÓN. */
async function actorConfig(sp: Busqueda, tenantId: string) {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId, rol: s.rol };
}

async function ejecutarConfig(a: { tenantId: string; userId: string; rol: string }, fd: FormData): Promise<ResultadoConfig> {
  const { t: tx } = await getT('agentes');
  const v = validarConfiguracion(fd);
  if (!v.ok) return fallo(v.error);
  const esDuena = a.rol === DUENA;
  // Los controles de privacidad solo viajan en el formulario de la dueña; si llegan de otro rol alguien armó la petición a mano.
  const traePrivacidad = [...fd.keys()].some((k) => k === 'op_presente' || operadorCampos(tx).some((o) => o.control === k));
  if (traePrivacidad && !esDuena) return fallo(tx('rest.solo_la_duena_de_la_flota_3'));

  const previo = await leerConfiguracion(a.tenantId);
  const nuevo: ConfigPantalla = { ...v.valor, operador: v.operador && esDuena ? v.operador : previo.config.operador };
  const cambios = cambiosDeConfig(previo.config, previo.ventanaIlegible, nuevo);
  if (cambios.config.length === 0 && cambios.operador.length === 0) return bien(tx('rest.no_hay_cambios_que_guardar_la'));

  // ── A37-S15-05: ENCENDER, MODO Y CANAL SON DE LA DUEÑA ─────────────────────
  // La configuración del Vigía (../page.tsx, `actor(sp, tenantId, 'administra')`) exige `flota_admin` y le cierra el autoenvío al
  // perfil `cinco_agentes`; aquí el encargado podía guardar modo autónomo + WhatsApp directo + encendido sin ese candado.
  // Se relee el rol de la SESIÓN (nunca del formulario) y se compara contra lo ya guardado: el encargado sigue ajustando
  // horarios, secciones y reenvíos, pero no estos tres. Autónomo, además, se cierra bajo el perfil restringido.
  if (!esDuena && (nuevo.habilitado !== previo.config.habilitado || nuevo.modo !== previo.config.modo || nuevo.canalDefault !== previo.config.canalDefault)) {
    return falloCfg(tx('rest.solo_la_duena_de_la_flota_4'));
  }
  if (nuevo.modo === 'autonomo' && previo.config.modo !== 'autonomo' && (await perfilDeTenant(a.tenantId)) === 'cinco_agentes') {
    return falloCfg(tx('rest.el_modo_autonomo_no_esta_disponible'));
  }

  const hechos: CambioConfig[] = [];
  try {
    if (cambios.operador.length > 0) {
      await guardarPoliticaOperador(a.tenantId, a.userId, nuevo.operador, cambios.operador.map((c) => c.campo.replace('operador_', '')));
      hechos.push(...cambios.operador);
    }
    if (cambios.config.length > 0) {
      await guardarConfigBase(a.tenantId, a.userId, v.valor);
      hechos.push(...cambios.config);
    }
  } finally {
    if (hechos.length > 0) {
      await anotarBitacora(
        { tenantId: a.tenantId, actor: { id: a.userId }, accion: 'vigia_aviso_config.cambiar', entidad: 'vigia_aviso_config', entidadId: a.tenantId, detalle: { rol: a.rol, cambios: hechos } },
        { evento: 'vigia.aviso_config_bitacora_no_escribio' },
      );
    }
  }
  if (!AVISO_AUTOMATICO_CONECTADO) return bien(tx('rest.configuracion_guardada_los_avisos_la_usaran'));
  return bien(tx('rest.configuracion_guardada_los_avisos_nuevos_la'));
}

/**
 * La bandeja de avisos de viaje del Vigía (Agente 4, T-A4-22): por día y por cliente, cada aviso con lo que tiene, lo que
 * falta y de dónde salió cada dato, y los botones Confirmar y enviar / Editar / Copiar y marcar enviado / Descartar.
 * Por defecto nada sale sin una persona (E5). Cero pesos. Quien solo mira no ve botones ni teléfonos completos.
 */
export default async function PaginaAvisosVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const puedeDecidir = DECIDE.includes(rol);
  const soloPendientes = sp.pendientes === '1';

  async function guardarConfiguracion(_p: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    const a = await actorConfig(sp, tenantId);
    if (!a) return falloCfg(tx('rest.solo_el_dueno_o_el_encargado_2'));
    try {
      const r = await ejecutarConfig(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof AvisoSinMigrar) return falloCfg(tx('rest.la_base_de_datos_todavia_no'));
      logger.error('vigia.aviso_config_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return falloCfg(mensajeParaPantalla(e, tx('rest.guardar_la_configuracion')));
    }
  }

  if (sp.config === '1') {
    let leida: Awaited<ReturnType<typeof leerConfiguracion>> | null = null;
    let sinMigrarCfg = false;
    let errorCfg: string | null = null;
    try {
      leida = await leerConfiguracion(tenantId);
    } catch (e) {
      if (e instanceof AvisoSinMigrar) sinMigrarCfg = true;
      else {
        logger.error('vigia.aviso_config_lectura_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
        errorCfg = tx('rest.no_pude_leer_la_configuracion_intenta');
      }
    }
    return (
      <VistaConfiguracionAviso
        sufijo={sufijoTenant(sp)}
        config={leida?.config ?? null}
        opciones={opcionesConfig(tx)}
        puedeEditar={puedeDecidir}
        puedeEditarPrivacidad={rol === DUENA}
        puedeEditarEnvio={rol === DUENA}
        ventanaIlegible={leida?.ventanaIlegible ?? false}
        errorLectura={errorCfg}
        sinMigrar={sinMigrarCfg}
        accion={guardarConfiguracion}
      />
    );
  }

  let avisoEncendido: boolean | null = null;
  let errorLectura: string | null = null;
  let sinMigrar = false;
  let avisos: AvisoBandeja[] = [];
  let filas = new Map<string, FilaActual>();
  // La cuenta exacta de lo que espera a una persona (los mismos estados que «Solo pendientes»). Si no se pudo contar: null, nunca un cero.
  const pPendientes: Promise<number | null> = Promise.resolve().then(() => crearRepoBandeja().contarPendientes(tenantId)).then((n) => (typeof n === 'number' ? n : null)).catch(() => null);
  try {
    const desde = new Date(ahoraMs() - DIAS_BANDEJA * 86_400_000).toISOString();
    const [cfg, lista] = await Promise.all([crearRepoAviso().leerConfig(tenantId), crearRepoBandeja().listar(tenantId, desde, soloPendientes)]);
    avisoEncendido = cfg ? cfg.habilitado : false;
    avisos = lista;
    const ids = [...new Set(lista.map((x) => x.filaId))];
    filas = new Map((ids.length > 0 ? await crearRepoCambios().filasPorIds(tenantId, ids) : []).map((f) => [f.id, f]));
  } catch (e) {
    if (e instanceof AvisoSinMigrar) sinMigrar = true;
    else {
      logger.error('vigia.avisos_lectura_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      errorLectura = tx('rest.no_pude_leer_los_avisos_intenta');
    }
  }

  const tarjetas = avisos.map((av) => armarTarjeta(av, filas.get(av.filaId) ?? null, !puedeDecidir));

  async function decidir(_p: ResultadoAviso, fd: FormData): Promise<ResultadoAviso> {
    'use server';
    const a = await actor(sp, tenantId);
    if (!a) return fallo(tx('rest.solo_el_dueno_o_el_encargado_3'));
    try {
      const r = await ejecutar(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof AvisoSinMigrar) return fallo(tx('rest.la_base_de_datos_todavia_no'));
      // Nunca el texto del aviso ni datos del operador en el log: solo el mensaje técnico.
      logger.error('vigia.aviso_accion_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return fallo(mensajeParaPantalla(e, 'actualizar el aviso'));
    }
  }

  return (
    <VistaAvisosVigia
      sufijo={sufijoTenant(sp)}
      grupos={agruparPorDia(tarjetas)}
      total={tarjetas.length}
      hayMas={avisos.length >= TOPE_AVISOS_BANDEJA}
      pendientes={await pPendientes}
      soloPendientes={soloPendientes}
      puedeDecidir={puedeDecidir}
      avisoEncendido={avisoEncendido}
      errorLectura={errorLectura}
      sinMigrar={sinMigrar}
      accion={decidir}
    />
  );
}
