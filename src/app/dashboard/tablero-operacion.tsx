import { Truck, UserCog, Wrench, TriangleAlert, PackageCheck, CircleSlash } from 'lucide-react';
import { EstadoVacio, StatusPill, KpiTile, StatCard } from '../admin/ui/kit';
import { TituloSeccion } from './resumen-visual';
import type { TableroOperacion, CargaOperador } from '@/lib/likida/operacion';

// ═══════════════════════════════════════════════════════════════════════════
// Movido de `despacho/vista.tsx` el 10-ago-2026, cuando esa página se borró
// para el rediseño de "dueño de flota" desde cero. `TableroCifras` y
// `TablaCarga` sobreviven porque `inicio-operacion.tsx` (la casa del
// ENCARGADO en `/dashboard` — no una de las 17 páginas que se borraron) las
// usa para su propia versión sin dinero del tablero. Borrar despacho sin
// mover esto primero se hubiera llevado entre pies la vista de ese rol.
// `TablaSinAsignar`/`FormaAlta` NO se movieron: eran exclusivas de despacho
// (los formularios de asignar/crear viaje), inicio-operacion.tsx nunca las
// usó — se fueron con la página.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

/**
 * Los 6 números del tablero partidos en dos filas: arriba, como StatCard, los
 * TRES que piden acción hoy (por asignar, incidencias abiertas, sin
 * evidencia de entrega); abajo, en plano, los tres de CONTEXTO (viajes
 * activos, unidades disponibles, en taller).
 */
export function TableroCifras({ t }: { t: TableroOperacion }) {
  return (
    <div>
      <TituloSeccion>Estado de la operación</TituloSeccion>
      <div className="mt-3 flex flex-wrap gap-2.5 items-stretch">
        <div className="flex-1 min-w-[200px]">
          <StatCard icono={<CircleSlash width={17} height={17} strokeWidth={1.75} />}
            etiqueta="Por asignar" valor={t.porAsignar} formato="entero" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <StatCard icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} />}
            etiqueta="Incidencias abiertas" valor={t.incidenciasAbiertas} formato="entero" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <StatCard icono={<PackageCheck width={17} height={17} strokeWidth={1.75} />}
            etiqueta="Sin evidencia de entrega" valor={t.podPendientes} formato="entero" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        <KpiTile icono={<Truck {...ICONO} />} etiqueta="Viajes activos" valor={t.viajesActivos} formato="entero" />
        <KpiTile icono={<UserCog {...ICONO} />} etiqueta="Unidades disponibles" valor={t.unidadesDisponibles} formato="entero" />
        <KpiTile icono={<Wrench {...ICONO} />} etiqueta="En taller" valor={t.unidadesEnTaller} formato="entero" />
      </div>
    </div>
  );
}

export function TablaCarga({ carga }: { carga: CargaOperador[] }) {
  if (carga.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EstadoVacio icono={<UserCog width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no hay operadores en esta flota. Se dan de alta solos cuando el chofer manda su primer mensaje por
          WhatsApp.
        </EstadoVacio>
      </div>
    );
  }
  // La barra es proporcional AL QUE MÁS TRAE, no a un máximo inventado: con
  // dos viajes cada uno, nadie está "al 20% de su capacidad" — esa capacidad
  // no existe en ningún lado y ponerla sería inventar una cifra.
  const cargaMax = Math.max(1, ...carga.map((c) => c.enCurso));
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Operador</th>
            <th className="px-5 py-2.5 font-medium">Carga</th>
            <th className="px-5 py-2.5 font-medium text-right">En curso</th>
            <th className="px-5 py-2.5 font-medium text-right">Sin POD</th>
            <th className="px-5 py-2.5 font-medium text-right">Incidencias</th>
            <th className="px-5 py-2.5 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {carga.map((c) => (
            <tr key={c.operadorId} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="px-5 py-3 font-medium">{c.nombre}</td>
              <td className="px-5 py-3 w-40">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${Math.round((c.enCurso / cargaMax) * 100)}%`, background: 'var(--marca)' }} />
                </div>
              </td>
              <td className="px-5 py-3 text-right tabular">{c.enCurso}</td>
              <td className="px-5 py-3 text-right tabular">{c.sinPod > 0 ? c.sinPod : '—'}</td>
              <td className="px-5 py-3 text-right tabular">{c.incidenciasAbiertas > 0 ? c.incidenciasAbiertas : '—'}</td>
              <td className="px-5 py-3">
                <StatusPill estado={c.activo ? 'ok' : 'neutral'}>{c.activo ? 'Activo' : 'Inactivo'}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
