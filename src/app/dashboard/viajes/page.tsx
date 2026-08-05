import { Truck, MapPin, Wallet, Clock, BellOff, BellRing, CheckCheck, PhoneOff } from 'lucide-react';
import { getViajes, type ViajeRow } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { fechaMx } from '../formato';
import { confirmacionDeViaje, resumenConfirmacion } from '../confirmacion';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

/** Los TRES estatus que `viaje` de verdad admite — el dominio está fijado en
 *  la base (`viaje_estatus_dominio`, 0025_dominios_check.sql:112:
 *  `estatus in ('abierto','en_cuadre','liquidado')`), no es una convención.
 *  Un cuarto valor cae al `??` de abajo y sale con su clave cruda: nunca
 *  `undefined` ni una etiqueta inventada. */
const ESTATUS_VIAJE: Record<string, { label: string; estado: Estado }> = {
  abierto: { label: 'Abierto', estado: 'warn' },
  en_cuadre: { label: 'En cuadre', estado: 'warn' },
  liquidado: { label: 'Liquidado', estado: 'ok' },
};

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

  // "Sin liquidar" son los DOS estatus previos al cierre (`abierto` y
  // `en_cuadre`), no solo `abierto`: contar uno solo dejaría fuera justo los
  // viajes que están a media liquidación, que son los que el dueño persigue.
  const sinLiquidar = viajes?.filter((v) => v.estatus !== 'liquidado') ?? [];
  const abiertos = sinLiquidar.length;
  const anticipoAbierto = sinLiquidar.reduce((s, v) => s + v.anticipo, 0);
  const conPendientes = viajes?.filter((v) => v.intakePendientes > 0).length ?? 0;

  // UN SOLO RELOJ PARA TODA LA TABLA. Llamar `new Date()` dentro de cada fila
  // haría que dos viajes avisados en el mismo instante pudieran salir con
  // minutos distintos, y el jefe ordena por ese "hace cuánto".
  const ahora = new Date();
  const conf = resumenConfirmacion(viajes ?? [], ahora);

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
                  etiqueta="Viajes registrados" valor={viajes.length} formato="entero" />
                <KpiTile icono={<MapPin width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Abiertos (sin liquidar)" valor={abiertos} formato="entero" />
                {veDinero && (
                  <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Anticipo en viajes abiertos" valor={anticipoAbierto} formato="mxn" />
                )}
                <KpiTile icono={<Clock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con comprobantes en camino" valor={conPendientes} formato="entero"
                  nota="Fotos que el operador mandó y el agente todavía está procesando" />
              </div>
            </section>

            {/* ── Confirmación del chofer (mig. 0058) ───────────────────────
                Los cuatro conteos se calculan SOBRE LAS FILAS DE ABAJO, no con
                una consulta aparte: `getViajes` trae 100 como máximo, y un
                conteo por otro camino diría un número que no cuadra con lo que
                se ve. Por eso el subtítulo dice sobre cuántos está contando. */}
            {viajes.length > 0 && (
              <section className="px-5 pb-5 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Confirmación del chofer
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--faint)' }}>
                  Sobre los {viajes.length} viaje{viajes.length === 1 ? '' : 's'} listados abajo
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <KpiTile icono={<BellOff width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}
                    etiqueta="Sin avisar" valor={conf.sinAvisar} formato="entero"
                    destacar={conf.sinAvisar > 0}
                    nota="Viajes abiertos sin registro de que el aviso saliera. La escalación automática solo mira viajes avisados: estos no salen solos, hay que perseguirlos a mano." />
                  <KpiTile icono={<BellRing width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}
                    etiqueta="Esperando confirmación" valor={conf.esperando} formato="entero"
                    nota="Ya se les escribió por WhatsApp y todavía no contestan. La columna de abajo dice hace cuánto." />
                  <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ok)' }} />}
                    etiqueta="Confirmados" valor={conf.confirmados} formato="entero"
                    nota="El chofer contestó que sí. La hora exacta va en su renglón." />
                  <KpiTile icono={<PhoneOff width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}
                    etiqueta="Escalados" valor={conf.escalados} formato="entero"
                    nota="Pasó el plazo sin respuesta y ya se le avisó al jefe por WhatsApp. Aquí es donde se decide cambiar de chofer." />
                </div>
                {conf.sinRegistro > 0 && (
                  <p className="text-xs mt-3" style={{ color: 'var(--faint)' }}>
                    Otros {conf.sinRegistro} viaje{conf.sinRegistro === 1 ? '' : 's'} salen como «Sin registro»: ya
                    avanzaron a cuadre o quedaron liquidados y no guardan la confirmación. Las cuatro marcas existen
                    desde la migración 0058 (4-ago-2026); lo anterior a eso no se registró y no se puede reconstruir.
                  </p>
                )}
              </section>
            )}

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Todos los viajes
              </h2>
            </div>
            {viajes.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no hay viajes registrados para esta flota.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Folio</th>
                      <th className="px-5 py-2.5 font-medium">Ruta</th>
                      <th className="px-5 py-2.5 font-medium">Operador</th>
                      <th className="px-5 py-2.5 font-medium">Confirmación</th>
                      <th className="px-5 py-2.5 font-medium">Inicio</th>
                      {veDinero && <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>}
                      <th className="px-5 py-2.5 font-medium">Estatus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viajes.map((v) => {
                      const e = ESTATUS_VIAJE[v.estatus] ?? { label: v.estatus, estado: 'neutral' as Estado };
                      const c = confirmacionDeViaje(v, ahora);
                      return (
                        <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-5 py-3 font-medium">{v.folio}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                            {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? '—')}
                          </td>
                          <td className="px-5 py-3">{v.operadorNombre ?? '—'}</td>
                          <td className="px-5 py-3">
                            <StatusPill estado={c.estado}>{c.label}</StatusPill>
                            {/* La segunda línea es el DATO (la hora, el tiempo
                                transcurrido, los avisos), no un adorno: sin
                                ella "Esperando confirmación" no dice si van
                                veinte minutos o dos días. */}
                            <div className="text-xs mt-1" style={{ color: 'var(--faint)' }}>{c.detalle}</div>
                          </td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
                          {veDinero && <td className="px-5 py-3 text-right tabular">{v.anticipo > 0 ? mxn(v.anticipo) : '—'}</td>}
                          <td className="px-5 py-3">
                            <StatusPill estado={e.estado}>{e.label}</StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
