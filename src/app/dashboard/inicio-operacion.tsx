import Link from 'next/link';
import { Send, UserCog, CircleSlash } from 'lucide-react';
import { saludo, fechaLarga, ahoraMs } from '@/lib/saludo';
import { getViajes, type ViajeRow } from '@/lib/likida/analytics';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, getIncidencias,
  type TableroOperacion, type ViajeSinAsignar, type CargaOperador, type IncidenciaRow,
} from '@/lib/likida/operacion';
import { EstadoVacio, StatusPill } from '../admin/ui/kit';
import { TableroCifras } from './despacho/vista';
import { TablaCarga } from './despacho/vista';
import AvanceCierre from './avance-cierre';
import { sufijoTenant } from './sufijo';
import { AvisoSinFlota } from './sin-flota';
import { fechaMx } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// LA CASA DEL ENCARGADO.
//
// El Resumen que existía es del DUEÑO: abre con lo que el motor señaló en
// pesos, los acreditables fiscales y el monto comprobado. El jefe de tráfico
// no ve nada de eso (visibilidad.ts), así que aterrizaba en una pantalla
// llena de huecos o, peor, en una que le enseñaba justo lo que no le toca.
//
// Esta es la misma casa con otro contenido: mismo encabezado, misma barra de
// avance, mismo marco — pero las seis cifras son de operación y lo que sigue
// abajo es lo que persigue en la mañana: qué no tiene chofer, quién trae
// cuánto, y qué se salió de lo normal. Cero pesos en toda la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

export async function InicioOperacion({
  tenantId, tenantNombre, nombre, sp, tenantExiste = true,
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  sp: { vista?: string; tenant?: string; rol?: string } | undefined;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Aquí importa más que en el Resumen del dueño: sin
   *  flota, "Todo lo que está en curso ya trae chofer" y "0 viajes activos"
   *  se leen como una mañana tranquila, no como una base vacía. */
  tenantExiste?: boolean;
}) {
  const sufijo = sufijoTenant(sp);
  const [tablero, sinAsignar, carga, incidencias, viajes] = await Promise.all([
    safe<TableroOperacion>(() => getTableroOperacion(tenantId)),
    safe<ViajeSinAsignar[]>(() => getViajesSinAsignar(tenantId)),
    safe<CargaOperador[]>(() => getCargaOperadores(tenantId)),
    safe<IncidenciaRow[]>(() => getIncidencias(tenantId)),
    safe<ViajeRow[]>(() => getViajes(tenantId)),
  ]);

  // Lo urgente arriba, y SOLO si hay fuego real. Una banda de alertas que
  // siempre dice algo entrena a ignorarla.
  const urgentes: string[] = [];
  if ((sinAsignar?.length ?? 0) > 0) {
    urgentes.push(`${sinAsignar!.length} viaje${sinAsignar!.length === 1 ? '' : 's'} sin chofer.`);
  }
  const vencidas = (incidencias ?? []).filter((i) => i.slaVencido);
  if (vencidas.length > 0) {
    urgentes.push(`${vencidas.length} incidencia${vencidas.length === 1 ? '' : 's'} pasada${vencidas.length === 1 ? '' : 's'} de su tiempo comprometido.`);
  }
  if ((tablero?.podPendientes ?? 0) > 0) {
    urgentes.push(`${tablero!.podPendientes} viaje${tablero!.podPendientes === 1 ? '' : 's'} en curso sin evidencia de entrega.`);
  }

  return (
    // EL SCROLL VIVE DENTRO DE CADA PANEL, no en la columna.
    //
    // Con la columna scrolleando, un panel más alto que la pantalla se
    // CORTA a media fila: se ve la mitad de un KPI y el borde redondeado
    // del recuadro nunca aparece, como si la interfaz estuviera rota.
    // Con `h-full` + `min-h-0` en la cadena, cada panel cierra donde debe y
    // lo que no cabe se desplaza adentro.
    <main className="flex flex-col gap-3">
      <div className="glass-panel overflow-hidden shrink-0">
        <div className="px-5 pt-3 pb-3 flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl tracking-tight truncate" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              {saludo()}, {nombre ?? 'jefe'}
            </h1>
            {/* Ya viene capitalizada de `fechaLarga()` — ver auditoría 10,
                BAJO (dashboard/page.tsx tiene la nota completa). */}
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted)' }}>{fechaLarga()}</p>
            {tenantNombre && (
              <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
                viendo como superadmin · {tenantNombre}
              </span>
            )}
            <AvanceCierre viajes={viajes ?? []} ahoraMs={ahoraMs()} />
          </div>

          {/* En vez de la cifra de dinero del dueño, la cifra que manda aquí:
              cuántos viajes están vivos ahora mismo. */}
          <div className="text-right shrink-0">
            <div className="text-4xl tracking-tight tabular" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              {tablero?.viajesActivos ?? '—'}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: 'var(--muted)' }}>
              Viajes activos
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
              Abiertos y en cuadre
            </div>
          </div>
        </div>

        {!tenantExiste && (
          <div className="px-5 pb-3"><AvisoSinFlota tenantId={tenantId} /></div>
        )}

        {urgentes.length > 0 && (
          <div className="px-5 pb-3 space-y-1.5">
            {urgentes.map((u) => (
              <div key={u} className="flex items-center gap-2 text-[13px]">
                <StatusPill estado="warn">Atender</StatusPill>
                <span>{u}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {tablero === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el estado de la operación.
        </div>
      ) : (
        <TableroCifras t={tablero} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <section className="glass-panel overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-center gap-2 shrink-0">
            <CircleSlash width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Sin asignar
            </h2>
            <Link href={`/dashboard/despacho${sufijo}`} className="ml-auto text-[11px] font-medium underline">
              Ir a despacho
            </Link>
          </div>
          {sinAsignar === null ? (
            <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la lista.</div>
          ) : sinAsignar.length === 0 ? (
            <div className="px-5 pb-4">
              <EstadoVacio icono={<Send width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Todo lo que está en curso ya trae chofer.
              </EstadoVacio>
            </div>
          ) : (
            <ul className="pb-3">
              {sinAsignar.map((v) => (
                <li key={v.id} className="px-5 py-2 border-t flex items-center gap-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <span className="font-medium">{v.folio ?? '—'}</span>
                  <span className="truncate" style={{ color: 'var(--muted)' }}>
                    {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? 'sin ruta')}
                  </span>
                  <span className="ml-auto shrink-0 text-[12px]" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-center gap-2 shrink-0">
            <UserCog width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Carga por operador
            </h2>
          </div>
          {carga === null ? (
            <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la carga.</div>
          ) : (
            <TablaCarga carga={carga} />
          )}
        </section>
      </div>
    </main>
  );
}
