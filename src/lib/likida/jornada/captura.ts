import { OFFSET_MX } from '@/lib/formato';
import type { Asiento } from './modelo';

/**
 * Validación de la marca que CAPTURA el contralor (A37-S19-01 y A37-S19-02).
 *
 * Esa hora queda firmada con su correo y se compara después contra un tope
 * legal, así que no se guarda nada que no pueda defenderse:
 *   · la fecha tiene que EXISTIR (`new Date('2026-02-30T…')` no falla: se
 *     corre a marzo y el registro diría otro día del que se tecleó);
 *   · tiene que caer en el día del expediente, o a un día de él (un fin de
 *     jornada pasada la medianoche es legítimo);
 *   · lleva una nota con su fuente (≥ 5 caracteres): sin ella la hora es una
 *     cifra sin origen;
 *   · `corrigeA` solo puede ser una marca ANULADA de ESTA jornada: la FK de la
 *     base solo exige el mismo tenant, y un id de otro operador dejaría un
 *     expediente apuntando a otro.
 */
export const NOTA_MINIMA = 5;

export type ResultadoCaptura =
  | { ok: true; momento: Date; nota: string; corrigeA: string | null }
  | { ok: false; error: string };

const DIA_MS = 24 * 60 * 60 * 1000;

function diaUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // Reconstruir y comparar: así «30 de febrero» no se acepta corrido a marzo.
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t;
}

export function validarCapturaMarca(e: {
  cuando: string;
  /** El día del expediente (`jornada_dia.dia`, AAAA-MM-DD), leído de la base. */
  dia: string;
  nota: string;
  corrigeA: string | null;
  /** Los asientos del expediente; solo se consulta si hay `corrigeA`. */
  asientos: Asiento[];
}): ResultadoCaptura {
  const cuando = e.cuando.trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(cuando);
  if (!m) return { ok: false, error: 'Captura la fecha y la hora completas.' };
  const fecha = diaUtc(m[1]);
  if (fecha === null || Number(m[2]) > 23 || Number(m[3]) > 59) {
    return { ok: false, error: 'Esa fecha u hora no existe. Revísala.' };
  }
  const del = diaUtc(e.dia);
  if (del === null) return { ok: false, error: 'No pude leer el día del expediente — no se anotó nada.' };
  if (Math.abs(fecha - del) > DIA_MS) {
    return { ok: false, error: `Esa hora cae fuera del día ${e.dia} del expediente (se admite hasta un día antes o después). Revisa la fecha.` };
  }
  const momento = new Date(`${cuando}:00${OFFSET_MX}`);
  if (!Number.isFinite(momento.getTime())) return { ok: false, error: 'Esa fecha y hora no se entienden.' };

  const nota = e.nota.trim();
  if (nota.length < NOTA_MINIMA) {
    return { ok: false, error: `Anota de dónde sacaste la hora (mínimo ${NOTA_MINIMA} caracteres): sin la fuente, la hora queda como una cifra sin origen.` };
  }

  let corrigeA: string | null = null;
  if (e.corrigeA) {
    const objetivo = e.asientos.find((a) => a.id === e.corrigeA);
    if (!objetivo || objetivo.anuladoEn === null) {
      return { ok: false, error: 'La marca que dices corregir no es una marca anulada de este día. Recarga la pantalla.' };
    }
    corrigeA = objetivo.id;
  }
  return { ok: true, momento, nota, corrigeA };
}
