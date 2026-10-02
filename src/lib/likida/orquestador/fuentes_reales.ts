import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { getUltimasPosiciones } from '../comercial';
import { colaCobranza } from '../agentes/cobranza';
import { tableroGastos } from '../agentes/cobranza_gasto';
import { ultimasCorridas, type AgenteConCorridas } from '../agentes/corridas';
import { fasesDePortales, lotesVivos, repoControl } from '../autofactura/control_emision_repo';
import { conteoBuzon } from '../buzon/repo';
import { leerConfigConductor } from '../conductor/repo';
import { leerCatalogosFiltro, leerDatosTablero } from '../conductor/repo_validacion';
import { leerGrupos } from '../vigia/historial/repo';
import { ConveniosNoDisponibles, leerLigado, listarViajesConConvenio } from '../convenios/repo';
import { contarNoCoincide, contarPorEstado, listarLiquidacionesExternas } from '../liquidacion_externa/repo';
import { reporteReclamacion } from '../peajes/bitacora_conciliada';
import { JornadaIlegible, leerJornadas } from '../jornada/repo';
import { hoyMx } from '@/lib/formato';
import { cargarTablero } from '../vigia/repo';
import { estadoLatidos } from '@/lib/admin/salud';
import { registrarFuentesReales, type Fuentes, type ResultadoCrearEscalacion } from './fuentes';
import { AGENTES_VIGILADOS, type CorridaVista, type EntradaSalud, type LatidoVisto } from './salud_agentes';
import { PATRON_FOLIO, llaveDedupe, type Destino, type Motivo, type TareaAbierta } from './escalamiento';
import { MAX_INTENTOS_AVISO, REINTENTO_AVISO_MIN, avisarEscalacion, depsDeCorreo, type DepsAvisoEscalacion, type TareaParaAviso } from './aviso_escalacion';
import { PREFIJO_BARRIDO, type DepsBarrido } from './barrido_salud';
import type { PuertoCicloVivo } from './ciclo_cron';
import { posicionesDeGps } from './tablero_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS FUENTES REALES — solo COMPONEN los lectores que cada agente ya tiene (con su
// `tenant_id` en cada consulta). No hay lectura nueva de datos de otros agentes;
// lo único propio es la tabla de escalaciones (0650) y dos conteos de «envíos que
// no salieron». Todo se tolera contra una base SIN migrar: una tabla que no
// existe se dice («disponible: false» / null), jamás se pinta como «cero».
// ═══════════════════════════════════════════════════════════════════════════

// 42P01/PGRST205: tabla inexistente. 42703/PGRST204: columna inexistente (base sin la 0651). 42883/PGRST202: función inexistente (sin la 0652).
const SIN_TABLA = new Set(['42P01', 'PGRST205', '42703', 'PGRST204', '42883', 'PGRST202']);
const esSinTabla = (e: { code?: string } | null): boolean => !!e && !!e.code && SIN_TABLA.has(e.code);
const DIA_MS = 86_400_000;

