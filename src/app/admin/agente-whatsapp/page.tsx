import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo, contarConversacionesActivas } from '@/lib/admin/negocio';
import { Tarjeta, Aviso, BotonEnlace } from '@/app/ui-v2/componentes';
import { Columnas } from '@/app/ui-v2/graficas';
import { numero as num, usd as dolares, fechaCorta } from '@/lib/formato';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { TablaModelosFase } from '../tarjeta-fase';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * Agente de WhatsApp: la conversación con el operador de principio a fin. Real: `llm_costo` filtrado por la fase `whatsapp` y
 * `wa_conversacion.estado` para CUÁNTAS conversaciones hay activas. La lista de conversaciones vive solo en Agentes › Conversaciones
 * (con el teléfono enmascarado); aquí NO se repite: una cifra y un enlace. Un cero de costo es MEDIDO, no un relleno.
 */
export default async function AgenteWhatsappPage() {
  const { t, idioma } = await getT('admin_sistema');
  await requireSuperadmin();
  const [r, porFaseModelo, activas] = await Promise.all([
    getResumenNegocio(), getCostoPorFaseModelo().catch(() => []), contarConversacionesActivas(),
  ]);
  const whatsapp = r.porFase.find((f) => f.fase === 'whatsapp');
  const modelos = porFaseModelo.filter((m) => m.fase === 'whatsapp');

  return (
    <EsqueletoPanelCifras
      area="Agentes"
      titulo={t('model_ops.agentes')}
      apoyo={t('agente_whatsapp.whatsapp_la_conversacion_completa_con_el')}
      acciones={<BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm">{t('agente_whatsapp.ver_conversaciones')}</BotonEnlace>}
      avisos={<Aviso tono="info">{t('agente_whatsapp.el_whatsapp_del_producto_sigue_en')}</Aviso>}
      etiquetaCifras="WhatsApp"
      cifras={[
          { etiqueta: t('agente_whatsapp.gastado_en_whatsapp'), valor: whatsapp ? whatsapp.costoUsd : 0, formato: 'usd', nota: t('agente_cuadre.costo_medido_en_llm_costo') },
          { etiqueta: t('agente_whatsapp.llamadas_de_whatsapp'), valor: whatsapp ? whatsapp.n : 0, formato: 'entero' },
          { etiqueta: t('whatsapp_infra.conversaciones_activas'), valor: activas, estado: activas === null ? 'error' : 'ok', formato: 'entero', href: '/admin/conversaciones' },
      ]}
      graficas={[
        <Tarjeta key="serie" titulo={t('agente_fase.serie_costo_dia')} estado={r.porDia.length > 0 ? 'ok' : 'vacio'} mensaje={t('model_ops.sin_actividad_de_ia')} detalle={t('agente_cuadre.el_costo_por_dia_no_se')} contenida>
          <Columnas etiqueta={t('capacidad_forecast.costo_de_ia_por_dia')} datos={r.porDia.map((d) => ({ etiqueta: fechaCorta(d.dia, idioma), valor: d.costoUsd }))} formato="usd" />
        </Tarjeta>,
        <TablaModelosFase
          key="modelos"
          titulo={t('agente_whatsapp.costo_por_modelo_whatsapp')}
          modelos={modelos}
          textos={{ modelo: t('agente_fase.col_modelo'), llamadas: t('agente_fase.col_llamadas'), costo: t('agente_fase.col_costo'), vacio: t('agente_fase.sin_modelos'), vacioDetalle: t('agente_fase.sin_modelos_detalle') }}
        />,
      ]}
      saberes={{
        seSabe: {
          titulo: t('saberes.se_sabe'),
          items: [
            t('agente_fase.se_gasto', { fase: 'WhatsApp', costo: dolares(whatsapp ? whatsapp.costoUsd : 0), n: num(whatsapp ? whatsapp.n : 0) }),
            ...(activas === null ? [] : [t('agente_whatsapp.se_conversaciones', { n: num(activas) })]),
          ],
        },
        noSeSabe: { titulo: t('saberes.no_se_sabe'), items: [t('agente_whatsapp.no_entrega')] },
      }}
    />
  );
}

export const metadata: Metadata = { title: 'WhatsApp' };
