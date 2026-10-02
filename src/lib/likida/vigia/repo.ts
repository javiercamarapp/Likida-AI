// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS DEL VIGÍA — todo en UN archivo (mig. 0400).
//
// Implementa `RepoVigia` (lo que el servicio necesita), el servicio de estatus
// de viaje REAL (`ServicioEstatusViaje`) y las lecturas/escrituras del tablero.
// Vive junto para que la frontera de datos (`frontera_datos_guardiana.test.ts`)
// cuente UN archivo nuevo y no uno por tabla.
//
// ── REGLAS QUE ESTE ARCHIVO CUMPLE (y `repo.test.ts` comprueba) ─────────────
//   1. TODA consulta a una tabla con `tenant_id` filtra por él. Las dos únicas
//      que cruzan flotas a propósito son `contactoPorTelefono` (el webhook solo
//      trae el número: el teléfono ES la llave y es único entre activos) y
//      `conversacionesEnEspera` (el cron barre todas las flotas con el agente
//      encendido); ambas devuelven filas que luego se usan CON su propio tenant.
//   2. Las consultas pasan por `acotada` (tope de tiempo) y un error de la base
//      LANZA: «no pude preguntar» nunca se lee como «no hay nada».
//   3. El estatus de viaje se arma SOLO con viajes de ese tenant Y de ese cliente.
//   4. Nada de texto de cliente ni teléfonos en los logs.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { telefonoDeUsuario, telefonoJefeDe } from '../contactos';
import { normalizarTelefonoWa } from '../wa_ventana';
import { hashTelefono } from './servicio';
import {
  etapaDeViaje, ultimoHitoDe, type EstatusViaje, type ResumenViaje, type ServicioEstatusViaje,
} from './estatus_viaje';
import { estatusViaje as estatusDelConductor } from '../conductor/servicios';
import type { EstatusViaje as EstatusConductor } from '../conductor/estatus_viaje';
import { mezclarEstatus, parteDelConductor } from './desde_conductor';
import { adjuntosDeRespaldo, nombreDeAdjunto, nombreDeArchivo, pieDeAdjunto, rutaEsDeLaFlota, SEGUNDOS_URL_ADJUNTO, type ArchivoParaEnviar } from './adjuntos';
import type {
  CambioReclamo, Destinatario, FilaEnEspera, NuevoEvento, NuevoSaliente, RepoVigia, ResultadoRecibir,
} from './puertos';
import {
  configApagada, configParaCliente, type ConfigVigia, type Contacto, type Conversacion, type Intencion, type MensajeVigia, type ModoAprobacion,
} from './tipos';

type Fila = Record<string, unknown>;

