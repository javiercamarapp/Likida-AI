import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getDatosMapa } from '@/lib/admin/prospectos-mapa';
import { AvisoCompacto } from '../../ui-v2/componentes/aviso';
import { Cerebro } from './cerebro';

export const dynamic = 'force-dynamic';

/**
 * EL CEREBRO DE VENTAS — /admin/mapa-prospectos. El servidor solo abre la
 * puerta y entrega la primera foto de la cartera; el mundo entero (zoom,
 * calles, latido de 60 s) vive en el cliente (cerebro.tsx). Si la lectura
 * falló, `fallo: true` viaja al cliente y la pantalla lo dice — un mapa
 * vacío por avería no puede parecer un país sin prospectos.
 */
export default async function PaginaMapaProspectos() {
  const { userId } = await requireSuperadmin();
  const datos = await getDatosMapa({ auditoria: { actorId: userId } });
  return (
    <div>
      {datos.fallo && (
        <AvisoCompacto
          tono="error"
          className="mb-4"
          resumen="La cartera no se pudo leer — lo que ves abajo está vacío POR ESO, no porque no haya prospectos."
          mas="Cada página de la cartera se reintenta una vez antes de rendirse. Si recargar no lo arregla, la base tardó más de lo que permite o rechazó la consulta; el detalle queda en el registro del servidor (mapa_prospectos.leer)."
        />
      )}
      <Cerebro inicial={datos} />
    </div>
  );
}

export const metadata: Metadata = { title: 'Cerebro de ventas' };
