// ═══════════════════════════════════════════════════════════════════════════
// BANDEJA «AVISOS DE VIAJE» (T-A4-22): lo que la pantalla del ejecutivo lee y escribe, en UN archivo.
//
// Confirmación humana al inicio (E5): ningún aviso sale sin que una persona lo vea. Aquí viven
//   · el acceso a datos de la bandeja (lista, conteo, aprobar, editar, descartar, captura manual y la copia manual),
//   · la tarjeta que se pinta (qué datos tiene, cuáles faltan y por qué, de dónde salió cada uno),
//   · las reglas de qué botón corresponde a cada estado/canal, y
//   · el enmascarado de teléfonos para los roles que solo miran.
// Disciplina del repo (igual que `repo.ts`): TODA consulta lleva `tenant_id`, pasa por `acotada`, un error de la base LANZA,
// sin `select *`, ids en tandas, y 42P01 / PGRST205 = la 0797 aún no está en la base (`AvisoSinMigrar`). Nada del contenido
// del aviso ni del programa va a los logs.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../../presupuesto';
import { MAX_TEXTO_AL_CLIENTE } from '../enviar';
import { AvisoSinMigrar, type CanalAviso, type EstadoAviso } from './repo';
import type { AvisoParaEntrega, DepsEntrega } from './entrega';
import { CAMPOS_AVISO, CAMPOS_SENSIBLES, type CampoAviso } from './privacidad';
import type { FilaActual } from './cambios';

const SIN_0797 = new Set(['42P01', 'PGRST205']);

type ErrorBase = { message: string; code?: string } | null | undefined;

function exigir(op: string, error: ErrorBase): void {
  if (!error) return;
  if (error.code && SIN_0797.has(error.code)) throw new AvisoSinMigrar();
  throw new Error(`bandeja.${op}: ${error.message}`);
}

/** Cuántos días hacia atrás se listan los avisos de la bandeja (los pendientes viejos se siguen viendo hasta resolverse). */
export const DIAS_BANDEJA = 14;
export const TOPE_AVISOS_BANDEJA = 300;
/** Lo que el cliente puede recibir (el mismo tope del compositor y de la entrega). */
export const MAX_TEXTO_AVISO = MAX_TEXTO_AL_CLIENTE;

/** Estados en los que todavía hay algo que hacer. */
export const ESTADOS_PENDIENTES: readonly EstadoAviso[] = ['pendiente_confirmacion', 'sin_destinatario', 'fallido', 'aprobado'];
/** Estados en los que el texto y los datos aún se pueden tocar (aprobado ya está reclamable: no se edita). */
const EDITABLES: readonly EstadoAviso[] = ['pendiente_confirmacion', 'sin_destinatario', 'fallido'];

export interface AvisoBandeja {
  id: string;
  filaId: string;
  clienteId: string | null;
  version: number;
  estado: EstadoAviso;
  canal: CanalAviso;
  texto: string;
  datos: Record<string, unknown>;
  motivo: string | null;
  error: string | null;
  creadoEn: string;
  aprobadoEn: string | null;
  enviadoEn: string | null;
}

export interface DatoManualEntrada {
  operadorNombre?: string | null;
  licencia?: string | null;
  licenciaVence?: string | null;
  telefono?: string | null;
  placasUnidad?: string | null;
  placasCaja?: string | null;
  estadoCaja?: string | null;
}

const COLS = 'id, fila_id, cliente_id, version, estado, canal, texto, datos, motivo, error, creado_en, aprobado_en, enviado_en';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function aAviso(r: Record<string, unknown>): AvisoBandeja {
  const d = r.datos;
  return {
    id: String(r.id), filaId: String(r.fila_id), clienteId: str(r.cliente_id), version: Number(r.version ?? 1),
    estado: String(r.estado) as EstadoAviso, canal: r.canal === 'cliente_1a1' ? 'cliente_1a1' : 'ejecutivo_copia',
    texto: String(r.texto ?? ''),
    datos: typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {},
    motivo: str(r.motivo), error: str(r.error), creadoEn: String(r.creado_en),
    aprobadoEn: str(r.aprobado_en), enviadoEn: str(r.enviado_en),
  };
}

