import { Boton, BotonEnlace } from '@/app/ui-v2/componentes';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { desplazarMes } from '@/lib/backoffice/periodo';

/**
 * El selector de mes ÚNICO de las pantallas del Back-office con mes: «Mes anterior» y «Mes siguiente», siempre los dos y en el mismo lugar.
 * `periodo` es `AAAA-MM-01`. Con `tope` (el mes en curso) el siguiente se ve APAGADO en el último mes, nunca desaparece.
 * `completo` pone el parámetro como `AAAA-MM-01` (cierre); sin él, `AAAA-MM` (gastos, comisiones, contabilidad).
 */
export function SelectorMes({ t, base, param, periodo, tope, completo = false }: {
  t: TrDe<'admin_backoffice'>;
  base: string;
  param: 'mes' | 'periodo';
  periodo: string;
  tope?: string;
  completo?: boolean;
}) {
  const valor = (p: string): string => (completo ? p : p.slice(0, 7));
  const ultimo = tope !== undefined && periodo >= tope;
  return (
    <span className="adm-din-acciones bo-selector-mes">
      <BotonEnlace variante="ghost" tamano="sm" href={`${base}?${param}=${valor(desplazarMes(periodo, -1))}`}>{t('gastos.mes_anterior')}</BotonEnlace>
      {ultimo
        ? <Boton variante="ghost" tamano="sm" disabled>{t('gastos.mes_siguiente')}</Boton>
        : <BotonEnlace variante="ghost" tamano="sm" href={`${base}?${param}=${valor(desplazarMes(periodo, 1))}`}>{t('gastos.mes_siguiente')}</BotonEnlace>}
    </span>
  );
}
