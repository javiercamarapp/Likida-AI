import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo, contarConversacionesActivas } from '@/lib/admin/negocio';
import { MarcoPagina, FilaTarjetas, Tarjeta, Aviso, BotonEnlace } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * Agente de WhatsApp: la conversación con el operador de principio a fin. Real: `llm_costo` filtrado por la fase `whatsapp` y
 * `wa_conversacion.estado` para CUÁNTAS conversaciones hay activas. La lista de conversaciones vive solo en Agentes › Conversaciones
 * (con el teléfono enmascarado); aquí NO se repite: una cifra y un enlace. Un cero de costo es MEDIDO, no un relleno.
 */
export default async function AgenteWhatsappPage() {
  const { t } = await getT('admin_sistema');
  await requireSuperadmin();
  const [r, porFaseModelo, activas] = await Promise.all([
    getResumenNegocio(), getCostoPorFaseModelo().catch(() => []), contarConversacionesActivas(),
  ]);
  const whatsapp = r.porFase.find((f) => f.fase === 'whatsapp');
  const modelos = porFaseModelo.filter((m) => m.fase === 'whatsapp');

  return (
    <MarcoPagina
      area="Agentes"
      titulo={t('model_ops.agentes')}
      apoyo={t('agente_whatsapp.whatsapp_la_conversacion_completa_con_el')}
      acciones={<BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm">{t('agente_whatsapp.ver_conversaciones')}</BotonEnlace>}
    >
      <Aviso tono="info">{t('agente_whatsapp.el_whatsapp_del_producto_sigue_en')}</Aviso>

      <TiraCifras
        etiqueta="WhatsApp"
        items={[
          { etiqueta: t('agente_whatsapp.gastado_en_whatsapp'), valor: whatsapp ? whatsapp.costoUsd : 0, formato: 'usd', nota: t('agente_cuadre.costo_medido_en_llm_costo') },
          { etiqueta: t('agente_whatsapp.llamadas_de_whatsapp'), valor: whatsapp ? whatsapp.n : 0, formato: 'entero' },
          { etiqueta: t('whatsapp_infra.conversaciones_activas'), valor: activas, estado: activas === null ? 'error' : 'ok', formato: 'entero', href: '/admin/conversaciones' },
        ]}
      />

      <FilaTarjetas variante="6-6">
        <TarjetaFase
          titulo={t('agente_whatsapp.costo_por_modelo_whatsapp')}
          queHace={t('model_ops.lleva_la_conversacion_con_el_operador')}
          datos={whatsapp}
          modelos={modelos}
        />
        <Tarjeta
          titulo={t('agente_whatsapp.lo_que_falta_medir')}
          estado="vacio"
          mensaje={t('agente_whatsapp.entrega_y_ventana_de_24_horas')}
          detalle={t('agente_whatsapp.enviados_entregados_y_leidos_la_ventana')}
        />
      </FilaTarjetas>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'WhatsApp' };
