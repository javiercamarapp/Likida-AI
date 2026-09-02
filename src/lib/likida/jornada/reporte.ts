import { TZ_MX } from '@/lib/formato';
import { toCsv } from '../export';
import { componerJornada, fraseDelHueco, aHoras, ROTULO_PROCEDENCIA, type Asiento } from './modelo';
import {
  evaluarRiesgoDia, ROTULO_VEREDICTO, LEYENDA_VEREDICTOS, type PoliticaFlota,
} from './riesgo';
import {
  LEYENDA_NOM_087, LEYENDA_NO_ES_BITACORA_83, CONSERVACION_LFT_804,
} from './topes';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE QUE LA FLOTA ENSEÑA EN UNA INSPECCIÓN.
//
// Cuatro cosas que este archivo hace y que un exportador normal no haría:
//
//   1. LAS LEYENDAS VAN PEGADAS AL ARCHIVO, no en la pantalla desde donde se
//      descargó. Un CSV viaja solo: se manda por correo, se imprime, se abre
//      en la computadora de un abogado tres años después. Lo que el documento
//      NO afirma tiene que viajar con él o deja de estar dicho.
//
//   2. DICE QUE NO ES LA BITÁCORA DEL ART. 83. Este es el registro de jornada
//      de la LFT 132 fr. XXXIV; la bitácora de horas de servicio del
//      Reglamento de Tránsito es otro documento, con diez campos que Likida no
//      tiene. Una flota que enseñara esto en un retén creyendo que cumple con
//      aquello se llevaría la multa igual, y con nuestro archivo en la mano.
//
//   3. LA PROCEDENCIA VIAJA EN SU PROPIA COLUMNA, junto a cada hora. Una hora
//      sin origen no prueba nada; dos horas de orígenes distintos restadas
//      entre sí y presentadas como una cifra prueban menos que nada.
//
//   4. EL DÍA SIN DATO SE ESCRIBE CON PALABRAS, no con un cero ni con una
//      celda vacía. `total_horas` vacío en un renglón que dice «sin registro
//      declarado» es exactamente lo contrario de un cero: es el hueco,
//      declarado.
// ═══════════════════════════════════════════════════════════════════════════

export interface DiaDelReporte {
  dia: string;
  operadorId: string;
  operadorNombre: string;
  numeroEmpleado: string | null;
  estado: 'abierto' | 'cerrado';
  cerradoEn: string | null;
  cerradoPorEmail: string | null;
  conformeOperadorEn: string | null;
  asientos: Asiento[];
}

export interface ReporteJornada {
  tenantNombre: string | null;
  desde: string;
  hasta: string;
  generadoEn: string;
  leyendas: string[];
  filas: FilaReporte[];
}

export interface FilaReporte {
  operador: string;
  numero_empleado: string;
  dia: string;
  inicio: string;
  origen_inicio: string;
  fin: string;
  origen_fin: string;
  minutos_descanso: string;
  total_horas: string;
  tipo_jornada: string;
  veredicto: string;
  observaciones: string;
  estado_del_dia: string;
  cerrado_por: string;
  conformidad_del_operador: string;
}

