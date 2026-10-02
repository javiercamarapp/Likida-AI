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
import { cargarTablero } from '../vigia/repo';
import { estadoLatidos } from '@/lib/admin/salud';
import { registrarFuentesReales, type Fuentes } from './fuentes';
import { AGENTES_VIGILADOS, type CorridaVista, type EntradaSalud, type LatidoVisto } from './salud_agentes';
import { PATRON_FOLIO, llaveDedupe, type Destino, type Motivo, type TareaAbierta } from './escalamiento';
import { posicionesDeGps } from './tablero_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS FUENTES REALES — solo COMPONEN los lectores que cada agente ya tiene (con su
// `tenant_id` en cada consulta). No hay lectura nueva de datos de otros agentes;
// lo único propio es la tabla de escalaciones (0650) y dos conteos de «envíos que
// no salieron». Todo se tolera contra una base SIN migrar: una tabla que no
// existe se dice («disponible: false» / null), jamás se pinta como «cero».
// ═══════════════════════════════════════════════════════════════════════════

const SIN_TABLA = new Set(['42P01', 'PGRST205']);
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
      const dedupe = llaveDedupe(e, viajeId);
      const ins = await acotada(db.from('orquestador_escalacion').insert({
        tenant_id: tenantId, destino: e.destino, motivo: e.motivo, viaje_id: viajeId, viaje_folio: e.viajeFolio, resumen: e.resumen,
        pedida_por_rol: quien.rol, pedida_por_usuario: quien.usuarioId, dedupe_key: dedupe,
      }).select('id').single(), 'orquestador.escalar');
      if (ins.error) {
        if (esSinTabla(ins.error)) return { estado: 'no_disponible' };
        if (ins.error.code === '23505') {
          const previa = await acotada(db.from('orquestador_escalacion').select('id, creada_en')
            .eq('tenant_id', tenantId).eq('dedupe_key', dedupe).eq('estado', 'abierta').order('creada_en', { ascending: false }).order('id').limit(1), 'orquestador.escalar_previa');
          const f = ((previa.data ?? []) as Array<{ id: string; creada_en: string }>)[0];
          if (f) return { estado: 'ya_abierta', id: f.id, creadaEn: f.creada_en };
        }
        throw new Error(`orquestador.escalar: ${ins.error.message}`);
      }
      return { estado: 'creada', id: String((ins.data as { id: string }).id) };
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

registrarFuentesReales(crearFuentesReales);
