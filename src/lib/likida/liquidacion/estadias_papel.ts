import { mxn } from '@/lib/formato';
import { horaExactaMx, type FilaEstadia } from '../conductor/estadias_anden';
import type { ResultadoEstadiasPeriodo } from '../conductor/estadias_lectura';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESTADÍAS EN ANDÉN EN EL PAPEL DE LA LIQUIDACIÓN — puro (sin PDF, sin base).
//
// La liquidación cuadra lo que el operador GASTÓ contra su anticipo. Las estadías son otra cosa: tiempo que la
// unidad pasó en el andén de un cliente, con la hora exacta del mensaje del chofer (o la declarada por la oficina),
// y es dinero que la FLOTA puede cobrarle al CLIENTE. Aquí se imprimen como un anexo informativo del ejemplar del
// contralor, con tres reglas que este archivo hace cumplir y su prueba comprueba:
//
//   1. NO ENTRAN A NINGÚN TOTAL. Ni el comprobado, ni el anticipo, ni la diferencia, ni las cubetas de
//      deducibilidad: el anexo lo dice con todas sus letras. Y no mueven `insumos_hash`: no son un insumo del cuadre.
//   2. SOLO EL EJEMPLAR DEL CONTRALOR. El operador no ve dinero de cobro a un tercero ni «paradas con minutos» que
//      leería como una auditoría de su tiempo.
//   3. LO QUE NO SE PUDO MEDIR NO SE INVENTA. Una parada sin salida registrada al emitir (incluida la que «sigue en
//      curso»: el papel es una foto, no un reloj que corre) imprime «sin salida registrada» y sin minutos ni monto; una
//      incoherente o sin llegada, igual. El monto es una PROPUESTA con el pacto aplicado a la vista, y solo de paradas
//      cerradas: sin horas libres pactadas, sin tarifa o dentro de lo libre, dice por qué no hay monto.
// ═══════════════════════════════════════════════════════════════════════════

export interface RenglonEstadiaPapel {
  parada: 'Carga' | 'Descarga';
  sitio: string | null;
  /** «2026-10-02 09:14:05», hora de México, o «—». */
  llegada: string;
  salida: string;
  /** «1 h 25 min», o el motivo por el que no se mide. */
  duracion: string;
  /** De dónde salieron las horas y con qué se sostienen: «mensaje del chofer · ubicación validada · 2 fotos». */
  respaldo: string;
  /** «Propuesta: 2 h cobrables = $1,200.00 MXN» o el porqué de que no la haya. */
  cobro: string;
}

export interface EstadiasParaPapel {
  renglones: RenglonEstadiaPapel[];
  /** Notas al pie del anexo (supuestos y límites), ya redactadas. */
  notas: string[];
  /** La lectura del periodo se truncó: hay más viajes de los que se leyeron (no aplica a un solo viaje, pero se declara). */
  truncada: boolean;
}

const FUENTE = { chofer: 'mensaje del chofer', oficina: 'captura de oficina', sistema: 'sistema' } as const;
const VALIDACION = { validado: 'ubicación validada', sin_coincidencia: 'ubicación sin coincidencia', sin_dato: 'sin dato de ubicación' } as const;
const MOTIVO: Record<string, string> = {
  sin_minutos: 'sin minutos medibles',
  sin_horas_libres_pactadas: 'sin horas libres pactadas (no hay umbral que exceder)',
  dentro_de_horas_libres: 'dentro de las horas libres pactadas: no hay cobro',
  sin_tarifa_pactada: 'sin tarifa de detención pactada',
};

export function duracionTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** El formato de cifras vive solo en `lib/formato.ts` (CLAUDE.md): aquí solo se compone la frase. */
function dinero(monto: number, moneda: string): string {
  // Los pesos llevan su símbolo; otra moneda lleva la misma cifra con su código (nunca un «$» que se lea como pesos).
  return moneda === 'MXN' ? mxn(monto) : `${mxn(monto).replace('$', '').trim()} ${moneda}`;
}

function renglon(f: FilaEstadia): RenglonEstadiaPapel {
  const { estancia: e, detencion: d } = f;
  const llegada = e.llegada ? horaExactaMx(e.llegada.en) || '—' : '—';
  const salida = e.salida ? horaExactaMx(e.salida.en) || '—' : '—';

  let duracion: string;
  let cobro: string;
  if (e.fase === 'cerrada' && e.minutos !== null) {
    duracion = duracionTexto(e.minutos);
    if (d.monto !== null && d.moneda && d.horasCobrables !== null) {
      cobro = `Propuesta: ${d.horasCobrables} h cobrables = ${dinero(d.monto, d.moneda)}`;
    } else {
      cobro = d.motivoSinMonto ? `Sin monto: ${MOTIVO[d.motivoSinMonto] ?? d.motivoSinMonto}` : 'Sin monto';
    }
  } else {
    // El papel es una FOTO al emitirse: una parada que «sigue en curso» no es cobrable ni tiene duración medida.
    duracion = e.fase === 'incoherente' ? 'horas incoherentes: revisar' : e.fase === 'sin_llegada' ? 'sin llegada registrada' : 'sin salida registrada';
    cobro = 'Sin monto: la duración no se pudo medir';
  }

  const respaldo: string[] = [];
  if (e.llegada) respaldo.push(`llegada: ${FUENTE[e.llegada.fuente]}`);
  if (e.salida) respaldo.push(`salida: ${FUENTE[e.salida.fuente]}`);
  if (e.llegada) respaldo.push(e.llegada.validacion ? VALIDACION[e.llegada.validacion] : 'sin veredicto de ubicación');
  const fotos = (e.llegada?.evidencias ?? 0) + (e.salida?.evidencias ?? 0);
  respaldo.push(fotos === 0 ? 'sin fotos' : `${fotos} ${fotos === 1 ? 'foto' : 'fotos'}`);

  return { parada: e.lugar === 'carga' ? 'Carga' : 'Descarga', sitio: f.sitio, llegada, salida, duracion, respaldo: respaldo.join(' · '), cobro };
}

/**
 * Lo que se imprime. `null` = no hay anexo (no hay paradas con hitos, o no se pudo leer): una sección vacía en un papel
 * que se archiva se leería como «medido: cero estadía», y eso no es verdad.
 */
export function estadiasParaPapel(r: ResultadoEstadiasPeriodo | null): EstadiasParaPapel | null {
  if (!r || r.filas.length === 0) return null;
  // Carga primero, luego descarga (el orden del viaje), no «más reciente primero» como el panel.
  const filas = [...r.filas].sort((a, b) => (a.estancia.lugar === b.estancia.lugar ? 0 : a.estancia.lugar === 'carga' ? -1 : 1));
  const hayPropuesta = filas.some((f) => f.estancia.fase === 'cerrada' && f.detencion.monto !== null);
  const notas = [
    'Anexo informativo: NO suma a ningún total de esta liquidación (ni comprobado, ni anticipo, ni diferencia) y no es un gasto del operador.',
    'La hora de cada llegada y salida es la del MENSAJE del chofer (o la que declaró la oficina), no telemetría del evento físico.',
  ];
  if (hayPropuesta) {
    notas.push('Los montos son una PROPUESTA con el pacto de detención vigente (el del cliente, o el de la flota si no hay); las horas libres se aplican por parada. El contralor decide y factura.');
  }
  return { renglones: filas.map(renglon), notas, truncada: r.truncada };
}
