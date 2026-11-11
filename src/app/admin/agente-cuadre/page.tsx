import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { MarcoPagina, FilaTarjetas, Tarjeta } from '@/app/ui-v2/componentes';
import { TiraCifras, Columnas } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * Agente de Cuadre: la fase que compara los gastos ya capturados contra el anticipo y la política de la flota. Real: `llm_costo`
 * filtrado por la fase `cuadre` y `viaje` para el total de viajes procesados. Un cero aquí es MEDIDO: cero filas para la fase es
 * cero gasto real, no un relleno.
 */
export default async function AgenteCuadrePage() {
  const { t } = await getT('admin_sistema');
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo().catch(() => [])]);
  const cuadre = r.porFase.find((f) => f.fase === 'cuadre');
  const modelos = porFaseModelo.filter((m) => m.fase === 'cuadre');

  return (
    <MarcoPagina
      area="Agentes"
      titulo={t('model_ops.agentes')}
      apoyo={t('agente_cuadre.cuadre_concilia_gastos_comprobados_contra_anticipo')}
    >
      <TiraCifras
        etiqueta={t('model_ops.cuadre')}
        items={[
          { etiqueta: t('agente_cuadre.gastado_en_cuadre'), valor: cuadre ? cuadre.costoUsd : 0, formato: 'usd', nota: t('agente_cuadre.costo_medido_en_llm_costo') },
          { etiqueta: t('agente_cuadre.llamadas_de_cuadre'), valor: cuadre ? cuadre.n : 0, formato: 'entero' },
          { etiqueta: t('agente_cuadre.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero' },
        ]}
      />
      <FilaTarjetas variante="6-6">
        <TarjetaFase
          titulo={t('agente_cuadre.costo_por_modelo_cuadre')}
          queHace={t('model_ops.compara_los_gastos_ya_capturados_contra')}
          datos={cuadre}
          modelos={modelos}
        />
        <Tarjeta
          titulo={t('agente_cuadre.conciliacion_automatica_contra_manual')}
          estado="vacio"
          mensaje={t('agente_cuadre.aun_no_se_mide')}
          detalle={t('agente_cuadre.likida_sabe_cuantos_viajes_se_procesaron', { viajesProcesados: r.viajesProcesados })}
        />
      </FilaTarjetas>
      <Tarjeta titulo={t('agente_cuadre.costo_de_ia_por_dia_todas')} estado={r.porDia.length > 0 ? 'ok' : 'vacio'} mensaje={t('model_ops.sin_actividad_de_ia')} detalle={t('agente_cuadre.el_costo_por_dia_no_se')}>
        <Columnas etiqueta={t('capacidad_forecast.costo_de_ia_por_dia')} datos={r.porDia.map((d) => ({ etiqueta: d.dia, valor: d.costoUsd }))} formato="usd" />
      </Tarjeta>
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('model_ops.cuadre') };
}
