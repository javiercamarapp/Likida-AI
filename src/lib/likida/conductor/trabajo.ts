import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerTodo } from '../pg';
import { COLUMNAS_HITO, COLUMNAS_VIAJE_CTX, filaAHito, filaAViajeCtx, type ViajeContexto } from './repo';
import type { AvisoReclamado } from './planificador';
import type { HitoFila } from './tipos';
import { debeReintentarseValidacion } from './validacion';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from './geometria_datos';
import type { MuestraGps, SitioGps, SitiosViaje, UnidadDeViaje } from './ciclo_gps';
import type { CandidatoSitio, LadoViaje, SitioCatalogo } from './sitio_derivado';
import { faltaEsquema, filaAEpisodio } from './repo';
import type { EstadoEpisodios } from './senal_vida';

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA DE TRABAJO DEL CRON `conductor-hitos` — las lecturas que CRUZAN flotas.
//
// El cron barre los viajes abiertos de TODAS las flotas en una corrida, así que estas
// consultas no llevan `.eq('tenant_id', …)` A PROPÓSITO (como `liquidacion_externa/
// trabajo.ts` y `wa-outbox`). Viven en su PROPIO archivo para que la exención de
// `consultas_admin_filtran_tenant.test.ts` no cubra a `repo.ts`, que atiende a una
// flota por llamada y sigue vigilado entero.
//
// Cada fila que devuelven trae su `tenant_id`, y TODO lo que el motor hace después con
// ella (planificar con la config DE ESA flota, reclamar el aviso, mandar, marcar) se ancla
// a ESE tenant. `tenantDelViaje` resuelve la flota de un payload de botón (`jefe_atiendo:
// <viaje>`) y la respuesta se vuelve a comprobar con `puedeAcusar(tenant, teléfono)`.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

/** El tenant de un viaje por su id (el payload del «Ya lo atiendo» no trae flota). `null` = no existe. */
export async function tenantDelViaje(viajeId: string): Promise<string | null> {
  const res = await acotada(supabaseAdmin().from('viaje').select('tenant_id').eq('id', viajeId).maybeSingle(), 'conductor.acuse_viaje');
  const f = exigir(res as never, 'conductor.acuse_viaje') as { tenant_id: string } | null;
  return f ? f.tenant_id : null;
}

const trozos = <T>(xs: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
};

export async function sembrarHitos(limite: number): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().rpc('sembrar_hitos_conductor', { p_limite: limite }), 'conductor.sembrar');
  if (error) throw new Error(`conductor.sembrar: ${error.message}`);
  return Number(data ?? 0);
}

export async function leerViajesActivos(limite: number): Promise<ViajeContexto[]> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').select(COLUMNAS_VIAJE_CTX)
    .eq('estatus', 'abierto').not('aceptado_en', 'is', null)
    .order('aceptado_en', { ascending: true }).order('id').limit(limite), 'conductor.viajes');
  return ((exigir(res as never, 'conductor.viajes') ?? []) as unknown as Fila[]).map(filaAViajeCtx);
}

export async function leerHitosDeViajes(viajeIds: string[]): Promise<HitoFila[]> {
  const salida: HitoFila[] = [];
  for (const ids of trozos(viajeIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje_hito').select(COLUMNAS_HITO).in('viaje_id', ids).order('id').range(desde, hasta), 'conductor.hitos_lote') as never, 'conductor.hitos_lote');
    salida.push(...filas.map(filaAHito));
  }
  return salida;
}

export async function leerAvisosDeHitos(hitoIds: string[]): Promise<Array<AvisoReclamado & { hitoId: string }>> {
  const salida: Array<AvisoReclamado & { hitoId: string }> = [];
  for (const ids of trozos(hitoIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje_hito_aviso').select('viaje_hito_id, ciclo, clase, nivel').in('viaje_hito_id', ids).order('id').range(desde, hasta), 'conductor.avisos_lote') as never, 'conductor.avisos_lote');
    for (const f of filas) {
      salida.push({ hitoId: String(f.viaje_hito_id), ciclo: Number(f.ciclo), clase: f.clase as AvisoReclamado['clase'], nivel: Number(f.nivel) });
    }
  }
  return salida;
}

/** Cuántos mensajes proactivos recibió cada chofer desde `desde` (el tope diario). */
export async function contarEnviadosPorChofer(operadorIds: string[], desde: Date): Promise<Record<string, number>> {
  const cuenta: Record<string, number> = {};
  for (const ids of trozos(operadorIds, 150)) {
    const filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin()
      .from('viaje_hito_aviso').select('operador_id').in('operador_id', ids).in('clase', ['solicitud', 'recordatorio'])
      .gte('created_at', desde.toISOString()).order('id').range(d, h), 'conductor.tope_dia') as never, 'conductor.tope_dia');
    for (const f of filas) cuenta[String(f.operador_id)] = (cuenta[String(f.operador_id)] ?? 0) + 1;
  }
  return cuenta;
}

