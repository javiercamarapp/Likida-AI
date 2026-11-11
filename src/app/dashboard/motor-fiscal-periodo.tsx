'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ReceiptText, TriangleAlert } from 'lucide-react';
import { mxn } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { Icono, SegmentedControl } from '@/app/ui-v2/componentes';
import { BarList, Cifra, TiraCifras } from '@/app/ui-v2/graficas';

type Modo = 'semanal' | 'mensual' | 'historico';
const MODOS: readonly Modo[] = ['semanal', 'mensual', 'historico'];

interface CtxPeriodo { modo: Modo; setModo: (m: Modo) => void }
const PeriodoCtx = createContext<CtxPeriodo | null>(null);

/** Comparte el periodo (7 días / 30 días / Histórico) entre el selector de la barra de filtros y las tarjetas que lo leen: el control vive
 *  en la barra, arriba (Rovaq: segmentado de periodo en la fila de filtros) y no dentro de una tarjeta. */
export function PeriodoMotorProvider({ children }: { children: ReactNode }) {
  const [modo, setModo] = useState<Modo>('semanal');
  return <PeriodoCtx.Provider value={{ modo, setModo }}>{children}</PeriodoCtx.Provider>;
}

/** El segmentado del periodo. Sin proveedor no pinta nada (no hay a quién mandar el cambio). */
export function SelectorPeriodoMotor() {
  const { t } = useT('resto', restoEs);
  const ctx = useContext(PeriodoCtx);
  if (!ctx) return null;
  return (
    <SegmentedControl<Modo> tamano="sm" etiqueta={t('op.mf_periodo')} opciones={opcionesPeriodo([t('op.mf_opcion_semanal'), t('op.mf_opcion_mensual'), t('op.mf_opcion_historico')])} valor={ctx.modo}
      onChange={(v) => ctx.setModo(MODOS.includes(v) ? v : 'semanal')} />
  );
}

function opcionesPeriodo(etiquetas: readonly [string, string, string]) {
  return [
    { valor: 'semanal', etiqueta: etiquetas[0] },
    { valor: 'mensual', etiqueta: etiquetas[1] },
    { valor: 'historico', etiqueta: etiquetas[2] },
  ] as const;
}

interface ResumenSimple { montoPerdido: number; montoEnRiesgo: number; montoRecuperable: number }
export interface CausaMotor { titulo: string; n: number; monto: number }

/**
 * "En riesgo/perdido" y "Recuperable pidiendo factura" con su periodo elegible (semanal / mensual / histórico) y, debajo, las tres
 * causas que más pesan en el ejercicio. Antes eran dos recuadros con flechas ‹ › propias más una lista suelta (`MotorFiscal`); ahora
 * son dos cifras del kit en una tira, con el segmentado del sistema arriba: el mismo control de periodo que usa el resto del producto.
 *
 * `series` ya trae los 3 `ResumenPerdidas` PRE-CALCULADOS por el servidor — este componente solo elige cuál mostrar.
 * `resumirPerdidas` vive en `fiscal.ts`, que importa `supabaseAdmin` a nivel de módulo: un Client Component no puede importar ese
 * archivo en tiempo de ejecución (arrastraría el service-role al bundle del navegador), así que el cálculo llega ya hecho, como
 * datos planos. Las causas son las del ejercicio (no ciclan con el periodo) y se rotulan así.
 */
export function MotorFiscalPeriodo({ series, causas = [] }: { series: Record<Modo, ResumenSimple> | null; causas?: readonly CausaMotor[] }) {
  const { t } = useT('resto', restoEs);
  const [modoLocal, setModoLocal] = useState<Modo>('semanal');
  const compartido = useContext(PeriodoCtx);
  const modo = compartido?.modo ?? modoLocal;

  if (!series) {
    return <p className="rv-cont__nota">{t('op.no_se_pudo_leer_el_motor')}</p>;
  }
  const r = series[modo];
  const ventana: Record<Modo, string> = {
    semanal: t('op.mf_ventana_semanal'), mensual: t('op.mf_ventana_mensual'), historico: t('op.mf_ventana_historico'),
  };
  const top = causas.slice(0, 3);

  return (
    <div className="rv-cont__motor">
      {/* Con proveedor, el selector vive en la barra de filtros de la página; suelto, se pinta aquí. */}
      {compartido ? null : (
        <SegmentedControl<Modo> tamano="sm" etiqueta={t('op.mf_periodo')} opciones={opcionesPeriodo([t('op.mf_opcion_semanal'), t('op.mf_opcion_mensual'), t('op.mf_opcion_historico')])} valor={modo} onChange={(v) => setModoLocal(MODOS.includes(v) ? v : 'semanal')} />
      )}
      <TiraCifras>
        <Cifra icono={<Icono icono={TriangleAlert} />} tono={r.montoEnRiesgo + r.montoPerdido > 0 ? 'bad' : undefined} info="contador.en_riesgo"
          etiqueta={t('op.mf_en_riesgo', { ventana: ventana[modo] })} valor={r.montoEnRiesgo + r.montoPerdido} formato="mxn" />
        <Cifra icono={<Icono icono={ReceiptText} />} tono={r.montoRecuperable > 0 ? 'ok' : undefined} info="contador.recuperable"
          etiqueta={t('op.mf_recuperable', { ventana: ventana[modo] })} valor={r.montoRecuperable} formato="mxn" />
      </TiraCifras>
      {top.length > 0 && (
        <BarList
          etiqueta={t('op.mf_causas')}
          items={top.map((c, i) => ({
            clave: `${i}-${c.titulo}`, valor: c.monto, texto: mxn(c.monto),
            etiqueta: t(c.n === 1 ? 'op.titulo_n_comprobante.uno' : 'op.titulo_n_comprobante.otros', { titulo: c.titulo, n: c.n }),
          }))}
        />
      )}
    </div>
  );
}