export interface RepoBandeja {
  /** Avisos de los últimos `DIAS_BANDEJA` días (sin los `reemplazado`), los más nuevos primero. */
  listar(tenantId: string, desdeIso: string, soloPendientes: boolean): Promise<AvisoBandeja[]>;
  /** Un aviso de ESTA flota, o `null`. */
  obtener(tenantId: string, id: string): Promise<AvisoBandeja | null>;
  /** Cuántos avisos siguen pendientes (los mismos estados que `ESTADOS_PENDIENTES`, o sea los de «Solo pendientes»). */
  contarPendientes(tenantId: string): Promise<number>;
  /** `desde` → `aprobado` con quién y cuándo; condicional al estado leído (`false` = ya cambió). `canal` solo para la copia manual. */
  aprobar(tenantId: string, id: string, desde: EstadoAviso, userId: string, ahoraIso: string, canal?: CanalAviso): Promise<boolean>;
  /** `sin_destinatario` → `pendiente_confirmacion` (paso previo a aprobar para copiar a mano). */
  reabrir(tenantId: string, id: string): Promise<boolean>;
  /** Cambia el texto de un aviso aún editable y deja constancia de que lo tocó una persona. */
  editarTexto(tenantId: string, aviso: AvisoBandeja, texto: string, userId: string, ahoraIso: string): Promise<boolean>;
  /** Guarda lo capturado a mano para la fila (mezcla con lo que ya había: lo vacío no borra nada). */
  guardarDatoManual(tenantId: string, filaId: string, userId: string, dato: DatoManualEntrada): Promise<'guardado' | 'fila_ajena'>;
}

export function crearRepoBandeja(): RepoBandeja {
  return {
    async listar(tenantId, desdeIso, soloPendientes) {
      let q = supabaseAdmin().from('vigia_aviso').select(COLS).eq('tenant_id', tenantId);
      q = soloPendientes
        ? q.in('estado', [...ESTADOS_PENDIENTES])
        // Lo ya resuelto solo los últimos días; lo que espera a una persona se ve sin importar su edad.
        : q.neq('estado', 'reemplazado').or(`creado_en.gte.${desdeIso},estado.in.(${ESTADOS_PENDIENTES.join(',')})`);
      const { data, error } = await acotada(q.order('creado_en', { ascending: false }).range(0, TOPE_AVISOS_BANDEJA - 1), 'bandeja.listar');
      exigir('listar', error);
      return ((data ?? []) as Record<string, unknown>[]).map(aAviso);
    },

    async obtener(tenantId, id) {
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .select(COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'bandeja.obtener');
      exigir('obtener', error);
      return data ? aAviso(data as Record<string, unknown>) : null;
    },

    async contarPendientes(tenantId) {
      const { count, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
        .in('estado', [...ESTADOS_PENDIENTES]), 'bandeja.contar'); // A37-S58-07: el MISMO conjunto que «Solo pendientes»
      exigir('contar', error);
      return count ?? 0;
    },

    async aprobar(tenantId, id, desde, userId, ahoraIso, canal) {
      const cambio: Record<string, unknown> = { estado: 'aprobado', aprobado_por: userId, aprobado_en: ahoraIso, error: null };
      if (canal) cambio.canal = canal;
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .update(cambio).eq('tenant_id', tenantId).eq('id', id).eq('estado', desde).select('id'), 'bandeja.aprobar');
      exigir('aprobar', error);
      return Array.isArray(data) && data.length > 0;
    },

    async reabrir(tenantId, id) {
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .update({ estado: 'pendiente_confirmacion' }).eq('tenant_id', tenantId).eq('id', id).eq('estado', 'sin_destinatario').select('id'), 'bandeja.reabrir');
      exigir('reabrir', error);
      return Array.isArray(data) && data.length > 0;
    },

    async editarTexto(tenantId, aviso, texto, userId, ahoraIso) {
      const datos = { ...aviso.datos, editado_por_persona: true, editado_por: userId, editado_en: ahoraIso };
      const { data, error } = await acotada(supabaseAdmin().from('vigia_aviso')
        .update({ texto, datos }).eq('tenant_id', tenantId).eq('id', aviso.id).eq('estado', aviso.estado).select('id'), 'bandeja.editar');
      exigir('editar', error);
      return Array.isArray(data) && data.length > 0;
    },

    async guardarDatoManual(tenantId, filaId, userId, d) {
      const db = supabaseAdmin();
      const fila = await acotada(db.from('programa_despacho_fila').select('id').eq('tenant_id', tenantId).eq('id', filaId).maybeSingle(), 'bandeja.fila');
      exigir('fila', fila.error);
      if (!fila.data) return 'fila_ajena';
      const previo = await acotada(db.from('vigia_dato_viaje_manual')
        .select('operador_nombre, licencia, licencia_vence, telefono, placas_unidad, placas_caja, estado_caja')
        .eq('tenant_id', tenantId).eq('fila_id', filaId).maybeSingle(), 'bandeja.dato_previo');
      exigir('dato_previo', previo.error);
      const p = (previo.data ?? {}) as Record<string, unknown>;
      const mezcla = (nuevo: string | null | undefined, antes: unknown): string | null => (nuevo ? nuevo : str(antes));
      const { error } = await acotada(db.from('vigia_dato_viaje_manual').upsert({
        tenant_id: tenantId, fila_id: filaId,
        operador_nombre: mezcla(d.operadorNombre, p.operador_nombre), licencia: mezcla(d.licencia, p.licencia),
        licencia_vence: mezcla(d.licenciaVence, p.licencia_vence), telefono: mezcla(d.telefono, p.telefono),
        placas_unidad: mezcla(d.placasUnidad, p.placas_unidad), placas_caja: mezcla(d.placasCaja, p.placas_caja),
        estado_caja: mezcla(d.estadoCaja, p.estado_caja),
        editado_por: userId, en: new Date().toISOString(),
      }, { onConflict: 'tenant_id,fila_id' }), 'bandeja.dato_manual');
      exigir('dato_manual', error);
      return 'guardado';
    },
  };
}

