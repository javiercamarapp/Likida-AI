import { diaEnZona, TZ_MX } from '@/lib/formato';
import { estaResuelto, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LOS HITOS LE DICEN AL AGENTE DE JORNADA (Agente 12) — puro.
//
// El expediente de jornada (0241) se alimenta de marcas CON ORIGEN. Los hitos son una fuente más, pero
// con un límite que `jornada/derivar.ts` ya dejó escrito y que aquí se respeta al pie de la letra:
//
//   · «Ya llegué» NO es «empecé a trabajar» (el chofer manejó horas antes de llegar): del primer hito del
//     día NO se deriva un INICIO — acortaría la jornada registrada, y una jornada acortada por el sistema
//     favorece al patrón con una hora que nadie declaró. Se informa, marcado como «no usable como inicio».
//   · El ÚLTIMO hito del día sí prueba que el chofer seguía operando a esa hora: es una COTA INFERIOR del
//     FIN (la jornada duró al menos hasta ahí). Sirve para probar un exceso, nunca para descartarlo.
//
// Este módulo SOLO calcula y expone esa evidencia (`servicios.evidenciaJornadaDeHitos`). NO escribe en
// `jornada_asiento`: el único escritor de marcas derivadas es el derivador (claims con lease, versionado y la
// puerta del aviso de privacidad, 0319/0325), y un segundo escritor sin esa puerta crearía expedientes de
// personas que nunca recibieron su aviso. Ver docs/operacion/agente-conductor.md.
// ═══════════════════════════════════════════════════════════════════════════

export interface MarcaHito {
  tipo: TipoHito;
  viajeId: string;
  /** La hora del mensaje (o declarada por oficina). */
  momento: string;
  fuente: HitoFila['fuente'];
  /** Coordenada del hecho (qué hito la produjo) en el formato de `origen_ref` del expediente. */
  origenRef: string;
}

export interface EvidenciaJornada {
  /** Día de México (AAAA-MM-DD). */
  dia: string;
  /** El primer hito del día: informativo, NO usable como inicio de jornada. */
  primerHito: MarcaHito | null;
  /** El último hito del día: cota inferior del FIN de la jornada. */
  ultimoHito: MarcaHito | null;
  hitos: number;
  usoPermitido: { inicio: false; fin: 'cota_inferior' };
}

const marca = (h: HitoFila, momento: string): MarcaHito => ({
  tipo: h.tipo, viajeId: h.viajeId, momento, fuente: h.fuente, origenRef: `viaje:${h.viajeId}:hito:${h.tipo}:c${h.ciclo}`,
});

/** La evidencia de UN día a partir de los hitos (de todos los viajes del chofer ese día). */
export function evidenciaJornadaDeHitos(hitos: readonly HitoFila[], dia: string): EvidenciaJornada {
  const delDia = hitos
    .filter((h) => estaResuelto(h) && (h.mensajeEn ?? h.recibidoEn))
    .map((h) => ({ h, momento: (h.mensajeEn ?? h.recibidoEn) as string }))
    .filter((x) => !Number.isNaN(Date.parse(x.momento)) && diaEnZona(new Date(x.momento), TZ_MX) === dia)
    .sort((a, b) => Date.parse(a.momento) - Date.parse(b.momento));
  return {
    dia,
    primerHito: delDia.length ? marca(delDia[0].h, delDia[0].momento) : null,
    ultimoHito: delDia.length ? marca(delDia[delDia.length - 1].h, delDia[delDia.length - 1].momento) : null,
    hitos: delDia.length,
    usoPermitido: { inicio: false, fin: 'cota_inferior' },
  };
}
