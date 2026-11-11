import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getDatosMapa } from '@/lib/admin/prospectos-mapa';
import { AvisoCompacto, MarcoPagina } from '../../ui-v2/componentes';
import { Cerebro } from './cerebro';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * EL CEREBRO DE VENTAS — /admin/mapa-prospectos. El servidor solo abre la
 * puerta y entrega la primera foto de la cartera; el mundo entero (zoom,
 * calles, latido de 60 s) vive en el cliente (cerebro.tsx). Si la lectura
 * falló, `fallo: true` viaja al cliente y la pantalla lo dice — un mapa
 * vacío por avería no puede parecer un país sin prospectos.
 */
export default async function PaginaMapaProspectos() {
  const { t } = await getT('admin_sistema');
  const { userId } = await requireSuperadmin();
  const datos = await getDatosMapa({ auditoria: { actorId: userId } });
  return (
    <MarcoPagina titulo={t('mapa_prospectos.ventas')} apoyo={t('mapa_prospectos.tu_cartera_de_prospectos_en_un')}>
      {datos.fallo && (
        <AvisoCompacto
          tono="error"
          resumen={t('mapa_prospectos.la_cartera_no_se_pudo_leer')}
          mas={t('mapa_prospectos.cada_pagina_de_la_cartera_se')}
        />
      )}
      <Cerebro inicial={datos} />
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('mapa_prospectos.cerebro_de_ventas') };
}
