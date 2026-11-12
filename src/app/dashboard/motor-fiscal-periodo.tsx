'use client';

import { useState } from 'react';
import { ReceiptText, TriangleAlert } from 'lucide-react';
import { mxn } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { Icono, SegmentedControl } from '@/app/ui-v2/componentes';
import { BarList, Cifra, TiraCifras } from '@/app/ui-v2/graficas';

type Modo = 'semanal' | 'mensual' | 'historico';
const MODOS: readonly Modo[] = ['semanal', 'mensual', 'historico'];

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
 *
 * `causas === null` significa «la lectura de las causas falló», y NO es lo mismo que `[]` («no hay causas»): las causas y las series
 * son dos lecturas independientes, así que una puede caerse sin la otra, y entonces se dice (A50-FIS-04).
 */
export function MotorFiscalPeriodo({ series, causas = [] }: { series: Record<Modo, ResumenSimple> | null; causas?: readonly CausaMotor[] | null }) {
  const { t } = useT('resto', restoEs);
  const [modo, setModo] = useState<Modo>('semanal');

  if (!series) {
    return <p className="rv-cont__nota">{t('op.no_se_pudo_leer_el_motor')}</p>;
  }
  const r = series[modo];
  const ventana: Record<Modo, string> = {
    semanal: t('op.mf_ventana_semanal'), mensual: t('op.mf_ventana_mensual'), historico: t('op.mf_ventana_historico'),
  };
  const opciones = [
    { valor: 'semanal', etiqueta: t('op.mf_opcion_semanal') },
    { valor: 'mensual', etiqueta: t('op.mf_opcion_mensual') },
    { valor: 'historico', etiqueta: t('op.mf_opcion_historico') },
  ] as const;
  const top = (causas ?? []).slice(0, 3);

  return (
    <div className="rv-cont__motor">
      <SegmentedControl<Modo> tamano="sm" etiqueta={t('op.mf_periodo')} opciones={opciones} valor={modo} onChange={(v) => setModo(MODOS.includes(v) ? v : 'semanal')} />
      <TiraCifras>
        <Cifra icono={<Icono icono={TriangleAlert} />} tono="bad" info="contador.en_riesgo"
          etiqueta={t('op.mf_en_riesgo', { ventana: ventana[modo] })} valor={r.montoEnRiesgo + r.montoPerdido} formato="mxn" />
        <Cifra icono={<Icono icono={ReceiptText} />} tono="ok" info="contador.recuperable"
          etiqueta={t('op.mf_recuperable', { ventana: ventana[modo] })} valor={r.montoRecuperable} formato="mxn" />
      </TiraCifras>
      {causas === null && <p className="rv-cont__nota">{t('op.mf_causas_no_leidas')}</p>}
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