// ─── copia manual: «Copiar y marcar enviado» ───────────────────────────────

/** El aviso tal como lo pide `entregarAviso`. */
export function paraEntrega(tenantId: string, a: AvisoBandeja): AvisoParaEntrega {
  return {
    id: a.id, tenantId, filaId: a.filaId, clienteId: a.clienteId, version: a.version, estado: a.estado, canal: a.canal,
    texto: a.texto, datos: a.datos,
  };
}

/**
 * Accesos mínimos para `entregarAviso(…, 'copiar')`: reclamar y cerrar por las RPC de la 0797 (service_role) y la bandera de
 * «aviso encendido». «Copiar» no toca a Meta, así que el resto del contexto no se usa y va en su valor más cerrado.
 */
export function crearDepsCopia(tenantId: string, avisoHabilitado: boolean, zona: string): DepsEntrega {
  return {
    tenantId,
    async contexto() {
      return { agenteHabilitado: false, avisoHabilitado, nombreFlota: '', ventanaEnvio: {}, zona, telefonoEjecutivo: null, urlBandeja: null };
    },
    async reclamar(avisoId) {
      const { data, error } = await acotada(supabaseAdmin().rpc('vigia_aviso_reclamar', { p_tenant: tenantId, p_id: avisoId }), 'bandeja.reclamar');
      exigir('reclamar', error);
      const fila = (Array.isArray(data) ? data[0] : null) as { o_token?: string } | null;
      return fila?.o_token ? { token: fila.o_token } : null;
    },
    async cerrar(avisoId, token, estado, err) {
      const { data, error } = await acotada(supabaseAdmin().rpc('vigia_aviso_cerrar', {
        p_tenant: tenantId, p_id: avisoId, p_token: token, p_estado: estado, p_error: err ?? null,
      }), 'bandeja.cerrar');
      exigir('cerrar', error);
      return data === true;
    },
    async contactoDeCliente() { return null; },
  };
}

// ─── captura manual de lo que falta ────────────────────────────────────────

const PLACA = /^[A-Z0-9-]{3,12}$/;
const ESTADOS_CAJA = ['vacia', 'cargada', 'en_patio', 'en_transito', 'desconocido'] as const;

export type ValidacionDato = { ok: true; valor: DatoManualEntrada } | { ok: false; error: string };

const limpiar = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