/**
 * Las llegadas recientes que aún no se pudieron validar contra la ubicación: sin veredicto del ciclo
 * vigente, o «sin dato» por falta de posición (el GPS reporta con minutos de retraso). Cruza flotas
 * a propósito (el barrido es del cron); cada candidato trae su `tenantId` y todo lo posterior se
 * ancla a él. Solo viajes abiertos.
 */
export async function leerCandidatosValidacion(desde: Date, limite: number): Promise<Array<{ hito: HitoFila; viaje: ViajeContexto; resultadoPrevio: 'sin_coincidencia' | null }>> {
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO)
    .in('tipo', ['llegada_carga', 'llegada_descarga']).eq('estado', 'recibido').gte('recibido_en', desde.toISOString())
    .order('recibido_en', { ascending: false }).order('id').limit(limite * 2), 'conductor.candidatos_validacion');
  const hitos = ((exigir(res as never, 'conductor.candidatos_validacion') ?? []) as unknown as Fila[]).map(filaAHito);
  if (hitos.length === 0) return [];

  const vistos = new Map<string, { ciclo: number; resultado: string; motivo: string | null }>();
  for (const ids of trozos(hitos.map((h) => h.id), 150)) {
    const rv = await acotada(supabaseAdmin()
      .from('viaje_hito_validacion').select('viaje_hito_id, ciclo, resultado, motivo').in('viaje_hito_id', ids), 'conductor.candidatos_veredictos');
    for (const f of (exigir(rv as never, 'conductor.candidatos_veredictos') ?? []) as unknown as Fila[]) {
      vistos.set(`${f.viaje_hito_id}|${f.ciclo}`, { ciclo: Number(f.ciclo), resultado: String(f.resultado), motivo: typeof f.motivo === 'string' ? f.motivo : null });
    }
  }
  const pendientes = hitos.filter((h) => {
    const v = vistos.get(`${h.id}|${h.ciclo}`);
    return debeReintentarseValidacion(v);
  }).slice(0, limite);
  if (pendientes.length === 0) return [];

  const viajes = new Map<string, ViajeContexto>();
  for (const ids of trozos([...new Set(pendientes.map((h) => h.viajeId))], 150)) {
    const rv = await acotada(supabaseAdmin().from('viaje').select(COLUMNAS_VIAJE_CTX).in('id', ids).eq('estatus', 'abierto'), 'conductor.candidatos_viajes');
    for (const f of (exigir(rv as never, 'conductor.candidatos_viajes') ?? []) as unknown as Fila[]) viajes.set(String(f.id), filaAViajeCtx(f));
  }
  // El hito y su viaje SON de la misma flota: se comprueba, no se supone.
  return pendientes.flatMap((h) => {
    const v = viajes.get(h.viajeId);
    if (!v || v.tenantId !== h.tenantId) return [];
    const previo = vistos.get(`${h.id}|${h.ciclo}`);
    return [{ hito: h, viaje: v, resultadoPrevio: previo?.resultado === 'sin_coincidencia' ? 'sin_coincidencia' as const : null }];
  });
}

