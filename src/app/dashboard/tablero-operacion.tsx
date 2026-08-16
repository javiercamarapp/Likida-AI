import { Truck, UserCog, Wrench, TriangleAlert, PackageCheck, CircleSlash } from 'lucide-react';
import { EstadoVacio, StatusPill, StatCard, type Estado } from '../admin/ui/kit';
import { TituloSeccion, PILL_ESTATUS } from './resumen-visual';
import { fechaMx } from '@/lib/formato';
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
//
// Restyleado el 14-ago-2026 a la anatomía de página del Resumen del dueño: los
// tres KPI de contexto pasaron de `KpiTile` a `StatCard` (la misma caja
// interna) para que las dos filas hablen el mismo lenguaje visual. Y
// llegó `TablaViajesOperacion`: la tabla de viajes recientes SIN pesos — la
// del dueño (`TablaViajes`, resumen-visual.tsx) enseña el anticipo, y esa
// columna es exactamente lo que este rol no ve.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los 6 números del tablero partidos en dos filas: arriba los TRES que piden
 * acción hoy (sin unidad, incidencias abiertas, sin evidencia de entrega);
 * abajo los tres de CONTEXTO (viajes activos, unidades disponibles, en
 * taller). Ninguno es dinero — ver el encabezado de `lib/likida/operacion.ts`.
 */
export function TableroCifras({ t }: { t: TableroOperacion }) {
  return (
    <div>
      <TituloSeccion>Estado de la operación</TituloSeccion>
      <div className="mt-2 flex flex-wrap gap-2.5 items-stretch">
        <div className="flex-1 min-w-[200px]">
          <StatCard icono={<CircleSlash width={17} height={17} strokeWidth={1.75} />}
            etiqueta="Sin unidad" valor={t.sinUnidad} formato="entero" />
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
      {/* `md:grid-cols-3` y NO `xl:grid-cols-6`: el ancho de la ventana no es
          el ancho de la grilla — sidebar + rail dejan ~1100px reales a 1440px
          de ventana, y a 6 columnas los rótulos salían cortados al 40%
          (auditoría 10, MEDIO; la prueba lo vigila). */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mt-2.5">
        <StatCard icono={<Truck width={17} height={17} strokeWidth={1.75} />}
          etiqueta="Viajes activos" valor={t.viajesActivos} formato="entero" />
        <StatCard icono={<UserCog width={17} height={17} strokeWidth={1.75} />}
          etiqueta="Unidades disponibles" valor={t.unidadesDisponibles} formato="entero" />
        <StatCard icono={<Wrench width={17} height={17} strokeWidth={1.75} />}
          etiqueta="En taller" valor={t.unidadesEnTaller} formato="entero" />
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

// ── Viajes recientes, versión SIN pesos ─────────────────────────────────────

/** Lo que la tabla del encargado imprime — copia estructural de `ViajeRow`
 *  SIN `anticipo` a propósito: un tipo que no recibe el peso no lo puede
 *  filtrar en pantalla, y ésa es la garantía que un `if` no da. El mapeo que
 *  lo deja fuera vive en `inicio-operacion.tsx`, en el servidor. */
export interface FilaViajeOperacion {
  id: string;
  folio: string;
  origen: string | null;
  destino: string | null;
  estatus: string;
  operadorNombre: string | null;
  fechaInicio: string | null;
}

/** Con 100 viajes cargados, la tarjeta del inicio enseña los más recientes y
 *  lo dice — la lista completa vive en /dashboard/viajes. */
const MAX_FILAS = 8;

/**
 * Los viajes recientes del ENCARGADO: folio/ruta, chofer, estatus y fecha.
 * NO es `TablaViajes` (resumen-visual.tsx): aquella trae la columna de
 * anticipo y el "Ver" al detalle de la LIQUIDACIÓN — las dos son pantallas
 * de dinero, y este rol no ve un peso. Tampoco se le pone un "Ver" por fila:
 * no existe un detalle de viaje sin dinero al cual llevar, y un link a un
 * 404 es peor que no ponerlo.
 */
export function TablaViajesOperacion({ viajes }: { viajes: FilaViajeOperacion[] }) {
  if (viajes.length === 0) {
    return (
      <div className="px-5 pb-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Aún no hay viajes registrados. En cuanto se abra el primero, aparece aquí.
        </p>
      </div>
    );
  }
  const visibles = viajes.slice(0, MAX_FILAS);
  const TH = 'etiqueta-mono text-left text-[10px] font-medium uppercase px-5 py-1.5';
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH} style={{ color: 'var(--muted)' }}>Viaje</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Chofer</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Estatus</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Inicio</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((v) => {
            const pill = PILL_ESTATUS[v.estatus] ?? { estado: 'neutral' as Estado, etiqueta: v.estatus };
            const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino;
            return (
              <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                <td className="px-5 py-2 min-w-0">
                  <div className="text-sm font-medium">{v.folio}</div>
                  {/* Sin origen/destino capturados no se inventa una ruta: un
                      guion dice "falta el dato", no "viaje sin ruta". */}
                  <div className="text-xs mt-0.5 truncate max-w-[260px]" style={{ color: 'var(--muted)' }}>{ruta ?? '—'}</div>
                </td>
                <td className="px-5 py-2 text-sm whitespace-nowrap">
                  {v.operadorNombre ?? <span style={{ color: 'var(--faint)' }}>Sin asignar</span>}
                </td>
                <td className="px-5 py-2"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                <td className="px-5 py-2 text-[13px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {viajes.length > MAX_FILAS && (
        <p className="text-[11px] px-5 pt-2" style={{ color: 'var(--faint)' }}>
          Los {MAX_FILAS} más recientes de {viajes.length} cargados.
        </p>
      )}
    </div>
  );
}
