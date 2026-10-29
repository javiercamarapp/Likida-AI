// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES CREÍBLES · logística de carga en México. 100 % sintéticos y deterministas (misma semilla ⇒ mismas cifras),
// para que las capturas y el detector midan una pantalla que SE PARECE a la operación real y no a una caricatura.
//
//  · rutas entre ciudades mexicanas con kilometraje y casetas plausibles;
//  · operadores inventados con nombre y dos apellidos (no corresponden a nadie);
//  · folios ÚNICOS por serie (V-4101…), unidades económicas distintas, patios con nombre;
//  · montos plausibles (anticipo ≈ 0.55–0.9 del costo de la ruta; diferencias de signo mixto y cuadres exactos en 0);
//  · NULOS reales: viajes sin operador asignado, sin ruta capturada, sin fecha; cuando falta un dato se queda como null
//    (la UI lo pinta «—»), jamás como 0.
// Repo público: nada de personas, empresas ni datos reales de ningún cliente. Los dominios son `.test` (reservado).
// ═══════════════════════════════════════════════════════════════════════════

/** PRNG determinista (mulberry32). */
export function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Ruta { origen: string; destino: string; km: number; casetas: number }
/** Casetas en MXN para un tractocamión de 5 ejes, redondeadas; km por carretera. Plausibles, no tarifas oficiales. */
export const RUTAS: Ruta[] = [
  { origen: 'Monterrey', destino: 'Nuevo Laredo', km: 225, casetas: 1180 },
  { origen: 'Monterrey', destino: 'Saltillo', km: 85, casetas: 310 },
  { origen: 'Saltillo', destino: 'Torreón', km: 260, casetas: 940 },
  { origen: 'Querétaro', destino: 'Ciudad de México', km: 215, casetas: 1320 },
  { origen: 'Guadalajara', destino: 'Manzanillo', km: 340, casetas: 1560 },
  { origen: 'Guadalajara', destino: 'León', km: 190, casetas: 880 },
  { origen: 'León', destino: 'Querétaro', km: 175, casetas: 760 },
  { origen: 'Puebla', destino: 'Veracruz', km: 290, casetas: 1410 },
  { origen: 'Ciudad de México', destino: 'Puebla', km: 130, casetas: 640 },
  { origen: 'San Luis Potosí', destino: 'Tampico', km: 410, casetas: 1790 },
  { origen: 'Aguascalientes', destino: 'San Luis Potosí', km: 195, casetas: 720 },
  { origen: 'Chihuahua', destino: 'Ciudad Juárez', km: 375, casetas: 1250 },
  { origen: 'Hermosillo', destino: 'Nogales', km: 280, casetas: 990 },
  { origen: 'Mérida', destino: 'Cancún', km: 320, casetas: 1120 },
  { origen: 'Lázaro Cárdenas', destino: 'Toluca', km: 640, casetas: 2740 },
  { origen: 'Irapuato', destino: 'Guadalajara', km: 215, casetas: 930 },
];

/** Nombres inventados (nombre + 2 apellidos). Ninguno es una persona real conocida. */
export const OPERADORES: string[] = [
  'Marisol Treviño Ibarra', 'Gerardo Pineda Lozano', 'Ernesto Villaseñor Cuéllar', 'Araceli Domínguez Soto',
  'Rogelio Santacruz Meléndez', 'Leticia Barragán Olvera', 'Hugo Zambrano Quiroz', 'Itzel Montaño Rivas',
  'Baltazar Echeverría Núñez', 'Yolanda Cabrales Peña', 'Ramiro Ledesma Acosta', 'Concepción Arriaga Ponce',
  'Isidro Valdivia Cantú', 'Nayeli Ocampo Guerra', 'Fidel Maldonado Ruelas', 'Dulce Carrillo Esparza',
];
export const PATIOS = ['Patio Monterrey', 'Patio Querétaro', 'Patio Guadalajara', 'Patio Veracruz'];
export const UNIDADES = ['TR-104', 'TR-107', 'TR-112', 'TR-118', 'TR-121', 'TR-125', 'TR-133', 'TR-140', 'TR-146', 'TR-152', 'TR-158', 'TR-163'];

