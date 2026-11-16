import type { CierreDosMeses, CierreMensual, ResumenDecena } from '@/lib/likida/peajes/cierre_mensual';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { mxnEntero } from '@/lib/formato';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trDashboardBEs } from '@/lib/i18n/tr_dashboard_b';

type Tr = TrDe<'dashboard_b'>;

// ═══════════════════════════════════════════════════════════════════════════
// CIFRAS EN PESOS DEL INICIO PARA UNA FLOTA CON PERFIL `cinco_agentes` — MODELO PURO.
//
// Dos cifras, autorizadas para quien ve el área de dinero de una flota con este perfil (dueño y contador; el superadmin
// pasa porque `puedeVerArea` le da `dinero`; el encargado y cualquier otro rol, nunca):
//   (a) el importe del estado de cuenta IAVE de la última decena cargada, con la decena anterior cargada como
//       referencia (siempre rotulada: son PERIODOS DISTINTOS, no una variación del mismo periodo);
//   (b) los cobros extemporáneos de las decenas cargadas del mismo mes (cantidad y monto), siempre «candidatos».
//
// POR QUÉ NO SE REUSAN `peajesDeGasto`, `getKpis` NI `getDineroObservadoPorTipo`: leen las tablas internas de Likida
// (tickets y liquidaciones del flujo nativo). Los datos de esta flota llegan por el reporte IAVE
// (`desglose_peaje_linea`), así que esos lectores devolverían $0 «medido». Aquí todo sale de `cierreMensual`
// (`ResumenDecena`, `tardios`).
//
// REGLAS (cada una tiene su prueba):
//   · Sin dato NUNCA es $0: `valor` y `valorTexto` son `null`. Un archivo que cubre la decena pero no trae cruces
//     dentro de ella tampoco produce un cero: es «Sin dato».
//   · Una decena sin archivo se DECLARA en `decenasFaltantes`; un mes con una sola decena no se presenta como mes
//     (el periodo dice «decenas cargadas», no el nombre del mes solo).
//   · El rótulo de (b) dice «candidatos» y nunca acusa. La definición («fecha anterior al inicio del periodo del
//     archivo») es provisional y se dice.
//
// PURO: sin base, sin red, sin importar nada del servidor (la lectura vive en `cinco-agentes-cifras.ts`).
// ═══════════════════════════════════════════════════════════════════════════

export const PERFIL_CIFRAS_PESOS = 'cinco_agentes';

/**
 * ¿Se pueden CONSULTAR estas cifras? Rol con el área de dinero (dueño, contador; el encargado nunca) Y perfil
 * `cinco_agentes`. Es la puerta de la lectura: sin ella no se toca ningún dato de pesos.
 */
export function puedeVerCifrasPesos(rol: string, perfil: string | null): boolean {
  return puedeVerArea(rol, 'dinero') && perfil === PERFIL_CIFRAS_PESOS;
}

export type SelloCifra = 'Medido' | 'Estimado' | 'Sin dato';

export interface CifraPesos {
  /** Pesos exactos (2 decimales del reporte). `null` = sin dato: jamás 0. */
  valor: number | null;
  /**
   * `valor` con `mxnEntero`. OJO: desde $1 M sale COMPACTO («$3 M», «$3.3 M») y pierde el detalle. La UI de finanzas (contador)
   * debe mostrar pesos completos desde `valor`; este texto es para tarjetas de resumen. `null` = sin dato.
   */
  valorTexto: string | null;
  /** Periodo que cubre la cifra, legible («1 al 10 de octubre de 2026»). `null` = sin dato. */
  periodo: string | null;
  fuente: string;
  sello: SelloCifra;
  /** Decenas ya terminadas del mes de la cifra que no tienen archivo (vacío = ninguna falta). */
  decenasFaltantes: string[];
  /** Decenas MÁS RECIENTES que la cifrada con archivo pero sin cruces dentro de ellas: no se cifran y se declaran. */
  decenasSinCruces: string[];
  /** Texto corto de pie de tarjeta: alcance y salvedades. */
  rotulo: string;
  /** `true` solo si la lectura falló: la pantalla ofrece «Reintentar». */
  reintentar: boolean;
  /** Por qué es «Sin dato». `null` si hay dato. */
  motivo: string | null;
}

