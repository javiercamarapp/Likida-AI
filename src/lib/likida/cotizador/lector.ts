// ═══════════════════════════════════════════════════════════════════════════
// EL COTIZADOR — la parte con base (0225). El motor puro vive en motor.ts;
// aquí vive quien lo alimenta y quien persiste lo que decide el humano.
//
// Tres verdades de este archivo:
//   1. Las casetas MEDIDAS se computan AL LEER desde los gastos 'caseta' de
//      viajes liquidados de la misma ruta — no se persisten (serían una
//      segunda verdad que se desactualiza con cada viaje nuevo, criterio
//      0207). Lo que SÍ se persiste es el desglose de cada cotización: la
//      cita de con qué números se armó (0225).
//   2. La ruta se compara NORMALIZADA (`normalizarPlaza`, el mismo criterio
//      de las tarifas): "León→CDMX" y "leon → cdmx" son la misma ruta, o
//      media flota nunca tendría histórico.
//   3. La conversión a viaje es claim-then-act: `decidida_en` se estampa con
//      un UPDATE condicional sobre NULL (patrón talacha/0201) ANTES de crear
//      el viaje — el doble clic de "ganada" lo resuelve la base. Si crear el
//      viaje falla, el claim se suelta (compensación dicha en el log).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { conteo, traerTodo } from '../pg';
import { acotada } from '../presupuesto';
import { round2, hoyMx } from '@/lib/formato';
import { DatoInvalido } from '../errores';
import { normalizarPlaza, tarifaSugerida, type TarifaRow, type ModoTarifa } from '../clientes';
import { politicasDetencion } from '../estadias/lector';
import {
  armarDesglose, type CostosDeclarados, type Desglose, type FuenteCasetas, type PactoDetencion,
} from './motor';

// ── La configuración de costos declarados ──────────────────────────────────

export async function getConfigCotizador(tenantId: string): Promise<CostosDeclarados> {
  const { data, error } = await acotada(
    supabaseAdmin().from('cotizador_config')
      .select('diesel_por_km, salario_dia, viaticos_dia, fijos_por_km, factor_regreso_vacio, margen_objetivo_pct')
      .eq('tenant_id', tenantId).maybeSingle(),
    'cotizador.config',
  );
  if (error) throw new Error(`cotizador.config: ${error.message}`);
  const n = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    dieselPorKm: n(data?.diesel_por_km),
    salarioDia: n(data?.salario_dia),
    viaticosDia: n(data?.viaticos_dia),
    fijosPorKm: n(data?.fijos_por_km),
    factorRegresoVacio: n(data?.factor_regreso_vacio),
    margenObjetivoPct: n(data?.margen_objetivo_pct),
  };
}

/** Valida con las MISMAS cotas del CHECK de la 0225: rebotar aquí con
 *  mensaje de pantalla es mejor que un error de constraint críptico. */
export async function guardarConfigCotizador(
  tenantId: string,
  v: CostosDeclarados,
  userId: string | null,
): Promise<void> {
  const rangos: Array<[string, number | null, number, number]> = [
    ['diésel por km', v.dieselPorKm, 0, 1000],
    ['salario por día', v.salarioDia, 0, 100000],
    ['viáticos por día', v.viaticosDia, 0, 100000],
    ['fijos por km', v.fijosPorKm, 0, 1000],
  ];
  for (const [nombre, valor, min, max] of rangos) {
    if (valor !== null && (!Number.isFinite(valor) || valor < min || valor > max)) {
      throw new DatoInvalido(`El ${nombre} no es un número razonable.`);
    }
  }
  if (v.factorRegresoVacio !== null
    && (!Number.isFinite(v.factorRegresoVacio) || v.factorRegresoVacio < 1 || v.factorRegresoVacio > 3)) {
    throw new DatoInvalido('El factor de regreso vacío va de 1 (regreso cargado) a 3.');
  }
  if (v.margenObjetivoPct !== null
    && (!Number.isFinite(v.margenObjetivoPct) || v.margenObjetivoPct < 0 || v.margenObjetivoPct > 90)) {
    throw new DatoInvalido('El margen objetivo va de 0 a 90%.');
  }
  const { error } = await acotada(
    supabaseAdmin().from('cotizador_config').upsert({
      tenant_id: tenantId,
      diesel_por_km: v.dieselPorKm,
      salario_dia: v.salarioDia,
      viaticos_dia: v.viaticosDia,
      fijos_por_km: v.fijosPorKm,
      factor_regreso_vacio: v.factorRegresoVacio,
      margen_objetivo_pct: v.margenObjetivoPct,
      actualizado_en: new Date().toISOString(),
      actualizado_por: userId,
    }, { onConflict: 'tenant_id' }),
    'cotizador.guardarConfig',
  );
  if (error) throw new Error(`cotizador.guardarConfig: ${error.message}`);
}

