import { Map, Satellite, KeyRound } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getEstadoRastreo, type EstadoRastreo } from '@/lib/cuadra/comercial';
import { EstadoVacio, KpiTile, StatusPill } from '../../admin/ui/kit';
import { fechaMx } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * MAPA — el esquema de rastreo existe desde la 0050 (`posicion`, `geocerca`,
 * `rastreo_credencial`), pero LA CONEXIÓN NO. Mientras ninguna flota conecte su
 * proveedor, estas tablas están vacías y la pantalla invita a conectar en vez
 * de dibujar un mapa con coordenadas de ejemplo.
 *
 * EL TOKEN NO SE PINTA NUNCA. La consulta ni siquiera lo trae: solo
 * `token_ultimos4`. Un panel que enseña el token completo lo filtra a
 * cualquiera que mire la pantalla, y un token de rastreo no expira solo — y
 * además suele permitir MANDAR órdenes a la flota, no solo leer posiciones.
 */
export default async function MapaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/mapa');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/mapa', sp);
  const r = await safe<EstadoRastreo>(() => getEstadoRastreo(tenantId));

  const sinProveedor = !r || r.proveedores.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Map width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Mapa en vivo</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Dónde va cada unidad ahora mismo
          </span>
        </div>
      </header>

      {sinProveedor ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<Satellite width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">No hay rastreo conectado.</span> El sistema ya sabe
            guardar posiciones y geocercas, pero todavía no está enlazado a ningún proveedor, así
            que no tiene una sola coordenada que enseñar. Conecta el GPS que ya trae tu flota —
            Wialon, Traccar, Samsara, Geotab o Navixy— y el mapa se llena solo.
            <br /><br />
            <span style={{ color: 'var(--muted)' }}>
              Likida guarda el token cifrado y nunca lo vuelve a mostrar: en pantalla solo verás
              &quot;configurado&quot; y los últimos 4 dígitos.
            </span>
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiTile
                icono={<Satellite width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Unidades reportando"
                valor={r!.unidadesConPosicion}
              />
              <KpiTile
                icono={<KeyRound width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Proveedores configurados"
                valor={r!.proveedores.length}
                nota={r!.ultimaPosicion ? `Última posición: ${fechaMx(r!.ultimaPosicion)}` : 'Sin posiciones recibidas todavía'}
              />
            </div>
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Proveedores de rastreo
            </h2>
            <div className="flex flex-col gap-2">
              {r!.proveedores.map((p) => (
                <div key={p.proveedor} className="card p-3.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium capitalize">{p.proveedor}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      {p.ultimos4 ? `Token configurado ✓ ····${p.ultimos4}` : 'Sin token capturado'}
                      {p.probadaEn ? ` · probada el ${fechaMx(p.probadaEn)}` : ' · sin probar'}
                    </div>
                    {/* El error EXACTO del último intento. Sin él, una
                        integración rota se ve igual que una que nadie usó. */}
                    {p.ultimoError && (
                      <div className="text-xs mt-1" style={{ color: 'var(--bad)' }}>{p.ultimoError}</div>
                    )}
                  </div>
                  <StatusPill estado={p.activo && !p.ultimoError ? 'ok' : p.ultimoError ? 'bad' : 'neutral'}>
                    {p.activo ? (p.ultimoError ? 'con error' : 'activo') : 'inactivo'}
                  </StatusPill>
                </div>
              ))}
            </div>
          </div>

          {r!.unidadesConPosicion === 0 && (
            <div className="glass-panel p-5">
              <EstadoVacio>
                Hay proveedor configurado pero <span className="font-semibold">no ha llegado
                ninguna posición</span>. O el token no tiene permiso de lectura, o las unidades no
                están dadas de alta en el proveedor. Usa &quot;Probar conexión&quot; para ver el
                error exacto.
              </EstadoVacio>
            </div>
          )}
        </>
      )}
    </div>
  );
}