export interface ComparacionDecena {
  valor: number;
  valorTexto: string;
  periodo: string;
  /** Siempre dice que son periodos distintos. */
  rotulo: string;
}

export interface CifraImporteDecena extends CifraPesos {
  cruces: number | null;
  anterior: ComparacionDecena | null;
}

export interface CifraExtemporaneos extends CifraPesos {
  /** Candidatos (cruces). `null` = sin dato. */
  n: number | null;
}

export interface CifrasPesosCincoAgentes {
  importeDecena: CifraImporteDecena;
  extemporaneos: CifraExtemporaneos;
}

/** Pasa a `false` cuando el cliente acuerde la definición de «extemporáneo»; mientras tanto la cifra (b) es siempre «Estimado». */
export const DEFINICION_EXTEMPORANEO_PROVISIONAL = true;

const fuenteImporte = (t: Tr) => t('cif.fuente_importe');
const fuenteExtemporaneos = (t: Tr) => t('cif.fuente_extemp');

const CLAVES_MES = ['cif.mes.1', 'cif.mes.2', 'cif.mes.3', 'cif.mes.4', 'cif.mes.5', 'cif.mes.6', 'cif.mes.7', 'cif.mes.8', 'cif.mes.9', 'cif.mes.10', 'cif.mes.11', 'cif.mes.12'] as const;

const soloMes = (mes: string, t: Tr): string => {
  const clave = CLAVES_MES[Number(mes.slice(5, 7)) - 1];
  return clave ? t(clave) : mes;
};

/** «octubre de 2026» a partir de AAAA-MM. */
function nombreMes(mes: string, t: Tr): string {
  return t('cif.mes_anio', { mes: soloMes(mes, t), anio: mes.slice(0, 4) });
}

/** «1 al 10 de octubre de 2026» a partir de dos fechas ISO de una misma decena. */
export function etiquetaPeriodo(desde: string, hasta: string, t: Tr = trDashboardBEs): string {
  return t('cif.periodo', { d1: Number(desde.slice(8, 10)), d2: Number(hasta.slice(8, 10)), mes: soloMes(desde.slice(0, 7), t), anio: desde.slice(0, 4) });
}

const dias = (d: { desde: string; hasta: string }) => Number(d.hasta.slice(8, 10)) - Number(d.desde.slice(8, 10)) + 1;

export function cifraSinDato(fuente: string, motivo: string, reintentar = false, t: Tr = trDashboardBEs): CifraPesos {
  return {
    valor: null, valorTexto: null, periodo: null, fuente, sello: 'Sin dato', decenasFaltantes: [], decenasSinCruces: [],
    rotulo: reintentar ? t('cif.no_leer') : motivo, reintentar, motivo,
  };
}

/** Las dos cifras en «Sin dato» (la lectura falló, o no hay archivo reciente). */
export function cifrasSinDato(motivo: string, reintentar: boolean, t: Tr = trDashboardBEs): CifrasPesosCincoAgentes {
  return {
    importeDecena: { ...cifraSinDato(fuenteImporte(t), motivo, reintentar, t), cruces: null, anterior: null },
    extemporaneos: { ...cifraSinDato(fuenteExtemporaneos(t), motivo, reintentar, t), n: null },
  };
}

interface DecenaDeVentana { d: ResumenDecena; c: CierreMensual }

/** Las seis decenas de la ventana en orden cronológico, cada una con el cierre de su mes. */
function ventana(dos: CierreDosMeses): DecenaDeVentana[] {
  return dos.cierres.flatMap((c) => c.decenas.map((d) => ({ d, c })));
}

