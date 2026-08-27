import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { listarProveedoresEmergencia, polizaVigenteDe, type ProveedorEmergencia, type FlotaPoliza, type TipoProveedor } from './emergencias';
import type { TipoAsistencia } from './asistencia_wa';

// ═══════════════════════════════════════════════════════════════════════════
// EL PROVEEDOR CORRECTO (Capa C del agente de ayuda en ruta, blueprint 19).
//
// Ante "se me ponchó una llanta", proponerle al JEFE al proveedor correcto en
// una cascada de cuatro fuentes con precedencia fija:
//
//   1. El directorio verificado de la flota (0198) — la realidad mexicana: el
//      proveedor carretero promedio no tiene presencia digital confiable, y
//      la flota ya tiene sus proveedores de confianza. El agente los honra,
//      no los sustituye.
//   2. El 800 de la póliza (flota_poliza) — para siniestro o grúa, el "mejor
//      proveedor cercano" suele ser LA ASEGURADORA de la flota. Se presenta
//      con número de póliza en mano; quien marca es un humano, nunca Likida
//      (una llamada abre un siniestro: dinero y acto jurídico).
//   3. Google Places — NO CONFIGURADO: requiere la cuenta de Google Cloud
//      (decisión de Javier, sección E del plan). El escalón EXISTE en el
//      resultado como no_disponible con el motivo dicho — jamás se simula ni
//      se inventa un negocio.
//   4. Recursos públicos nacionales — números verificados con fuente citada
//      en RECURSOS_NACIONALES. Solo informan; Likida jamás marca.
//
// El resultado declara SIEMPRE qué salió de qué fuente y qué escalones no
// aplicaron y por qué — la cascada es citable, no una caja negra.
//
// CANDADOS (reglas de la casa):
//  · Teléfonos solo del directorio verificado o de fuente nacional citada.
//    Un proveedor capturado SIN verificar se lista rotulado "sin confirmar".
//  · Distancias solo con coordenadas reales de AMBOS lados (haversine, el
//    mismo cálculo de la 0207); sin coordenadas se lista sin ordenar y se
//    dice — jamás un "más cercano" inventado.
//  · En ROBO/violencia la cascada SE OMITE entera: el protocolo mudo manda
//    ("no le marques") y recomendar un gruero en un asalto es ruido peligroso.
//  · 911 es INFORMACIÓN al humano, nunca una acción de Likida.
// ═══════════════════════════════════════════════════════════════════════════

/** Qué tipos del directorio sirven a cada tipo de incidencia. `bloqueo` no
 *  tiene proveedor que lo resuelva — su escalón de directorio no aplica. */
const TIPOS_UTILES: Record<Exclude<TipoAsistencia, 'robo'>, TipoProveedor[]> = {
  varado: ['llantera', 'mecanico', 'grua'],
  siniestro: ['grua', 'medico'],
  emergencia_medica: ['medico'],
  bloqueo: [],
};

/** La póliza cubre asistencia vial/grúa: aplica a siniestro y varado. */
const POLIZA_APLICA: ReadonlySet<TipoAsistencia> = new Set(['siniestro', 'varado']);

export interface RecursoNacional {
  nombre: string;
  telefono: string;
  nota: string;
  /** A qué tipos de incidencia le sirve este recurso. */
  aplica: TipoAsistencia[];
}

/**
 * Números públicos VERIFICADOS, cada uno con su fuente. No se agrega aquí
 * ningún número que no se pueda citar — un teléfono inventado en una
 * emergencia es el peor bug posible de este módulo.
 */
