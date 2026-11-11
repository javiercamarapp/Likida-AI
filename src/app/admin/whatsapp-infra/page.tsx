import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getConversacionesActivas, contarConversacionesActivas, TOPE_CONVERSACIONES } from '@/lib/admin/negocio';
import { Smartphone, Info } from 'lucide-react';
import { EstadoVacio, Tarjeta } from '../../ui-v2/componentes';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { FilaConversacion } from '../conversaciones/hilo';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

export const dynamic = 'force-dynamic';

/** Lo que de verdad falta para tratar esto como infraestructura de la Meta
 *  WhatsApp Business API a escala — ninguno de estos existe hoy, y no se
 *  simula: Likida usa UN número para el flujo del bot, sin pool, sin
 *  plantillas administradas, sin métricas de entrega. */
const fueraDeAlcance = (t: TSistema = T_SISTEMA_ES) => ([
  t('whatsapp_infra.quality_rating_por_numero'),
  t('whatsapp_infra.pool_de_numeros_con_rotacion_balanceo'),
  t('whatsapp_infra.plantillas_estado_de_aprobacion_categoria_deliverability'),
  t('whatsapp_infra.entrega_enviados_entregados_leidos'),
  t('whatsapp_infra.ventana_de_24h'),
  t('whatsapp_infra.opt_ins_opt_outs'),
]);

/**
 * WhatsApp Infra — el número real que opera el bot de producción es UNO
 * solo, no un pool. No hay el dígito real disponible en este código (vive
 * en la config de Meta, no en una tabla), así que esta página lo describe
 * en vez de inventarlo. Lo único con datos reales aquí son las
 * conversaciones (`wa_conversacion`, vía `getConversacionesActivas`) — no
 * existe todavía una página dedicada de Conversaciones bajo /admin, así
 * que en vez de enlazar a algo que no existe, se enseña la lista completa
 * aquí mismo (mismo patrón que la sección "Conversaciones de WhatsApp" de
 * Inicio).
 *
 * Marco de página único (`MarcoPagina`). Las mitades vacías siguen vacías y lo dicen.
 */
export default async function WhatsappInfraPage() {
  const { t } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // FE-9: el KPI decía "Conversaciones activas: N" con el N del TOPE (20).
  const [conversaciones, total] = await Promise.all([
    getConversacionesActivas(), contarConversacionesActivas(),
  ]);
  const recortado = total !== null && total > conversaciones.length;

  return (
    /* El conteo REAL de `wa_conversacion` (count exact, FE-9). Antes esta tarjeta enseñaba el tamaño de la página —20— con una nota
       que confesaba el tope: una cifra de infraestructura que se topa en 20 no sirve para dimensionar infraestructura. */
    <EsqueletoPanelCifras
      titulo={t('whatsapp_infra.whatsapp_infra')}
      etiquetaCifras={t('whatsapp_infra.conversaciones_de_whatsapp')}
      cifras={[
        {
          etiqueta: t('whatsapp_infra.conversaciones_activas'), valor: total, formato: 'entero',
          estado: total === null ? 'vacio' : 'ok',
          mensaje: t('whatsapp_infra.no_se_pudo_contar'),
          nota: t('whatsapp_infra.filas_vivas_en_wa_conversacion_ventana'),
        },
        { etiqueta: t('whatsapp_infra.kpi_mostradas'), valor: conversaciones.length, formato: 'entero' },
        { etiqueta: t('whatsapp_infra.kpi_numeros'), valor: 1, formato: 'entero', nota: t('whatsapp_infra.kpi_numeros_nota') },
        { etiqueta: t('whatsapp_infra.kpi_sin_integrar'), valor: fueraDeAlcance(t).length, formato: 'entero', tono: 'warn' },
      ]}
    >

      <Tarjeta titulo={t('whatsapp_infra.numero_operativo')}>
        <div className="flex items-center gap-2.5 rounded-lg border border-[var(--line2)] bg-[var(--surface)] px-3 py-2.5">
          <Smartphone width={15} height={15} strokeWidth={1.75} className="shrink-0 text-muted" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{t('whatsapp_infra.1_numero_operativo')}</div>
            <div className="mt-0.5 text-xs text-muted">{t('whatsapp_infra.el_que_usa_el_bot_de')}</div>
          </div>
        </div>
        <p className="m-0 mt-2 text-xs text-muted">{t('whatsapp_infra.el_digito_real_no_vive_en')}</p>
      </Tarjeta>

      <Tarjeta titulo={recortado ? t('whatsapp_infra.conversaciones_las_mas_recientes_de', { topeConversaciones: TOPE_CONVERSACIONES, total }) : t('whatsapp_infra.conversaciones')}>
        <div id="conversaciones" className="scroll-mt-24">
          {conversaciones.length === 0 ? (
            <p className="m-0 text-sm text-muted">{t('whatsapp_infra.sin_conversaciones_activas')}</p>
          ) : (
            <div className="space-y-1.5">
              {conversaciones.map((c) => <FilaConversacion key={`${c.tenantId ?? 'sin-flota'}-${c.telefono}`} c={c} />)}
            </div>
          )}
        </div>
      </Tarjeta>

      <Tarjeta titulo={t('whatsapp_infra.fuera_de_alcance_hoy')}>
        <EstadoVacio titulo={t('whatsapp_infra.sin_integrar')} icono={Info} contenido>{t('whatsapp_infra.ninguno_de_estos_existe_todavia_en')}</EstadoVacio>
        <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm text-muted">
          {fueraDeAlcance(t).map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('whatsapp_infra.whatsapp_infra') };
}
