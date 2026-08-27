import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { DatoInvalido } from '../errores';
import {
  armarEpisodios, resumirEstadias,
  type ContextoEstadias, type EpisodioEstadia, type PoliticaDetencion,
  type ResumenEstadias, type ViajeParaEstadia,
} from './motor';

// ═══════════════════════════════════════════════════════════════════════════
// LA LECTURA Y EL ESCRITOR DE ESTADÍAS (0207). El motor es puro (motor.ts);
// aquí vive el ida-y-vuelta con la base: la ventana de viajes con llegada
// sellada, los pactos, los sitios, y la presencia medida (RPC 0207) en UN
// solo viaje por pantalla — no un RPC por episodio.
//
// La ventana es por llegada_en (el hito que abre el episodio), no por
// fecha_inicio: un viaje despachado hace 40 días que llegó a descargar ayer
// ES de esta ventana. Mismo criterio de acotación que el auditor de cobranza
// (30 días, declarados en pantalla); el escalón siguiente es la RPC agregada
// (patrón 0152), no quitarle el techo a la lectura.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_ESTADIAS_DIAS = 30;

export interface EstadiasPanel {
  episodios: EpisodioEstadia[];
  resumen: ResumenEstadias;
  ventana: { desde: string; hasta: string };
  politicaFlota: PoliticaDetencion | null;
}

interface PoliticaCruda {
  cliente_id: unknown;
  horas_libres: unknown;
  tarifa_hora: unknown;
  moneda: unknown;
}

const aPerilla = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function armarPolitica(p: PoliticaCruda): PoliticaDetencion {
  return {
    horasLibres: aPerilla(p.horas_libres),
    tarifaHora: aPerilla(p.tarifa_hora),
    moneda: String(p.moneda ?? 'MXN'),
  };
}

/** Los pactos declarados del tenant: el de flota y los por cliente. */
export async function politicasDetencion(tenantId: string): Promise<{
  flota: PoliticaDetencion | null;
  porCliente: Map<string, PoliticaDetencion>;
}> {
  const filas = await traerTodo<PoliticaCruda>(
    (d, h) => acotada(supabaseAdmin()
      .from('politica_detencion')
      .select('cliente_id, horas_libres, tarifa_hora, moneda', conteo(d))
      .eq('tenant_id', tenantId)
      .order('id').range(d, h), 'estadias.politicas'),
    'estadias.politicas',
  );
  let flota: PoliticaDetencion | null = null;
  const porCliente = new Map<string, PoliticaDetencion>();
  for (const f of filas) {
    if (f.cliente_id === null) flota = armarPolitica(f);
    else porCliente.set(String(f.cliente_id), armarPolitica(f));
  }
  return { flota, porCliente };
}

/**
 * Declara (o actualiza) el pacto de detención. Update-luego-insert apoyado en
 * los índices únicos parciales de la 0207: el segundo intento concurrente cae
 * en la violación de único y se resuelve con el update — nunca dos pactos
 * vigentes del mismo alcance.
 */
export async function guardarPoliticaDetencion(
  tenantId: string,
  clienteId: string | null,
  valores: { horasLibres: number | null; tarifaHora: number | null },
  actualizadoPor: string,
): Promise<void> {
  const { horasLibres, tarifaHora } = valores;
  if (horasLibres !== null && (!Number.isFinite(horasLibres) || horasLibres < 0 || horasLibres > 240)) {
    throw new DatoInvalido('Las horas libres deben ser un número entre 0 y 240, o quedar vacías (= no pactadas).');
  }
  if (tarifaHora !== null && (!Number.isFinite(tarifaHora) || tarifaHora <= 0)) {
    throw new DatoInvalido('La tarifa por hora debe ser mayor a cero, o quedar vacía (= no pactada).');
  }

  const admin = supabaseAdmin();
  const cambios = {
    horas_libres: horasLibres,
    tarifa_hora: tarifaHora,
    actualizada_en: new Date().toISOString(),
    actualizado_por: actualizadoPor,
  };

  let q = admin.from('politica_detencion').update(cambios).eq('tenant_id', tenantId);
  q = clienteId === null ? q.is('cliente_id', null) : q.eq('cliente_id', clienteId);
  const upd = await acotada(q.select('id'), 'estadias.politica.update');
  if (upd.error) throw new Error(`estadias.politica.update: ${upd.error.message}`);
  if (upd.data && upd.data.length > 0) return;

  const ins = await acotada(admin.from('politica_detencion').insert({
    tenant_id: tenantId,
    cliente_id: clienteId,
    ...cambios,
  }), 'estadias.politica.insert');
  if (ins.error) {
    // 23505 = el pacto lo insertó otra petición entre el update y el insert:
    // reintentar el update UNA vez es la resolución, no un error.
    if (ins.error.code === '23505') {
      let q2 = admin.from('politica_detencion').update(cambios).eq('tenant_id', tenantId);
      q2 = clienteId === null ? q2.is('cliente_id', null) : q2.eq('cliente_id', clienteId);
      const upd2 = await acotada(q2.select('id'), 'estadias.politica.update2');
      if (upd2.error) throw new Error(`estadias.politica.update2: ${upd2.error.message}`);
      if (upd2.data && upd2.data.length > 0) return;
    }
    throw new Error(`estadias.politica.insert: ${ins.error.message}`);
  }
}