async function sinFallar<T>(etiqueta: string, p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (e) {
    logger.warn('orquestador.fuente_sin_leer', { fuente: etiqueta, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function entregasBuzon(tenantId: string, ahora: Date): Promise<{ porEstado: Record<string, number>; ultimaEnviadaEn: string | null } | null> {
  const desde = new Date(ahora.getTime() - 30 * DIA_MS).toISOString();
  const r = await acotada(supabaseAdmin().from('buzon_entrega').select('estado, enviada_en')
    .eq('tenant_id', tenantId).gte('creado_en', desde).order('creado_en', { ascending: false }).order('id').limit(500), 'orquestador.buzon_entregas');
  if (esSinTabla(r.error)) return null;
  if (r.error) throw new Error(`orquestador.buzon_entregas: ${r.error.message}`);
  const porEstado: Record<string, number> = {};
  let ultima: string | null = null;
  for (const f of (r.data ?? []) as Array<{ estado: string; enviada_en: string | null }>) {
    porEstado[f.estado] = (porEstado[f.estado] ?? 0) + 1;
    if (f.enviada_en && (!ultima || f.enviada_en > ultima)) ultima = f.enviada_en;
  }
  return { porEstado, ultimaEnviadaEn: ultima };
}

async function vigiaFallidos24h(tenantId: string, ahora: Date): Promise<number | null> {
  const desde = new Date(ahora.getTime() - DIA_MS).toISOString();
  const { count, error } = await acotada(supabaseAdmin().from('vigia_mensaje').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('direccion', 'saliente').eq('estado', 'fallido').gte('created_at', desde), 'orquestador.vigia_fallidos');
  if (esSinTabla(error)) return null;
  if (error || typeof count !== 'number') throw new Error(`orquestador.vigia_fallidos: ${error?.message ?? 'sin conteo'}`);
  return count;
}

const FILA_ESCALACION = 'id, creada_en, destino, motivo, viaje_folio, resumen, pedida_por_rol';

function aTarea(f: Record<string, unknown>): TareaAbierta {
  return {
    id: String(f.id), creadaEn: String(f.creada_en), destino: String(f.destino) as Destino, motivo: String(f.motivo) as Motivo,
    viajeFolio: f.viaje_folio == null ? null : String(f.viaje_folio), resumen: String(f.resumen), pedidaPorRol: String(f.pedida_por_rol),
  };
}

export function crearFuentesReales(): Fuentes {
  return {
    async entradaTablero(tenantId, ahora) {
      const [datos, config, cat, pos] = await Promise.all([
        leerDatosTablero(tenantId), leerConfigConductor(tenantId), leerCatalogosFiltro(tenantId),
        sinFallar('posiciones', getUltimasPosiciones(tenantId)),
      ]);
      const posiciones = pos === null ? null : posicionesDeGps(pos);
      return { datos, config, posiciones, ahora, terminales: cat.terminales, clientes: cat.clientes };
    },

    async vigia(tenantId, ahora) {
      const [datos, grupos] = await Promise.all([cargarTablero(tenantId, ahora), leerGrupos(tenantId)]);
      return { datos, grupos };
    },

    async buzon(tenantId, ahora) {
      const [conteo, entregas] = await Promise.all([conteoBuzon(tenantId, ahora), sinFallar('buzon_entregas', entregasBuzon(tenantId, ahora))]);
      return { conteo, entregas };
    },

    async cobranza(tenantId, ahora) {
      const [cola, gastos] = await Promise.all([colaCobranza(tenantId, ahora), sinFallar('cobranza_gasto', tableroGastos(tenantId, ahora))]);
      return { cola, gastos };
    },

    async autofactura(tenantId) {
      const [control, lotes, fases] = await Promise.all([repoControl.control(tenantId), lotesVivos(tenantId), fasesDePortales(tenantId)]);
      return { control, lotes, fases };
    },

    async salud(tenantId, ahora) {
      const nombres = [...new Set(AGENTES_VIGILADOS.map((a) => a.corridas).filter((x): x is string => !!x))];
      const [lat, corridas, vFall, bProb] = await Promise.all([
        sinFallar('latidos', estadoLatidos(ahora.getTime())),
        Promise.all(nombres.map(async (n) => [n, await sinFallar(`corridas:${n}`, ultimasCorridas(tenantId, n as AgenteConCorridas, 3))] as const)),
        sinFallar('vigia_fallidos', vigiaFallidos24h(tenantId, ahora)),
        sinFallar('buzon_entregas', entregasBuzon(tenantId, ahora)),
      ]);
      const latidos: Record<string, LatidoVisto> | null = lat === null ? null
        : Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { estado: v.estado, haceMin: v.haceMin, ultimoEstado: v.ultimoEstado }]));
      const salida: Record<string, CorridaVista[] | null> = {};
      for (const [n, lista] of corridas) {
        salida[n] = lista === null ? null : lista.map((c) => ({ estado: c.estado, inicio: c.inicio, fin: c.fin, error: c.error }));
      }
      return {
        ahora, latidos, corridas: salida,
        enviosSinSalir: {
          vigiaFallidos24h: vFall,
          buzonEntregasConProblema: bProb === null ? null : (bProb.porEstado.fallida ?? 0) + (bProb.porEstado.rebotada ?? 0),
        },
      } satisfies EntradaSalud;
    },

    async crearEscalacion(tenantId, e, quien) {
      const db = supabaseAdmin();
      let viajeId: string | null = null;
      if (e.viajeFolio) {
        if (!PATRON_FOLIO.test(e.viajeFolio)) return { estado: 'folio_no_encontrado' };
        const v = await acotada(db.from('viaje').select('id').eq('tenant_id', tenantId).eq('folio', e.viajeFolio).order('id').limit(1), 'orquestador.folio');
        if (v.error) throw new Error(`orquestador.folio: ${v.error.message}`);
        viajeId = ((v.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
        if (!viajeId) return { estado: 'folio_no_encontrado' };
      }
      const r = await insertarTarea(tenantId, {
        destino: e.destino, motivo: e.motivo, viajeId, viajeFolio: e.viajeFolio, resumen: e.resumen,
        rol: quien.rol, usuarioId: quien.usuarioId, dedupe: llaveDedupe(e, viajeId),
      });
      // La escalación AVISA: en caliente, sin esperar al cron (una emergencia no espera una hora). Mejor esfuerzo: nunca lanza y,
      // apagado por defecto, no hace nada hasta que la flota lo enciende en Notificaciones.
      if (r.estado === 'creada') return { ...r, aviso: await avisarEscalacion(tenantId, r.id, depsAvisoReales()) };
      return r;
    },

    async convenioDeViaje(tenantId, folio) {
      try {
        // Los viajes abiertos con cliente más recientes (el mismo tope de la pantalla de convenios): el folio se busca EN MEMORIA, nunca en una consulta.
        const filas = await listarViajesConConvenio(tenantId);
        const f = filas.find((x) => x.folio.toLowerCase() === folio.toLowerCase());
        if (!f) return 'sin_viaje';
        const ligado = await leerLigado(tenantId, f.viajeId);
        return {
          folio: f.folio, origen: f.origen, destino: f.destino, cliente: f.cliente, convenioNombre: f.convenioNombre, ligadoPor: f.ligadoPor,
          despachoEnviado: f.despachoEnviado, instrucciones: ligado?.instrucciones ?? [],
        };
      } catch (e) {
        if (e instanceof ConveniosNoDisponibles) return null;
        throw e;
      }
    },

    async liquidacionExterna(tenantId) {
      const [porEstado, noCoincide, fallidas, conAcuse] = await Promise.all([
        contarPorEstado(tenantId),
        contarNoCoincide(tenantId),
        sinFallar('liqext_fallidas', listarLiquidacionesExternas(tenantId, { estado: 'fallida' }, 8, null, false)),
        sinFallar('liqext_no_coincide', listarLiquidacionesExternas(tenantId, { acuseTipo: 'no_coincide' }, 8, null, false)),
      ]);
      // Todos los conteos nulos = la tabla no existe (base sin la 0370) o la base no contestó: no se pinta como ceros.
      if (Object.values(porEstado).every((n) => n === null)) return null;
      return { porEstado, noCoincide, fallidas: fallidas ? fallidas.filas : null, conAcuseNoCoincide: conAcuse ? conAcuse.filas : null };
    },

    async reclamacionPeajes(tenantId) {
      const r = await acotada(supabaseAdmin().from('desglose_peaje').select('id, proveedor, periodo_desde, periodo_hasta')
        .eq('tenant_id', tenantId).is('anulado_en', null).order('created_at', { ascending: false }).order('id').limit(1), 'orquestador.peajes_ultimo');
      if (esSinTabla(r.error)) return null;
      if (r.error) throw new Error(`orquestador.peajes_ultimo: ${r.error.message}`);
      const f = ((r.data ?? []) as Array<{ id: string; proveedor: string | null; periodo_desde: string | null; periodo_hasta: string | null }>)[0];
      if (!f) return { desglose: null, reporte: null };
      const reporte = await reporteReclamacion(tenantId, String(f.id));
      return { desglose: { id: String(f.id), proveedor: f.proveedor, periodoDesde: f.periodo_desde, periodoHasta: f.periodo_hasta }, reporte };
    },

    async jornada(tenantId, ahora, dias) {
      const hasta = hoyMx(ahora);
      const desde = hoyMx(new Date(ahora.getTime() - (dias - 1) * DIA_MS));
      try {
        return await leerJornadas(tenantId, desde, hasta);
      } catch (e) {
        // Base sin la jornada (tabla inexistente) se dice; cualquier otro fallo se propaga (no se pinta un cero).
        if (e instanceof JornadaIlegible && /does not exist|schema cache/i.test(e.message)) return null;
        throw e;
      }
    },

    async escalacionesAbiertas(tenantId, limite = 20) {
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').select(FILA_ESCALACION)
        .eq('tenant_id', tenantId).eq('estado', 'abierta').order('creada_en', { ascending: false }).order('id').limit(limite), 'orquestador.abiertas');
      if (esSinTabla(r.error)) return null;
      if (r.error) throw new Error(`orquestador.abiertas: ${r.error.message}`);
      return ((r.data ?? []) as Array<Record<string, unknown>>).map(aTarea);
    },

    async atenderEscalacion(tenantId, id, quien) {
      // El UPDATE condicional es el claim: solo una abierta DE ESTA flota pasa a atendida, una sola vez.
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').update({
        estado: 'atendida', atendida_en: new Date().toISOString(), atendida_por: quien.usuarioId, nota_atencion: quien.nota,
      }).eq('tenant_id', tenantId).eq('id', id).eq('estado', 'abierta').select('id'), 'orquestador.atender');
      if (r.error) throw new Error(`orquestador.atender: ${r.error.message}`);
      return ((r.data ?? []) as unknown[]).length === 1;
    },
  };
}

