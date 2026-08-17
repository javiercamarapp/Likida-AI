import { requireSuperadmin } from '@/lib/auth/guard';
import { getDatosMapa } from '@/lib/admin/prospectos-mapa';
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
  await requireSuperadmin();
  const datos = await getDatosMapa();
  return (
    <div>
      {datos.fallo && (
        <p className="mb-4 text-sm rounded-xl px-4 py-2.5" style={{ background: 'color-mix(in srgb, #b91c1c 10%, transparent)', color: '#b91c1c' }}>
          La cartera no se pudo leer — lo que ves abajo está vacío POR ESO, no porque no haya prospectos.
        </p>
      )}
      <Cerebro inicial={datos} />
    </div>
  );
}