export const RECURSOS_NACIONALES: readonly RecursoNacional[] = [
  {
    // Fuente: gob.mx/sectur/angelesverdes — "078, el número gratuito que te
    // acompaña, auxilia y orienta" (asistencia mecánica gratuita en carreteras
    // federales, 08:00-20:00). Citada en el blueprint 19, consultada 26-ago-2026.
    nombre: 'Ángeles Verdes',
    telefono: '078',
    nota: 'asistencia mecánica gratuita en carreteras federales (08:00–20:00)',
    aplica: ['varado'],
  },
  {
    // Fuente: gob.mx/capufe — 074 es el Centro de Atención a Usuarios de
    // CAPUFE (auxilio vial y estado de las autopistas de cuota).
    nombre: 'CAPUFE',
    telefono: '074',
    nota: 'auxilio vial y estado de autopistas de cuota',
    aplica: ['varado', 'bloqueo', 'siniestro'],
  },
  {
    // Fuente: SETIQ/ANIQ (Sistema de Emergencias en Transporte para la
    // Industria Química) — 800 002 1400. Citado en el blueprint 19 y en el
    // directorio semilla del diseño de Fase 6.
    nombre: 'SETIQ',
    telefono: '8000021400',
    nota: 'emergencias con materiales peligrosos — solo si la carga es matpel',
    aplica: ['siniestro'],
  },
  {
    // 911 no es un proveedor: es la información que el humano ya conoce. Se
    // incluye para que el mensaje del jefe lo repita cuando hay lesionados o
    // emergencia médica. LIKIDA JAMÁS MARCA (candado de la casa).
    nombre: 'Emergencias',
    telefono: '911',
    nota: 'si hay lesionados o riesgo de vida — marca un humano, no Likida',
    aplica: ['emergencia_medica', 'siniestro'],
  },
];

export interface ProveedorRecomendado {
  nombre: string;
  tipo: TipoProveedor;
  telefono: string;
  verificado: boolean;
  /** null = no medible (falta la coordenada de un lado, y se dice). */
  distanciaKm: number | null;
  /** true cuando la distancia medida rebasa el radio que el proveedor declaró. */
  fueraDeRadio: boolean;
}

export interface CascadaProveedor {
  /** true solo en robo/violencia: la cascada entera se calla a propósito. */
  omitida: boolean;
  motivoOmision: string | null;
  directorio: {
    /** 'sin_proveedores' = el directorio no tiene de los tipos útiles;
     *  'no_aplica_tipo' = a este tipo de incidencia no lo resuelve un
     *  proveedor (bloqueo); 'con_opciones' = hay lista. */
    estado: 'con_opciones' | 'sin_proveedores' | 'no_aplica_tipo';
    /** true = hubo coordenadas del incidente Y de proveedores: la lista viene
     *  ordenada por cercanía. false = sin orden, y el texto lo dice. */
    ordenadoPorDistancia: boolean;
    opciones: ProveedorRecomendado[];
  };
  poliza:
    | { estado: 'vigente' | 'sin_vigencia_capturada'; aseguradora: string; telefono: string; numeroPoliza: string; venceEl: string | null }
    | { estado: 'vencida'; aseguradora: string; telefono: string; numeroPoliza: string; venceEl: string }
    | { estado: 'sin_poliza' | 'no_aplica' };
  places: { estado: 'no_disponible'; motivo: string };
  nacionales: RecursoNacional[];
}

/** Haversine en km — la misma aritmética esférica de `presencia_en_sitios`
 *  (0207), aquí en TS porque son ≤ decenas de proveedores, no miles de
 *  posiciones. */
export function distanciaKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const R = 6371;
  const s =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface EntradaCascada {
  tipo: TipoAsistencia;
  lat: number | null;
  lng: number | null;
  proveedores: ProveedorEmergencia[];
  poliza: FlotaPoliza | null;
  /** 'YYYY-MM-DD' del día México — lo pasa el llamador (hoyMx), no se computa
   *  aquí: el motor es puro. */
  hoy: string;
}

const MAX_OPCIONES = 3;

/**
 * El motor PURO de la cascada. No lee la base, no manda mensajes: dado el
 * estado del mundo, dice qué recomendar y qué no se pudo — con motivo.
 */