// ── La tarea (0650): un solo camino de inserción para el asistente y para el barrido de salud ───────────────────────

interface TareaNueva { destino: Destino; motivo: Motivo; viajeId: string | null; viajeFolio: string | null; resumen: string; rol: string; usuarioId: string | null; dedupe: string }

async function insertarTarea(tenantId: string, t: TareaNueva): Promise<ResultadoCrearEscalacion> {
  const db = supabaseAdmin();
  const ins = await acotada(db.from('orquestador_escalacion').insert({
    tenant_id: tenantId, destino: t.destino, motivo: t.motivo, viaje_id: t.viajeId, viaje_folio: t.viajeFolio, resumen: t.resumen,
    pedida_por_rol: t.rol, pedida_por_usuario: t.usuarioId, dedupe_key: t.dedupe,
  }).select('id').single(), 'orquestador.escalar');
  if (ins.error) {
    if (esSinTabla(ins.error)) return { estado: 'no_disponible' };
    if (ins.error.code === '23505') {
      const previa = await acotada(db.from('orquestador_escalacion').select('id, creada_en')
        .eq('tenant_id', tenantId).eq('dedupe_key', t.dedupe).eq('estado', 'abierta').order('creada_en', { ascending: false }).order('id').limit(1), 'orquestador.escalar_previa');
      const f = ((previa.data ?? []) as Array<{ id: string; creada_en: string }>)[0];
      if (f) return { estado: 'ya_abierta', id: f.id, creadaEn: f.creada_en };
    }
    throw new Error(`orquestador.escalar: ${ins.error.message}`);
  }
  return { estado: 'creada', id: String((ins.data as { id: string }).id) };
}

