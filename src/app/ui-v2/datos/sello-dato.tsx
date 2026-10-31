import { fechaMx } from '@/lib/formato';
import { KindBadge, type TipoDato } from '../graficas/kind-badge';
import { cx } from '../componentes/clases';

type Instante = string | number | Date | null | undefined;

function aMs(v: Instante): number | null {
  if (v === null || v === undefined || v === '') return null;
  const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** «hace 5 min». Un instante futuro o ilegible no inventa antigüedad: devuelve null. */
export function haceTiempo(desdeMs: number, ahoraMs: number): string | null {
  const d = ahoraMs - desdeMs;
  if (!Number.isFinite(d) || d < -60_000) return null;
  if (d < 60_000) return 'hace unos segundos';
  const min = Math.floor(d / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.floor(h / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

export interface PropsSelloDato {
  /** Clase de dato (modelo epistémico del producto): observado, estimado, inferido o sin dato. */
  tipo: TipoDato;
  /** El registro del que sale la cifra, nunca un sistema que la pantalla no lee. */
  fuente: string;
  /** Fecha de corte REAL de la fuente (el último dato que la fuente trae), si la conoce. Nunca pases aquí el día de la lectura. */
  corte?: Instante;
  /** Cuándo se leyó la fuente. Solo alimenta «leído …» y «actualizado hace …»; jamás se presenta como corte. */
  leidoEn?: Instante;
  /** Reloj de la comparación (ms). Por omisión, ahora; se inyecta en pruebas y en pantallas que ya tienen su reloj. */
  ahora?: number;
  className?: string;
}

export interface TextoSello { texto: string; ayuda: string; actualizado: string | null }

/** El texto del sello. Con corte real: «Fuente · corte 28 oct 2026». Sin corte: «Fuente · leído 31 oct 2026» (y la ayuda lo aclara:
 *  la fuente no informa su corte). «Actualizado hace …» solo sale si se sabe cuándo se leyó. */
export function textoSello(p: Pick<PropsSelloDato, 'fuente' | 'corte' | 'leidoEn' | 'ahora'>): TextoSello {
  const corte = aMs(p.corte);
  const leido = aMs(p.leidoEn);
  const ahora = p.ahora ?? Date.now();
  // Una fecha SIN hora («2026-10-28») es un día de calendario: se imprime tal cual (fechaMx lo sabe); convertirla a instante la corre un día.
  const dia = (v: Instante, ms: number) => fechaMx(typeof v === 'string' ? v : new Date(ms).toISOString());
  const actualizado = leido !== null ? haceTiempo(leido, ahora) : null;
  if (corte !== null) {
    return { texto: `${p.fuente} · corte ${dia(p.corte, corte)}`, ayuda: `Último dato que trae la fuente: ${dia(p.corte, corte)}.`, actualizado };
  }
  if (leido !== null) {
    return { texto: `${p.fuente} · leído ${dia(p.leidoEn, leido)}`, ayuda: 'La fuente no informa su fecha de corte; esta es la fecha en que se leyó.', actualizado };
  }
  return { texto: p.fuente, ayuda: 'La fuente no informa su fecha de corte.', actualizado: null };
}

/** El sello de procedencia de una cifra o tabla: clase de dato + fuente + corte real + «actualizado hace». Reutiliza `KindBadge`:
 *  el punto silencioso de «observado» y la marca de estimado / inferido / sin dato (icono + texto, nunca solo color). */
export function SelloDato({ tipo, className, ...resto }: PropsSelloDato) {
  const t = textoSello(resto);
  const ref = aMs(resto.corte) !== null ? resto.corte : resto.leidoEn;
  const ms = aMs(ref);
  const dateTime = typeof ref === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ref.trim()) ? ref.trim() : ms !== null ? new Date(ms).toISOString() : undefined;
  return (
    <span className={cx('rv-sello', className)} data-tipo={tipo} title={t.ayuda}>
      {tipo === 'observado' ? <i className="rv-sello__punto" aria-hidden="true" /> : <KindBadge tipo={tipo} />}
      <time className="rv-sello__texto" dateTime={dateTime}>{t.texto}</time>
      {t.actualizado ? <span className="rv-sello__edad"> · actualizado {t.actualizado}</span> : null}
    </span>
  );
}
