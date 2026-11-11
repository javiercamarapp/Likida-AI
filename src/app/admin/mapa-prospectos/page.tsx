import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenProspectos, type ResumenProspectos } from '@/lib/admin/prospectos-mapa';
import { logger } from '@/lib/logger';
import { AvisoCompacto } from '../../ui-v2/componentes';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { Cerebro } from './cerebro';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * EL CEREBRO DE VENTAS — /admin/mapa-prospectos. El servidor solo abre la puerta y entrega el RESUMEN de la cartera (conteos por
 * estado y por etapa: unos cuantos KB); el mundo entero (zoom, calles, filtros, latido) vive en el cliente (cerebro.tsx), que pide el
 * detalle de los prospectos por la ruta `/api/admin/mapa-prospectos` al montar, SIN bloquear la primera pintura. Antes la página
 * serializaba las 33 mil filas en el HTML (2.3 MB, 25 s de pantalla blanca). Si la lectura falló, la pantalla lo dice — un mapa vacío por
 * avería no puede parecer un país sin prospectos.
 *
 * La entrega de filas con teléfono y correo (la que deja rastro `prospectos.entregados` en la bitácora) ahora ocurre en esa ruta, que
 * sigue anotándola al entregar; esta página ya no entrega ninguna fila.
 */
export default async function PaginaMapaProspectos() {
  const { t } = await getT('admin_sistema');
  await requireSuperadmin();
  let resumen: ResumenProspectos | null = null;
  try {
    resumen = await getResumenProspectos();
  } catch (e) {
    logger.error('mapa_prospectos.resumen', { err: e instanceof Error ? e.message : String(e) });
  }
  return (
    <EsqueletoPanelCifras
      titulo={t('mapa_prospectos.ventas')} apoyo={t('mapa_prospectos.tu_cartera_de_prospectos_en_un')} variante="8-4"
      avisos={resumen === null ? (
        <AvisoCompacto
          tono="error"
          resumen={t('mapa_prospectos.la_cartera_no_se_pudo_leer')}
          mas={t('mapa_prospectos.cada_pagina_de_la_cartera_se')}
        />
      ) : null}
    >
      <Cerebro resumen={resumen} />
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('mapa_prospectos.ventas') };
}
