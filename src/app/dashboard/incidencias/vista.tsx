import { TriangleAlert, Clock, Flame, CircleCheck } from 'lucide-react';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';
import type { IncidenciaRow } from '@/lib/cuadra/operacion';

// Bloques visuales de Incidencias, fuera de la página para poder mirar el
// render sin sesión (mismo motivo que en Despacho y Unidades).

const ICONO = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--ink)' } } as const;

/** Los dominios los fija la 0047. Un valor fuera sale con su clave cruda. */
export const TIPOS: Record<string, string> = {
  retraso: 'Retraso', averia: 'Avería', dano: 'Daño', faltante: 'Faltante', desvio: 'Desvío',
};
export const PRIORIDADES: Record<string, { label: string; estado: Estado }> = {
  alta: { label: 'Alta', estado: 'bad' },
  media: { label: 'Media', estado: 'warn' },
  baja: { label: 'Baja', estado: 'neutral' },
};
export const ESTADOS: Record<string, { label: string; estado: Estado }> = {
  abierta: { label: 'Abierta', estado: 'bad' },
  en_proceso: { label: 'En proceso', estado: 'warn' },
  resuelta: { label: 'Resuelta', estado: 'ok' },
};

export function CifrasIncidencias({ incidencias }: { incidencias: IncidenciaRow[] }) {
  const vivas = incidencias.filter((i) => i.estado !== 'resuelta');
  const resueltas = incidencias.filter((i) => i.estado === 'resuelta');
  // La mediana y no el promedio: una sola incidencia olvidada tres semanas
  // arrastra el promedio y hace ver mal un mes que estuvo bien. `null` si no
  // hay ninguna resuelta — un 0 se leería como "se resuelven al instante".
  const horas = resueltas.map((i) => i.horasAbierta).sort((a, b) => a - b);
  const mediana = horas.length === 0 ? null
    : horas.length % 2 ? horas[(horas.length - 1) / 2]
    : Math.round((horas[horas.length / 2 - 1] + horas[horas.length / 2]) / 2);

  return (
    <section className="glass-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Incidencias
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <KpiTile icono={<TriangleAlert {...ICONO} />} etiqueta="Abiertas" valor={vivas.length} formato="entero"
          destacar={vivas.length > 0} />
        <KpiTile icono={<Flame {...ICONO} />} etiqueta="Prioridad alta"
          valor={vivas.filter((i) => i.prioridad === 'alta').length} formato="entero" />
        <KpiTile icono={<Clock {...ICONO} />} etiqueta="Con SLA vencido"
          valor={vivas.filter((i) => i.slaVencido).length} formato="entero"
          nota="Solo cuenta las que tienen SLA pactado" />
        <KpiTile icono={<CircleCheck {...ICONO} />} etiqueta="Mediana de resolución"
          valor={mediana ?? 0} formato="entero"
          vacio={mediana === null ? 'sin incidencias resueltas todavía' : undefined}
          nota={mediana === null ? undefined : 'horas, mediana — no promedio'} />
      </div>
    </section>
  );
}

const CONTROL = { background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' } as const;

export function TablaIncidencias({
  incidencias, accionEstado,
}: {
  incidencias: IncidenciaRow[];
  accionEstado?: (fd: FormData) => Promise<void>;
}) {
  if (incidencias.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EstadoVacio icono={<CircleCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
          Sin incidencias registradas. Cuando algo se salga de lo normal —un retraso, una avería, un faltante— se
          levanta abajo y queda con dueño y reloj.
        </EstadoVacio>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Tipo</th>
            <th className="px-5 py-2.5 font-medium">Viaje</th>
            <th className="px-5 py-2.5 font-medium">Unidad</th>
            <th className="px-5 py-2.5 font-medium">Descripción</th>
            <th className="px-5 py-2.5 font-medium">Prioridad</th>
            <th className="px-5 py-2.5 font-medium">Reloj</th>
            <th className="px-5 py-2.5 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {incidencias.map((i) => {
            const p = PRIORIDADES[i.prioridad] ?? { label: i.prioridad, estado: 'neutral' as Estado };
            const e = ESTADOS[i.estado] ?? { label: i.estado, estado: 'neutral' as Estado };
            return (
              <tr key={i.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="px-5 py-3 font-medium">{TIPOS[i.tipo] ?? i.tipo}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{i.folio ?? '—'}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{i.numeroEconomico ?? '—'}</td>
                <td className="px-5 py-3 max-w-xs truncate" style={{ color: 'var(--muted)' }}>{i.descripcion ?? '—'}</td>
                <td className="px-5 py-3"><StatusPill estado={p.estado}>{p.label}</StatusPill></td>
                <td className="px-5 py-3">
                  {/* Sin SLA no está vencida, está SIN PACTAR — y así se dice,
                      porque pintarla en rojo acusaría de un incumplimiento
                      que nadie acordó. */}
                  {i.slaHoras === null ? (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{i.horasAbierta} h · sin SLA</span>
                  ) : (
                    <StatusPill estado={i.slaVencido ? 'bad' : 'ok'}>
                      {i.horasAbierta} h de {i.slaHoras} h
                    </StatusPill>
                  )}
                </td>
                <td className="px-5 py-3">
                  {accionEstado && i.estado !== 'resuelta' ? (
                    <form action={accionEstado} className="flex items-center gap-2">
                      <input type="hidden" name="incidenciaId" value={i.id} />
                      <select name="estado" defaultValue={i.estado} className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>
                        {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <button type="submit" className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>Mover</button>
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

export function FormaIncidencia({
  viajes, unidades, accion,
}: {
  viajes: Array<{ id: string; folio: string | null }>;
  unidades: Array<{ id: string; numeroEconomico: string }>;
  accion: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={accion} className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="tipo" className="text-xs" style={{ color: 'var(--muted)' }}>Tipo *</label>
        <select id="tipo" name="tipo" required defaultValue="retraso" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="prioridad" className="text-xs" style={{ color: 'var(--muted)' }}>Prioridad</label>
        <select id="prioridad" name="prioridad" defaultValue="media" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="viajeId" className="text-xs" style={{ color: 'var(--muted)' }}>Viaje</label>
        <select id="viajeId" name="viajeId" defaultValue="" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          <option value="">Sin viaje</option>
          {viajes.map((v) => <option key={v.id} value={v.id}>{v.folio ?? v.id.slice(0, 8)}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="unidadId" className="text-xs" style={{ color: 'var(--muted)' }}>Unidad</label>
        <select id="unidadId" name="unidadId" defaultValue="" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          <option value="">Sin unidad</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="slaHoras" className="text-xs" style={{ color: 'var(--muted)' }}>SLA (horas)</label>
        <input id="slaHoras" name="slaHoras" type="number" min="1" placeholder="Sin SLA"
          className="text-sm rounded-lg px-2.5 py-2" style={CONTROL} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="descripcion" className="text-xs" style={{ color: 'var(--muted)' }}>Qué pasó</label>
        <input id="descripcion" name="descripcion" placeholder="Se ponchó en la 57, km 210"
          className="text-sm rounded-lg px-2.5 py-2" style={CONTROL} />
      </div>
      <div className="flex items-end md:col-start-3 xl:col-start-6">
        <button type="submit" className="text-sm font-medium rounded-lg px-4 py-2 w-full"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}>
          Levantar
        </button>
      </div>
    </form>
  );
}