// ── Las casetas medidas de una ruta ────────────────────────────────────────

/** Filtro puro de ruta normalizada — exportado para poder probarse sin base. */
export function viajesDeMismaRuta<T extends { origen: string | null; destino: string | null }>(
  viajes: readonly T[],
  origen: string,
  destino: string,
): T[] {
  const o = normalizarPlaza(origen);
  const d = normalizarPlaza(destino);
  if (o === null || d === null) return [];
  return viajes.filter((v) => normalizarPlaza(v.origen) === o && normalizarPlaza(v.destino) === d);
}

export interface CasetasMedidas { promedio: number; viajes: number }

/**
 * El promedio de casetas de los viajes LIQUIDADOS de esta ruta en los
 * últimos 12 meses. `null` = sin viajes medibles (y el motor lo dice, no lo
 * rellena). Solo cuentan viajes con al menos un gasto 'caseta': un viaje
 * liquidado sin casetas registradas no distingue "ruta libre" de "no se
 * capturó", y promediar ceros ambiguos bajaría el costo con cara de medición.
 */
export async function casetasMedidasPorRuta(
  tenantId: string,
  origen: string,
  destino: string,
  hoy: string = hoyMx(),
): Promise<CasetasMedidas | null> {
  const admin = supabaseAdmin();
  const piso = new Date(Date.parse(`${hoy}T12:00:00Z`) - 366 * 86_400_000).toISOString();
  const viajes = await traerTodo<{ id: unknown; origen: unknown; destino: unknown }>(
    (d, h) => acotada(admin.from('viaje')
      .select('id, origen, destino', conteo(d))
      .eq('tenant_id', tenantId).eq('estatus', 'liquidado')
      .gte('created_at', piso)
      .not('origen', 'is', null).not('destino', 'is', null)
      .order('id').range(d, h), 'cotizador.viajesRuta'),
    'cotizador.viajesRuta',
  );
  const deRuta = viajesDeMismaRuta(
    viajes.map((v) => ({ id: String(v.id), origen: (v.origen as string) ?? null, destino: (v.destino as string) ?? null })),
    origen, destino,
  );
  if (deRuta.length === 0) return null;

  // Los gastos 'caseta' de esos viajes, en tandas: `.in()` con cientos de ids
  // rompe el largo de la URL de PostgREST.
  const porViaje = new Map<string, number>();
  const ids = deRuta.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 100) {
    const tanda = ids.slice(i, i + 100);
    const gastos = await traerTodo<{ viaje_id: unknown; monto: unknown }>(
      (d, h) => acotada(admin.from('gasto')
        .select('viaje_id, monto', conteo(d))
        .eq('tenant_id', tenantId).eq('concepto', 'caseta')
        .in('viaje_id', tanda)
        .order('id').range(d, h), 'cotizador.casetas'),
      'cotizador.casetas',
    );
    for (const g of gastos) {
      const id = String(g.viaje_id);
      const m = Number(g.monto);
      if (!Number.isFinite(m)) continue;
      porViaje.set(id, (porViaje.get(id) ?? 0) + m);
    }
  }
  if (porViaje.size === 0) return null;
  const total = [...porViaje.values()].reduce((s, v) => s + v, 0);
  return { promedio: round2(total / porViaje.size), viajes: porViaje.size };
}

// ── El panel completo ──────────────────────────────────────────────────────

export interface CotizacionRow {
  id: string;
  folio: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  origen: string;
  destino: string;
  km: number | null;
  costoEstimado: number | null;
  precio: number | null;
  estado: string;
  vigenteHasta: string | null;
  viajeId: string | null;
  desglose: Desglose | null;
  /** La sugerencia del catálogo de tarifas, congelada al cotizar. */
  tarifaCatalogo: { monto: number | null; porque: string; ambigua: boolean } | null;
  creadaEn: string;
}

export interface PanelCotizador {
  config: CostosDeclarados;
  cotizaciones: CotizacionRow[];
  clientes: Array<{ id: string; nombre: string }>;
}

/** La forma persistida en `cotizacion.desglose` (jsonb). El desglose del
 *  motor + la tarifa del catálogo congelada. */
interface DesglosePersistido extends Desglose {
  tarifaCatalogo?: { monto: number | null; porque: string; ambigua: boolean } | null;
}

