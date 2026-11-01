import type { CierreDosMeses, CierreMensual, ResumenDecena } from '@/lib/likida/peajes/cierre_mensual';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { mxnEntero } from '@/lib/formato';

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

const FUENTE_IMPORTE = 'Reporte IAVE · cruces con fecha dentro de la decena (sin cobros tardíos)';
const FUENTE_EXTEMPORANEOS = 'Reporte IAVE · cruces con fecha anterior al inicio del periodo de su archivo';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «octubre de 2026» a partir de AAAA-MM. */
function nombreMes(mes: string): string {
  const m = Number(mes.slice(5, 7));
  return `${MESES[m - 1] ?? mes} de ${mes.slice(0, 4)}`;
}

/** «1 al 10 de octubre de 2026» a partir de dos fechas ISO de una misma decena. */
export function etiquetaPeriodo(desde: string, hasta: string): string {
  return `${Number(desde.slice(8, 10))} al ${Number(hasta.slice(8, 10))} de ${nombreMes(desde.slice(0, 7))}`;
}

const dias = (d: { desde: string; hasta: string }) => Number(d.hasta.slice(8, 10)) - Number(d.desde.slice(8, 10)) + 1;

export function cifraSinDato(fuente: string, motivo: string, reintentar = false): CifraPesos {
  return {
    valor: null, valorTexto: null, periodo: null, fuente, sello: 'Sin dato', decenasFaltantes: [], decenasSinCruces: [],
    rotulo: reintentar ? 'No se pudo leer. Reintenta en un momento.' : motivo, reintentar, motivo,
  };
}

