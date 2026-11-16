import { AlertTriangle, CircleCheck, Clock } from 'lucide-react';
import { fechaMx } from '@/lib/formato';
import { cx } from '../componentes/clases';
import { idiomaUi, textoUi } from '../componentes/texto-ui';
import type { Idioma } from '@/lib/i18n/idioma';

export type EstadoCorte = 'al_dia' | 'parcial' | 'obsoleto';

/** Clasifica el corte de una fuente: obsoleto si pasó de `maxEdadDias`; parcial si leyó menos fuentes de las que hay; al día si no.
 *  Un corte desconocido NUNCA es «al día»: se dice que no se sabe. */
export function estadoDeCorte(p: { corte?: string | null; ahora?: number; maxEdadDias?: number; leidas?: number; total?: number }): EstadoCorte | 'desconocido' {
  if (p.leidas !== undefined && p.total !== undefined && p.leidas < p.total) return 'parcial';
  if (!p.corte) return 'desconocido';
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(p.corte.trim()) ? Date.parse(`${p.corte.trim()}T00:00:00Z`) : Date.parse(p.corte);
  if (!Number.isFinite(ms)) return 'desconocido';
  const dias = ((p.ahora ?? Date.now()) - ms) / 86_400_000;
  return dias > (p.maxEdadDias ?? 2) ? 'obsoleto' : 'al_dia';
}

const ICONO = { al_dia: CircleCheck, parcial: AlertTriangle, obsoleto: Clock, desconocido: Clock } as const;
const TONO = { al_dia: 'ok', parcial: 'warn', obsoleto: 'warn', desconocido: 'info' } as const;

/** Aviso del corte de una fuente en tres tonos (al día · parcial · obsoleto) más el «no sabemos». Icono + texto + `<time>`: el
 *  color nunca es el único canal. Dice QUÉ falta de la cobertura («18 de 22 operadores con captura») cuando hay conteos. */
export function AvisoCorte({ fuente, corte, estado, leidas, total, rotuloUnidad, children, className, ahora, maxEdadDias, idioma }: {
  /** Idioma de los textos (servidor sin proveedor); por omisión, es. */
  idioma?: Idioma;
  fuente: string;
  /** Corte real de la fuente (ISO o AAAA-MM-DD). Sin él, el aviso lo dice. */
  corte?: string | null;
  /** Fuerza el estado; por omisión se calcula con `estadoDeCorte`. */
  estado?: EstadoCorte | 'desconocido';
  leidas?: number;
  total?: number;
  /** Qué se cuenta en «n de N» («operadores con captura»). */
  rotuloUnidad?: string;
  /** Qué hacer o qué significa, en una línea. */
  children?: React.ReactNode;
  className?: string;
  ahora?: number;
  maxEdadDias?: number;
}) {
  const e = estado ?? estadoDeCorte({ corte, ahora, maxEdadDias, leidas, total });
  const Icono = ICONO[e];
  const idiomaEf = idiomaUi(idioma);
  const t = textoUi(idiomaEf);
  const titulo = t(`corte.${e}` as const);
  const cobertura = leidas !== undefined && total !== undefined ? ` ${t('corte.cobertura', { leidas, total, unidad: rotuloUnidad ?? t('corte.unidad') })}` : '';
  return (
    <div className={cx('rv-corte', className)} data-estado={e} data-tono={TONO[e]} role="status">
      <Icono className="rv-corte__icono" width={14} height={14} strokeWidth={2} aria-hidden="true" />
      <p className="rv-corte__texto">
        <strong>{titulo}.</strong>{' '}
        {corte ? <>{t('corte.con', { fuente })} <time dateTime={corte}>{fechaMx(corte, idiomaEf)}</time>.</> : <>{t('corte.sin', { fuente })}</>}
        {cobertura}
        {children ? <> {children}</> : null}
      </p>
    </div>
  );
}
