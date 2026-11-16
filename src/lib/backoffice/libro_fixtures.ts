import { folioDe, hashDe, HASH_CERO, textoCanonico, type AsientoLibro, type LineaAsiento, type SoporteAsiento } from './libro';

// Apoyo de PRUEBAS (no lo importa código de producción): arma un libro con la cadena de hash bien encadenada, igual que lo hace la base.

export interface EspecAsiento {
  fecha: string;
  descripcion?: string;
  lineas: LineaAsiento[];
  soporte?: SoporteAsiento;
  origenTipo?: string;
  reversaDe?: string | null;
  motivoReversa?: string | null;
  claveIdem?: string;
}

/** Líneas de un cobro de suscripción: banco contra ingresos. */
export const cobro = (cent: number): LineaAsiento[] => [
  { cuenta: '1110', debeCent: cent, haberCent: 0 },
  { cuenta: '4100', debeCent: 0, haberCent: cent },
];

/** Líneas de un gasto de nube: costo contra banco. */
export const gastoNube = (cent: number): LineaAsiento[] => [
  { cuenta: '5100', debeCent: cent, haberCent: 0 },
  { cuenta: '1110', debeCent: 0, haberCent: cent },
];

export function armarLibro(specs: readonly EspecAsiento[]): AsientoLibro[] {
  const salida: AsientoLibro[] = [];
  let anterior = HASH_CERO;
  specs.forEach((e, i) => {
    const seq = i + 1;
    const folio = folioDe(seq);
    const claveIdem = e.claveIdem ?? `prueba-clave-${seq}`;
    const origenTipo = e.origenTipo ?? 'manual';
    const reversaDe = e.reversaDe ?? null;
    const hash = hashDe(anterior, textoCanonico({ folio, claveIdem, fechaNeg: e.fecha, origenTipo, reversaDe, lineas: e.lineas }));
    salida.push({
      id: `id-${seq}`, seq, folio, claveIdem, fechaNeg: e.fecha, periodo: `${e.fecha.slice(0, 7)}-01`, descripcion: e.descripcion ?? `Asiento ${seq}`,
      origenTipo, origenId: null, soporte: e.soporte ?? 'ninguno', soporteRef: null, reversaDe, motivoReversa: e.motivoReversa ?? (reversaDe ? 'motivo de prueba' : null),
      esManual: origenTipo === 'manual', hashAnterior: anterior, hash, lineas: e.lineas,
    });
    anterior = hash;
  });
  return salida;
}