/** El correo de un usuario del panel por su id (llave primaria): firma la bitácora de las acciones de oficina. `null` = no existe. */
export async function emailDeUsuario(userId: string): Promise<string | null> {
  const res = await acotada(supabaseAdmin().from('app_user').select('email').eq('id', userId).maybeSingle(), 'conductor.email_usuario');
  const f = exigir(res as never, 'conductor.email_usuario') as { email?: unknown } | null;
  return f && typeof f.email === 'string' && f.email.length > 0 ? f.email : null;
}

/**
 * Qué viajes traen sitio de carga y de descarga (solo si están asignados, no sus coordenadas): lo que el aviso de «llegada sin
 * confirmar» necesita para distinguir «sin posición que la respalde» de «sin sitio contra el cual compararla». Lanza si la base
 * no contesta o no tiene la columna (0385): sin saberlo no se avisa, porque un «sin sitio» falso es peor que un aviso tardío.
 */
export async function leerSitiosDeViajes(viajeIds: string[]): Promise<Map<string, { origen: boolean; destino: boolean }>> {
  const salida = new Map<string, { origen: boolean; destino: boolean }>();
  for (const ids of trozos(viajeIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje').select('id, origen_geocerca_id, destino_geocerca_id').in('id', ids).order('id').range(desde, hasta), 'conductor.sitios_viajes') as never, 'conductor.sitios_viajes');
    for (const f of filas) salida.set(String(f.id), { origen: typeof f.origen_geocerca_id === 'string', destino: typeof f.destino_geocerca_id === 'string' });
  }
  return salida;
}

/**
 * Los sitios (con su polígono nativo si lo tienen) que cada viaje espera para cargar y descargar. Cruza flotas a propósito:
 * el barrido del ciclo por geocerca es del cron. El sitio de un viaje es de SU flota (FK compuesta con tenant, 0385) y aun así
 * se acota la lectura del catálogo por las flotas de los viajes. Un sitio archivado no cuenta (es como no tenerlo).
 */
export async function leerSitiosGeometriaDeViajes(viajes: Array<{ id: string; tenantId: string }>): Promise<Map<string, SitiosViaje>> {
  const salida = new Map<string, SitiosViaje>();
  if (viajes.length === 0) return salida;
  const tenants = [...new Set(viajes.map((v) => v.tenantId))];
  const asignados = new Map<string, { origen: string | null; destino: string | null }>();
  for (const ids of trozos(viajes.map((v) => v.id), 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje').select('id, origen_geocerca_id, destino_geocerca_id').in('tenant_id', tenants).in('id', ids).order('id').range(desde, hasta), 'conductor.ciclo_sitios_viajes') as never, 'conductor.ciclo_sitios_viajes');
    for (const f of filas) asignados.set(String(f.id), { origen: typeof f.origen_geocerca_id === 'string' ? f.origen_geocerca_id : null, destino: typeof f.destino_geocerca_id === 'string' ? f.destino_geocerca_id : null });
  }
  const sitioIds = [...new Set([...asignados.values()].flatMap((a) => [a.origen, a.destino]).filter((x): x is string => x !== null))];
  const sitios = new Map<string, SitioGps>();
  for (const ids of trozos(sitioIds, 150)) {
    const g = await conPoligonoOCirculo((conPoligono) => acotada(supabaseAdmin().from('geocerca')
      .select(conPoligono ? `id, nombre, lat, lng, radio_m, ${COLUMNAS_POLIGONO}` : 'id, nombre, lat, lng, radio_m')
      .in('tenant_id', tenants).in('id', ids).eq('activa', true), 'conductor.ciclo_sitios'));
    for (const f of (exigir(g as never, 'conductor.ciclo_sitios') ?? []) as unknown as Fila[]) {
      sitios.set(String(f.id), { id: String(f.id), nombre: String(f.nombre), lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), ...geometriaDeFila(f) });
    }
  }
  for (const [viajeId, a] of asignados) {
    salida.set(viajeId, { origen: a.origen ? sitios.get(a.origen) ?? null : null, destino: a.destino ? sitios.get(a.destino) ?? null : null });
  }
  return salida;
}

/**
 * Las muestras de GPS de verdad (el pin de WhatsApp NO: lo elige el chofer, no mide dónde está el tractor) de cada unidad desde
 * `desde`, de la más vieja a la más reciente. Llave `<tenant>|<unidad>`. Cruza flotas a propósito (cron); cada lectura se acota
 * por las flotas de las unidades pedidas.
 */
export async function leerMuestrasGps(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps[]>> {
  const salida = new Map<string, MuestraGps[]>();
  if (unidades.length === 0) return salida;
  const tenants = [...new Set(unidades.map((u) => u.tenantId))];
  const pedidas = new Set(unidades.map((u) => `${u.tenantId}|${u.unidadId}`));
  for (const ids of trozos([...new Set(unidades.map((u) => u.unidadId))], 100)) {
    const filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('posicion').select('tenant_id, unidad_id, lat, lng, medida_en')
      .in('tenant_id', tenants).in('unidad_id', ids).neq('proveedor', 'whatsapp').gte('medida_en', desde.toISOString())
      .order('medida_en', { ascending: true }).order('id').range(d, h), 'conductor.ciclo_muestras') as never, 'conductor.ciclo_muestras');
    for (const f of filas) {
      const llave = `${String(f.tenant_id)}|${String(f.unidad_id)}`;
      if (!pedidas.has(llave)) continue; // la combinación flota/unidad que no se pidió no es de esta corrida
      salida.set(llave, [...(salida.get(llave) ?? []), { lat: Number(f.lat), lng: Number(f.lng), medidaEn: new Date(String(f.medida_en)) }]);
    }
  }
  return salida;
}

