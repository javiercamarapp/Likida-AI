import { Truck, UserCog, Wrench, TriangleAlert, PackageCheck, CircleSlash } from 'lucide-react';
import { KpiTile, EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { fechaMx } from '../formato';
import type { TableroOperacion, ViajeSinAsignar, CargaOperador, UnidadRow } from '@/lib/cuadra/operacion';

// ═══════════════════════════════════════════════════════════════════════════
// Los tres bloques visuales del despacho, separados de la página.
//
// No es arquitectura por gusto: la página es un Server Component que empieza
// por `resolverTenantEfectivo`, así que NO se puede renderizar sin sesión — y
// CLAUDE.md pide mirar el render, no solo medirlo. Con los bloques aquí, el
// preview temporal importa EL MISMO componente que ve el encargado en vez de
// una copia con los mismos estilos, que solo se verificaría a sí misma.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

export function TableroCifras({ t }: { t: TableroOperacion }) {
  return (
    <section className="glass-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Estado de la operación
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3">
        <KpiTile icono={<Truck {...ICONO} />} etiqueta="Viajes activos" valor={t.viajesActivos} formato="entero" />
        <KpiTile icono={<CircleSlash {...ICONO} />} etiqueta="Por asignar" valor={t.porAsignar} formato="entero"
          destacar={t.porAsignar > 0} nota="Sin chofer y todavía sin liquidar" />
        <KpiTile icono={<UserCog {...ICONO} />} etiqueta="Unidades disponibles" valor={t.unidadesDisponibles} formato="entero" />
        <KpiTile icono={<Wrench {...ICONO} />} etiqueta="En taller" valor={t.unidadesEnTaller} formato="entero" />
        <KpiTile icono={<TriangleAlert {...ICONO} />} etiqueta="Incidencias abiertas" valor={t.incidenciasAbiertas} formato="entero" />
        <KpiTile icono={<PackageCheck {...ICONO} />} etiqueta="Sin evidencia de entrega" valor={t.podPendientes}
          formato="entero" nota="Viajes en curso sin POD subido" />
      </div>
    </section>
  );
}

const CONTROL = {
  background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)',
} as const;

export function TablaSinAsignar({
  viajes, operadores, unidadesLibres, accion,
}: {
  viajes: ViajeSinAsignar[];
  operadores: Array<{ id: string; nombre: string }>;
  unidadesLibres: UnidadRow[];
  accion: (fd: FormData) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Folio</th>
            <th className="px-5 py-2.5 font-medium">Ruta</th>
            <th className="px-5 py-2.5 font-medium">Inicio</th>
            <th className="px-5 py-2.5 font-medium">Asignar a</th>
          </tr>
        </thead>
        <tbody>
          {viajes.map((v) => (
            <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="px-5 py-3 font-medium">{v.folio ?? '—'}</td>
              <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? '—')}
              </td>
              <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
              <td className="px-5 py-3">
                <form action={accion} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="viajeId" value={v.id} />
                  <select name="operadorId" required defaultValue=""
                    className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>
                    <option value="" disabled>Chofer…</option>
                    {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                  <select name="unidadId" defaultValue="" className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>
                    <option value="">Sin unidad</option>
                    {unidadesLibres.map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}</option>)}
                  </select>
                  <button type="submit" className="text-sm font-medium rounded-lg px-3 py-1.5"
                    style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                    Despachar
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

export function FormaAlta({
  operadores, unidadesLibres, accion,
}: {
  operadores: Array<{ id: string; nombre: string }>;
  unidadesLibres: UnidadRow[];
  accion: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={accion} className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <Campo nombre="folio" etiqueta="Folio" placeholder="VJ-2026-0001" />
      <Campo nombre="origen" etiqueta="Origen" placeholder="Guadalajara" />
      <Campo nombre="destino" etiqueta="Destino" placeholder="Monterrey" />
      <Campo nombre="fechaInicio" etiqueta="Inicio" tipo="date" />
      <Campo nombre="anticipo" etiqueta="Anticipo (MXN)" tipo="number" placeholder="0" />
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Chofer</label>
        <select name="operadorId" defaultValue="" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          <option value="">Asignar después</option>
          {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Unidad</label>
        <select name="unidadId" defaultValue="" className="text-sm rounded-lg px-2.5 py-2" style={CONTROL}>
          <option value="">Sin unidad</option>
          {unidadesLibres.map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <button type="submit" className="text-sm font-medium rounded-lg px-4 py-2 w-full"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          Crear viaje
        </button>
      </div>
    </form>
  );
}

function Campo({ nombre, etiqueta, tipo = 'text', placeholder }: {
  nombre: string; etiqueta: string; tipo?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={nombre} className="text-xs" style={{ color: 'var(--muted)' }}>{etiqueta}</label>
      <input id={nombre} name={nombre} type={tipo} placeholder={placeholder}
        step={tipo === 'number' ? '0.01' : undefined} min={tipo === 'number' ? '0' : undefined}
        className="text-sm rounded-lg px-2.5 py-2" style={CONTROL} />
    </div>
  );
}