export type Estatus = 'abierto' | 'en_cuadre' | 'liquidado';
export interface ViajeFx {
  id: string; folio: string; origen: string | null; destino: string | null; estatus: Estatus; anticipo: number;
  operadorNombre: string | null; fechaInicio: string | null; liqId: string | null; km: number | null; unidad: string;
}

const MESES_ISO = '2026-10';
const iso = (dia: number, hora: number, min = 0) => `${MESES_ISO}-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
const redondea = (n: number, paso = 10) => Math.round(n / paso) * paso;

/** n viajes con folios únicos 4101… (descendentes en el tiempo). Los últimos traen nulos reales. */
export function viajes(n = 14, semilla = 7): ViajeFx[] {
  const r = azar(semilla);
  const out: ViajeFx[] = [];
  for (let i = 0; i < n; i++) {
    const ruta = RUTAS[(i * 5 + 3) % RUTAS.length];
    const estatus: Estatus = i % 4 === 0 ? 'abierto' : i % 4 === 1 ? 'en_cuadre' : 'liquidado';
    const costo = ruta.casetas + ruta.km * (10.5 + r() * 2.5) + 1800 + r() * 900;
    out.push({
      id: `v${4100 + n - i}`,
      folio: `V-${4100 + n - i}`,
      origen: ruta.origen, destino: ruta.destino, estatus,
      anticipo: redondea(costo * (0.55 + r() * 0.35), 50),
      operadorNombre: OPERADORES[(i * 3 + 1) % OPERADORES.length],
      fechaInicio: iso(27 - Math.floor(i * 0.9), 6 + (i % 5) * 2),
      liqId: estatus === 'liquidado' ? `l${4100 + n - i}` : null,
      km: ruta.km, unidad: UNIDADES[(i * 7 + 2) % UNIDADES.length],
    });
  }
  // Nulos reales: un viaje recién abierto sin operador, otro sin destino capturado, otro sin fecha de inicio.
  if (n > 2) { out[0].operadorNombre = null; out[0].estatus = 'abierto'; out[0].liqId = null; }
  if (n > 5) { out[5].destino = null; }
  if (n > 8) { out[8].fechaInicio = null; }
  return out;
}

export interface LiqFx { id: string; folio: string; creadoEn: string; comprobado: number; diferencia: number; estatus: 'cuadrada' | 'con_diferencias' | 'revisar' }
/** Liquidaciones recientes: cuadres exactos (diferencia 0 con comprobante), diferencias de signo mixto, una por revisar. */
export function liquidaciones(n = 8, semilla = 11): LiqFx[] {
  const r = azar(semilla);
  const v = viajes(n + 2, semilla);
  return Array.from({ length: n }, (_, i) => {
    const base = v[i + 1];
    const tipo = i % 4;
    const comprobado = redondea(base.anticipo * (0.92 + r() * 0.16), 5) + (tipo === 1 ? 0.5 : 0);
    const diferencia = tipo === 0 || tipo === 3 ? 0 : redondea((r() - 0.45) * 1900, 10);
    return {
      id: `l${base.id.slice(1)}`, folio: base.folio, creadoEn: iso(27 - Math.floor(i / 2), 18 - (i % 2) * 6, 10 + i),
      comprobado, diferencia, estatus: diferencia === 0 ? 'cuadrada' : i % 4 === 2 ? 'revisar' : 'con_diferencias',
    };
  });
}

export interface FilaColaFx {
  id: string; viajeId: string; folio: string; creadoEn: string; comprobado: number; anticipo: number; diferencia: number;
  estatus: 'con_diferencias' | 'revisar'; revision: 'pendiente'; operadorNombre: string | null; unidadEco: string; terminalNombre: string;
}
/** Cola de revisión: ≥ 10 filas, folios únicos, un operador sin nombre capturado. */
export function colaRevision(n = 12, semilla = 13): FilaColaFx[] {
  const r = azar(semilla);
  const v = viajes(n + 4, semilla);
  return Array.from({ length: n }, (_, i) => {
    const b = v[i + 2];
    const anticipo = b.anticipo;
    const dif = redondea((r() - 0.4) * 2400, 10) || 130;
    return {
      id: `c${i + 1}`, viajeId: b.id, folio: b.folio, creadoEn: iso(27 - Math.floor(i / 2), 17 - (i % 3) * 3, 5 + i * 3),
      comprobado: anticipo + dif, anticipo, diferencia: dif, estatus: i % 3 === 2 ? 'revisar' : 'con_diferencias', revision: 'pendiente',
      operadorNombre: i === 6 ? null : b.operadorNombre, unidadEco: b.unidad, terminalNombre: PATIOS[i % PATIOS.length],
    };
  });
}

/** Serie diaria de cierres (84 días): más actividad entre semana, domingos en 0 reales. */
export function cierresPorDia(dias = 84, semilla = 17): Array<{ fecha: string; valor: number }> {
  const r = azar(semilla);
  return Array.from({ length: dias }, (_, i) => {
    const f = new Date(Date.UTC(2026, 6, 6 + i)); // arranca un lunes
    const dow = f.getUTCDay();
    const base = dow === 0 ? 0 : dow === 6 ? 1 : 3 + Math.floor(r() * 4);
    return { fecha: f.toISOString().slice(0, 10), valor: base + (i > 56 ? Math.floor(r() * 2) : 0) };
  });
}

/** Diferencia acumulada por operador (barras): solo los operadores con diferencia, de mayor a menor. */
export function diferenciasPorOperador(): Array<{ etiqueta: string; valor: number }> {
  return [
    { etiqueta: OPERADORES[2], valor: 6840 }, { etiqueta: OPERADORES[7], valor: 4310 }, { etiqueta: OPERADORES[11], valor: 2975 },
    { etiqueta: OPERADORES[4], valor: 1620 }, { etiqueta: OPERADORES[9], valor: 880 },
  ];
}

export const KPIS_LIQUIDACION = { viajesLiquidados: 128, montoComprobado: 4_825_340.5, diferenciaDetectada: 18_420, conDiferencias: 7, porRevisar: 3, tasaCuadre: 94 };

/** Insight de muestra con texto creíble (sin la palabra «sintético»: el aviso es UNO por página, no por tarjeta). */
export function textoInsight(agente: string): { quePaso: string; queSignifica: string; queHacer: string; tabla: string; periodo: string; n: number } {
  const t: Record<string, ReturnType<typeof textoInsight>> = {
    liquidacion: { quePaso: 'Tres liquidaciones de la semana cerraron con diferencia contra el anticipo.', queSignifica: 'La diferencia viene de casetas sin comprobante en Monterrey–Nuevo Laredo.', queHacer: 'Pedir los tres comprobantes faltantes antes del cierre del viernes.', tabla: 'liquidacion', periodo: 'semana del 19 al 25 de oct de 2026', n: 3 },
    peajes: { quePaso: 'Dos cargos de caseta no tienen viaje contraparte en el corte quincenal.', queSignifica: 'Pueden ser cobros duplicados o un viaje sin abrir en el sistema.', queHacer: 'Revisar los dos cargos y reclamar al proveedor si no hay viaje.', tabla: 'peaje_linea', periodo: '1.ª quincena de oct de 2026', n: 2 },
  };
  return t[agente] ?? t.liquidacion;
}

/** Desglose de peajes del proveedor (fixture del hub de A2). */
export const DESGLOSE_PEAJES = {
  desgloseId: 'd-1042', proveedor: 'Peajes Integrados del Norte', archivoNombre: 'corte-peajes-1a-quincena-oct-2026.csv',
  periodoDesde: '2026-10-01', periodoHasta: '2026-10-15', creadoEn: '2026-10-16T14:20:00Z', total: 48, cuadra: 40, noCuadra: 3, sinContraparte: 5, pctCuadra: 83,
};

/** Usuario con sesión en los chromes de captura. */
export const USUARIO = { nombre: 'Ximena Salgado Robles', saludo: 'Ximena' };
