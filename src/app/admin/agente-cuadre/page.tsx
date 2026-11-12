import { uniformes } from '@/app/admin/cifras-uniformes';
import { observadas } from '@/app/admin/sello-observado';
import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { Tarjeta } from '@/app/ui-v2/componentes';
import { Columnas } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { TablaModelosFase } from '../tarjeta-fase';
import '../sistema.css';
import { numero as num, usd as dolares, fechaCorta } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * Agente de Cuadre: la fase que compara los gastos ya capturados contra el anticipo y la política de la flota. Real: `llm_costo`
 * filtrado por la fase `cuadre` y `viaje` para el total de viajes procesados. Un cero aquí es MEDIDO: cero filas para la fase es
 * cero gasto real, no un relleno.
 */
export default async function AgenteCuadrePage() {
  const { t, idioma } = await getT('admin_sistema');
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo().catch(() => [])]);
  const cuadre = r.porFase.find((f) => f.fase === 'cuadre');
  const modelos = porFaseModelo.filter((m) => m.fase === 'cuadre');

  return (
    <EsqueletoPanelCifras
      area="Agentes"
      titulo={t('model_ops.cuadre')}
      apoyo={t('agente_cuadre.cuadre_concilia_gastos_comprobados_contra_anticipo')}
      etiquetaCifras={t('model_ops.cuadre')}
      cifras={observadas(uniformes([
        { etiqueta: t('agente_cuadre.gastado_en_cuadre'), valor: cuadre ? cuadre.costoUsd : 0, formato: 'usd', nota: t('agente_cuadre.costo_medido_en_llm_costo') },
        { etiqueta: t('agente_cuadre.llamadas_de_cuadre'), valor: cuadre ? cuadre.n : 0, formato: 'entero' },
        { etiqueta: t('agente_cuadre.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero' },
      ]), t('a1r4.observado'))}
      graficas={[
        <Tarjeta key="serie" titulo={t('agente_fase.serie_costo_dia')} contenida>
          {r.porDia.length > 0
            ? <Columnas etiqueta={t('capacidad_forecast.costo_de_ia_por_dia')} datos={r.porDia.map((d) => ({ etiqueta: fechaCorta(d.dia, idioma), valor: d.costoUsd }))} formato="usd" />
            : <p className="adm-sis-vacio-linea" role="status"><b>{t('model_ops.sin_actividad_de_ia')}</b> {t('agente_cuadre.el_costo_por_dia_no_se')}</p>}
        </Tarjeta>,
        <TablaModelosFase
          key="modelos"
          titulo={t('agente_cuadre.costo_por_modelo_cuadre')}
          modelos={modelos}
          textos={{ modelo: t('agente_fase.col_modelo'), llamadas: t('agente_fase.col_llamadas'), costo: t('agente_fase.col_costo'), vacio: t('agente_fase.sin_modelos'), vacioDetalle: t('agente_fase.sin_modelos_detalle') }}
        />,
      ]}
      saberes={{
        seSabe: {
          titulo: t('saberes.se_sabe'),
          items: [
            t('agente_fase.se_gasto', { fase: 'Cuadre', costo: dolares(cuadre ? cuadre.costoUsd : 0), n: num(cuadre ? cuadre.n : 0) }),
            t('agente_cuadre.se_viajes', { n: num(r.viajesProcesados) }),
          ],
        },
        noSeSabe: { titulo: t('saberes.no_se_sabe'), items: [t('agente_cuadre.likida_sabe_cuantos_viajes_se_procesaron', { viajesProcesados: r.viajesProcesados })] },
      }}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('model_ops.cuadre') };
}