function placa(v: string, rotulo: string): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (v === '') return { ok: true, valor: null };
  const p = v.toUpperCase().replace(/\s+/g, '');
  return PLACA.test(p) ? { ok: true, valor: p } : { ok: false, error: `${rotulo}: usa de 3 a 12 letras, números o guiones (por ejemplo ABC-1234).` };
}

/** Valida lo que el ejecutivo escribió con las mismas reglas de la tabla (0796). Lo vacío se ignora; todo vacío es error. */
export function validarDatoManual(entrada: Record<string, unknown>): ValidacionDato {
  const out: DatoManualEntrada = {};

  const nombre = limpiar(entrada.operadorNombre);
  if (nombre !== '') {
    if (nombre.length > 120) return { ok: false, error: 'El nombre del operador es demasiado largo (máximo 120 letras).' };
    out.operadorNombre = nombre;
  }
  const licencia = limpiar(entrada.licencia);
  if (licencia !== '') {
    if (licencia.length > 40) return { ok: false, error: 'La licencia es demasiado larga (máximo 40 caracteres).' };
    out.licencia = licencia;
  }
  const vence = limpiar(entrada.licenciaVence);
  if (vence !== '') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vence);
    const f = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!m || !f || f.getUTCFullYear() !== Number(m[1]) || f.getUTCMonth() !== Number(m[2]) - 1 || f.getUTCDate() !== Number(m[3])) {
      return { ok: false, error: 'La vigencia de la licencia debe ser una fecha real (AAAA-MM-DD).' };
    }
    out.licenciaVence = vence;
  }
  const telDigitos = limpiar(entrada.telefono).replace(/[\s().-]/g, '');
  if (telDigitos !== '') {
    const t = /^\d{10}$/.test(telDigitos) ? `52${telDigitos}` : telDigitos;
    if (!/^52\d{10}$/.test(t)) return { ok: false, error: 'El teléfono debe tener 10 dígitos (o 52 y 10 dígitos).' };
    out.telefono = t;
  }
  for (const [campo, rotulo, clave] of [
    ['placasUnidad', 'Placas de la unidad', 'placasUnidad'], ['placasCaja', 'Placas de la caja', 'placasCaja'],
  ] as const) {
    const r = placa(limpiar(entrada[clave]), rotulo);
    if (!r.ok) return r;
    if (r.valor) out[campo] = r.valor;
  }
  const estado = limpiar(entrada.estadoCaja);
  if (estado !== '') {
    if (!(ESTADOS_CAJA as readonly string[]).includes(estado)) return { ok: false, error: 'Elige un estado de la caja de la lista.' };
    out.estadoCaja = estado;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'Escribe al menos un dato para guardar.' };
  return { ok: true, valor: out };
}

// ─── la tarjeta que se pinta ───────────────────────────────────────────────

export const ROTULO_ESTADO: Record<EstadoAviso, string> = {
  borrador: 'Borrador',
  pendiente_confirmacion: 'Pendiente de tu confirmación',
  aprobado: 'Aprobado, por enviar',
  enviado: 'Enviado',
  fallido: 'No se pudo enviar',
  descartado: 'Descartado',
  reemplazado: 'Reemplazado por una versión nueva',
  sin_destinatario: 'Sin destinatario',
};

export const ROTULO_CANAL: Record<CanalAviso, string> = {
  ejecutivo_copia: 'Copia para pegar en tu chat con el cliente',
  cliente_1a1: 'WhatsApp directo al contacto del cliente',
};

const ROTULO_CAMPO: Record<CampoAviso, string> = {
  caja: 'Caja', placas_caja: 'Placas de la caja', estado_caja: 'Estado de la caja', unidad: 'Unidad',
  placas_unidad: 'Placas de la unidad', operador_nombre: 'Operador', licencia: 'Licencia', vigencia: 'Vigencia de la licencia',
  telefono_operador: 'Teléfono del operador',
};

const FALTA: Record<CampoAviso, string> = {
  caja: 'Falta la caja', placas_caja: 'Falta la placa de la caja', estado_caja: 'Falta el estado de la caja',
  unidad: 'Falta la unidad', placas_unidad: 'Falta la placa de la unidad', operador_nombre: 'Falta el operador',
  licencia: 'Falta la licencia del operador', vigencia: 'Falta la vigencia de la licencia', telefono_operador: 'Falta el teléfono del operador',
};