/**
 * Los viajes abiertos y aceptados a los que les falta el sitio de carga o de descarga, con el texto de su origen y destino, su
 * cliente y qué lados ya se derivaron una vez (0637; una base sin esa tabla se lee como «ninguno»). Cruza flotas a propósito
 * (cron); cada candidato lleva su `tenantId` y todo lo posterior se ancla a él. Los más recientes primero.
 */
export async function leerCandidatosSitioDerivado(limite: number): Promise<CandidatoSitio[]> {
  const res = await acotada(supabaseAdmin().from('viaje')
    .select('id, tenant_id, origen, destino, cliente_id, origen_geocerca_id, destino_geocerca_id')
    .eq('estatus', 'abierto').not('aceptado_en', 'is', null).or('origen_geocerca_id.is.null,destino_geocerca_id.is.null')
    .order('aceptado_en', { ascending: false }).order('id').limit(limite), 'conductor.sitio_derivado_viajes');
  const viajes = (exigir(res as never, 'conductor.sitio_derivado_viajes') ?? []) as unknown as Fila[];
  if (viajes.length === 0) return [];

  const derivados = new Map<string, Set<LadoViaje>>();
  for (const ids of trozos(viajes.map((v) => String(v.id)), 150)) {
    const rd = await acotada(supabaseAdmin().from('viaje_sitio_derivado').select('viaje_id, lado').in('viaje_id', ids), 'conductor.sitio_derivado_previos');
    if (rd.error) {
      if (faltaEsquema(rd.error, /viaje_sitio_derivado/i)) break; // base sin la 0637: no hay derivaciones previas que respetar
      throw new Error(`conductor.sitio_derivado_previos: ${rd.error.message}`);
    }
    for (const f of (rd.data ?? []) as unknown as Fila[]) {
      const k = String(f.viaje_id);
      derivados.set(k, (derivados.get(k) ?? new Set()).add(f.lado === 'destino' ? 'destino' : 'origen'));
    }
  }
  return viajes.map((v): CandidatoSitio => {
    const conSitio = new Set<LadoViaje>();
    if (typeof v.origen_geocerca_id === 'string') conSitio.add('origen');
    if (typeof v.destino_geocerca_id === 'string') conSitio.add('destino');
    return {
      tenantId: String(v.tenant_id), viajeId: String(v.id), origen: typeof v.origen === 'string' ? v.origen : null,
      destino: typeof v.destino === 'string' ? v.destino : null, clienteId: typeof v.cliente_id === 'string' ? v.cliente_id : null,
      conSitio, yaDerivados: derivados.get(String(v.id)) ?? new Set(),
    };
  });
}