/** Una decena sirve para cifrar si tiene archivo Y cruces dentro de ella (un archivo vacío no es $0). */
const usable = (d: ResumenDecena) => d.cubierta && d.cruces > 0;

/** Decenas ya terminadas del mes que no tienen archivo. Las que aún corren no «faltan». */
function faltantesDelMes(c: CierreMensual, hoy: string, t: Tr): string[] {
  return c.decenas.filter((d) => !d.cubierta && d.hasta < hoy).map((d) => t('cif.etiqueta_mes', { etiqueta: d.etiqueta, mes: nombreMes(c.mes, t) }));
}

function decenaMasReciente(dos: CierreDosMeses, hoy: string, t: Tr): { idx: number; lista: DecenaDeVentana[]; sinCruces: string[] } | null {
  const lista = ventana(dos);
  const sinCruces: string[] = [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const { d, c } = lista[i];
    if (d.desde > hoy) continue;
    if (usable(d)) return { idx: i, lista, sinCruces };
    // Con archivo pero sin cruces dentro: no se cifra (no es $0), pero tampoco se salta en silencio.
    if (d.cubierta) sinCruces.push(t('cif.etiqueta_mes', { etiqueta: d.etiqueta, mes: nombreMes(c.mes, t) }));
  }
  return null;
}

const avisoSinCruces = (l: string[], t: Tr) => (l.length > 0 ? t('cif.sin_cruces_aviso', { lista: l.join(', ') }) : null);

const motivoSinArchivo = (t: Tr) => t('cif.sin_archivo');

/** (a) El importe de la decena más reciente con archivo, con la anterior cargada como referencia. */
export function cifraImporteDecena(dos: CierreDosMeses, hoy: string, t: Tr = trDashboardBEs): CifraImporteDecena {
  const hallada = decenaMasReciente(dos, hoy, t);
  if (!hallada) return { ...cifraSinDato(fuenteImporte(t), motivoSinArchivo(t), false, t), cruces: null, anterior: null };
  const { idx, lista, sinCruces } = hallada;
  const { d, c } = lista[idx];
  const periodo = etiquetaPeriodo(d.desde, d.hasta, t);

  let anterior: ComparacionDecena | null = null;
  let ant: DecenaDeVentana | null = null;
  let adyacente = false;
  for (let i = idx - 1; i >= 0; i--) {
    if (usable(lista[i].d)) { ant = lista[i]; adyacente = i === idx - 1; break; }
  }
  if (ant) {
    const periodoAnt = etiquetaPeriodo(ant.d.desde, ant.d.hasta, t);
    anterior = {
      valor: ant.d.monto, valorTexto: mxnEntero(ant.d.monto), periodo: periodoAnt,
      rotulo: t('cif.ant_rotulo', { periodo, dias: dias(d), anterior: periodoAnt, diasAnt: dias(ant.d), nota: adyacente ? '' : t('cif.ant_hueco') }),
    };
  }

  const faltantes = faltantesDelMes(c, hoy, t);
  const enCurso = d.hasta >= hoy;
  const salvedades: string[] = [];
  if (enCurso) salvedades.push(t('cif.s.en_curso'));
  if (c.dobleConteo.n > 0) salvedades.push(t('cif.s.doble', { n: c.dobleConteo.n }));
  if (c.archivosSinPeriodo.length > 0) salvedades.push(t('cif.s.sin_periodo', { n: c.archivosSinPeriodo.length }));
  if (sinCruces.length > 0) salvedades.push(t('cif.s.sin_cruces', { lista: sinCruces.join(', ') }));
  const sello: SelloCifra = salvedades.length === 0 ? 'Medido' : 'Estimado';
  const partes = [t('cif.imp.intro', { periodo })];
  if (faltantes.length > 0) partes.push(t('cif.faltan', { lista: faltantes.join(', ') }));
  const av = avisoSinCruces(sinCruces, t);
  if (av) partes.push(av);
  if (salvedades.length > 0) partes.push(t('cif.estimado', { lista: salvedades.join('; ') }));
  return {
    valor: d.monto, valorTexto: mxnEntero(d.monto), periodo, fuente: fuenteImporte(t), sello,
    decenasFaltantes: faltantes, decenasSinCruces: sinCruces, rotulo: partes.join(' '), reintentar: false, motivo: null,
    cruces: d.cruces, anterior,
  };
}