// ── El aviso saliente (0651): lectura, claim y cierre del estado del aviso de UNA tarea ─────────────────────────────

const FILA_AVISO = 'id, tenant_id, estado, aviso_estado, aviso_intentos, destino, motivo, viaje_folio, resumen';

export function depsAvisoReales(): DepsAvisoEscalacion {
  return {
    ...depsDeCorreo(),
    async leerTarea(tenantId, id): Promise<TareaParaAviso | null> {
      // orden-no-importa: filtra por `id` exacto dentro de la flota; la consulta deja una sola fila.
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').select(FILA_AVISO).eq('tenant_id', tenantId).eq('id', id).limit(1), 'orquestador.aviso_leer');
      if (esSinTabla(r.error)) return null;   // base sin la 0651: no hay estado de aviso y el aviso no corre
      if (r.error) throw new Error(`orquestador.aviso_leer: ${r.error.message}`);
      const f = ((r.data ?? []) as Array<Record<string, unknown>>)[0];
      if (!f) return null;
      return {
        id: String(f.id), tenantId: String(f.tenant_id), estado: String(f.estado), avisoEstado: String(f.aviso_estado), avisoIntentos: Number(f.aviso_intentos ?? 0),
        destino: String(f.destino) as Destino, motivo: String(f.motivo) as Motivo, viajeFolio: f.viaje_folio == null ? null : String(f.viaje_folio), resumen: String(f.resumen),
      };
    },
    async reclamar(tenantId, id) {
      // El UPDATE condicional ES el claim: pendiente, con intentos por debajo del tope y sin reclamo reciente. Suma el intento.
      const umbral = new Date(Date.now() - REINTENTO_AVISO_MIN * 60_000).toISOString();
      // orden-no-importa: filtra por `id` exacto dentro de la flota; la consulta deja una sola fila.
      const actual = await acotada(supabaseAdmin().from('orquestador_escalacion').select('aviso_intentos').eq('tenant_id', tenantId).eq('id', id).limit(1), 'orquestador.aviso_intentos');
      const intentos = Number(((actual.data ?? []) as Array<{ aviso_intentos: number }>)[0]?.aviso_intentos ?? 0);
      if (actual.error || intentos >= MAX_INTENTOS_AVISO) return false;
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion')
        .update({ aviso_intentos: intentos + 1, aviso_reclamado_en: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'abierta').eq('aviso_estado', 'pendiente').eq('aviso_intentos', intentos)
        .or(`aviso_reclamado_en.is.null,aviso_reclamado_en.lt.${umbral}`).select('id'), 'orquestador.aviso_reclamar');
      if (r.error) throw new Error(`orquestador.aviso_reclamar: ${r.error.message}`);
      return ((r.data ?? []) as unknown[]).length === 1;
    },
    async marcar(tenantId, id, estado, detalle) {
      const cambios: Record<string, unknown> = { aviso_estado: estado, aviso_detalle: detalle ? detalle.slice(0, 200) : null };
      if (estado === 'enviado') cambios.avisada_en = new Date().toISOString();
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').update(cambios)
        .eq('tenant_id', tenantId).eq('id', id).eq('aviso_estado', 'pendiente').select('id'), 'orquestador.aviso_marcar');
      if (r.error) throw new Error(`orquestador.aviso_marcar: ${r.error.message}`);
    },
    async nombreFlota(tenantId) {
      // orden-no-importa: filtra por `id` exacto de la flota (llave primaria); la consulta deja una sola fila.
      const r = await acotada(supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).limit(1), 'orquestador.aviso_flota');
      return r.error ? null : ((r.data ?? []) as Array<{ nombre: string | null }>)[0]?.nombre ?? null;
    },
  };
}