function exigir<T>(op: string, r: { data: T | null; error: { message: string; code?: string } | null }): T | null {
  if (r.error) throw new Error(`vigia.${op}: ${r.error.message}`);
  return r.data;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

// ── Mapeos fila → dominio ───────────────────────────────────────────────────

export function aConfig(f: Fila): ConfigVigia {
  return {
    tenantId: String(f.tenant_id),
    habilitado: f.habilitado === true,
    modoAprobacion: (f.modo_aprobacion === 'autoenviar_bajo_riesgo' ? 'autoenviar_bajo_riesgo' : 'siempre') as ModoAprobacion,
    autoenviarMinAprobaciones: num(f.autoenviar_min_aprobaciones) || 5,
    slaRespuestaMin: num(f.sla_respuesta_min) || 30,
    escalarNivel2Min: num(f.escalar_nivel2_min) || 60,
    // 0484: sin migrar la columna no existe → el valor de siempre.
    slaCriticoMin: num(f.sla_critico_min) || 10,
    molestiaAvisoNivel: num(f.molestia_aviso_nivel) === 3 ? 3 : 2,
    retencionDias: num(f.retencion_dias) || 180,
    avisoPrivacidadUrl: str(f.aviso_privacidad_url),
  };
}

export function aContacto(f: Fila): Contacto {
  return {
    id: String(f.id), tenantId: String(f.tenant_id), clienteId: String(f.cliente_id), telefono: String(f.telefono),
    nombre: str(f.nombre), gerenteUserId: str(f.gerente_user_id),
    estado: (f.estado === 'baja' || f.estado === 'suprimido' ? f.estado : 'activo') as Contacto['estado'],
    consentimientoEn: str(f.consentimiento_en), optoutEn: str(f.optout_en), avisoPrivacidadEn: str(f.aviso_privacidad_en),
  };
}

export function aConversacion(f: Fila): Conversacion {
  return {
    id: String(f.id), tenantId: String(f.tenant_id), contactoId: String(f.contacto_id), clienteId: String(f.cliente_id),
    viajeId: str(f.viaje_id), estado: f.estado === 'cerrada' ? 'cerrada' : 'activa',
    control: f.control === 'humano' ? 'humano' : 'agente', tomadaPor: str(f.tomada_por),
    ultimaEntradaEn: str(f.ultima_entrada_en), ultimaSalidaEn: str(f.ultima_salida_en),
    sinRespuestaDesde: str(f.sin_respuesta_desde), entradasSinRespuesta: num(f.entradas_sin_respuesta),
    molestiaNivel: num(f.molestia_nivel), molestiaMotivos: Array.isArray(f.molestia_motivos) ? (f.molestia_motivos as string[]) : [],
    molestiaEn: str(f.molestia_en), escalamientoNivel: num(f.escalamiento_nivel), escaladoEn: str(f.escalado_en), atendidaEn: str(f.atendida_en),
  };
}

export function aMensaje(f: Fila): MensajeVigia {
  return {
    id: String(f.id), tenantId: String(f.tenant_id), conversacionId: String(f.conversacion_id),
    direccion: f.direccion === 'saliente' ? 'saliente' : 'entrante',
    autor: (f.autor === 'agente' || f.autor === 'humano' ? f.autor : 'cliente') as MensajeVigia['autor'],
    wamid: str(f.wamid), tipo: String(f.tipo ?? 'texto'), texto: typeof f.texto === 'string' ? f.texto : null,
    intencion: str(f.intencion) as Intencion | null, estado: String(f.estado) as MensajeVigia['estado'],
    respuestaA: str(f.respuesta_a), riesgo: str(f.riesgo) as MensajeVigia['riesgo'], autoenviado: f.autoenviado === true,
    editado: f.editado === true, aprobadoPor: str(f.aprobado_por), enviadoEn: str(f.enviado_en),
    via: str(f.via) as MensajeVigia['via'], error: str(f.error), senales: Array.isArray(f.senales) ? (f.senales as string[]) : [],
    adjuntos: adjuntosDeRespaldo(f.datos_respaldo),
    createdAt: String(f.created_at),
  };
}

const COLS_CONTACTO = 'id, tenant_id, cliente_id, telefono, nombre, gerente_user_id, estado, consentimiento_en, optout_en, aviso_privacidad_en';
const COLS_CONV = 'id, tenant_id, contacto_id, cliente_id, viaje_id, estado, control, tomada_por, ultima_entrada_en, ultima_salida_en, sin_respuesta_desde, entradas_sin_respuesta, molestia_nivel, molestia_motivos, molestia_en, escalamiento_nivel, escalado_en, atendida_en';
const COLS_MSG = 'id, tenant_id, conversacion_id, direccion, autor, wamid, tipo, texto, intencion, estado, respuesta_a, riesgo, autoenviado, editado, aprobado_por, enviado_en, via, error, senales, datos_respaldo, created_at';

// ═══════════════════════════════════════════════════════════════════════════
// ESTATUS DE VIAJE REAL: viaje + posicion + pod + factura + lo del Agente 5 «Conductor»,
// de UN cliente en UNA flota
// ═══════════════════════════════════════════════════════════════════════════

const ESTATUS_EN_CURSO = ['abierto', 'en_cuadre'];

/** Lo que el estatus real necesita de afuera (inyectable para pruebas). */
export interface DepsEstatusReal {
  /** El estatus que calcula el Conductor (hitos, cita/ETA, andén) de un viaje de ESA flota; `null` si no existe. */
  conductor(tenantId: string, viajeId: string): Promise<EstatusConductor | null>;
}

export function crearEstatusViajeReal(d: DepsEstatusReal): ServicioEstatusViaje {
  return {
  async viajesEnCurso({ tenantId, clienteId }) {
    const db = supabaseAdmin();
    const { data, error } = await acotada(db.from('viaje')
      .select('id, folio, origen, destino')
      .eq('tenant_id', tenantId).eq('cliente_id', clienteId).in('estatus', ESTATUS_EN_CURSO)
      // Sin `regreso_en`: un viaje que ya va de regreso se entregó.
      .is('regreso_en', null)
      .order('created_at', { ascending: false }).order('id').limit(10), 'vigia.viajes_en_curso');
    const filas = exigir('viajes_en_curso', { data, error }) ?? [];
    return (filas as Fila[]).map((f): ResumenViaje => ({ viajeId: String(f.id), folio: str(f.folio), origen: str(f.origen), destino: str(f.destino) }));
  },

  async estatus({ tenantId, clienteId, viajeId }) {
    const db = supabaseAdmin();
    // El viaje SOLO si es de ese cliente en esa flota: es el candado de aislamiento.
    const v = exigir('estatus_viaje', await acotada(db.from('viaje')
      .select('id, folio, origen, destino, estatus, unidad_id, llegada_en, descarga_en, regreso_en')
      .eq('id', viajeId).eq('tenant_id', tenantId).eq('cliente_id', clienteId).maybeSingle(), 'vigia.estatus_viaje')) as Fila | null;
    if (!v) return null;

    const llegadaEn = str(v.llegada_en); const descargaEn = str(v.descarga_en); const regresoEn = str(v.regreso_en);

    // Posición: la última de la unidad del viaje (si tiene unidad y GPS). Un error NO es «sin GPS»: sube.
    let posicion: EstatusViaje['posicion'] = null;
    const unidadId = str(v.unidad_id);
    if (unidadId) {
      const p = exigir('estatus_posicion', await acotada(db.from('posicion')
        .select('lat, lng, medida_en')
        .eq('tenant_id', tenantId).eq('unidad_id', unidadId)
        .order('medida_en', { ascending: false }).order('id', { ascending: false }).limit(1), 'vigia.estatus_posicion')) as Fila[] | null;
      const fila = p?.[0];
      if (fila && typeof fila.lat === 'number' && typeof fila.lng === 'number' && typeof fila.medida_en === 'string') {
        posicion = { lat: fila.lat, lng: fila.lng, medidaEn: fila.medida_en };
      }
    }

    // POD y factura: `null` si no se pudo leer (≠ «no hay»).
    let podRecibido: boolean | null = null;
    let documentos: EstatusViaje['documentos'] = null;
    try {
      const pods = exigir('estatus_pod', await acotada(db.from('pod')
        .select('id').eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'subido').order('id').limit(1), 'vigia.estatus_pod')) as Fila[] | null;
      podRecibido = (pods?.length ?? 0) > 0;
      documentos = [{ nombre: 'Comprobante de entrega (POD)', estado: podRecibido ? 'entregado' : 'pendiente' }];
    } catch (e) {
      logger.warn('vigia.estatus_pod_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    }
    let facturaEmitida: boolean | null = null;
    try {
      const f1 = exigir('estatus_factura', await acotada(db.from('factura_emitida')
        .select('id').eq('tenant_id', tenantId).eq('viaje_id', viajeId).in('estatus', ['emitida', 'pagada']).order('id').limit(1), 'vigia.estatus_factura')) as Fila[] | null;
      let hay = (f1?.length ?? 0) > 0;
      if (!hay) {
        const ligas = exigir('estatus_factura_viaje', await acotada(db.from('factura_viaje')
          .select('factura_id').eq('viaje_id', viajeId).order('factura_id').limit(20), 'vigia.estatus_factura_viaje')) as Fila[] | null;
        const ids = (ligas ?? []).map((l) => String(l.factura_id));
        if (ids.length > 0) {
          const f2 = exigir('estatus_factura_2', await acotada(db.from('factura_emitida')
            .select('id').eq('tenant_id', tenantId).in('id', ids).in('estatus', ['emitida', 'pagada']).order('id').limit(1), 'vigia.estatus_factura_2')) as Fila[] | null;
          hay = (f2?.length ?? 0) > 0;
        }
      }
      facturaEmitida = hay;
    } catch (e) {
      logger.warn('vigia.estatus_factura_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    }

    // Lo del Agente 5 «Conductor»: los cinco hitos, la cita/ETA de cada punto y si el operador está en un andén. Si no se
    // pudo leer, el viaje dice lo que digan sus sellos y SIN ETA (no se rellena: el Vigía contesta «lo consulto» y escala).
    let delConductor: EstatusConductor | null = null;
    try {
      const c = await d.conductor(tenantId, viajeId);
      // El viaje ya se verificó contra el cliente arriba; que el Conductor hable del MISMO viaje es la segunda llave.
      if (c && c.viajeId === viajeId) delConductor = c;
    } catch (e) {
      logger.warn('vigia.estatus_conductor_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    }
    const parte = parteDelConductor(delConductor);
    const base = {
      etapa: etapaDeViaje({ estatus: str(v.estatus), llegadaEn, descargaEn, regresoEn }),
      ultimoHito: ultimoHitoDe({ llegadaEn, descargaEn, regresoEn }),
    };
    const mezcla = mezclarEstatus(base, parte);
    // Un viaje que ya llegó a descarga no tiene «hora estimada de llegada» por decir.
    const yaLlego = mezcla.etapa === 'cerrado' || ['en_destino', 'descargando', 'entregado', 'regresando'].includes(mezcla.etapa);

    return {
      viajeId: String(v.id), folio: str(v.folio), origen: str(v.origen), destino: str(v.destino),
      etapa: mezcla.etapa, ultimoHito: mezcla.ultimoHito, posicion,
      etaIso: yaLlego ? null : parte.etaIso, etaFuente: yaLlego ? null : parte.etaFuente,
      citaCarga: parte.citaCarga, enAnden: parte.enAnden,
      adjuntos: podRecibido === true ? [{ clave: 'pod', nombre: nombreDeAdjunto('pod') }] : [],
      documentos, podRecibido, facturaEmitida,
    };
  },
  };
}

export const estatusViajeReal: ServicioEstatusViaje = crearEstatusViajeReal({ conductor: (tenantId, viajeId) => estatusDelConductor(tenantId, viajeId) });

/**
 * El archivo a adjuntar, de ESE cliente en ESA flota, con URL firmada de 10 min. Se busca por (flota, cliente, viaje): el
 * POD de un viaje de otro cliente de la misma flota (o de otra flota) devuelve `null`. Si la base no contesta LANZA.
 */
export async function archivoAdjuntoReal(a: { tenantId: string; clienteId: string; viajeId: string; clave: 'pod' }): Promise<ArchivoParaEnviar | null> {
  const db = supabaseAdmin();
  const v = exigir('adjunto_viaje', await acotada(db.from('viaje')
    .select('id, folio').eq('id', a.viajeId).eq('tenant_id', a.tenantId).eq('cliente_id', a.clienteId).maybeSingle(), 'vigia.adjunto_viaje')) as Fila | null;
  if (!v) return null;
  const pods = exigir('adjunto_pod', await acotada(db.from('pod')
    .select('storage_path').eq('tenant_id', a.tenantId).eq('viaje_id', a.viajeId).eq('estado', 'subido').order('id').limit(1), 'vigia.adjunto_pod')) as Fila[] | null;
  const ruta = str(pods?.[0]?.storage_path);
  if (!ruta || !rutaEsDeLaFlota(a.tenantId, ruta)) return null;
  const { data, error } = await acotada(db.storage.from('comprobantes').createSignedUrl(ruta, SEGUNDOS_URL_ADJUNTO), 'vigia.adjunto_firma');
  if (error || !data?.signedUrl) {
    logger.warn('vigia.adjunto_no_firmado', { tenant: a.tenantId, err: error?.message ?? 'sin url' });
    return null;
  }
  const folio = str(v.folio);
  return { url: data.signedUrl, nombre: nombreDeArchivo(a.clave, folio, ruta), pie: pieDeAdjunto(a.clave, folio) };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL REPO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los clientes con al menos un grupo CRÍTICO, como `tenant:cliente`. Una base sin la 0484 (tabla inexistente) o una lectura que
 * falla NO tira el barrido: sin el dato, el cliente se atiende con el plazo general (nunca con uno más laxo que el de siempre).
 */
async function clientesCriticos(tenants: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await acotada(supabaseAdmin().from('vigia_grupo').select('tenant_id, cliente_id').in('tenant_id', tenants).eq('critico', true).order('id').limit(5000), 'vigia.clientes_criticos');
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as Fila[]).map((f) => `${String(f.tenant_id)}:${String(f.cliente_id)}`));
  } catch (e) {
    logger.warn('vigia.clientes_criticos_no_leidos', { err: e instanceof Error ? e.message : String(e) });
    return new Set();
  }
}

export function crearRepoVigia(): RepoVigia {
  return {
    async clienteCritico(tenantId, clienteId) {
      return (await clientesCriticos([tenantId])).has(`${tenantId}:${clienteId}`);
    },

    estatus: estatusViajeReal,
    archivoAdjunto: archivoAdjuntoReal,

    async config(tenantId) {
      const f = exigir('config', await acotada(supabaseAdmin().from('vigia_config')
        .select('*').eq('tenant_id', tenantId).maybeSingle(), 'vigia.config')) as Fila | null;
      return f ? aConfig(f) : configApagada(tenantId);
    },

    // Cruza flotas A PROPÓSITO: el webhook solo trae el número. Un número ACTIVO
    // pertenece a UNA flota (índice único parcial de la 0400); el resto de la
    // atención usa el `tenantId` del contacto que vuelve de aquí.
    async contactoPorTelefono(telefono) {
      const filas = exigir('contacto_por_telefono', await acotada(supabaseAdmin().from('vigia_contacto')
        .select(COLS_CONTACTO).eq('telefono', normalizarTelefonoWa(telefono)).in('estado', ['activo', 'baja']).order('id').limit(5), 'vigia.contacto_por_telefono')) as Fila[] | null;
      const lista = (filas ?? []).map(aContacto);
      return lista.find((c) => c.estado === 'activo') ?? lista[0] ?? null;
    },

    async nombreFlota(tenantId) {
      const f = exigir('nombre_flota', await acotada(supabaseAdmin().from('tenant')
        .select('nombre, razon_social').eq('id', tenantId).maybeSingle(), 'vigia.nombre_flota')) as Fila | null;
      return str(f?.razon_social) ?? str(f?.nombre) ?? 'tu flota';
    },

    async nombreCliente(tenantId, clienteId) {
      const f = exigir('nombre_cliente', await acotada(supabaseAdmin().from('cliente')
        .select('nombre').eq('id', clienteId).eq('tenant_id', tenantId).maybeSingle(), 'vigia.nombre_cliente')) as Fila | null;
      return str(f?.nombre);
    },

    async recibir(a) {
      const { data, error } = await acotada(supabaseAdmin().rpc('vigia_recibir_mensaje', {
        p_tenant: a.tenantId, p_contacto: a.contactoId, p_wamid: a.wamid, p_tipo: a.tipo, p_texto: a.texto, p_ahora: a.ahora.toISOString(),
      }), 'vigia.recibir');
      if (error) throw new Error(`vigia.recibir: ${error.message}`);
      const fila = (Array.isArray(data) ? data[0] : data) as Fila | undefined;
      if (!fila || !fila.mensaje_id || !fila.conversacion_id) throw new Error('vigia.recibir: la base devolvió otra forma (¿migración 0400 sin aplicar?)');
      const r: ResultadoRecibir = { mensajeId: String(fila.mensaje_id), conversacionId: String(fila.conversacion_id), duplicado: fila.duplicado === true };
      return r;
    },

    async conversacion(tenantId, id) {
      const f = exigir('conversacion', await acotada(supabaseAdmin().from('vigia_conversacion')
        .select(COLS_CONV).eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'vigia.conversacion')) as Fila | null;
      return f ? aConversacion(f) : null;
    },

    async mensaje(tenantId, id) {
      const f = exigir('mensaje', await acotada(supabaseAdmin().from('vigia_mensaje')
        .select(COLS_MSG).eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'vigia.mensaje')) as Fila | null;
      return f ? aMensaje(f) : null;
    },

    async contactoDe(tenantId, conversacionId) {
      const conv = exigir('contacto_de_conv', await acotada(supabaseAdmin().from('vigia_conversacion')
        .select('contacto_id').eq('id', conversacionId).eq('tenant_id', tenantId).maybeSingle(), 'vigia.contacto_de_conv')) as Fila | null;
      if (!conv) return null;
      const c = exigir('contacto_de', await acotada(supabaseAdmin().from('vigia_contacto')
        .select(COLS_CONTACTO).eq('id', String(conv.contacto_id)).eq('tenant_id', tenantId).maybeSingle(), 'vigia.contacto_de')) as Fila | null;
      return c ? aContacto(c) : null;
    },

    async ultimoEntranteId(tenantId, conversacionId) {
      const f = exigir('ultimo_entrante', await acotada(supabaseAdmin().from('vigia_mensaje')
        .select('id').eq('tenant_id', tenantId).eq('conversacion_id', conversacionId).eq('direccion', 'entrante')
        .order('created_at', { ascending: false }).order('id').limit(1), 'vigia.ultimo_entrante')) as Fila[] | null;
      return f?.[0] ? String(f[0].id) : null;
    },

    async entrantesRecientes(tenantId, conversacionId, desde, limite) {
      const f = exigir('entrantes_recientes', await acotada(supabaseAdmin().from('vigia_mensaje')
        .select('texto, created_at').eq('tenant_id', tenantId).eq('conversacion_id', conversacionId).eq('direccion', 'entrante')
        .gte('created_at', desde.toISOString()).order('created_at', { ascending: true }).order('id').limit(limite), 'vigia.entrantes_recientes')) as Fila[] | null;
      return (f ?? []).map((x) => ({ texto: typeof x.texto === 'string' ? x.texto : null, creadoEn: String(x.created_at) }));
    },

    async anotarClasificacion(tenantId, mensajeId, c) {
      const { error } = await acotada(supabaseAdmin().from('vigia_mensaje')
        .update({ intencion: c.intencion, confianza: Math.round(c.confianza * 100) / 100, clasificador: c.clasificador, senales: c.senales })
        .eq('id', mensajeId).eq('tenant_id', tenantId), 'vigia.anotar_clasificacion');
      if (error) throw new Error(`vigia.anotar_clasificacion: ${error.message}`);
    },

    async crearSaliente(tenantId, n: NuevoSaliente) {
      const db = supabaseAdmin();
      const { data, error } = await acotada(db.from('vigia_mensaje').insert({
        tenant_id: tenantId, conversacion_id: n.conversacionId, direccion: 'saliente', autor: n.autor, tipo: 'texto', texto: n.texto,
        estado: n.estado, respuesta_a: n.respuestaA, intencion: n.intencion, riesgo: n.riesgo, datos_respaldo: n.datosRespaldo,
        senales: n.senales, autoenviado: n.autoenviado, aprobado_por: n.aprobadoPor, aprobado_en: n.estado === 'aprobado' ? new Date().toISOString() : null,
      }).select('id').single(), 'vigia.crear_saliente');
      if (!error && data) return { id: String((data as Fila).id), creado: true };
      // 23505 = ya hay una respuesta del agente para ese entrante (índice único de la 0400): otra pasada la redactó.
      if (error?.code === '23505' && n.respuestaA) {
        const previo = exigir('crear_saliente_previo', await acotada(db.from('vigia_mensaje')
          .select('id').eq('tenant_id', tenantId).eq('respuesta_a', n.respuestaA).eq('autor', 'agente').order('id').limit(1), 'vigia.crear_saliente_previo')) as Fila[] | null;
        if (previo?.[0]) return { id: String(previo[0].id), creado: false };
      }
      throw new Error(`vigia.crear_saliente: ${error?.message ?? 'sin datos'}`);
    },

    async reclamarEstado(tenantId, mensajeId, de, a, cambio: CambioReclamo = {}) {
      const parche: Fila = { estado: a };
      if (cambio.aprobadoPor !== undefined) parche.aprobado_por = cambio.aprobadoPor;
      if (a === 'aprobado') parche.aprobado_en = new Date().toISOString();
      if (cambio.editado !== undefined) parche.editado = cambio.editado;
      if (cambio.texto !== undefined) parche.texto = cambio.texto;
      if (cambio.motivoRechazo !== undefined) parche.motivo_rechazo = cambio.motivoRechazo;
      const filas = exigir('reclamar_estado', await acotada(supabaseAdmin().from('vigia_mensaje')
        .update(parche).eq('id', mensajeId).eq('tenant_id', tenantId).eq('direccion', 'saliente').in('estado', de)
        .select(COLS_MSG), 'vigia.reclamar_estado')) as Fila[] | null;
      // Cero filas = otro lo ganó (o ya no está en ese estado): NO es un error.
      return filas && filas.length > 0 ? aMensaje(filas[0]) : null;
    },

    async marcarEnviado(tenantId, mensajeId, a) {
      const { error } = await acotada(supabaseAdmin().from('vigia_mensaje')
        .update({ estado: 'enviado', via: a.via, wamid: a.wamid, enviado_en: a.ahora.toISOString(), error: null })
        .eq('id', mensajeId).eq('tenant_id', tenantId), 'vigia.marcar_enviado');
      if (error) throw new Error(`vigia.marcar_enviado: ${error.message}`);
    },

    async marcarFallido(tenantId, mensajeId, err) {
      const { error } = await acotada(supabaseAdmin().from('vigia_mensaje')
        .update({ estado: 'fallido', error: err.slice(0, 300) }).eq('id', mensajeId).eq('tenant_id', tenantId), 'vigia.marcar_fallido');
      if (error) throw new Error(`vigia.marcar_fallido: ${error.message}`);
    },

    async marcarAvisoGerente(tenantId, mensajeId, ahora) {
      const { error } = await acotada(supabaseAdmin().from('vigia_mensaje')
        .update({ aviso_gerente_en: ahora.toISOString() }).eq('id', mensajeId).eq('tenant_id', tenantId), 'vigia.marcar_aviso_gerente');
      if (error) throw new Error(`vigia.marcar_aviso_gerente: ${error.message}`);
    },

    async aprobacionesSinEditar(tenantId, intencion) {
      const { count, error } = await acotada(supabaseAdmin().from('vigia_mensaje')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('intencion', intencion).eq('autor', 'agente')
        .eq('editado', false).eq('autoenviado', false).not('aprobado_por', 'is', null).eq('estado', 'enviado'), 'vigia.aprobaciones_sin_editar');
      if (error) throw new Error(`vigia.aprobaciones_sin_editar: ${error.message}`);
      return count ?? 0;
    },

    async pendientesDeHilo(tenantId, conversacionId) {
      const f = exigir('pendientes_de_hilo', await acotada(supabaseAdmin().from('vigia_mensaje')
        .select('id').eq('tenant_id', tenantId).eq('conversacion_id', conversacionId).eq('direccion', 'saliente')
        .in('estado', ['pendiente_aprobacion', 'borrador']).order('id').limit(50), 'vigia.pendientes_de_hilo')) as Fila[] | null;
      return (f ?? []).map((x) => String(x.id));
    },

    async actualizarConversacion(tenantId, id, p) {
      const m: Record<string, string> = {
        viajeId: 'viaje_id', molestiaNivel: 'molestia_nivel', molestiaMotivos: 'molestia_motivos', molestiaEn: 'molestia_en',
        escalamientoNivel: 'escalamiento_nivel', escaladoEn: 'escalado_en', control: 'control', tomadaPor: 'tomada_por',
        tomadaEn: 'tomada_en', atendidaEn: 'atendida_en', atendidaPor: 'atendida_por',
      };
      const parche: Fila = { updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(p)) if (m[k] !== undefined && v !== undefined) parche[m[k]] = v;
      const { error } = await acotada(supabaseAdmin().from('vigia_conversacion')
        .update(parche).eq('id', id).eq('tenant_id', tenantId), 'vigia.actualizar_conversacion');
      if (error) throw new Error(`vigia.actualizar_conversacion: ${error.message}`);
    },

    async marcarRespondida(tenantId, conversacionId, ahora) {
      const { error } = await acotada(supabaseAdmin().from('vigia_conversacion').update({
        sin_respuesta_desde: null, entradas_sin_respuesta: 0, escalamiento_nivel: 0, escalado_en: null, atendida_en: null, atendida_por: null,
        molestia_nivel: 0, molestia_motivos: [], molestia_en: null, ultima_salida_en: ahora.toISOString(), updated_at: ahora.toISOString(),
      }).eq('id', conversacionId).eq('tenant_id', tenantId), 'vigia.marcar_respondida');
      if (error) throw new Error(`vigia.marcar_respondida: ${error.message}`);
    },

    async cerrarConversacion(tenantId, conversacionId, ahora) {
      const { error } = await acotada(supabaseAdmin().from('vigia_conversacion').update({
        estado: 'cerrada', cerrada_en: ahora.toISOString(), sin_respuesta_desde: null, updated_at: ahora.toISOString(),
      }).eq('id', conversacionId).eq('tenant_id', tenantId), 'vigia.cerrar_conversacion');
      if (error) throw new Error(`vigia.cerrar_conversacion: ${error.message}`);
    },

    async evento(tenantId, e: NuevoEvento) {
      const { error } = await acotada(supabaseAdmin().from('vigia_evento').insert({
        tenant_id: tenantId, conversacion_id: e.conversacionId ?? null, tipo: e.tipo, clave: e.clave ?? null, nivel: e.nivel ?? null,
        actor_user_id: e.actorUserId ?? null, destinatario_hash: e.destinatarioHash ?? null, detalle: e.detalle ?? {},
      }), 'vigia.evento');
      if (error) {
        // Clave repetida = el sello anti-repetición funcionó: NO es un fallo.
        if (error.code === '23505' && e.clave) return false;
        throw new Error(`vigia.evento: ${error.message}`);
      }
      return true;
    },

    async registrarOptOut(tenantId, contactoId, ahora) {
      const { error } = await acotada(supabaseAdmin().from('vigia_contacto')
        .update({ estado: 'baja', optout_en: ahora.toISOString(), updated_at: ahora.toISOString() })
        .eq('id', contactoId).eq('tenant_id', tenantId), 'vigia.registrar_optout');
      if (error) throw new Error(`vigia.registrar_optout: ${error.message}`);
    },

    async marcarAvisoPrivacidad(tenantId, contactoId, ahora) {
      const { error } = await acotada(supabaseAdmin().from('vigia_contacto')
        .update({ aviso_privacidad_en: ahora.toISOString() }).eq('id', contactoId).eq('tenant_id', tenantId).is('aviso_privacidad_en', null), 'vigia.marcar_aviso_privacidad');
      if (error) throw new Error(`vigia.marcar_aviso_privacidad: ${error.message}`);
    },

    async destinatarioNivel(tenantId, contacto, nivel): Promise<Destinatario | null> {
      if (nivel === 1) {
        if (contacto.gerenteUserId) {
          const tel = await telefonoDeUsuario(contacto.gerenteUserId, tenantId);
          if (tel) return { userId: contacto.gerenteUserId, telefono: normalizarTelefonoWa(tel) };
        }
        const jefe = await telefonoJefeDe(tenantId);
        return jefe ? { userId: null, telefono: normalizarTelefonoWa(jefe) } : null;
      }
      const f = exigir('destinatario_dueno', await acotada(supabaseAdmin().from('app_user')
        .select('id, telefono, activo').eq('tenant_id', tenantId).eq('rol', 'flota_admin')
        .or('activo.is.null,activo.eq.true').not('telefono', 'is', null).order('id').limit(5), 'vigia.destinatario_dueno')) as Fila[] | null;
      const dueno = (f ?? []).find((x) => x.activo !== false && str(x.telefono));
      return dueno ? { userId: String(dueno.id), telefono: normalizarTelefonoWa(String(dueno.telefono)) } : null;
    },

    // El cron: cruza flotas A PROPÓSITO (barre todas las que tienen el agente encendido).
    async conversacionesEnEspera(limite): Promise<FilaEnEspera[]> {
      const db = supabaseAdmin();
      const convs = (exigir('en_espera', await acotada(db.from('vigia_conversacion')
        .select(COLS_CONV).eq('estado', 'activa').not('sin_respuesta_desde', 'is', null)
        .order('sin_respuesta_desde', { ascending: true }).order('id').limit(limite), 'vigia.en_espera')) as Fila[] | null ?? []).map(aConversacion);
      if (convs.length === 0) return [];
      const tenants = [...new Set(convs.map((c) => c.tenantId))];
      const configs = (exigir('en_espera_config', await acotada(db.from('vigia_config')
        .select('*').in('tenant_id', tenants).eq('habilitado', true), 'vigia.en_espera_config')) as Fila[] | null ?? []).map(aConfig);
      const contactos = (exigir('en_espera_contactos', await acotada(db.from('vigia_contacto')
        .select(COLS_CONTACTO).in('tenant_id', tenants).in('id', convs.map((c) => c.contactoId)), 'vigia.en_espera_contactos')) as Fila[] | null ?? []).map(aContacto);
      const criticos = await clientesCriticos(tenants);
      const salida: FilaEnEspera[] = [];
      for (const conversacion of convs) {
        const config = configs.find((c) => c.tenantId === conversacion.tenantId);
        const contacto = contactos.find((c) => c.id === conversacion.contactoId && c.tenantId === conversacion.tenantId);
        // Sin config encendida o sin contacto de ESA flota: no se toca.
        if (config && contacto) salida.push({ conversacion, contacto, config: configParaCliente(config, criticos.has(`${conversacion.tenantId}:${conversacion.clienteId}`)) });
      }
      return salida;
    },

    async aprobadosAtorados(antesDe, limite) {
      const f = exigir('aprobados_atorados', await acotada(supabaseAdmin().from('vigia_mensaje')
        .select('id, tenant_id').eq('direccion', 'saliente').eq('estado', 'aprobado').lt('aprobado_en', antesDe.toISOString()).order('id').limit(limite), 'vigia.aprobados_atorados')) as Fila[] | null;
      return (f ?? []).map((x) => ({ tenantId: String(x.tenant_id), id: String(x.id) }));
    },

    async purgar(limite) {
      const { data, error } = await acotada(supabaseAdmin().rpc('vigia_purgar', { p_limite: limite }), 'vigia.purgar');
      if (error) throw new Error(`vigia.purgar: ${error.message}`);
      // 0484: el histórico importado caduca con la misma retención. Sin la función (base sin migrar) no es un fallo del barrido.
      const h = await acotada(supabaseAdmin().rpc('vigia_historial_purgar', { p_limite: limite }), 'vigia.purgar_historial');
      if (h.error && h.error.code !== '42883' && h.error.code !== 'PGRST202') logger.warn('vigia.purgar_historial_fallo', { err: h.error.message });
      return typeof data === 'number' ? data : 0;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO (/dashboard/agentes/vigia) — lecturas y acciones de la flota
// ═══════════════════════════════════════════════════════════════════════════

export interface ConversacionTablero {
  id: string;
  contactoId: string;
  contactoNombre: string | null;
  clienteNombre: string | null;
  control: 'agente' | 'humano';
  sinRespuestaDesde: string | null;
  molestiaNivel: number;
  molestiaMotivos: string[];
  escalamientoNivel: number;
  atendida: boolean;
  ultimaEntradaEn: string | null;
  ultimoMensajeCliente: string | null;
}

export interface PendienteTablero {
  id: string;
  conversacionId: string;
  clienteNombre: string | null;
  mensajeCliente: string | null;
  borrador: string;
  intencion: Intencion | null;
  riesgo: 'bajo' | 'medio' | 'alto' | null;
  senales: string[];
  /** Los archivos que saldrán con la respuesta (nombres legibles) si el gerente la aprueba. */
  adjuntos: string[];
  creadoEn: string;
}

export interface FalloTablero { id: string; conversacionId: string; clienteNombre: string | null; error: string | null; creadoEn: string }

export interface ContactoTablero {
  id: string; nombre: string | null; clienteNombre: string | null; telefonoTerminacion: string; estado: Contacto['estado'];
  consentimientoEn: string | null; gerenteUserId: string | null;
}

export interface EventoTablero { id: number; tipo: string; nivel: number | null; creadoEn: string; conversacionId: string | null }

export interface DatosTablero {
  config: ConfigVigia;
  conversaciones: ConversacionTablero[];
  pendientes: PendienteTablero[];
  fallidos: FalloTablero[];
  contactos: ContactoTablero[];
  eventos: EventoTablero[];
  /** Tiempo de PRIMERA respuesta medido sobre las últimas respuestas enviadas (7 días); `null` = sin muestra. */
  respuesta: { muestra: number; promedioMin: number | null; medianaMin: number | null };
  clientes: Array<{ id: string; nombre: string }>;
  gerentes: Array<{ id: string; nombre: string | null; rol: string }>;
}

function recorta(t: unknown, n: number): string | null {
  if (typeof t !== 'string' || !t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export async function cargarTablero(tenantId: string, ahora: Date = new Date()): Promise<DatosTablero> {
  const db = supabaseAdmin();
  const repo = crearRepoVigia();
  const config = await repo.config(tenantId);

  const convRows = (exigir('tablero_conv', await acotada(db.from('vigia_conversacion')
    .select(COLS_CONV).eq('tenant_id', tenantId).eq('estado', 'activa')
    .order('updated_at', { ascending: false }).order('id').limit(100), 'vigia.tablero_conv')) as Fila[] | null ?? []).map(aConversacion);

  const contactosRows = (exigir('tablero_contactos', await acotada(db.from('vigia_contacto')
    .select(COLS_CONTACTO).eq('tenant_id', tenantId).neq('estado', 'suprimido')
    .order('created_at', { ascending: false }).order('id').limit(200), 'vigia.tablero_contactos')) as Fila[] | null ?? []).map(aContacto);

  const clientesRows = (exigir('tablero_clientes', await acotada(db.from('cliente')
    .select('id, nombre').eq('tenant_id', tenantId).eq('activo', true).order('nombre').order('id').limit(500), 'vigia.tablero_clientes')) as Fila[] | null ?? [])
    .map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
  const nombreCliente = new Map(clientesRows.map((c) => [c.id, c.nombre]));
  const contactoPorId = new Map(contactosRows.map((c) => [c.id, c]));

  // El último mensaje del cliente de cada conversación activa (una consulta, no N).
  const idsConv = convRows.map((c) => c.id);
  const ultimos = new Map<string, string | null>();
  if (idsConv.length > 0) {
    const ent = (exigir('tablero_ultimos', await acotada(db.from('vigia_mensaje')
      .select('conversacion_id, texto, created_at').eq('tenant_id', tenantId).eq('direccion', 'entrante').in('conversacion_id', idsConv)
      .order('created_at', { ascending: false }).order('id').limit(300), 'vigia.tablero_ultimos')) as Fila[] | null ?? []);
    for (const m of ent) if (!ultimos.has(String(m.conversacion_id))) ultimos.set(String(m.conversacion_id), recorta(m.texto, 160));
  }

  const conversaciones: ConversacionTablero[] = convRows.map((c) => ({
    id: c.id, contactoId: c.contactoId, contactoNombre: contactoPorId.get(c.contactoId)?.nombre ?? null,
    clienteNombre: nombreCliente.get(c.clienteId) ?? null, control: c.control, sinRespuestaDesde: c.sinRespuestaDesde,
    molestiaNivel: c.molestiaNivel, molestiaMotivos: c.molestiaMotivos, escalamientoNivel: c.escalamientoNivel,
    atendida: c.atendidaEn !== null, ultimaEntradaEn: c.ultimaEntradaEn, ultimoMensajeCliente: ultimos.get(c.id) ?? null,
  }));

  // Cola de aprobación.
  const pend = (exigir('tablero_pendientes', await acotada(db.from('vigia_mensaje')
    .select(COLS_MSG).eq('tenant_id', tenantId).eq('direccion', 'saliente').eq('estado', 'pendiente_aprobacion')
    .order('created_at', { ascending: true }).order('id').limit(50), 'vigia.tablero_pendientes')) as Fila[] | null ?? []).map(aMensaje);
  const respuestaIds = pend.map((m) => m.respuestaA).filter((x): x is string => !!x);
  const entrantesDe = new Map<string, string | null>();
  if (respuestaIds.length > 0) {
    const e = (exigir('tablero_pendientes_entrante', await acotada(db.from('vigia_mensaje')
      .select('id, texto').eq('tenant_id', tenantId).in('id', respuestaIds), 'vigia.tablero_pendientes_entrante')) as Fila[] | null ?? []);
    for (const f of e) entrantesDe.set(String(f.id), recorta(f.texto, 300));
  }
  const clienteDeConv = new Map(convRows.map((c) => [c.id, nombreCliente.get(c.clienteId) ?? null]));
  const pendientes: PendienteTablero[] = pend.map((m) => ({
    id: m.id, conversacionId: m.conversacionId, clienteNombre: clienteDeConv.get(m.conversacionId) ?? null,
    mensajeCliente: m.respuestaA ? entrantesDe.get(m.respuestaA) ?? null : null, borrador: m.texto ?? '',
    intencion: m.intencion, riesgo: m.riesgo, senales: m.senales, adjuntos: m.adjuntos.map((a) => nombreDeAdjunto(a.clave)), creadoEn: m.createdAt,
  }));

  // Envíos fallidos de las últimas 24 h.
  const desde24 = new Date(ahora.getTime() - 24 * 3_600_000).toISOString();
  const fallidos = (exigir('tablero_fallidos', await acotada(db.from('vigia_mensaje')
    .select(COLS_MSG).eq('tenant_id', tenantId).eq('direccion', 'saliente').eq('estado', 'fallido').gte('created_at', desde24)
    .order('created_at', { ascending: false }).order('id').limit(20), 'vigia.tablero_fallidos')) as Fila[] | null ?? []).map(aMensaje)
    .map((m): FalloTablero => ({ id: m.id, conversacionId: m.conversacionId, clienteNombre: clienteDeConv.get(m.conversacionId) ?? null, error: m.error, creadoEn: m.createdAt }));

  // Bitácora reciente (sin texto de clientes).
  const eventos = (exigir('tablero_eventos', await acotada(db.from('vigia_evento')
    .select('id, tipo, nivel, created_at, conversacion_id').eq('tenant_id', tenantId)
    .order('id', { ascending: false }).limit(40), 'vigia.tablero_eventos')) as Fila[] | null ?? [])
    .map((f): EventoTablero => ({ id: num(f.id), tipo: String(f.tipo), nivel: f.nivel === null ? null : num(f.nivel), creadoEn: String(f.created_at), conversacionId: str(f.conversacion_id) }));

  // Tiempo de primera respuesta: enviadas de los últimos 7 días contra el entrante al que contestan.
  const desde7 = new Date(ahora.getTime() - 7 * 86_400_000).toISOString();
  const enviadas = (exigir('tablero_enviadas', await acotada(db.from('vigia_mensaje')
    .select('respuesta_a, enviado_en').eq('tenant_id', tenantId).eq('direccion', 'saliente').eq('estado', 'enviado')
    .not('respuesta_a', 'is', null).gte('enviado_en', desde7).order('enviado_en', { ascending: false }).order('id').limit(100), 'vigia.tablero_enviadas')) as Fila[] | null ?? []);
  const tiempos: number[] = [];
  if (enviadas.length > 0) {
    const ents = (exigir('tablero_enviadas_ent', await acotada(db.from('vigia_mensaje')
      .select('id, created_at').eq('tenant_id', tenantId).in('id', enviadas.map((e) => String(e.respuesta_a))), 'vigia.tablero_enviadas_ent')) as Fila[] | null ?? []);
    const creado = new Map(ents.map((e) => [String(e.id), Date.parse(String(e.created_at))]));
    for (const e of enviadas) {
      const t0 = creado.get(String(e.respuesta_a)); const t1 = Date.parse(String(e.enviado_en));
      if (t0 !== undefined && Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) tiempos.push((t1 - t0) / 60_000);
    }
  }
  tiempos.sort((a, b) => a - b);
  const respuesta = {
    muestra: tiempos.length,
    promedioMin: tiempos.length ? Math.round(tiempos.reduce((s, x) => s + x, 0) / tiempos.length) : null,
    medianaMin: tiempos.length ? Math.round(tiempos[Math.floor(tiempos.length / 2)]) : null,
  };

  const gerentes = (exigir('tablero_gerentes', await acotada(db.from('app_user')
    .select('id, nombre, rol, activo').eq('tenant_id', tenantId).in('rol', ['flota_admin', 'encargado']).or('activo.is.null,activo.eq.true').order('id').limit(50), 'vigia.tablero_gerentes')) as Fila[] | null ?? [])
    .filter((f) => f.activo !== false).map((f) => ({ id: String(f.id), nombre: str(f.nombre), rol: String(f.rol) }));

  return {
    config, conversaciones, pendientes, fallidos, eventos, respuesta, clientes: clientesRows, gerentes,
    contactos: contactosRows.map((c) => ({
      id: c.id, nombre: c.nombre, clienteNombre: nombreCliente.get(c.clienteId) ?? null, telefonoTerminacion: c.telefono.slice(-4),
      estado: c.estado, consentimientoEn: c.consentimientoEn, gerenteUserId: c.gerenteUserId,
    })),
  };
}

// ── Acciones de la flota (las validaciones viven aquí y se prueban con dobles) ─────

export interface ValoresConfig {
  habilitado: boolean;
  modoAprobacion: ModoAprobacion;
  autoenviarMinAprobaciones: number;
  slaRespuestaMin: number;
  escalarNivel2Min: number;
  slaCriticoMin: number;
  molestiaAvisoNivel: 2 | 3;
  retencionDias: number;
  avisoPrivacidadUrl: string | null;
}

export type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string };

const entero = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function validarConfig(c: Record<string, unknown>): Validacion<ValoresConfig> {
  const modo = c.modoAprobacion === 'autoenviar_bajo_riesgo' ? 'autoenviar_bajo_riesgo' : c.modoAprobacion === 'siempre' ? 'siempre' : null;
  if (!modo) return { ok: false, error: 'Elige un modo de aprobación válido.' };
  const min = entero(c.autoenviarMinAprobaciones, 1, 100);
  if (min === null) return { ok: false, error: 'Las aprobaciones previas deben ser un número entre 1 y 100.' };
  const sla = entero(c.slaRespuestaMin, 5, 1440);
  if (sla === null) return { ok: false, error: 'El tiempo de respuesta debe estar entre 5 y 1,440 minutos.' };
  const n2 = entero(c.escalarNivel2Min, 5, 2880);
  if (n2 === null) return { ok: false, error: 'El tiempo para avisar al dueño debe estar entre 5 y 2,880 minutos.' };
  const vacio = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
  const crit = vacio(c.slaCriticoMin) ? 10 : entero(c.slaCriticoMin, 2, 1440);
  if (crit === null) return { ok: false, error: 'El tiempo para clientes críticos debe estar entre 2 y 1,440 minutos.' };
  const molestia = vacio(c.molestiaAvisoNivel) ? 2 : entero(c.molestiaAvisoNivel, 2, 3);
  if (molestia === null) return { ok: false, error: 'El nivel de molestia para avisar debe ser 2 o 3.' };
  const ret = entero(c.retencionDias, 30, 730);
  if (ret === null) return { ok: false, error: 'La retención debe estar entre 30 y 730 días.' };
  const urlCruda = typeof c.avisoPrivacidadUrl === 'string' ? c.avisoPrivacidadUrl.trim() : '';
  if (urlCruda && !/^https:\/\/[^\s]{1,480}$/.test(urlCruda)) return { ok: false, error: 'La liga del aviso de privacidad debe empezar con https://' };
  return { ok: true, valor: {
    habilitado: c.habilitado === true, modoAprobacion: modo, autoenviarMinAprobaciones: min, slaRespuestaMin: sla,
    escalarNivel2Min: n2, slaCriticoMin: crit, molestiaAvisoNivel: molestia === 3 ? 3 : 2, retencionDias: ret, avisoPrivacidadUrl: urlCruda || null,
  } };
}

export async function guardarConfigVigia(tenantId: string, userId: string, v: ValoresConfig): Promise<void> {
  const base = {
    tenant_id: tenantId, habilitado: v.habilitado, modo_aprobacion: v.modoAprobacion, autoenviar_min_aprobaciones: v.autoenviarMinAprobaciones,
    sla_respuesta_min: v.slaRespuestaMin, escalar_nivel2_min: v.escalarNivel2Min, retencion_dias: v.retencionDias,
    aviso_privacidad_url: v.avisoPrivacidadUrl, updated_at: new Date().toISOString(), updated_by: userId,
  };
  const db = supabaseAdmin();
  const { error } = await acotada(db.from('vigia_config').upsert(
    { ...base, sla_critico_min: v.slaCriticoMin, molestia_aviso_nivel: v.molestiaAvisoNivel }, { onConflict: 'tenant_id' }), 'vigia.guardar_config');
  if (!error) return;
  // Base sin la 0484 (columna inexistente): se guarda lo de siempre en vez de perder el cambio entero.
  if (error.code === '42703' || error.code === 'PGRST204') {
    const r = await acotada(db.from('vigia_config').upsert(base, { onConflict: 'tenant_id' }), 'vigia.guardar_config_sin_0484');
    if (!r.error) return;
    throw new Error(`vigia.guardar_config: ${r.error.message}`);
  }
  throw new Error(`vigia.guardar_config: ${error.message}`);
}

/** Teléfono de un cliente en la forma de la allowlist (52 + 10 dígitos), o `null` si no es mexicano válido. PURA. */
export function telefonoDeAllowlist(crudo: string): string | null {
  const n = normalizarTelefonoWa(crudo);
  if (/^52\d{10}$/.test(n)) return n;
  if (/^\d{10}$/.test(n)) return `52${n}`;
  return null;
}

export interface AltaContacto {
  clienteId: string;
  telefono: string;
  nombre: string | null;
  gerenteUserId: string | null;
  /** La flota declara que el cliente autorizó que se le escriba por WhatsApp. Sin esto no hay alta. */
  consentimiento: boolean;
}

export async function altaContactoVigia(tenantId: string, userId: string, a: AltaContacto): Promise<Validacion<{ id: string }>> {
  if (!a.consentimiento) return { ok: false, error: 'Confirma que el cliente autorizó recibir mensajes por WhatsApp: sin esa constancia no se le escribe.' };
  const tel = telefonoDeAllowlist(a.telefono);
  if (!tel) return { ok: false, error: 'Escribe el WhatsApp del cliente a 10 dígitos (o con 52).' };
  const nombre = (a.nombre ?? '').trim().slice(0, 120) || null;
  const db = supabaseAdmin();

  // El cliente y el gerente tienen que ser DE ESTA flota.
  const cli = exigir('alta_cliente', await acotada(db.from('cliente').select('id').eq('id', a.clienteId).eq('tenant_id', tenantId).maybeSingle(), 'vigia.alta_cliente')) as Fila | null;
  if (!cli) return { ok: false, error: 'Ese cliente no es de tu flota.' };
  if (a.gerenteUserId) {
    const g = exigir('alta_gerente', await acotada(db.from('app_user').select('id').eq('id', a.gerenteUserId).eq('tenant_id', tenantId).maybeSingle(), 'vigia.alta_gerente')) as Fila | null;
    if (!g) return { ok: false, error: 'Ese responsable no es de tu flota.' };
  }
  const { data, error } = await acotada(db.from('vigia_contacto').insert({
    tenant_id: tenantId, cliente_id: a.clienteId, telefono: tel, telefono_hash: hashTelefono(tel), nombre, gerente_user_id: a.gerenteUserId,
    estado: 'activo', consentimiento_en: new Date().toISOString(), consentimiento_origen: 'alta_flota',
  }).select('id').single(), 'vigia.alta_contacto');
  if (error) {
    // Mensaje genérico: no se revela en qué otra flota está ese número.
    if (error.code === '23505') return { ok: false, error: 'Ese número no se pudo dar de alta (ya está en uso). Si es de tu cliente, escríbenos a soporte.' };
    throw new Error(`vigia.alta_contacto: ${error.message}`);
  }
  const id = String((data as Fila).id);
  await crearRepoVigia().evento(tenantId, { tipo: 'alta', actorUserId: userId, destinatarioHash: hashTelefono(tel), detalle: { contacto: id } });
  return { ok: true, valor: { id } };
}

export async function bajaManualContacto(tenantId: string, userId: string, contactoId: string): Promise<boolean> {
  const filas = exigir('baja_manual', await acotada(supabaseAdmin().from('vigia_contacto')
    .update({ estado: 'baja', optout_en: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', contactoId).eq('tenant_id', tenantId).eq('estado', 'activo').select('telefono_hash'), 'vigia.baja_manual')) as Fila[] | null;
  if (!filas || filas.length === 0) return false;
  await crearRepoVigia().evento(tenantId, { tipo: 'baja_manual', actorUserId: userId, destinatarioHash: String(filas[0].telefono_hash) });
  // Sus hilos abiertos se cierran: nadie más le escribe.
  await acotada(supabaseAdmin().from('vigia_conversacion').update({ estado: 'cerrada', cerrada_en: new Date().toISOString(), sin_respuesta_desde: null })
    .eq('contacto_id', contactoId).eq('tenant_id', tenantId).eq('estado', 'activa'), 'vigia.baja_manual_conv');
  return true;
}

/** ARCO — cancelación: borra mensajes y conversaciones del contacto y deja su teléfono solo como hash. */
export async function suprimirContactoVigia(tenantId: string, contactoId: string): Promise<{ mensajes: number; conversaciones: number } | null> {
  const { data, error } = await acotada(supabaseAdmin().rpc('vigia_suprimir_contacto', { p_tenant: tenantId, p_contacto: contactoId }), 'vigia.suprimir');
  if (error) {
    if (error.code === 'P0001') return null; // inexistente en esta flota
    throw new Error(`vigia.suprimir: ${error.message}`);
  }
  const d = (data ?? {}) as Fila;
  return { mensajes: num(d.mensajes), conversaciones: num(d.conversaciones) };
}