export function armarCascada(e: EntradaCascada): CascadaProveedor {
  if (e.tipo === 'robo') {
    // En violencia activa la única recomendación válida es el silencio: el
    // aviso al jefe ya trae el protocolo ("no le marques"). Un gruero
    // recomendado aquí sería ruido — y ruido en un asalto cuesta caro.
    return {
      omitida: true,
      motivoOmision: 'protocolo de violencia: la cascada no recomienda proveedores en un robo',
      directorio: { estado: 'no_aplica_tipo', ordenadoPorDistancia: false, opciones: [] },
      poliza: { estado: 'no_aplica' },
      places: PLACES_NO_DISPONIBLE,
      nacionales: [],
    };
  }

  const utiles = TIPOS_UTILES[e.tipo];
  const hayIncidenteUbicado = e.lat != null && e.lng != null;

  let directorio: CascadaProveedor['directorio'];
  if (utiles.length === 0) {
    directorio = { estado: 'no_aplica_tipo', ordenadoPorDistancia: false, opciones: [] };
  } else {
    const candidatos = e.proveedores.filter((p) => utiles.includes(p.tipo));
    const conDistancia = candidatos.map((p): ProveedorRecomendado => {
      const medible = hayIncidenteUbicado && p.lat != null && p.lng != null;
      const d = medible ? distanciaKm(e.lat as number, e.lng as number, p.lat as number, p.lng as number) : null;
      return {
        nombre: p.nombre,
        tipo: p.tipo,
        telefono: p.telefono,
        verificado: p.verificadoEn !== null,
        distanciaKm: d == null ? null : Math.round(d * 10) / 10,
        // Fuera del radio DECLARADO por el proveedor: se dice, no se oculta —
        // el jefe decide si igual le marca.
        fueraDeRadio: d != null && p.radioKm != null && d > p.radioKm,
      };
    });
    // Verificados primero SIEMPRE (regla de la casa); dentro de cada grupo,
    // por distancia cuando se pudo medir. Sin coordenadas no hay orden de
    // cercanía y el resultado lo declara.
    const ordenadoPorDistancia = conDistancia.some((p) => p.distanciaKm != null);
    conDistancia.sort((a, b) => {
      if (a.verificado !== b.verificado) return a.verificado ? -1 : 1;
      if (a.distanciaKm == null && b.distanciaKm == null) return 0;
      if (a.distanciaKm == null) return 1;
      if (b.distanciaKm == null) return -1;
      return a.distanciaKm - b.distanciaKm;
    });
    directorio = candidatos.length === 0
      ? { estado: 'sin_proveedores', ordenadoPorDistancia: false, opciones: [] }
      : { estado: 'con_opciones', ordenadoPorDistancia, opciones: conDistancia.slice(0, MAX_OPCIONES) };
  }

  let poliza: CascadaProveedor['poliza'];
  if (!POLIZA_APLICA.has(e.tipo)) {
    poliza = { estado: 'no_aplica' };
  } else if (!e.poliza) {
    poliza = { estado: 'sin_poliza' };
  } else if (e.poliza.vigenciaHasta && e.poliza.vigenciaHasta < e.hoy) {
    // Vencida: SE DICE y no se presenta como vigente — recomendar una póliza
    // muerta en un siniestro es afirmar una cobertura que no existe.
    poliza = {
      estado: 'vencida',
      aseguradora: e.poliza.aseguradora,
      telefono: e.poliza.telefonoSiniestros,
      numeroPoliza: e.poliza.numeroPoliza,
      venceEl: e.poliza.vigenciaHasta,
    };
  } else {
    poliza = {
      estado: e.poliza.vigenciaHasta ? 'vigente' : 'sin_vigencia_capturada',
      aseguradora: e.poliza.aseguradora,
      telefono: e.poliza.telefonoSiniestros,
      numeroPoliza: e.poliza.numeroPoliza,
      venceEl: e.poliza.vigenciaHasta,
    };
  }

  return {
    omitida: false,
    motivoOmision: null,
    directorio,
    poliza,
    places: PLACES_NO_DISPONIBLE,
    nacionales: RECURSOS_NACIONALES.filter((r) => r.aplica.includes(e.tipo)),
  };
}