// ── El ciclo vivo dentro del cron `escalar` (0652): claim por flota, tareas de sistema, avisos pendientes ──────────

export function puertoCicloVivoReal(): PuertoCicloVivo {
  return {
    async reclamarFlotas(limite, ventanaMin) {
      const r = await acotada(supabaseAdmin().rpc('reclamar_flotas_barrido_orquestador', { p_limite: limite, p_ventana_min: ventanaMin }), 'orquestador.barrido_reclamar');
      if (esSinTabla(r.error)) return null;
      if (r.error) throw new Error(`orquestador.barrido_reclamar: ${r.error.message}`);
      return ((r.data ?? []) as Array<{ tenant_id: string }>).map((f) => String(f.tenant_id));
    },
    async registrarBarrido(tenantId, res) {
      const r = await acotada(supabaseAdmin().rpc('registrar_barrido_orquestador', {
        p_tenant: tenantId, p_resultado: res.ok ? 'ok' : 'error', p_abiertas: res.abiertas, p_cerradas: res.cerradas, p_error: res.error,
      }), 'orquestador.barrido_registrar');
      if (r.error && !esSinTabla(r.error)) throw new Error(`orquestador.barrido_registrar: ${r.error.message}`);
    },
    async pendientesDeAviso(limite) {
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').select('tenant_id, id')
        .eq('estado', 'abierta').eq('aviso_estado', 'pendiente').order('creada_en').order('id').limit(limite), 'orquestador.aviso_pendientes');
      if (esSinTabla(r.error)) return null;
      if (r.error) throw new Error(`orquestador.aviso_pendientes: ${r.error.message}`);
      return ((r.data ?? []) as Array<{ tenant_id: string; id: string }>).map((f) => ({ tenantId: String(f.tenant_id), id: String(f.id) }));
    },
  };
}

export function depsBarridoReales(): DepsBarrido {
  const fuentesReales = crearFuentesReales();
  return {
    salud: (tenantId, ahora) => fuentesReales.salud(tenantId, ahora),
    async abrirTarea(tenantId, t) {
      const r = await insertarTarea(tenantId, {
        destino: t.destino, motivo: 'falla_de_agente', viajeId: null, viajeFolio: null, resumen: t.resumen, rol: 'sistema', usuarioId: null, dedupe: t.dedupe,
      });
      return r.estado === 'creada' ? 'creada' : r.estado === 'ya_abierta' ? 'ya_abierta' : 'no_disponible';
    },
    async tareasAbiertas(tenantId) {
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').select('dedupe_key')
        .eq('tenant_id', tenantId).eq('estado', 'abierta').like('dedupe_key', `${PREFIJO_BARRIDO}%`).order('creada_en').order('id').limit(50), 'orquestador.barrido_abiertas');
      if (esSinTabla(r.error)) return null;
      if (r.error) throw new Error(`orquestador.barrido_abiertas: ${r.error.message}`);
      return ((r.data ?? []) as Array<{ dedupe_key: string }>).map((f) => String(f.dedupe_key));
    },
    async cerrarTarea(tenantId, dedupe, nota) {
      const r = await acotada(supabaseAdmin().from('orquestador_escalacion').update({ estado: 'atendida', atendida_en: new Date().toISOString(), nota_atencion: nota.slice(0, 300) })
        .eq('tenant_id', tenantId).eq('dedupe_key', dedupe).eq('estado', 'abierta').select('id'), 'orquestador.barrido_cerrar');
      if (r.error) throw new Error(`orquestador.barrido_cerrar: ${r.error.message}`);
      return ((r.data ?? []) as unknown[]).length >= 1;
    },
  };
}

registrarFuentesReales(crearFuentesReales);
