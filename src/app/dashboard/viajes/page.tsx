import { Truck, MapPin, Wallet, Clock } from 'lucide-react';
import { getViajes, contarViajes, getViajesSinLiquidar, type ViajeRow } from '@/lib/likida/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { KpiTile, EstadoVacio } from '../../admin/ui/kit';
import { TiraConfirmacion, TablaViajes } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Viajes (PASO 12 del documento) — la tabla real de `viaje`.
 *
 * El PASO 12 pide columnas de unidad, POD y margen por viaje: NINGUNA existe
 * en el esquema (`viaje` no tiene `unidad_id`, no hay tabla de vehículos, no
 * hay campo de POD, y no hay ingreso registrado contra el cual calcular un
 * margen). Enseñar esas columnas vacías haría ver el producto más completo y
 * la pantalla más inútil, así que se dice abajo qué falta y por qué.
 *
 * LA COLUMNA "CONFIRMACIÓN" ES LO CONTRARIO: el dato SÍ existía y no se veía.
 * La migración 0058 le puso a `viaje` cuatro marcas —avisado, aceptado,
 * escalado y cuántas veces se insistió— y hasta aquí ninguna salía en pantalla,
 * así que el jefe no tenía dónde enterarse de que un chofer confirmó ni, peor,
 * de que a uno nunca se le avisó. La lectura de las cuatro marcas vive en
 * `dashboard/confirmacion.ts`, pura y probada; esta página solo la pinta.
 */
export default async function ViajesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/viajes', sp);
  // ESTA PÁGINA ES ÁREA `operacion`, ASÍ QUE EL ENCARGADO ENTRA. El anticipo es
  // dinero y la matriz de roles (0044) no se lo da: el despacho ya lo dice
  // explícito —"el anticipo se captura porque el motor lo necesita, pero no se
  // lista ni se suma en ninguna columna"— y aquí sí se listaba y se sumaba.
  const veDinero = puedeVerArea(rol, 'dinero');
  const viajes = await safe<ViajeRow[]>(() => getViajes(tenantId));

  // EL TOTAL SE CUENTA, NO SE DEDUCE DE LA LISTA. `getViajes` trae 100, y el
  // KPI enseñaba `viajes.length` como si fuera el total: con los 8 viajes de
  // prueba coincidían, pero a 30 viajes diarios el panel diría "100" para
  // siempre a partir del cuarto día. Un rótulo que dice "registrados" tiene que
  // contar los registrados.
  const [totalViajes, abiertosReales] = await Promise.all([
    safe<number | null>(() => contarViajes(tenantId)),
    safe<Array<{ id: string; anticipo: number }>>(() => getViajesSinLiquidar(tenantId)),
  ]);
  const totalAbiertos = abiertosReales ? abiertosReales.length : null;

  // "Sin liquidar" son los DOS estatus previos al cierre (`abierto` y
  // `en_cuadre`), no solo `abierto`: contar uno solo dejaría fuera justo los
  // viajes que están a media liquidación, que son los que el dueño persigue.
  // La suma sale de TODOS los viajes sin liquidar, no de la ventana de 100.
  // Si la consulta falla se cae a la ventana, que subestima — pero `safe` ya
  // dejó el rastro y una cifra corta se nota; una cifra inventada, no.
  const sinLiquidar = viajes?.filter((v) => v.estatus !== 'liquidado') ?? [];
  const anticipoAbierto = (abiertosReales ?? sinLiquidar).reduce((s, v) => s + v.anticipo, 0);
  const conPendientes = viajes?.filter((v) => v.intakePendientes > 0).length ?? 0;

  // UN SOLO RELOJ PARA TODA LA TABLA. Llamar `new Date()` dentro de cada fila
  // haría que dos viajes avisados en el mismo instante pudieran salir con
  // minutos distintos, y el jefe ordena por ese "hace cuánto".
  const ahora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Truck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Viajes</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Cada viaje, su operador y su anticipo</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {viajes === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado de viajes.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Estado de la operación
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Viajes registrados" valor={totalViajes ?? 0} formato="entero"
                  vacio={totalViajes === null ? 'No se pudo contar' : undefined} />
                <KpiTile icono={<MapPin width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Abiertos (sin liquidar)" valor={totalAbiertos ?? 0} formato="entero"
                  vacio={totalAbiertos === null ? 'No se pudo contar' : undefined} />
                {veDinero && (
                  <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Anticipo en viajes abiertos" valor={anticipoAbierto} formato="mxn" />
                )}
                <KpiTile icono={<Clock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con comprobantes en camino" valor={conPendientes} formato="entero"
                  nota="Fotos que el operador mandó y el agente todavía está procesando" />
              </div>
            </section>

            {viajes.length > 0 && <TiraConfirmacion viajes={viajes} ahora={ahora} />}

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Todos los viajes
              </h2>
            </div>
            <TablaViajes viajes={viajes} veDinero={veDinero} ahora={ahora} />

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                Unidad asignada, POD (evidencia de entrega) y margen por viaje no aparecen porque no existen en el
                sistema: `viaje` no guarda unidad, no hay tabla de vehículos, no hay campo de POD, y no se registra
                el ingreso del flete contra el cual calcular un margen. Crear y asignar viajes desde aquí (hoy se
                hace por WhatsApp), el estimador de casetas+combustible y OTIF necesitan esas mismas piezas.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
