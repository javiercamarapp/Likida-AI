import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
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
import { sufijoTenant } from '../../../sufijo';
import { VistaAvisosVigia, type ResultadoAviso } from './vista';
import { VistaConfiguracionAviso, type ConfigPantalla, type OpcionesConfigPantalla, type ResultadoConfig } from './configuracion';

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
const CARRERA = 'Otra persona ya cambió este aviso. Recarga la pantalla para ver cómo quedó.';

/**
 * Vuelve a resolver la sesión (cookie) y devuelve el actor si su rol decide por los clientes.
 * A NIVEL DE MÓDULO a propósito (como el `actor` de ../page.tsx): una `'use server'` inline que cierra sobre una función local
 * no es serializable; aquí `sp` entra por parámetro y lo único que la acción captura son strings. El tenant sale de la
 * SESIÓN, nunca del formulario: ninguna acción lee un `tenant_id` del cliente.
 */
async function actor(sp: Busqueda) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

/** Lo que cada botón hace. Cada rama vuelve a leer el aviso DE ESTA FLOTA y comprueba que su estado lo permita. */
async function ejecutar(a: { tenantId: string; userId: string }, fd: FormData): Promise<ResultadoAviso> {
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return fallo('Aviso no válido.');
  const que = texto(fd, 'accion');
  const repo = crearRepoBandeja();
  const av = await repo.obtener(a.tenantId, id);
  if (!av) return fallo('No encuentro ese aviso en tu flota.');
  const ahora = new Date();
  const interno = av.datos.interno === true;

  if (que === 'confirmar') {
    if (interno || av.canal !== 'cliente_1a1' || av.estado !== 'pendiente_confirmacion') return fallo('Este aviso ya no espera tu confirmación.');
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo('El aviso de viaje está apagado: enciéndelo antes de confirmar.');
    if (!(await repo.aprobar(a.tenantId, id, 'pendiente_confirmacion', a.userId, ahora.toISOString()))) return fallo(CARRERA);
    return bien('Confirmado. Sale en la siguiente revisión automática (máximo 5 minutos), dentro del horario de envío y solo si el cliente autorizó mensajes por WhatsApp.');
  }

  if (que === 'copiar') {
    if (interno) return fallo('Esta es una alerta interna: no se manda al cliente.');
    if (av.estado === 'aprobado' && av.canal !== 'ejecutivo_copia') return fallo('Este aviso ya está aprobado para salir por WhatsApp directo.');
    if (!['pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario'].includes(av.estado)) return fallo('Este aviso ya no se puede marcar como enviado.');
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo('El aviso de viaje está apagado: enciéndelo antes de marcar avisos.');
    let estado = av.estado;
    if (estado === 'sin_destinatario') {
      if (!(await repo.reabrir(a.tenantId, id))) return fallo(CARRERA);
      estado = 'pendiente_confirmacion';
    }
    if (estado !== 'aprobado' && !(await repo.aprobar(a.tenantId, id, estado, a.userId, ahora.toISOString(), 'ejecutivo_copia'))) return fallo(CARRERA);
    const listo = await repo.obtener(a.tenantId, id);
    if (!listo) return fallo(CARRERA);
    const r = await entregarAviso(paraEntrega(a.tenantId, listo), crearDepsCopia(a.tenantId, cfg.habilitado, cfg.zona), 'copiar');
    if (r.estado === 'enviado') return bien('Listo: quedó marcado como enviado.');
    if (r.estado === 'omitido' && r.motivo === 'aviso_apagado') return fallo('El aviso de viaje está apagado.');
    return fallo('Otra persona está procesando este aviso. Recarga la pantalla.');
  }

  if (que === 'editar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo('Este aviso ya no se puede editar.');
    const nuevo = texto(fd, 'texto').replace(/\r\n/g, '\n').trim();
    if (nuevo === '') return fallo('El texto no puede quedar vacío.');
    if (nuevo.length > MAX_TEXTO_AVISO) return fallo(`El texto pasa de ${MAX_TEXTO_AVISO} letras: acórtalo.`);
    if (nuevo === av.texto) return fallo('No cambiaste nada del texto.');
    if (!(await repo.editarTexto(a.tenantId, av, nuevo, a.userId, ahora.toISOString()))) return fallo(CARRERA);
    return bien('Texto guardado. Revísalo y confirma cuando esté bien.');
  }

  if (que === 'descartar') {
    if (!EDITABLES.includes(av.estado) && av.estado !== 'aprobado') return fallo('Este aviso ya no se puede descartar.');
    const ok = await crearRepoCambios().cambiarEstado(a.tenantId, id, av.estado, 'descartado', 'descartado por una persona');
    return ok ? bien('Descartado: no se enviará.') : fallo(CARRERA);
  }

  if (que === 'capturar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo('Este aviso ya no admite datos nuevos.');
    const v = validarDatoManual({
      operadorNombre: texto(fd, 'operadorNombre'), licencia: texto(fd, 'licencia'), licenciaVence: texto(fd, 'licenciaVence'),
      telefono: texto(fd, 'telefono'), placasUnidad: texto(fd, 'placasUnidad'), placasCaja: texto(fd, 'placasCaja'), estadoCaja: texto(fd, 'estadoCaja'),
      borrar: fd.getAll('borrar').map(String),
    });
    if (!v.ok) return fallo(v.error);
    const r = await repo.guardarDatoManual(a.tenantId, av.filaId, a.userId, v.valor);
    if (r === 'fila_ajena') return fallo('No encuentro ese servicio en tu flota.');
    return bien('Datos guardados. El aviso se rehace con ellos en la siguiente revisión automática; revísalo entonces antes de confirmar.');
  }

  return fallo('Acción no válida.');
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
const CCP_OPCIONES = [
  { valor: 'listo', rotulo: 'Listo' }, { valor: 'despachado', rotulo: 'Despachado' }, { valor: 'pend_reque', rotulo: 'Pendiente de requerimiento' },
  { valor: 'pend_ccp', rotulo: 'Pendiente de carta porte' }, { valor: 'falta_complemento', rotulo: 'Falta complemento' },
];
// CANCELACIONES nunca genera este aviso (lo hace cumplir el evaluador «listo»): no se ofrece.
const SECCIONES_OPCIONES = [
  { valor: 'IMPORTACION', rotulo: 'Importación' }, { valor: 'EXPORTACION', rotulo: 'Exportación' },
  { valor: 'DOMESTICO', rotulo: 'Doméstico' }, { valor: 'MOV_VACIO', rotulo: 'Movimiento en vacío' },
];
const OPERADOR_CAMPOS = [
  { campo: 'licencia', control: 'op_licencia', rotulo: 'Licencia' },
  { campo: 'vigencia', control: 'op_vigencia', rotulo: 'Vigencia de la licencia' },
  { campo: 'telefono', control: 'op_telefono', rotulo: 'Teléfono del operador' },
] as const;
const LIMITES = { horasAntes: { min: 0, max: 48 }, debounce: { min: 1, max: 120 }, reenvios: { min: 0, max: 10 } } as const;
const OPCIONES_CONFIG: OpcionesConfigPantalla = {
  ccp: CCP_OPCIONES, secciones: SECCIONES_OPCIONES, operador: OPERADOR_CAMPOS.map((o) => ({ ...o })), limites: LIMITES,
};
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
function validarConfiguracion(fd: FormData): Validado {
  const uno = (k: string) => texto(fd, k).trim();
  const modo = uno('modo');
  if (modo !== 'confirmar' && modo !== 'autonomo') return { ok: false, error: 'Elige un modo de envío válido.' };
  const canal = uno('canal');
  if (canal !== 'ejecutivo_copia' && canal !== 'cliente_1a1') return { ok: false, error: 'Elige un canal válido.' };

  const ccp = ordenada(fd.getAll('ccp').map(String));
  if (ccp.length === 0 || ccp.some((x) => !CCP_OPCIONES.some((o) => o.valor === x))) return { ok: false, error: 'Marca al menos un estatus de carta porte que cuente como listo.' };
  const secciones = ordenada(fd.getAll('seccion').map(String));
  if (secciones.length === 0 || secciones.some((x) => !SECCIONES_OPCIONES.some((o) => o.valor === x))) return { ok: false, error: 'Marca al menos una sección del programa.' };

  const entero = (k: string, min: number, max: number): number | null | 'mal' => {
    const t = uno(k);
    if (t === '') return null;
    if (!ENTERO.test(t)) return 'mal';
    const n = Number(t);
    return n >= min && n <= max ? n : 'mal';
  };
  const horas = entero('horas_antes', LIMITES.horasAntes.min, LIMITES.horasAntes.max);
  if (horas === 'mal') return { ok: false, error: `Las horas antes de la cita van de ${LIMITES.horasAntes.min} a ${LIMITES.horasAntes.max}, o déjalo vacío.` };
  const debounce = entero('debounce_min', LIMITES.debounce.min, LIMITES.debounce.max);
  if (debounce === null || debounce === 'mal') return { ok: false, error: `Los minutos de calma van de ${LIMITES.debounce.min} a ${LIMITES.debounce.max}.` };
  const reenvios = entero('max_reenvios', LIMITES.reenvios.min, LIMITES.reenvios.max);
  if (reenvios === null || reenvios === 'mal') return { ok: false, error: `Los reenvíos por servicio van de ${LIMITES.reenvios.min} a ${LIMITES.reenvios.max}.` };

  const desde = uno('ventana_desde');
  const hasta = uno('ventana_hasta');
  let ventana: ConfigPantalla['ventana'] = null;
  if (desde !== '' || hasta !== '') {
    if (!HORA.test(desde) || !HORA.test(hasta)) return { ok: false, error: 'El horario de envío necesita hora de inicio y de fin (HH:MM), o déjalos los dos vacíos.' };
    if (desde === hasta) return { ok: false, error: 'La hora de inicio y la de fin no pueden ser la misma.' };
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
const rotuloVentana = (v: ConfigPantalla['ventana'], ilegible = false) => (ilegible ? 'ilegible' : v ? `${v.desde}-${v.hasta}` : 'sin restricción');

/** Qué cambió, campo por campo (solo nombres de campo y valores de configuración: nada de datos personales). */
function cambiosDeConfig(antes: ConfigPantalla, ventanaIlegible: boolean, nuevo: ConfigPantalla): { config: CambioConfig[]; operador: CambioConfig[] } {
  const cfg: CambioConfig[] = [];
  const poner = (campo: string, a: string, d: string) => { if (a !== d) cfg.push({ campo, antes: a, despues: d }); };
  poner('habilitado', sino(antes.habilitado), sino(nuevo.habilitado));
  poner('modo', antes.modo, nuevo.modo);
  poner('canal_default', antes.canalDefault, nuevo.canalDefault);
  poner('ccp_listos', ordenada(antes.ccpListos).join(','), ordenada(nuevo.ccpListos).join(','));
  poner('exigir_transito', sino(antes.exigirTransito), sino(nuevo.exigirTransito));
  poner('secciones', ordenada(antes.secciones).join(','), ordenada(nuevo.secciones).join(','));
  poner('horas_antes_cita', String(antes.horasAntesCita ?? 'vacío'), String(nuevo.horasAntesCita ?? 'vacío'));
  poner('ventana_envio', rotuloVentana(antes.ventana, ventanaIlegible), rotuloVentana(nuevo.ventana));
  poner('max_reenvios', String(antes.maxReenvios), String(nuevo.maxReenvios));
  poner('debounce_min', String(antes.debounceMin), String(nuevo.debounceMin));
  const op: CambioConfig[] = [];
  for (const o of OPERADOR_CAMPOS) {
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
async function actorConfig(sp: Busqueda) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId, rol: s.rol };
}

async function ejecutarConfig(a: { tenantId: string; userId: string; rol: string }, fd: FormData): Promise<ResultadoConfig> {
  const v = validarConfiguracion(fd);
  if (!v.ok) return fallo(v.error);
  const esDuena = a.rol === DUENA;
  // Los controles de privacidad solo viajan en el formulario de la dueña; si llegan de otro rol alguien armó la petición a mano.
  const traePrivacidad = [...fd.keys()].some((k) => k === 'op_presente' || OPERADOR_CAMPOS.some((o) => o.control === k));
  if (traePrivacidad && !esDuena) return fallo('Solo la dueña de la flota puede cambiar qué datos del operador se mandan al cliente.');

  const previo = await leerConfiguracion(a.tenantId);
  const nuevo: ConfigPantalla = { ...v.valor, operador: v.operador && esDuena ? v.operador : previo.config.operador };
  const cambios = cambiosDeConfig(previo.config, previo.ventanaIlegible, nuevo);
  if (cambios.config.length === 0 && cambios.operador.length === 0) return bien('No hay cambios que guardar: la configuración ya estaba así.');

  // ── A37-S15-05: ENCENDER, MODO Y CANAL SON DE LA DUEÑA ─────────────────────
  // La configuración del Vigía (../page.tsx, `actor(sp, 'administra')`) exige `flota_admin` y le cierra el autoenvío al
  // perfil `cinco_agentes`; aquí el encargado podía guardar modo autónomo + WhatsApp directo + encendido sin ese candado.
  // Se relee el rol de la SESIÓN (nunca del formulario) y se compara contra lo ya guardado: el encargado sigue ajustando
  // horarios, secciones y reenvíos, pero no estos tres. Autónomo, además, se cierra bajo el perfil restringido.
  if (!esDuena && (nuevo.habilitado !== previo.config.habilitado || nuevo.modo !== previo.config.modo || nuevo.canalDefault !== previo.config.canalDefault)) {
    return falloCfg('Solo la dueña de la flota enciende o apaga el aviso y cambia el modo o el canal de envío.');
  }
  if (nuevo.modo === 'autonomo' && previo.config.modo !== 'autonomo' && (await perfilDeTenant(a.tenantId)) === 'cinco_agentes') {
    return falloCfg('El modo autónomo no está disponible en tu plan.');
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
  return bien('Configuración guardada. Los avisos nuevos la usan desde la siguiente revisión automática (máximo 5 minutos).');
}

/**
 * La bandeja de avisos de viaje del Vigía (Agente 4, T-A4-22): por día y por cliente, cada aviso con lo que tiene, lo que
 * falta y de dónde salió cada dato, y los botones Confirmar y enviar / Editar / Copiar y marcar enviado / Descartar.
 * Por defecto nada sale sin una persona (E5). Cero pesos. Quien solo mira no ve botones ni teléfonos completos.
 */
export default async function PaginaAvisosVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const puedeDecidir = DECIDE.includes(rol);
  const soloPendientes = sp.pendientes === '1';

  async function guardarConfiguracion(_p: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    const a = await actorConfig(sp);
    if (!a) return falloCfg('Solo el dueño o el encargado de la flota cambia la configuración del aviso.');
    try {
      const r = await ejecutarConfig(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof AvisoSinMigrar) return falloCfg('La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.');
      logger.error('vigia.aviso_config_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return falloCfg(mensajeParaPantalla(e, 'guardar la configuración'));
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
        errorCfg = 'No pude leer la configuración. Intenta de nuevo en un momento.';
      }
    }
    return (
      <VistaConfiguracionAviso
        sufijo={sufijoTenant(sp)}
        config={leida?.config ?? null}
        opciones={OPCIONES_CONFIG}
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
      errorLectura = 'No pude leer los avisos. Intenta de nuevo en un momento.';
    }
  }

  const tarjetas = avisos.map((av) => armarTarjeta(av, filas.get(av.filaId) ?? null, !puedeDecidir));

  async function decidir(_p: ResultadoAviso, fd: FormData): Promise<ResultadoAviso> {
    'use server';
    const a = await actor(sp);
    if (!a) return fallo('Solo el dueño o el encargado de la flota decide sobre los avisos.');
    try {
      const r = await ejecutar(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof AvisoSinMigrar) return fallo('La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.');
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
      soloPendientes={soloPendientes}
      puedeDecidir={puedeDecidir}
      avisoEncendido={avisoEncendido}
      errorLectura={errorLectura}
      sinMigrar={sinMigrar}
      accion={decidir}
    />
  );
}