/**
 * (b) Los cobros extemporáneos de las decenas cargadas del MISMO MES que la cifra (a). Candidatos para validar con el
 * proveedor; la definición (fecha del cruce anterior al inicio del periodo de su archivo) es provisional.
 */
export function cifraExtemporaneos(dos: CierreDosMeses, hoy: string, t: Tr = trDashboardBEs): CifraExtemporaneos {
  const hallada = decenaMasReciente(dos, hoy, t);
  if (!hallada) return { ...cifraSinDato(fuenteExtemporaneos(t), motivoSinArchivo(t), false, t), n: null };
  const c = hallada.lista[hallada.idx].c;
  const sinCruces = hallada.sinCruces;
  const cargadas = c.decenas.filter((d) => d.cubierta);
  // Un mes con menos de sus tres decenas NO se presenta como mes: se dicen las decenas cargadas.
  const periodo = cargadas.length === c.decenas.length
    ? nombreMes(c.mes, t)
    : t('cif.ext.periodo_parcial', { mes: nombreMes(c.mes, t), lista: cargadas.map((d) => d.etiqueta).join(', ') });
  const faltantes = faltantesDelMes(c, hoy, t);
  const n = c.tardiosMesAnterior.n + c.tardiosDecenaAnterior.n;
  const monto = Math.round((c.tardiosMesAnterior.monto + c.tardiosDecenaAnterior.monto) * 100) / 100;

  // La definición de «extemporáneo» está pendiente de acordar con el cliente: mientras sea provisional, NUNCA «Medido».
  const salvedades: string[] = [DEFINICION_EXTEMPORANEO_PROVISIONAL ? t('cif.ext.s.prov') : ''].filter(Boolean);
  if (sinCruces.length > 0) salvedades.push(t('cif.s.sin_cruces', { lista: sinCruces.join(', ') }));
  if (faltantes.length > 0) salvedades.push(t('cif.ext.s.faltan'));
  if (c.archivosSinPeriodo.length > 0) salvedades.push(t('cif.ext.s.sin_periodo', { n: c.archivosSinPeriodo.length }));
  if (c.dobleConteo.n > 0) salvedades.push(t('cif.ext.s.doble', { n: c.dobleConteo.n }));
  const sello: SelloCifra = salvedades.length === 0 ? 'Medido' : 'Estimado';
  const partes = [t(n === 1 ? 'cif.ext.intro.uno' : 'cif.ext.intro.otros', { n, periodo })];
  if (faltantes.length > 0) partes.push(t('cif.faltan', { lista: faltantes.join(', ') }));
  if (salvedades.length > 0) partes.push(t('cif.estimado', { lista: salvedades.join('; ') }));
  return {
    valor: monto, valorTexto: mxnEntero(monto), periodo, fuente: fuenteExtemporaneos(t), sello,
    decenasFaltantes: faltantes, decenasSinCruces: sinCruces, rotulo: partes.join(' '), reintentar: false, motivo: null, n,
  };
}

/** Las dos cifras a partir del cierre de dos meses ya leído. */
export function cifrasDeCierre(dos: CierreDosMeses, hoy: string, t: Tr = trDashboardBEs): CifrasPesosCincoAgentes {
  return { importeDecena: cifraImporteDecena(dos, hoy, t), extemporaneos: cifraExtemporaneos(dos, hoy, t) };
}