function leerDesglose(v: unknown): { desglose: Desglose | null; tarifa: CotizacionRow['tarifaCatalogo'] } {
  if (v === null || typeof v !== 'object') return { desglose: null, tarifa: null };
  const d = v as DesglosePersistido;
  if (!Array.isArray(d.lineas)) return { desglose: null, tarifa: null };
  return {
    desglose: {
      lineas: d.lineas,
      costoTotal: typeof d.costoTotal === 'number' ? d.costoTotal : null,
      faltantes: Array.isArray(d.faltantes) ? d.faltantes : [],
      precioSugerido: typeof d.precioSugerido === 'number' ? d.precioSugerido : null,
      notas: Array.isArray(d.notas) ? d.notas : [],
    },
    tarifa: d.tarifaCatalogo ?? null,
  };
}

export async function getPanelCotizador(tenantId: string): Promise<PanelCotizador> {
  const admin = supabaseAdmin();
  const [config, cots, clientes] = await Promise.all([
    getConfigCotizador(tenantId),
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('cotizacion')
        .select('id, folio, cliente_id, origen, destino, km, costo_estimado, precio, estado, vigente_hasta, viaje_id, desglose, creada_en', conteo(d))
        .eq('tenant_id', tenantId)
        .order('creada_en', { ascending: false }).order('id').range(d, h), 'cotizador.lista'),
      'cotizador.lista',
    ),
    traerTodo<{ id: unknown; nombre: unknown }>(
      (d, h) => acotada(admin.from('cliente').select('id, nombre', conteo(d))
        .eq('tenant_id', tenantId).eq('activo', true).order('nombre').range(d, h), 'cotizador.clientes'),
      'cotizador.clientes',
    ),
  ]);
  const nombrePor = new Map(clientes.map((c) => [String(c.id), String(c.nombre)]));
  const n = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    config,
    clientes: clientes.map((c) => ({ id: String(c.id), nombre: String(c.nombre) })),
    cotizaciones: cots.map((c) => {
      const { desglose, tarifa } = leerDesglose(c.desglose);
      return {
        id: String(c.id),
        folio: (c.folio as string) ?? null,
        clienteId: (c.cliente_id as string) ?? null,
        clienteNombre: c.cliente_id ? nombrePor.get(String(c.cliente_id)) ?? null : null,
        origen: String(c.origen),
        destino: String(c.destino),
        km: n(c.km),
        costoEstimado: n(c.costo_estimado),
        precio: n(c.precio),
        estado: String(c.estado),
        vigenteHasta: (c.vigente_hasta as string) ?? null,
        viajeId: (c.viaje_id as string) ?? null,
        desglose,
        tarifaCatalogo: tarifa,
        creadaEn: String(c.creada_en),
      };
    }),
  };
}

// ── Cotizar ────────────────────────────────────────────────────────────────

async function tarifasDelTenant(tenantId: string): Promise<TarifaRow[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('tarifa')
      .select('id, cliente_id, origen, destino, modo, precio, moneda, vigente_desde, vigente_hasta, activa, creada_en', conteo(d))
      .eq('tenant_id', tenantId).order('id').range(d, h), 'cotizador.tarifas'),
    'cotizador.tarifas',
  );
  return filas.map((t) => ({
    id: String(t.id),
    clienteId: (t.cliente_id as string) ?? null,
    clienteNombre: null,
    origen: (t.origen as string) ?? null,
    destino: (t.destino as string) ?? null,
    modo: t.modo as ModoTarifa,
    precio: round2(Number(t.precio)),
    moneda: String(t.moneda ?? 'MXN'),
    vigenteDesde: String(t.vigente_desde),
    vigenteHasta: (t.vigente_hasta as string) ?? null,
    activa: Boolean(t.activa),
    creadaEn: String(t.creada_en),
  }));
}

export interface NuevaCotizacion {
  clienteId: string | null;
  origen: string;
  destino: string;
  km: number | null;
  dias: number | null;
  /** Casetas capturadas a mano — solo se usan si NO hay medición histórica. */
  casetasManual: number | null;
  /** El precio que el humano decide cotizar. `null` = a medias, y se dice. */
  precio: number | null;
  folio: string | null;
  vigenteHasta: string | null;
}

/**
 * Crea la cotización: corre el motor con los costos declarados + las casetas
 * medidas de la ruta + el pacto de detención, y persiste el desglose TAL
 * CUAL (la cita). Devuelve el id.
 */