/**
 * Vincula (o desvincula, con null) el sitio del cliente. El UPDATE va anclado
 * al tenant y la FK compuesta de la 0207 rechaza una geocerca de otra flota —
 * el candado es de la base, no de esta función.
 */
export async function vincularSitioCliente(
  tenantId: string,
  clienteId: string,
  geocercaId: string | null,
): Promise<void> {
  const r = await acotada(supabaseAdmin()
    .from('cliente')
    .update({ geocerca_id: geocercaId })
    .eq('tenant_id', tenantId)
    .eq('id', clienteId)
    .select('id'), 'estadias.sitio');
  if (r.error) throw new Error(`estadias.sitio: ${r.error.message}`);
  if (!r.data || r.data.length === 0) throw new DatoInvalido('Ese cliente no existe en tu flota.');
}

/** El panel completo: episodios de la ventana + resumen + pactos. Lanza ante
 *  error de base — un panel a medias diría "sin estadías" de episodios que sí
 *  existen; el llamador lo envuelve en su try/catch y enseña el error. */
export async function getEstadias(
  tenantId: string,
  opciones: { ahora?: Date; dias?: number } = {},
): Promise<EstadiasPanel> {
  const ahora = opciones.ahora ?? new Date();
  const dias = opciones.dias ?? VENTANA_ESTADIAS_DIAS;
  const desde = new Date(ahora.getTime() - dias * 86_400_000).toISOString();
  const hasta = ahora.toISOString();
  const admin = supabaseAdmin();

  const [viajesCrudos, politicas] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('viaje')
        .select('id, folio, origen, destino, cliente_id, unidad_id, estatus, llegada_en, descarga_en, regreso_en', conteo(d))
        .eq('tenant_id', tenantId)
        .gte('llegada_en', desde)
        .lte('llegada_en', hasta)
        .order('id').range(d, h), 'estadias.viajes'),
      'estadias.viajes',
    ),
    politicasDetencion(tenantId),
  ]);

  const viajes: ViajeParaEstadia[] = viajesCrudos.map((v) => ({
    id: String(v.id),
    folio: (v.folio as string | null) ?? null,
    origen: (v.origen as string | null) ?? null,
    destino: (v.destino as string | null) ?? null,
    clienteId: (v.cliente_id as string | null) ?? null,
    unidadId: (v.unidad_id as string | null) ?? null,
    estatus: String(v.estatus ?? ''),
    llegadaEn: (v.llegada_en as string | null) ?? null,
    descargaEn: (v.descarga_en as string | null) ?? null,
    regresoEn: (v.regreso_en as string | null) ?? null,
  }));

  // Clientes y unidades de la ventana — `traerPorIds`: un `.in()` con más de
  // mil ids se recorta en silencio (pg.ts) y un mapa recortado inventaría
  // "sin sitio del cliente" falsos.
  const clienteIds = [...new Set(viajes.map((v) => v.clienteId).filter((c): c is string => !!c))];
  const unidadIds = [...new Set(viajes.map((v) => v.unidadId).filter((u): u is string => !!u))];

  const clientePorId = new Map<string, { nombre: string; geocercaId: string | null }>();
  if (clienteIds.length > 0) {
    const filas = await traerPorIds<Record<string, unknown>>(
      clienteIds,
      (tanda) => acotada(
        admin.from('cliente').select('id, nombre, geocerca_id').eq('tenant_id', tenantId).in('id', tanda),
        'estadias.clientes',
      ),
      'estadias.clientes',
    );
    for (const c of filas) {
      clientePorId.set(String(c.id), {
        nombre: String(c.nombre ?? ''),
        geocercaId: (c.geocerca_id as string | null) ?? null,
      });
    }
  }

  const unidadPorId = new Map<string, { economico: string }>();
  if (unidadIds.length > 0) {
    const filas = await traerPorIds<Record<string, unknown>>(
      unidadIds,
      (tanda) => acotada(
        admin.from('unidad').select('id, numero_economico').eq('tenant_id', tenantId).in('id', tanda),
        'estadias.unidades',
      ),
      'estadias.unidades',
    );
    for (const u of filas) unidadPorId.set(String(u.id), { economico: String(u.numero_economico ?? '') });
  }

  const geocercaIds = [...new Set(
    [...clientePorId.values()].map((c) => c.geocercaId).filter((g): g is string => !!g),
  )];
  const geocercaPorId = new Map<string, { nombre: string }>();
  const geocercaGeom = new Map<string, { lat: number; lng: number; radioM: number }>();
  if (geocercaIds.length > 0) {
    const filas = await traerPorIds<Record<string, unknown>>(
      geocercaIds,
      (tanda) => acotada(
        admin.from('geocerca').select('id, nombre, lat, lng, radio_m').eq('tenant_id', tenantId).in('id', tanda),
        'estadias.geocercas',
      ),
      'estadias.geocercas',
    );
    for (const g of filas) {
      geocercaPorId.set(String(g.id), { nombre: String(g.nombre ?? '') });
      geocercaGeom.set(String(g.id), {
        lat: Number(g.lat), lng: Number(g.lng), radioM: Number(g.radio_m),
      });
    }
  }

  // La presencia medida: un solo RPC con TODOS los episodios que tienen sitio
  // dibujado y unidad. La ventana de cada item es la del episodio (llegada →
  // regreso, o → ahora si corre): medir fuera de ella mezclaría este viaje
  // con el anterior de la misma unidad al mismo sitio.
  const items: Array<Record<string, unknown>> = [];
  for (const v of viajes) {
    if (!v.llegadaEn || !v.unidadId || !v.clienteId) continue;
    const geocercaId = clientePorId.get(v.clienteId)?.geocercaId;
    const geom = geocercaId ? geocercaGeom.get(geocercaId) : undefined;
    if (!geom) continue;
    items.push({
      viaje_id: v.id,
      unidad_id: v.unidadId,
      desde: v.llegadaEn,
      hasta: v.regresoEn ?? hasta,
      lat: geom.lat,
      lng: geom.lng,
      radio_m: geom.radioM,
    });
  }
  // En tandas de 500: la respuesta trae a lo más una fila por item, pero
  // `max_rows` de PostgREST recorta a 1,000 EN SILENCIO lo que devuelve un
  // RPC (la lección de pg.ts) — y una presencia recortada inventaría
  // "sin posiciones en el sitio" falsos.
  const presenciaPorViaje = new Map<string, { primera: string; ultima: string; n: number }>();
  for (let i = 0; i < items.length; i += 500) {
    const r = await acotada(
      admin.rpc('presencia_en_sitios', { p_tenant: tenantId, p_items: items.slice(i, i + 500) }),
      'estadias.presencia',
    );
    if (r.error) throw new Error(`estadias.presencia: ${r.error.message}`);
    for (const f of (r.data ?? []) as Array<Record<string, unknown>>) {
      presenciaPorViaje.set(String(f.viaje_id), {
        primera: String(f.primera),
        ultima: String(f.ultima),
        n: Number(f.n),
      });
    }
  }

  const ctx: ContextoEstadias = {
    politicaFlota: politicas.flota,
    politicaPorCliente: politicas.porCliente,
    clientePorId,
    geocercaPorId,
    unidadPorId,
    presenciaPorViaje,
  };
  const episodios = armarEpisodios(viajes, ctx, hasta);
  return {
    episodios,
    resumen: resumirEstadias(episodios),
    ventana: { desde: desde.slice(0, 10), hasta: hasta.slice(0, 10) },
    politicaFlota: politicas.flota,
  };
}
