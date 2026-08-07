import { Truck, CircleCheck, Route, Wrench, FileWarning } from 'lucide-react';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';
import { numero } from '@/lib/formato';
import type { UnidadRow } from '@/lib/likida/operacion';

// Los bloques visuales de Unidades, fuera de la página por la misma razón que
// en Despacho: la página no se renderiza sin sesión, y el render hay que
// mirarlo. El preview temporal importa ESTO, no una copia.

const ICONO = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

/** Los cuatro estados de `unidad_estado_dominio` (0047). Un quinto valor sale
 *  con su clave cruda en vez de caer a un `undefined` o a una etiqueta
 *  inventada — mismo criterio que ESTATUS_VIAJE en viajes/page.tsx. */
const ESTADO_UNIDAD: Record<string, { label: string; estado: Estado }> = {
  disponible: { label: 'Disponible', estado: 'ok' },
  en_ruta: { label: 'En ruta', estado: 'neutral' },
  taller: { label: 'En taller', estado: 'warn' },
  baja: { label: 'Baja', estado: 'neutral' },
};

export function CifrasUnidades({ unidades }: { unidades: UnidadRow[] }) {
  const activas = unidades.filter((u) => u.activo);
  // "Vencido" es estrictamente < 0. Un papel que vence HOY (0 días) todavía
  // sirve hoy; contarlo como vencido haría que el número no cuadre con lo que
  // el encargado ve en la fila.
  const vencidos = activas.filter((u) => u.diasAlVencimiento !== null && u.diasAlVencimiento < 0).length;
  return (
    <section className="glass-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Estado de la flota
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
        <KpiTile icono={<Truck {...ICONO} />} etiqueta="Unidades activas" valor={activas.length} formato="entero" />
        <KpiTile icono={<CircleCheck {...ICONO} />} etiqueta="Disponibles"
          valor={activas.filter((u) => u.estado === 'disponible').length} formato="entero" />
        <KpiTile icono={<Route {...ICONO} />} etiqueta="En ruta"
          valor={activas.filter((u) => u.estado === 'en_ruta').length} formato="entero" />
        <KpiTile icono={<Wrench {...ICONO} />} etiqueta="En taller"
          valor={activas.filter((u) => u.estado === 'taller').length} formato="entero" />
        <KpiTile icono={<FileWarning {...ICONO} />} etiqueta="Con papel vencido" valor={vencidos} formato="entero"
          destacar={vencidos > 0} nota="Póliza, permiso SICT o verificación" />
      </div>
    </section>
  );
}

/** Cómo se pinta el vencimiento más próximo de una unidad. */
function papel(u: UnidadRow): { estado: Estado; texto: string } {
  if (u.diasAlVencimiento === null) return { estado: 'neutral', texto: 'Sin capturar' };
  const d = u.diasAlVencimiento;
  if (d < 0) return { estado: 'bad', texto: `${u.queVence}: vencido hace ${Math.abs(d)} d` };
  if (d === 0) return { estado: 'warn', texto: `${u.queVence}: vence hoy` };
  if (d <= 30) return { estado: 'warn', texto: `${u.queVence}: ${d} d` };
  return { estado: 'ok', texto: `${u.queVence}: ${d} d` };
}

export function TablaUnidades({
  unidades, accionEstado,
}: {
  unidades: UnidadRow[];
  /** `undefined` cuando el rol no puede mover el estado: entonces la columna
   *  se pinta como texto, no como un control muerto. */
  accionEstado?: (fd: FormData) => Promise<void>;
}) {
  if (unidades.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no hay unidades dadas de alta. Da de alta la primera abajo — con el número económico basta, el
          resto se puede llenar después.
        </EstadoVacio>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Económico</th>
            <th className="px-5 py-2.5 font-medium">Placas</th>
            <th className="px-5 py-2.5 font-medium">Unidad</th>
            <th className="px-5 py-2.5 font-medium text-right">Km</th>
            <th className="px-5 py-2.5 font-medium">Papeles</th>
            <th className="px-5 py-2.5 font-medium text-right">Taller</th>
            <th className="px-5 py-2.5 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {unidades.map((u) => {
            const e = ESTADO_UNIDAD[u.estado] ?? { label: u.estado, estado: 'neutral' as Estado };
            const p = papel(u);
            return (
              <tr key={u.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="px-5 py-3 font-medium">{u.numeroEconomico}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{u.placas ?? '—'}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                  {[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || '—'}
                </td>
                {/* Sin km capturados va un guion, no un 0: un 0 se lee como
                    "unidad nueva sin rodar", que es una afirmación. */}
                <td className="px-5 py-3 text-right tabular">
                  {u.kmActual === null ? '—' : numero(u.kmActual)}
                </td>
                <td className="px-5 py-3"><StatusPill estado={p.estado}>{p.texto}</StatusPill></td>
                <td className="px-5 py-3 text-right tabular">{u.ordenesAbiertas > 0 ? u.ordenesAbiertas : '—'}</td>
                <td className="px-5 py-3">
                  {accionEstado ? (
                    <form action={accionEstado} className="flex items-center gap-2">
                      <input type="hidden" name="unidadId" value={u.id} />
                      <select name="estado" defaultValue={u.estado}
                        className="text-sm rounded-lg px-2.5 py-1.5"
                        style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                        {Object.entries(ESTADO_UNIDAD).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                      <button type="submit" className="text-sm rounded-lg px-2.5 py-1.5"
                        style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                        Mover
                      </button>
                    </form>
                  ) : (
                    <StatusPill estado={e.estado}>{e.label}</StatusPill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FormaUnidad({ accion }: { accion: (fd: FormData) => Promise<void> }) {
  const control = { background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' } as const;
  return (
    <form action={accion} className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {[
        { n: 'numeroEconomico', e: 'Número económico *', p: 'C2-08', req: true },
        { n: 'placas', e: 'Placas', p: 'ABC-123-A' },
        { n: 'marca', e: 'Marca', p: 'Freightliner' },
        { n: 'modelo', e: 'Modelo', p: 'Cascadia' },
      ].map(({ n, e, p, req }) => (
        <div key={n} className="flex flex-col gap-1">
          <label htmlFor={n} className="text-xs" style={{ color: 'var(--muted)' }}>{e}</label>
          <input id={n} name={n} placeholder={p} required={req}
            className="text-sm rounded-lg px-2.5 py-2" style={control} />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label htmlFor="anio" className="text-xs" style={{ color: 'var(--muted)' }}>Año</label>
        <input id="anio" name="anio" type="number" min="1950" max="2100" placeholder="2021"
          className="text-sm rounded-lg px-2.5 py-2" style={control} />
      </div>
      <div className="flex items-end">
        <button type="submit" className="text-sm font-medium rounded-lg px-4 py-2 w-full"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          Dar de alta
        </button>
      </div>
    </form>
  );
}