/** Las dos cifras en «Sin dato» (la lectura falló, o no hay archivo reciente). */
export function cifrasSinDato(motivo: string, reintentar: boolean): CifrasPesosCincoAgentes {
  return {
    importeDecena: { ...cifraSinDato(FUENTE_IMPORTE, motivo, reintentar), cruces: null, anterior: null },
    extemporaneos: { ...cifraSinDato(FUENTE_EXTEMPORANEOS, motivo, reintentar), n: null },
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
function faltantesDelMes(c: CierreMensual, hoy: string): string[] {
  return c.decenas.filter((d) => !d.cubierta && d.hasta < hoy).map((d) => `${d.etiqueta} de ${nombreMes(c.mes)}`);
}

function decenaMasReciente(dos: CierreDosMeses, hoy: string): { idx: number; lista: DecenaDeVentana[]; sinCruces: string[] } | null {
  const lista = ventana(dos);
  const sinCruces: string[] = [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const { d, c } = lista[i];
    if (d.desde > hoy) continue;
    if (usable(d)) return { idx: i, lista, sinCruces };
    // Con archivo pero sin cruces dentro: no se cifra (no es $0), pero tampoco se salta en silencio.
    if (d.cubierta) sinCruces.push(`${d.etiqueta} de ${nombreMes(c.mes)}`);
  }
  return null;
}

const avisoSinCruces = (l: string[]) => (l.length > 0 ? `Tiene archivo pero sin cruces dentro, no se cifra: ${l.join(', ')}.` : null);

const MOTIVO_SIN_ARCHIVO = 'No hay estado de cuenta IAVE cargado en los últimos dos meses.';

/** (a) El importe de la decena más reciente con archivo, con la anterior cargada como referencia. */
export function cifraImporteDecena(dos: CierreDosMeses, hoy: string): CifraImporteDecena {
  const hallada = decenaMasReciente(dos, hoy);
  if (!hallada) return { ...cifraSinDato(FUENTE_IMPORTE, MOTIVO_SIN_ARCHIVO), cruces: null, anterior: null };
  const { idx, lista, sinCruces } = hallada;
  const { d, c } = lista[idx];
  const periodo = etiquetaPeriodo(d.desde, d.hasta);

  let anterior: ComparacionDecena | null = null;
  let ant: DecenaDeVentana | null = null;
  let adyacente = false;
  for (let i = idx - 1; i >= 0; i--) {
    if (usable(lista[i].d)) { ant = lista[i]; adyacente = i === idx - 1; break; }
  }
  if (ant) {
    const periodoAnt = etiquetaPeriodo(ant.d.desde, ant.d.hasta);
    anterior = {
      valor: ant.d.monto, valorTexto: mxnEntero(ant.d.monto), periodo: periodoAnt,
      rotulo: `Periodos distintos: ${periodo} (${dias(d)} días) contra ${periodoAnt} (${dias(ant.d)} días)`
        + `${adyacente ? '' : '; hay decenas intermedias sin archivo'}. No es el mismo periodo.`,
    };
  }

  const faltantes = faltantesDelMes(c, hoy);
  const enCurso = d.hasta >= hoy;
  const salvedades: string[] = [];
  if (enCurso) salvedades.push('la decena aún no termina: el importe puede crecer');
  if (c.dobleConteo.n > 0) salvedades.push(`${c.dobleConteo.n} cobro(s) están en más de un archivo y pueden estar sumados dos veces`);
  if (c.archivosSinPeriodo.length > 0) salvedades.push(`${c.archivosSinPeriodo.length} archivo(s) sin periodo no entran a la cifra`);
  if (sinCruces.length > 0) salvedades.push(`hay una decena más reciente sin cruces (${sinCruces.join(', ')})`);
  const sello: SelloCifra = salvedades.length === 0 ? 'Medido' : 'Estimado';
  const partes = [`Importe del reporte IAVE del ${periodo}.`];
  if (faltantes.length > 0) partes.push(`Faltan por cargar: ${faltantes.join(', ')}.`);
  const av = avisoSinCruces(sinCruces);
  if (av) partes.push(av);
  if (salvedades.length > 0) partes.push(`Estimado: ${salvedades.join('; ')}.`);
  return {
    valor: d.monto, valorTexto: mxnEntero(d.monto), periodo, fuente: FUENTE_IMPORTE, sello,
    decenasFaltantes: faltantes, decenasSinCruces: sinCruces, rotulo: partes.join(' '), reintentar: false, motivo: null,
    cruces: d.cruces, anterior,
  };
}

/**
 * (b) Los cobros extemporáneos de las decenas cargadas del MISMO MES que la cifra (a). Candidatos para validar con el
 * proveedor; la definición (fecha del cruce anterior al inicio del periodo de su archivo) es provisional.
 */
export function cifraExtemporaneos(dos: CierreDosMeses, hoy: string): CifraExtemporaneos {
  const hallada = decenaMasReciente(dos, hoy);
  if (!hallada) return { ...cifraSinDato(FUENTE_EXTEMPORANEOS, MOTIVO_SIN_ARCHIVO), n: null };
  const c = hallada.lista[hallada.idx].c;
  const sinCruces = hallada.sinCruces;
  const cargadas = c.decenas.filter((d) => d.cubierta);
  // Un mes con menos de sus tres decenas NO se presenta como mes: se dicen las decenas cargadas.
  const periodo = cargadas.length === c.decenas.length
    ? nombreMes(c.mes)
    : `decenas cargadas de ${nombreMes(c.mes)}: ${cargadas.map((d) => d.etiqueta).join(', ')}`;
  const faltantes = faltantesDelMes(c, hoy);
  const n = c.tardiosMesAnterior.n + c.tardiosDecenaAnterior.n;
  const monto = Math.round((c.tardiosMesAnterior.monto + c.tardiosDecenaAnterior.monto) * 100) / 100;

  // La definición de «extemporáneo» está pendiente de acordar con el cliente: mientras sea provisional, NUNCA «Medido».
  const salvedades: string[] = [DEFINICION_EXTEMPORANEO_PROVISIONAL ? 'la definición de extemporáneo es provisional' : ''].filter(Boolean);
  if (sinCruces.length > 0) salvedades.push(`hay una decena más reciente sin cruces (${sinCruces.join(', ')})`);
  if (faltantes.length > 0) salvedades.push('faltan decenas, la cifra es parcial');
  if (c.archivosSinPeriodo.length > 0) salvedades.push(`${c.archivosSinPeriodo.length} archivo(s) sin periodo no se revisaron`);
  if (c.dobleConteo.n > 0) salvedades.push(`${c.dobleConteo.n} cobro(s) en más de un archivo`);
  const sello: SelloCifra = salvedades.length === 0 ? 'Medido' : 'Estimado';
  const partes = [`${n} ${n === 1 ? 'candidato' : 'candidatos'} a validar con el proveedor (${periodo}). Definición provisional.`];
  if (faltantes.length > 0) partes.push(`Faltan por cargar: ${faltantes.join(', ')}.`);
  if (salvedades.length > 0) partes.push(`Estimado: ${salvedades.join('; ')}.`);
  return {
    valor: monto, valorTexto: mxnEntero(monto), periodo, fuente: FUENTE_EXTEMPORANEOS, sello,
    decenasFaltantes: faltantes, decenasSinCruces: sinCruces, rotulo: partes.join(' '), reintentar: false, motivo: null, n,
  };
}

/** Las dos cifras a partir del cierre de dos meses ya leído. */
export function cifrasDeCierre(dos: CierreDosMeses, hoy: string): CifrasPesosCincoAgentes {
  return { importeDecena: cifraImporteDecena(dos, hoy), extemporaneos: cifraExtemporaneos(dos, hoy) };
}