function horaMx(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/**
 * Arma el reporte. Puro: recibe los días ya leídos y no toca la base — así se
 * puede probar cada frase que el documento afirma sin levantar Postgres.
 */
export function armarReporte(args: {
  tenantNombre: string | null;
  desde: string;
  hasta: string;
  dias: readonly DiaDelReporte[];
  politica: PoliticaFlota | null;
  generadoEn?: Date;
}): ReporteJornada {
  const leyendas = [
    'Registro de jornada — artículo 132 fracción XXXIV de la Ley Federal del Trabajo.',
    LEYENDA_NO_ES_BITACORA_83,
    LEYENDA_NOM_087,
    LEYENDA_VEREDICTOS,
    CONSERVACION_LFT_804,
    'La columna «origen» dice de dónde salió cada hora. Una hora derivada (del GPS o de un hito ' +
    'del viaje) acota la jornada por abajo: sirve para demostrar un exceso, no para descartarlo.',
    'Un día sin marcas aparece como «sin registro declarado» y con el total en blanco. Eso NO ' +
    'significa cero horas trabajadas: significa que nadie las reportó.',
  ];

  if (args.politica) {
    const declarados: string[] = [];
    if (args.politica.horasMaxJornada !== null) declarados.push(`jornada máxima ${args.politica.horasMaxJornada} h`);
    if (args.politica.minutosMinDescanso !== null) declarados.push(`descanso mínimo ${args.politica.minutosMinDescanso} min`);
    if (args.politica.horasMinEntreJornadas !== null) declarados.push(`descanso entre jornadas ${args.politica.horasMinEntreJornadas} h`);
    if (declarados.length > 0) {
      leyendas.push(
        `Umbrales que esta flota declaró para sí misma: ${declarados.join(', ')}.` +
        (args.politica.fundamento ? ` Fundamento declarado por la flota: ${args.politica.fundamento}` : '') +
        ' Likida los transcribe sin validarlos.',
      );
    }
  }

  return {
    tenantNombre: args.tenantNombre,
    desde: args.desde,
    hasta: args.hasta,
    generadoEn: (args.generadoEn ?? new Date()).toISOString(),
    leyendas,
    filas: args.dias.map((d) => filaDeDia(d, args.politica)),
  };
}

function filaDeDia(d: DiaDelReporte, politica: PoliticaFlota | null): FilaReporte {
  const j = componerJornada(d.asientos);
  const riesgo = evaluarRiesgoDia(j, politica);
  const horas = aHoras(j.minutosEfectivos ?? j.minutosBrutos);
  const hueco = fraseDelHueco(j);

  const observaciones = [
    ...(hueco ? [hueco] : []),
    ...riesgo.senales.map((s) => (s.fundamento ? `${s.dice} (${s.fundamento})` : s.dice)),
  ].join(' · ');

  return {
    operador: d.operadorNombre,
    numero_empleado: d.numeroEmpleado ?? 'sin registrar',
    dia: d.dia,
    // Celda VACÍA cuando no hay marca. Un guion o un cero se leen como valor;
    // el vacío, junto a la observación que lo explica, se lee como hueco.
    inicio: j.inicio ? horaMx(j.inicio.momento) : '',
    origen_inicio: j.inicio ? ROTULO_PROCEDENCIA[j.inicio.procedencia] : '',
    fin: j.fin ? horaMx(j.fin.momento) : '',
    origen_fin: j.fin ? ROTULO_PROCEDENCIA[j.fin.procedencia] : '',
    // `null` NO se vuelve 0: «no reportó descanso» y «descansó cero minutos»
    // son dos afirmaciones distintas, y la segunda es una que Likida no puede
    // hacer.
    minutos_descanso: j.minutosDescanso === null ? 'sin descanso reportado' : String(j.minutosDescanso),
    total_horas: horas === null ? '' : String(horas),
    tipo_jornada: riesgo.tipoJornada ?? '',
    veredicto: ROTULO_VEREDICTO[riesgo.veredicto],
    observaciones,
    estado_del_dia: d.estado === 'cerrado' ? 'Cerrado' : 'Abierto',
    cerrado_por: d.cerradoPorEmail ?? '',
    // La conformidad es lo que el tercer párrafo del 132-XXXIV pide para
    // «prueba plena». Su ausencia se dice: no se deja en blanco como si fuera
    // un campo opcional que a nadie le importa.
    conformidad_del_operador: d.conformeOperadorEn
      ? `Sí, el ${d.conformeOperadorEn.slice(0, 10)}`
      : 'Sin conformidad del operador',
  };
}

/** El CSV, con las leyendas como comentarios `#` arriba — mismo formato que la
 *  bitácora de peaje (F5), para que las dos exportaciones se lean igual. */
export function reporteACsv(r: ReporteJornada): string {
  const encabezado = [
    ...r.leyendas.map((l) => `# ${l}`),
    '#',
    `# Flota: ${r.tenantNombre ?? 'sin nombre registrado'} · Periodo: ${r.desde} a ${r.hasta} · Generado: ${r.generadoEn}`,
    '#',
  ].join('\n');

  const tabla = r.filas.length === 0
    ? '# (No hay expedientes de jornada en este periodo. Eso no significa que nadie trabajó: ' +
      'significa que no hay registro, que es justo lo que el artículo 132 fracción XXXIV manda tener.)\n'
    : toCsv(r.filas);

  return `${encabezado}\n${tabla}`;
}
