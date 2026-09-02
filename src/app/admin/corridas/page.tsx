import { Fragment } from 'react';
import Link from 'next/link';
import { ListTree, ArrowLeft } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  corridasFiltradas, ESTADOS_CORRIDA, type CorridaCruzada,
} from '@/lib/admin/corridas-cruzadas';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import { StatusPill, EstadoError, EstadoVacio, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { etiquetaInterruptor } from '../observabilidad/etiquetas';

export const dynamic = 'force-dynamic';

const PILL: Record<string, { estado: Estado; etiqueta: string }> = {
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Fallo' },
};

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

interface SearchParams { agente?: string; estado?: string; tenant?: string; p?: string }

/**
 * EL ÍNDICE DE CORRIDAS — /admin/corridas (16-ago-2026; filtros + paginación
 * ADM-10, auditoría 24).
 *
 * Existía solo /admin/corridas/[id], y DOS mapas del copiloto
 * (PANTALLA_POR_TOOL y PANTALLA_UI) mandaban al usuario a esta URL: el chip
 * de fuente de `traza_corrida` aterrizaba en un 404. El mapeo del 16-ago lo
 * encontró; esta página lo cerró con la MISMA fuente que ya pinta el
 * Inicio, pero sin filtro ni paginación — con 58 agentes despachando por
 * cron/webhook, triage de fallos ("¿qué le pasó a Cobranza hoy?") era
 * desplazarse a ojo entre filas de todo lo demás. `corridasFiltradas`
 * (lib/admin/corridas-cruzadas.ts) trae el mismo patrón de `?q=&p=` que
 * `buscarConversaciones` (ADM-1): filtro GET, sin JS, `count` real.
 */
export default async function IndiceCorridas({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const agente = (sp.agente ?? '').trim();
  const estado = (sp.estado ?? '').trim();
  const tenant = (sp.tenant ?? '').trim();
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1);
  const hayFiltro = agente !== '' || estado !== '' || tenant !== '';

  let resultado: { corridas: CorridaCruzada[]; pagina: number; paginas: number; total: number } | null = null;
  let error: string | null = null;
  try {
    resultado = await corridasFiltradas({
      agente: agente || undefined,
      estado: estado || undefined,
      tenantId: tenant || undefined,
      pagina,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : 'no se pudo leer';
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <BarraPagina icono={<ListTree className="w-5 h-5" style={{ color: 'var(--muted)' }} />} titulo="Corridas de agentes" />
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Cruzadas de todas las flotas. Cada una abre su traza completa.
      </p>
      <div className="mb-4">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--muted)' }}>
          <ArrowLeft className="w-4 h-4" /> Volver al inicio
        </Link>
      </div>

      <FormaFiltros agente={agente} estado={estado} tenant={tenant} hayFiltro={hayFiltro} />

      {error !== null && (
        <EstadoError mensaje={`No se pudieron leer las corridas — ${error}. La consulta falló; no es que no existan.`} />
      )}
      {resultado !== null && resultado.total === 0 && (
        <EstadoVacio>
          {hayFiltro
            ? 'Ninguna corrida coincide con el filtro.'
            : 'Aún no hay corridas. Cada corrida de un agente deja aquí su fila (0102); la primera aparecerá cuando un agente trabaje.'}
        </EstadoVacio>
      )}
      {resultado !== null && resultado.total > 0 && (
        <div>
          <div className="mb-2">
            <TituloSeccion>
              {`${resultado.total} corrida${resultado.total === 1 ? '' : 's'} — página ${resultado.pagina} de ${resultado.paginas}`}
            </TituloSeccion>
          </div>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  <th className="px-4 py-2.5">Agente</th>
                  <th className="px-4 py-2.5">Flota</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Inicio</th>
                  <th className="px-4 py-2.5">Duración</th>
                  <th className="px-4 py-2.5">Tareas</th>
                  <th className="px-4 py-2.5">Gasto</th>
                </tr>
              </thead>
              <tbody>
                {resultado.corridas.map((c) => {
                  const pill = PILL[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
                  return (
                    <Fragment key={c.id}>
                    {/* ADM-12 (auditoría 24, menor): `--line-2`/`--ink-2` no
                        existen (globals.css define `--line2`/`--ink2`) — los
                        bordes de esta tabla eran invisibles. */}
                    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/corridas/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--ink)' }}>
                          {etiquetaInterruptor(c.agente)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink2)' }}>{c.tenantNombre ?? 'Likida (negocio)'}</td>
                      <td className="px-4 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink2)' }}>{fechaHoraMx(c.inicio)}</td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink2)' }}>{duracion(c.duracionMs)}</td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink2)' }}>
                        {/* ambos o ninguno — la regla de la casa para tareas */}
                        {c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink2)' }}>
                        {/* `usd4` y no `usd`: una corrida cuesta céntimos de
                            céntimo, y `usd` los redondearía a US$0.00 — que se
                            lee «no gastó». NULL se pinta '—' con su porqué en
                            el title: no se midió, no es que saliera gratis. */}
                        {c.costoUsd === null
                          ? <span style={{ color: 'var(--faint)' }} title="Esta corrida no midió su gasto (costo_usd NULL). No significa que no gastara.">—</span>
                          : usd4(c.costoUsd)}
                      </td>
                    </tr>
                    {/* EL ERROR, EN LA LISTA. Estaba solo dentro de la traza, una
                        por una: con 50 corridas y tres fallos, encontrar el
                        motivo eran tres clics a ciegas. `agente_corrida.error`
                        ya guarda el motivo REDACTADO para una persona (0102:42),
                        no un stack, así que se puede pintar tal cual. */}
                    {c.error !== null && c.error !== '' && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-2.5 text-xs" style={{ color: 'var(--color-bad)' }}>
                          <span className="line-clamp-2" title={c.error}>{c.error}</span>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginador agente={agente} estado={estado} tenant={tenant} pagina={resultado.pagina} paginas={resultado.paginas} />
        </div>
      )}
    </div>
  );
}

/**
 * Formulario GET — sin JS, sin action de servidor. Mismo criterio que
 * `CajaBusqueda` de /admin/conversaciones (ADM-1): `agente`/`tenant` son
 * texto libre (id del catálogo/uuid) porque el catálogo de agentes tiene 58
 * entradas — un selector no cabría sin volverse la mitad de la pantalla;
 * `estado` sí es un `<select>` porque su dominio son tres valores fijos.
 */
function FormaFiltros({ agente, estado, tenant, hayFiltro }: {
  agente: string; estado: string; tenant: string; hayFiltro: boolean;
}) {
  return (
    <form className="card p-3 mb-4 flex flex-wrap items-center gap-2" method="GET">
      <input
        type="text" name="agente" defaultValue={agente} placeholder="Agente (id del catálogo)…"
        className="text-sm rounded-lg px-2.5 py-1.5 outline-none w-48"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
      />
      <select name="estado" defaultValue={estado}
        className="text-sm rounded-lg px-2.5 py-1.5 outline-none"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
        <option value="">Cualquier estado</option>
        {ESTADOS_CORRIDA.map((e) => (
          <option key={e} value={e}>{PILL_LABEL[e]}</option>
        ))}
      </select>
      <input
        type="text" name="tenant" defaultValue={tenant} placeholder="Flota (uuid del tenant)…"
        className="text-sm rounded-lg px-2.5 py-1.5 outline-none w-56"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
      />
      <button type="submit" className="text-xs px-2.5 py-1.5 rounded-lg hairline" style={{ color: 'var(--muted)' }}>
        Filtrar
      </button>
      {hayFiltro && (
        <Link href="/admin/corridas" className="text-xs px-2.5 py-1.5 rounded-lg hairline" style={{ color: 'var(--muted)' }}>
          Limpiar
        </Link>
      )}
    </form>
  );
}

const PILL_LABEL: Record<string, string> = { ok: 'OK', parcial: 'Parcial', fallo: 'Fallo' };

/** Paginador de corridas — enlaces GET simples, conservando los filtros. */
function Paginador({ agente, estado, tenant, pagina, paginas }: {
  agente: string; estado: string; tenant: string; pagina: number; paginas: number;
}) {
  if (paginas <= 1) return null;
  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (agente) qs.set('agente', agente);
    if (estado) qs.set('estado', estado);
    if (tenant) qs.set('tenant', tenant);
    qs.set('p', String(p));
    return `/admin/corridas?${qs.toString()}`;
  };
  return (
    <div className="flex items-center justify-between mt-3 text-xs" style={{ color: 'var(--muted)' }}>
      <span>Página {pagina} de {paginas}</span>
      <div className="flex gap-2">
        {pagina > 1 && <Link href={href(pagina - 1)} className="hairline rounded-lg px-2.5 py-1.5">Anterior</Link>}
        {pagina < paginas && <Link href={href(pagina + 1)} className="hairline rounded-lg px-2.5 py-1.5">Siguiente</Link>}
      </div>
    </div>
  );
}