export async function crearCotizacion(
  tenantId: string,
  n: NuevaCotizacion,
  userId: string | null,
): Promise<string> {
  const origen = n.origen.trim();
  const destino = n.destino.trim();
  if (!origen || !destino) throw new DatoInvalido('La ruta necesita origen y destino.');
  if (n.km !== null && (!Number.isFinite(n.km) || n.km <= 0 || n.km >= 20000)) {
    throw new DatoInvalido('Los km no son razonables (1–19,999).');
  }
  if (n.dias !== null && (!Number.isFinite(n.dias) || n.dias <= 0 || n.dias > 60)) {
    throw new DatoInvalido('Los días de viaje no son razonables (1–60).');
  }
  if (n.precio !== null && (!Number.isFinite(n.precio) || n.precio < 0)) {
    throw new DatoInvalido('El precio no es un número razonable.');
  }
  if (n.casetasManual !== null && (!Number.isFinite(n.casetasManual) || n.casetasManual < 0)) {
    throw new DatoInvalido('Las casetas capturadas no son un número razonable.');
  }

  // El cliente tiene que ser de esta flota — el <select> es UI, no servidor
  // (mismo candado que crearViaje).
  if (n.clienteId) {
    const { data, error } = await acotada(
      supabaseAdmin().from('cliente').select('id')
        .eq('tenant_id', tenantId).eq('id', n.clienteId).maybeSingle(),
      'cotizador.clientePropio',
    );
    if (error) throw new Error(`cotizador.clientePropio: ${error.message}`);
    if (!data) throw new DatoInvalido('El cliente no pertenece a esta flota.');
  }

  const [config, medidas, politicas, tarifas] = await Promise.all([
    getConfigCotizador(tenantId),
    casetasMedidasPorRuta(tenantId, origen, destino),
    politicasDetencion(tenantId),
    tarifasDelTenant(tenantId),
  ]);

  // La jerarquía de casetas: MEDIDA > capturada > falta. Una medición real
  // gana sobre lo tecleado — y el desglose dice cuál se usó.
  const casetas: FuenteCasetas = medidas !== null
    ? { tipo: 'medida', promedio: medidas.promedio, viajes: medidas.viajes }
    : n.casetasManual !== null
      ? { tipo: 'capturada', monto: n.casetasManual }
      : { tipo: 'falta' };

  // El pacto aplicable: el del cliente gana sobre el de flota (criterio 0207).
  const deCliente = n.clienteId ? politicas.porCliente.get(n.clienteId) ?? null : null;
  const pacto: PactoDetencion | null = deCliente
    ? { horasLibres: deCliente.horasLibres, tarifaHora: deCliente.tarifaHora, origen: 'cliente' }
    : politicas.flota
      ? { horasLibres: politicas.flota.horasLibres, tarifaHora: politicas.flota.tarifaHora, origen: 'flota' }
      : null;

  const desglose = armarDesglose({ km: n.km, dias: n.dias, casetas, costos: config, pactoDetencion: pacto });

  // La tarifa del catálogo, congelada como referencia (no como precio: el
  // precio lo decide el humano — doctrina de la 0051).
  const sugerencia = tarifaSugerida(tarifas, {
    clienteId: n.clienteId, origen, destino, km: n.km, fecha: hoyMx(),
  });
  const persistido: DesglosePersistido = {
    ...desglose,
    tarifaCatalogo: sugerencia
      ? { monto: sugerencia.monto, porque: sugerencia.porque, ambigua: sugerencia.ambigua }
      : null,
  };

  const { data, error } = await acotada(supabaseAdmin().from('cotizacion').insert({
    tenant_id: tenantId,
    folio: n.folio?.trim() || null,
    cliente_id: n.clienteId,
    origen,
    destino,
    km: n.km,
    costo_estimado: desglose.costoTotal,
    // `?? null` y NO `|| null`: un flete cotizado en $0 (cortesía) es un
    // precio real, no "sin capturar".
    precio: n.precio ?? null,
    estado: 'borrador',
    vigente_hasta: n.vigenteHasta || null,
    desglose: persistido,
    creada_por: userId,
  }).select('id').single(), 'cotizador.crear');
  if (error) throw new Error(`cotizador.crear: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('cotizador.crear: el insert no devolvió id');
  return String(id);
}

// ── Decidir ────────────────────────────────────────────────────────────────

export async function marcarEnviada(tenantId: string, id: string): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().from('cotizacion')
    .update({ estado: 'enviada' })
    .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'borrador')
    .select('id'), 'cotizador.enviada');
  if (error) throw new Error(`cotizador.enviada: ${error.message}`);
  if (!data || data.length === 0) throw new DatoInvalido('Solo un borrador se puede marcar como enviada.');
}

/**
 * Perdida o vencida: terminal, con claim. El UPDATE condicional sobre
 * `decidida_en IS NULL` es el árbitro — el segundo tap recibe la verdad.
 */
export async function marcarPerdida(
  tenantId: string,
  id: string,
  como: 'perdida' | 'vencida',
  userId: string | null,
): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().from('cotizacion')
    .update({ estado: como, decidida_en: new Date().toISOString(), decidida_por: userId })
    .eq('tenant_id', tenantId).eq('id', id)
    .in('estado', ['borrador', 'enviada'])
    .is('decidida_en', null)
    .select('id'), 'cotizador.perdida');
  if (error) throw new Error(`cotizador.perdida: ${error.message}`);
  if (!data || data.length === 0) {
    throw new DatoInvalido('Esta cotización ya fue decidida (o no está viva).');
  }
}

/**
 * La conversión: cotización → viaje. Claim primero (el doble clic lo
 * resuelve la base), luego `crearViaje` con la ruta/cliente/precio de la
 * cotización — el ingreso del viaje ES el precio cotizado. Si crear el viaje
 * falla, el claim se suelta para que el humano pueda reintentar.
 */
export async function convertirEnViaje(
  tenantId: string,
  id: string,
  userId: string | null,
): Promise<string> {
  const { data: cot, error: errLee } = await acotada(supabaseAdmin().from('cotizacion')
    .select('origen, destino, km, precio, cliente_id, estado')
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'cotizador.leer');
  if (errLee) throw new Error(`cotizador.leer: ${errLee.message}`);
  if (!cot) throw new DatoInvalido('La cotización no existe en esta flota.');
  if (cot.precio === null) {
    // El CHECK `cotizacion_ganada_completa` (0051) lo rebotaría igual; aquí
    // se dice en palabras de pantalla ANTES de crear nada.
    throw new DatoInvalido('Sin precio cotizado no hay viaje que crear: captura el precio primero.');
  }
  if (cot.estado !== 'borrador' && cot.estado !== 'enviada') {
    throw new DatoInvalido(`Una cotización ${cot.estado} ya no se convierte en viaje.`);
  }

  // EL CLAIM: gana exactamente uno.
  const { data: claim, error: errClaim } = await acotada(supabaseAdmin().from('cotizacion')
    .update({ decidida_en: new Date().toISOString(), decidida_por: userId })
    .eq('tenant_id', tenantId).eq('id', id)
    .in('estado', ['borrador', 'enviada'])
    .is('decidida_en', null)
    .select('id'), 'cotizador.claim');
  if (errClaim) throw new Error(`cotizador.claim: ${errClaim.message}`);
  if (!claim || claim.length === 0) {
    throw new DatoInvalido('Alguien ya está decidiendo esta cotización.');
  }

  let viajeId: string;
  try {
    // Import dinámico (patrón del runner): `operacion.ts` arrastra los
    // disparos de despacho (briefing, Carta Porte) y solo esta función los
    // necesita — los lectores del panel no tienen por qué cargarlos.
    const { crearViaje } = await import('../operacion');
    viajeId = await crearViaje(tenantId, {
      origen: cot.origen as string,
      destino: cot.destino as string,
      clienteId: (cot.cliente_id as string) ?? null,
      ingresoFlete: Number(cot.precio),
      kmRecorridos: cot.km === null ? null : Number(cot.km),
    });
  } catch (e) {
    // COMPENSACIÓN: el viaje no existe, así que la decisión tampoco. Soltar
    // el claim deja el reintento en manos del humano; si esto también falla,
    // el log lo dice y la cotización queda "decidiéndose" — visible, no rota.
    await acotada(supabaseAdmin().from('cotizacion')
      .update({ decidida_en: null, decidida_por: null })
      .eq('tenant_id', tenantId).eq('id', id).neq('estado', 'ganada'), 'cotizador.soltarClaim')
      .then(({ error: e2 }) => {
        if (e2) logger.warn('cotizador.claim_huerfano', { id, err: e2.message });
      });
    throw e;
  }

  const { error: errGana } = await acotada(supabaseAdmin().from('cotizacion')
    .update({ estado: 'ganada', viaje_id: viajeId })
    .eq('tenant_id', tenantId).eq('id', id), 'cotizador.ganada');
  if (errGana) {
    // El viaje YA existe — eso es lo que el humano pidió. El estado de la
    // cotización se puede corregir a mano; el viaje no se deshace.
    logger.warn('cotizador.ganada_sin_marcar', { id, viajeId, err: errGana.message });
  }
  return viajeId;
}
