import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { logger } from '@/lib/logger';
import { usd, numero } from '@/lib/formato';
import { sentryActivo } from '@/lib/observability/sentry';
import { correoConfigurado } from '@/lib/correo/enviar';
import { hookDeCorreoConfigurado } from '@/lib/correo/auth';
import { envHealth, faltantes } from '@/lib/env';
import { Disclosure, EstadoError, Tarjeta } from '../../ui-v2/componentes';
import { TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { TablaRenglones, type RenglonSistema } from '../renglon-sistema';
import '../sistema.css';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const dynamic = 'force-dynamic';

type Modelo = { modelo: string; n: number; costoUsd: number };

const columnasModelo = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<Modelo>[] => ([
  { id: 'modelo', titulo: t('integraciones.modelo'), principal: true, celda: (m) => m.modelo },
  { id: 'llamadas', titulo: t('integraciones.llamadas'), alinear: 'der', celda: (m) => numero(m.n, idioma) },
  { id: 'costo', titulo: t('integraciones.costo'), alinear: 'der', celda: (m) => usd(m.costoUsd) },
]);

/**
 * Integraciones — los conectores REALES de los que depende Likida hoy. Su estado está MEDIDO (variables de entorno y configuración de
 * cada servicio, las mismas mediciones que usa Salud: `sentryActivo()`, `correoConfigurado()`, `envHealth()`/`faltantes()`), o dice que
 * no se mide desde aquí. «Configurado» no es «vivo»: el rótulo dice exactamente lo medido; la prueba viva de la base está en Salud.
 *
 * Los proveedores de modelos no son una tarjeta genérica: se listan los modelos que YA corrieron (`resumen.porModelo`, la misma fuente
 * que usa el Inicio), no los que se PODRÍAN usar.
 */
export default async function IntegracionesPage() {
  const { t, idioma } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // Si la lectura de costos cae, los conectores siguen en pie: solo la lista de modelos se queda sin dato (y lo dice).
  const r = await getResumenNegocio().catch((e: unknown) => { logger.error('admin.integraciones.negocio', { err: e instanceof Error ? e.message : String(e) }); return null; });
  const salud = envHealth();
  const falta = faltantes();

  const conectores: RenglonSistema[] = [
    {
      titulo: t('integraciones.supabase'), marca: 'supabase', link: { href: 'https://supabase.com/dashboard', texto: t('salud_sistema.abrir_el_panel_de_supabase') },
      ...(salud.supabase
        ? { tono: 'ok' as const, etiqueta: t('integraciones.llaves_completas'), detalle: t('integraciones.la_base_de_datos_y_el') }
        : { tono: 'bad' as const, etiqueta: t('integraciones.faltan_llaves'), detalle: t('integraciones.la_base_de_datos_y_el_2'), arreglo: t('salud_sistema.faltan_variables', { lista: (falta.supabase ?? []).join(', ') }) }),
    },
    {
      titulo: t('integraciones.resend'), marca: 'resend', link: { href: 'https://resend.com/emails', texto: t('integraciones.abrir_resend') },
      ...(correoConfigurado()
        ? { tono: 'ok' as const, etiqueta: t('salud_sistema.configurado'), detalle: t('integraciones.correo_transaccional_avisos_invitaciones_y_con') }
        : { tono: 'warn' as const, etiqueta: t('salud_sistema.sin_configurar'), detalle: t('integraciones.ningun_correo_sale_esperado_en_local'), arreglo: t('salud_sistema.faltan_resend_api_key_o_resend') }),
    },
    {
      // EL CORREO DE ACCESO. Se mide el SECRETO, que es lo único que se puede medir desde aquí; que el enlace esté encendido vive en el panel
      // de Supabase. El caso caro es el inverso —encendido allá, sin secreto acá—: responde con error y nadie entra, así que se pinta en ámbar.
      titulo: t('integraciones.correo_de_acceso'), link: { href: 'https://supabase.com/dashboard/project/_/auth/hooks', texto: t('integraciones.abrir_los_enlaces_de_acceso_en') },
      ...(hookDeCorreoConfigurado()
        ? { tono: 'ok' as const, etiqueta: t('integraciones.secreto_configurado'), detalle: t('integraciones.el_enlace_de_acceso_sale_por') }
        : { tono: 'warn' as const, etiqueta: t('integraciones.sin_secreto'), detalle: t('integraciones.si_el_enlace_esta_encendido_en'), arreglo: t('integraciones.ver_docs_correo_de_acceso') }),
    },
    {
      titulo: t('integraciones.sentry'), marca: 'sentry', link: { href: 'https://sentry.io', texto: t('salud_sistema.abrir_sentry') },
      ...(sentryActivo()
        ? { tono: 'ok' as const, etiqueta: t('integraciones.dsn_configurado'), detalle: t('integraciones.registro_de_errores_en_produccion_que') }
        : { tono: 'bad' as const, etiqueta: t('integraciones.sin_dsn'), detalle: t('integraciones.los_errores_solo_quedan_en_el'), arreglo: t('salud_sistema.falta_el_dsn_de_sentry_en') }),
    },
    {
      // Desde adentro no hay nada que medir de Vercel: si esta página renderiza, Vercel ya contestó. Neutral honesto, nunca verde fijo.
      titulo: t('integraciones.vercel'), marca: 'vercel', link: { href: 'https://vercel.com/dashboard', texto: t('salud_sistema.abrir_el_panel_de_vercel') },
      tono: 'neutral', etiqueta: t('integraciones.sin_medir'), detalle: t('integraciones.hosting_y_despliegues_vercel_ya_lo'),
    },
    {
      titulo: t('integraciones.whatsapp_business_meta'), marca: 'whatsapp', link: { href: '/admin/whatsapp-infra', texto: t('integraciones.ir_a_whatsapp') },
      ...(salud.whatsapp
        ? { tono: 'ok' as const, etiqueta: t('integraciones.variables_completas'), detalle: t('integraciones.el_numero_sigue_siendo_el_de') }
        : { tono: 'bad' as const, etiqueta: t('integraciones.faltan_variables'), detalle: t('integraciones.la_conexion_con_whatsapp_no_tiene'), arreglo: t('salud_sistema.faltan_variables', { lista: (falta.whatsapp ?? []).join(', ') }) }),
    },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('integraciones.integraciones')}
      apoyo={t('integraciones.los_servicios_reales_de_los_que')}
      cifras={[{ etiqueta: t('integraciones.conectores'), valor: conectores.length, formato: 'entero', tono: conectores.some((c) => c.tono === 'bad') ? 'bad' : conectores.some((c) => c.tono === 'warn') ? 'warn' : 'ok' }]}
    >
      <Tarjeta titulo={t('integraciones.conectores')}>
        <TablaRenglones
          renglones={conectores} etiqueta={t('integraciones.conectores')}
          columnas={{ servicio: t('salud_sistema.col_servicio'), estado: t('salud_sistema.estado'), significa: t('salud_sistema.col_significa'), enlace: t('salud_sistema.col_enlace') }}
          rotuloArreglo={(n) => t('salud_sistema.como_arreglar_n', { n })}
        />
      </Tarjeta>

      {r === null ? (
        <EstadoError reintentar>{t('integraciones.no_se_pudo_leer_el_gasto')}</EstadoError>
      ) : (
        <Tarjeta titulo={t('integraciones.proveedores_de_modelos_de_ia')} estado={r.porModelo.length === 0 ? 'vacio' : 'ok'} mensaje={t('integraciones.sin_llamadas_registradas_todavia')} detalle={t('integraciones.aparecen_aqui_los_modelos_en_cuanto')}>
          <p className="adm-sis-nota">{t('integraciones.no_es_un_catalogo_de_lo')}</p>
          <TablaBase etiqueta={t('integraciones.modelos_que_ya_corrieron')} columnas={columnasModelo(t, idioma)} filas={r.porModelo} idFila={(m) => m.modelo} densa tarjetaMovil />
        </Tarjeta>
      )}

      <Disclosure titulo={t('compliance.lo_que_aun_no_existe_aqui')} resumen={t('integraciones.rotacion_de_llaves')}>
        <p className="adm-sis-nota">{t('integraciones.la_rotacion_de_llaves_de_api')}</p>
      </Disclosure>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('integraciones.integraciones') };
}
