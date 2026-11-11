import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenProspectos, type ResumenProspectos } from '@/lib/admin/prospectos-mapa';
import { logger } from '@/lib/logger';
import { AvisoCompacto, MarcoPagina } from '../../ui-v2/componentes';
import { Cerebro } from './cerebro';

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
  await requireSuperadmin();
  let resumen: ResumenProspectos | null = null;
  try {
    resumen = await getResumenProspectos();
  } catch (e) {
    logger.error('mapa_prospectos.resumen', { err: e instanceof Error ? e.message : String(e) });
  }
  return (
    <MarcoPagina titulo="Ventas" apoyo="Tu cartera de prospectos en un mapa vivo: filtra, abre la ficha y contacta con el mensaje que redactó el agente.">
      {resumen === null && (
        <AvisoCompacto
          tono="error"
          resumen="La cartera no se pudo leer — lo que ves abajo está vacío POR ESO, no porque no haya prospectos."
          mas="Cada página de la cartera se reintenta una vez antes de rendirse. Si recargar no lo arregla, la base tardó más de lo que permite o rechazó la consulta; el detalle queda en el registro del servidor (mapa_prospectos.resumen)."
        />
      )}
      <Cerebro resumen={resumen} />
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Cerebro de ventas' };
