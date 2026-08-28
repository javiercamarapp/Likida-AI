import { Fragment } from 'react';
import Link from 'next/link';
import { ListTree, ArrowLeft } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { corridasRecientes, type CorridaCruzada } from '@/lib/admin/corridas-cruzadas';
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

/**
 * EL ÍNDICE DE CORRIDAS — /admin/corridas (16-ago-2026).
 *
 * Existía solo /admin/corridas/[id], y DOS mapas del copiloto
 * (PANTALLA_POR_TOOL y PANTALLA_UI) mandaban al usuario a esta URL: el chip
 * de fuente de `traza_corrida` aterrizaba en un 404. El mapeo del 16-ago lo
 * encontró; esta página lo cierra con la MISMA fuente que ya pinta el
 * Inicio (`corridasRecientes`) — cero consultas nuevas que mantener.
 */
export default async function IndiceCorridas() {
  await requireSuperadmin();

  let corridas: CorridaCruzada[] | null = null;
  let error: string | null = null;
  try {
    corridas = await corridasRecientes(50);
  } catch (e) {
    error = e instanceof Error ? e.message : 'no se pudo leer';
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <BarraPagina icono={<ListTree className="w-5 h-5" style={{ color: 'var(--muted)' }} />} titulo="Corridas de agentes" />
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Las últimas 50, cruzadas de todas las flotas. Cada una abre su traza completa.
      </p>
      <div className="mb-4">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--muted)' }}>
          <ArrowLeft className="w-4 h-4" /> Volver al inicio
        </Link>
      </div>

      {error !== null && (
        <EstadoError mensaje={`No se pudieron leer las corridas — ${error}. La consulta falló; no es que no existan.`} />
      )}
      {corridas !== null && corridas.length === 0 && (
        <EstadoVacio>
          Aún no hay corridas. Cada corrida de un agente deja aquí su fila (0102); la primera aparecerá cuando un agente trabaje.
        </EstadoVacio>
      )}
      {corridas !== null && corridas.length > 0 && (
        <div>
          <div className="mb-2"><TituloSeccion>{`Últimas ${corridas.length}`}</TituloSeccion></div>
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
                {corridas.map((c) => {
                  const pill = PILL[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
                  return (
                    <Fragment key={c.id}>
                    <tr className="border-t" style={{ borderColor: 'var(--line-2)' }}>
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/corridas/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--ink)' }}>
                          {etiquetaInterruptor(c.agente)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>{c.tenantNombre ?? 'Likida (negocio)'}</td>
                      <td className="px-4 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink-2)' }}>{fechaHoraMx(c.inicio)}</td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink-2)' }}>{duracion(c.duracionMs)}</td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink-2)' }}>
                        {/* ambos o ninguno — la regla de la casa para tareas */}
                        {c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--ink-2)' }}>
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
        </div>
      )}
    </div>
  );
}
