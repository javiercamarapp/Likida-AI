import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/formato';
import { Tarjeta, Disclosure, BotonEnlace } from '@/app/ui-v2/componentes';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { DonaMini, BarList } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

export const dynamic = 'force-dynamic';

const faseLabel = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({ ocr: 'OCR', cuadre: t('model_ops.cuadre'), whatsapp: 'WhatsApp' });

/** Las TRES fases del pipeline DEL VIAJE, en el orden en que corren. Esta pantalla gobierna solo ese camino; NO es el inventario de
 *  agentes de la compañía (eso es Agentes › Panel, con la matriz de roles de modelo en `agente_definicion.modelo_rol`). */
const fasesTr = (t: TSistema = T_SISTEMA_ES) => ([
  { fase: 'ocr', nombre: t('model_ops.ocr'), queHace: t('model_ops.lee_la_foto_de_un_comprobante') },
  { fase: 'cuadre', nombre: t('model_ops.cuadre'), queHace: t('model_ops.compara_los_gastos_ya_capturados_contra') },
  { fase: 'whatsapp', nombre: 'WhatsApp', queHace: t('model_ops.lleva_la_conversacion_con_el_operador') },
] as const);

/**
 * Modelos: el pipeline completo del viaje con su costo real por fase y por modelo. Todo sale de `llm_costo` (`getResumenNegocio` /
 * `getCostoPorFaseModelo`). No hay editor de prompts ni selector de modelo por fase: eso sería funcionalidad decorativa, y se
 * declara abajo. El rol de modelo de cada AGENTE del catálogo sí se cambia, desde Agentes › Panel › Configurar.
 */
export default async function ModelOpsPage() {
  const { t, idioma } = await getT('admin_sistema');
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const porFase = new Map(r.porFase.map((f) => [f.fase, f]));

  return (
    <EsqueletoPanelCifras
      area="Agentes"
      titulo={t('model_ops.agentes')}
      apoyo={t('model_ops.modelos_las_tres_fases_del_pipeline')}
      acciones={<BotonEnlace href="/admin/agentes" variante="secondary" tamano="sm">{t('model_ops.rol_de_modelo_por_agente')}</BotonEnlace>}
      etiquetaCifras={t('model_ops.agentes')}
      cifras={[
        { etiqueta: t('model_ops.kpi_gasto'), valor: r.costoUsd, formato: 'usd' },
        { etiqueta: t('model_ops.kpi_llamadas'), valor: r.porFase.reduce((s, f) => s + f.n, 0), formato: 'entero' },
        { etiqueta: t('model_ops.kpi_fases'), valor: r.porFase.length, formato: 'entero' },
        { etiqueta: t('model_ops.kpi_modelos'), valor: r.porModelo.length, formato: 'entero' },
      ]}
      variante="4-4-4"
      graficas={[
        ...fasesTr(t).map(({ fase, nombre, queHace }) => (
          <TarjetaFase key={fase} titulo={nombre} queHace={queHace} datos={porFase.get(fase)} modelos={porFaseModelo.filter((m) => m.fase === fase)} />
        )),
        <Tarjeta key="por-fase" titulo={t('model_ops.costo_por_fase')} estado={r.porFase.length > 0 ? 'ok' : 'vacio'} mensaje={t('model_ops.sin_actividad_de_ia')} detalle={t('model_ops.todavia_no_hay_actividad_de_ia')}>
          <DonaMini
            etiqueta={t('model_ops.costo_por_fase')}
            formato="usd"
            gajos={r.porFase.map((f) => ({ etiqueta: faseLabel(t)[f.fase] ?? f.fase, valor: f.costoUsd }))}
            centro={usd(r.porFase.reduce((s, f) => s + f.costoUsd, 0))}
          />
        </Tarjeta>,
        <Tarjeta key="por-modelo" titulo={t('model_ops.costo_por_modelo_todas_las_fases')} estado={r.porModelo.length > 0 ? 'ok' : 'vacio'} mensaje={t('model_ops.sin_llamadas')} detalle={t('model_ops.sin_llamadas_registradas_todavia')}>
          <BarList
            etiqueta={t('model_ops.costo_por_modelo')}
            items={r.porModelo.map((m) => ({ clave: m.modelo, etiqueta: m.modelo, valor: m.costoUsd, texto: t('model_ops.llamadas_costo', { costo: usd(m.costoUsd), n: numero(m.n, idioma) }) }))}
          />
        </Tarjeta>,
      ]}
    >
      <Disclosure titulo={t('model_ops.lo_que_no_existe_todavia')} resumen={t('model_ops.versionado_y_selector_de_modelo')}>
        <p>{t('model_ops.versionado_de_prompts_reversa_y_guardrails')}</p>
      </Disclosure>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('model_ops.modelos') };
}