/** Los sitios ACTIVOS del catálogo del Conductor de cada flota (el de peajes es de otra pantalla). Acotado a las flotas pedidas. */
export async function leerCatalogoSitios(tenantIds: string[]): Promise<Map<string, SitioCatalogo[]>> {
  const salida = new Map<string, SitioCatalogo[]>();
  if (tenantIds.length === 0) return salida;
  const filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('geocerca').select('id, tenant_id, nombre, codigo, cliente_id')
    .in('tenant_id', tenantIds).eq('catalogo', 'conductor').eq('activa', true).order('id').range(d, h), 'conductor.sitio_derivado_catalogo') as never, 'conductor.sitio_derivado_catalogo');
  for (const f of filas) {
    const t = String(f.tenant_id);
    salida.set(t, [...(salida.get(t) ?? []), {
      id: String(f.id), nombre: String(f.nombre), codigo: typeof f.codigo === 'string' ? f.codigo : null, clienteId: typeof f.cliente_id === 'string' ? f.cliente_id : null,
    }]);
  }
  return salida;
}

/**
 * Los episodios de «sin señal de vida» de estos viajes: el abierto (si lo hay) y el silencio vigente que dejó la respuesta del chofer.
 * Cruza flotas a propósito (cron). Una base sin la 0636 se lee como «sin episodios» (la perilla de la flota tampoco existe: apagada).
 */
export async function leerEpisodiosSenalVida(viajeIds: string[], ahora: Date): Promise<Map<string, EstadoEpisodios>> {
  const salida = new Map<string, EstadoEpisodios>();
  for (const ids of trozos(viajeIds, 150)) {
    const res = await acotada(supabaseAdmin().from('viaje_senal_vida')
      .select('id, tenant_id, viaje_id, motivo, abierto_en, nivel_enviado, aviso_1_en, aviso_2_en, escalado_en, cerrado_en, silenciado_hasta')
      .in('viaje_id', ids).or(`cerrado_en.is.null,silenciado_hasta.gt.${ahora.toISOString()}`).order('abierto_en', { ascending: false }).order('id').limit(ids.length * 3), 'conductor.senal_episodios');
    if (res.error) {
      if (faltaEsquema(res.error, /viaje_senal_vida/i)) return salida;
      throw new Error(`conductor.senal_episodios: ${res.error.message}`);
    }
    for (const f of (res.data ?? []) as unknown as Fila[]) {
      const k = String(f.viaje_id);
      const previo = salida.get(k) ?? { abierto: null, silenciadoHasta: null };
      if (f.cerrado_en === null || f.cerrado_en === undefined) previo.abierto = filaAEpisodio(f);
      else if (typeof f.silenciado_hasta === 'string') {
        const t = new Date(f.silenciado_hasta);
        if (!previo.silenciadoHasta || t.getTime() > previo.silenciadoHasta.getTime()) previo.silenciadoHasta = t;
      }
      salida.set(k, previo);
    }
  }
  return salida;
}

/** La hora de la última muestra de GPS de verdad de cada unidad desde `desde` (una consulta por unidad; son pocas: solo las que no tienen muestras recientes). */
export async function leerUltimaMuestraGps(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, Date>> {
  const salida = new Map<string, Date>();
  for (const u of unidades.slice(0, 200)) {
    const res = await acotada(supabaseAdmin().from('posicion').select('medida_en')
      .eq('tenant_id', u.tenantId).eq('unidad_id', u.unidadId).neq('proveedor', 'whatsapp').gte('medida_en', desde.toISOString())
      .order('medida_en', { ascending: false }).order('id').limit(1), 'conductor.senal_ultima_muestra');
    const f = ((exigir(res as never, 'conductor.senal_ultima_muestra') ?? []) as unknown as Fila[])[0];
    if (f && typeof f.medida_en === 'string') salida.set(`${u.tenantId}|${u.unidadId}`, new Date(f.medida_en));
  }
  return salida;
}