const FUENTE: Record<string, string> = { sistema: 'del sistema', manual: 'capturado a mano', catalogo: 'del catálogo' };

/** Por qué no hay a quién mandarlo (lo de caja/unidad/operador ya sale en «qué falta»). */
const CAUSA_DESTINO: Record<string, string> = {
  sin_cliente: 'No encontré a qué cliente pertenece este servicio.',
  cliente_ambiguo: 'Hay más de un cliente que coincide con ese nombre.',
  sin_contacto: 'El cliente no tiene un contacto autorizado de WhatsApp.',
};

export interface DatoTarjeta { campo: CampoAviso; rotulo: string; valor: string; fuente: string }

export interface TarjetaAviso {
  id: string;
  filaId: string;
  estado: EstadoAviso;
  estadoRotulo: string;
  canal: CanalAviso;
  canalRotulo: string;
  version: number;
  /** `inicial` | `actualizacion` | `cancelacion` | `alerta_cambia_demasiado`. */
  tipo: string;
  interno: boolean;
  fecha: string;
  cliente: string;
  servicio: string;
  cita: string | null;
  texto: string;
  tiene: DatoTarjeta[];
  faltan: Array<{ campo: CampoAviso; texto: string }>;
  causas: string[];
  /** Primera línea de una actualización: lo que cambió desde el aviso anterior. */
  cambio: string | null;
  motivo: string | null;
  /** Mensaje llano de por qué no salió (solo `fallido`). */
  errorLlano: string | null;
  editadoPorPersona: boolean;
  puede: { confirmar: boolean; copiar: boolean; editar: boolean; descartar: boolean; capturar: boolean };
}

/** Teléfonos completos nunca para quien solo mira: queda el final. */
export function ocultarTelefonos(texto: string): string {
  return texto.replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 10 ? `•••• ${d.slice(-4)}` : m;
  });
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** «No pude enviar: …» en llano, con el camino que sigue (copiar y mandarlo por el grupo). */
export function errorEnLlano(error: string | null): string {
  const e = (error ?? '').toLowerCase();
  let causa: string;
  if (/consentimiento|baja|no est[aá] activo|sin_consent|con_baja/.test(e)) causa = 'este cliente no autorizó mensajes por WhatsApp';
  else if (/132001|plantilla/.test(e)) causa = 'la plantilla del aviso todavía no está aprobada en WhatsApp';
  else if (/sin_destinatario|destinatario|contacto/.test(e)) causa = 'el cliente no tiene un contacto de WhatsApp registrado';
  else if (/apagado/.test(e)) causa = 'el Vigía está apagado';
  else causa = 'WhatsApp no lo aceptó';
  return `No pude enviar: ${causa}. Copia el texto y mándalo por tu grupo.`;
}

const PENDIENTE_DATO: readonly CampoAviso[] = ['placas_unidad', 'placas_caja', 'estado_caja', 'operador_nombre', 'licencia', 'vigencia', 'telefono_operador'];