const PLACES_NO_DISPONIBLE = {
  estado: 'no_disponible' as const,
  motivo: 'búsqueda pública (Google Places) sin configurar — requiere la cuenta de Google Cloud',
};

/**
 * El bloque de texto que se APPENDEA al 🚨 del jefe. Compacto: el jefe está
 * leyendo una emergencia, no un catálogo. `null` = no hay nada que decir
 * (cascada omitida, o ningún escalón produjo dato).
 */
export function textoCascadaParaJefe(c: CascadaProveedor): string | null {
  if (c.omitida) return null;
  const lineas: string[] = [];

  if (c.directorio.estado === 'con_opciones') {
    for (const p of c.directorio.opciones) {
      const partes = [
        `${p.nombre} (${p.tipo}) ${p.telefono}`,
        p.verificado ? null : 'SIN confirmar',
        p.distanciaKm != null ? `~${p.distanciaKm} km` : null,
        p.fueraDeRadio ? 'fuera de su radio declarado' : null,
      ].filter(Boolean);
      lineas.push(`· ${partes.join(' — ')}`);
    }
    if (!c.directorio.ordenadoPorDistancia) {
      lineas.push('  (sin ubicación del incidente: la lista no está ordenada por cercanía)');
    }
  } else if (c.directorio.estado === 'sin_proveedores') {
    lineas.push('· Tu directorio no tiene proveedores de este tipo — captúralos en Emergencias.');
  }

  if (c.poliza.estado === 'vigente' || c.poliza.estado === 'sin_vigencia_capturada') {
    lineas.push(
      `· Siniestros ${c.poliza.aseguradora}: ${c.poliza.telefono} (póliza ${c.poliza.numeroPoliza}${c.poliza.estado === 'sin_vigencia_capturada' ? ', vigencia sin capturar' : ''})`,
    );
  } else if (c.poliza.estado === 'vencida') {
    lineas.push(
      `· ⚠️ Tu póliza ${c.poliza.aseguradora} VENCIÓ el ${c.poliza.venceEl} — el ${c.poliza.telefono} podría no cubrir. Revísala.`,
    );
  }

  for (const r of c.nacionales) {
    lineas.push(`· ${r.nombre} ${r.telefono} — ${r.nota}`);
  }

  if (lineas.length === 0) return null;
  return `\nA quién marcarle (marca un humano, no Likida):\n${lineas.join('\n')}`;
}

/**
 * El lector: junta el estado del mundo (incidencia con o sin coordenadas,
 * directorio, póliza) y corre el motor. BEST-EFFORT declarado: cualquier
 * fallo de lectura devuelve null y el 🚨 sale sin recomendación — la
 * recomendación jamás puede costar el aviso.
 */
export async function recomendacionCascada(
  tenantId: string,
  incidenciaId: string,
  tipo: TipoAsistencia,
  hoy: string,
): Promise<string | null> {
  try {
    if (tipo === 'robo') return null; // ni siquiera leer: el protocolo manda
    const [inc, proveedores, poliza] = await Promise.all([
      acotada(
        supabaseAdmin().from('incidencia').select('lat, lng').eq('id', incidenciaId).eq('tenant_id', tenantId).limit(1),
        'cascada.incidencia',
      ),
      listarProveedoresEmergencia(tenantId),
      polizaVigenteDe(tenantId),
    ]);
    if (inc.error) throw new Error(inc.error.message);
    const fila = (inc.data ?? [])[0] as { lat: number | null; lng: number | null } | undefined;
    const cascada = armarCascada({
      tipo,
      lat: fila?.lat ?? null,
      lng: fila?.lng ?? null,
      proveedores,
      poliza,
      hoy,
    });
    return textoCascadaParaJefe(cascada);
  } catch (e) {
    logger.warn('cascada.no_disponible', {
      incidencia: incidenciaId,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