export function armarTarjeta(a: AvisoBandeja, fila: Pick<FilaActual, 'fecha' | 'cliente' | 'consignatario' | 'caja' | 'unidad' | 'citaTexto' | 'citaEn'> | null, soloLectura: boolean): TarjetaAviso {
  const datos = a.datos;
  const valores = objeto(datos.valores);
  const fuentes = objeto(datos.fuentes);
  const tipo = typeof datos.tipo === 'string' ? datos.tipo : 'inicial';
  const interno = datos.interno === true || tipo === 'alerta_cambia_demasiado';

  const tiene: DatoTarjeta[] = [];
  for (const campo of CAMPOS_AVISO) {
    if (CAMPOS_SENSIBLES.includes(campo)) continue; // nunca viajan en `datos`; no se pintan aunque alguien los metiera
    const v = valores[campo];
    if (typeof v !== 'string' || v === '') continue;
    const clave = campo === 'operador_nombre' ? 'operador' : campo;
    const f = typeof fuentes[clave] === 'string' ? (fuentes[clave] as string) : null;
    tiene.push({ campo, rotulo: ROTULO_CAMPO[campo], valor: valor(v, soloLectura), fuente: f ? (FUENTE[f] ?? f) : 'del programa' });
  }

  const pendientes = Array.isArray(datos.pendientes) ? (datos.pendientes as unknown[]).filter((x): x is CampoAviso => (CAMPOS_AVISO as readonly string[]).includes(String(x))) : [];
  const faltan = pendientes.map((campo) => ({ campo, texto: FALTA[campo] }));

  const causas: string[] = [];
  const faltantes = Array.isArray(datos.faltantes) ? (datos.faltantes as unknown[]) : [];
  for (const f of faltantes) { const t = CAUSA_DESTINO[String(f)]; if (t && !causas.includes(t)) causas.push(t); }
  if (a.estado === 'sin_destinatario' && causas.length === 0 && !interno) causas.push('No hay a quién mandarlo: copia el texto y mándalo por tu grupo.');

  const texto = soloLectura ? ocultarTelefonos(a.texto) : a.texto;
  const primera = a.texto.split('\n')[0] ?? '';
  const cambio = a.version > 1 && /^Actualizaci[oó]n/.test(primera) ? (soloLectura ? ocultarTelefonos(primera) : primera) : null;

  const editable = EDITABLES.includes(a.estado) && !soloLectura;
  const accionable = !soloLectura && !interno;
  const puede = {
    confirmar: accionable && a.canal === 'cliente_1a1' && a.estado === 'pendiente_confirmacion',
    copiar: accionable && (
      (a.canal === 'ejecutivo_copia' && (a.estado === 'pendiente_confirmacion' || a.estado === 'aprobado'))
      || a.estado === 'fallido' || a.estado === 'sin_destinatario'
    ),
    editar: editable && !interno,
    descartar: !soloLectura && (EDITABLES.includes(a.estado) || a.estado === 'aprobado'),
    capturar: editable && !interno && tipo !== 'cancelacion' && faltan.some((f) => PENDIENTE_DATO.includes(f.campo)),
  };

  return {
    id: a.id, filaId: a.filaId, estado: a.estado, estadoRotulo: ROTULO_ESTADO[a.estado], canal: a.canal, canalRotulo: ROTULO_CANAL[a.canal],
    version: a.version, tipo, interno,
    fecha: fila?.fecha ?? '', cliente: fila?.cliente ?? fila?.consignatario ?? 'Cliente sin identificar',
    servicio: [fila?.caja ? `caja ${fila.caja}` : null, fila?.unidad ? `unidad ${fila.unidad}` : null].filter(Boolean).join(' · ') || 'servicio sin caja ni unidad',
    cita: fila?.citaTexto ?? fila?.citaEn ?? null,
    texto, tiene, faltan, causas, cambio, motivo: a.motivo,
    errorLlano: a.estado === 'fallido' ? errorEnLlano(a.error) : null,
    editadoPorPersona: datos.editado_por_persona === true,
    puede,
  };
}

function valor(v: string, soloLectura: boolean): string {
  return soloLectura ? ocultarTelefonos(v) : v;
}

export interface GrupoCliente { cliente: string; tarjetas: TarjetaAviso[] }
export interface GrupoDia { fecha: string; clientes: GrupoCliente[] }

/** Por día (el más próximo primero; sin fecha al final) y dentro de cada día por cliente; versiones de menor a mayor. */
export function agruparPorDia(tarjetas: readonly TarjetaAviso[]): GrupoDia[] {
  const dias = new Map<string, Map<string, TarjetaAviso[]>>();
  for (const t of tarjetas) {
    const porCliente = dias.get(t.fecha) ?? new Map<string, TarjetaAviso[]>();
    const lista = porCliente.get(t.cliente) ?? [];
    lista.push(t);
    porCliente.set(t.cliente, lista);
    dias.set(t.fecha, porCliente);
  }
  const orden = [...dias.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x < y ? -1 : x > y ? 1 : 0));
  return orden.map((fecha) => ({
    fecha,
    clientes: [...(dias.get(fecha) as Map<string, TarjetaAviso[]>).entries()]
      .sort(([x], [y]) => x.localeCompare(y, 'es'))
      .map(([cliente, ts]) => ({ cliente, tarjetas: [...ts].sort((p, q) => p.filaId.localeCompare(q.filaId) || p.version - q.version) })),
  }));
}
