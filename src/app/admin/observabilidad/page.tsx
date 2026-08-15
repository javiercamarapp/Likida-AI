import { getResumenNegocio } from '@/lib/admin/negocio';
import { sentryActivo } from '@/lib/observability/sentry';
import { usd } from '@/lib/utils';
import { Activity, ExternalLink, Power, ScrollText, ListTree, Search } from 'lucide-react';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarInterruptores, apagar, encender } from '@/lib/likida/interruptores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ultimasEntradasBitacora, type EntradaBitacora } from '@/lib/admin/bitacora';
import { corridasRecientes, type CorridaCruzada } from '@/lib/admin/corridas-cruzadas';
import { fechaHoraMx } from '@/lib/formato';
import { AreaChartSimple } from '../charts';
import { StatusPill, EstadoVacio, EstadoError, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { SeccionInterruptores, type InterruptorParaUi } from './interruptores-ui';
import { etiquetaInterruptor } from './etiquetas';
import type { ResultadoAccion } from '../ui/forma';

export const dynamic = 'force-dynamic';

/** `agente_corrida.estado` como pill; un valor fuera del dominio se pinta
 *  crudo en neutro — visible, no roto (criterio de PILL_ESTATUS). */
const PILL_CORRIDA: Record<string, { estado: Estado; etiqueta: string }> = {
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Fallo' },
};

/** "3 s" / "2.4 min" — para la tabla. `null` (sin fin) se pinta '—'. */
function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

/**
 * Observabilidad — la casa de OPERAR el sistema: el kill switch (0110), la
 * traza de corridas y el primer lector de la bitácora de auditoría, junto a
 * lo que ya vivía aquí (Sentry/Vercel y el costo de IA como proxy de
 * actividad). `requireSuperadmin()` ya lo hizo el layout para RENDERIZAR;
 * los server actions lo repiten adentro porque el gateo de la UI solo decide
 * si se pinta el formulario (patrón de administracion.ts).
 */
export default async function ObservabilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  async function accionInterruptor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    // RE-GATEO: el action es un endpoint público en la práctica — el layout
    // solo protegió el render.
    const { userId } = await requireSuperadmin();
    const id = String(fd.get('id') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    const motivo = String(fd.get('motivo') ?? '');
    try {
      if (operacion === 'apagar') await apagar(id, motivo, userId);
      else if (operacion === 'encender') await encender(id, userId);
      else return { error: 'Operación desconocida.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el interruptor ${id}`) };
    }
    revalidatePath('/admin/observabilidad');
    return {
      ok: operacion === 'apagar'
        ? `${etiquetaInterruptor(id)} APAGADO. Los crons lo saltan desde su siguiente corrida (responden 200 con "saltado" — apagado a propósito no es fallo). Quedó firmado en la bitácora.`
        : `${etiquetaInterruptor(id)} encendido. Vuelve a correr en la siguiente corrida programada.`,
    };
  }

  const sp = await searchParams;
  const filtroBitacora = (sp.b ?? '').trim();

  // Cada fuente falla POR SEPARADO y lo dice: los interruptores caídos no
  // pueden esconder la bitácora, ni al revés — en un incidente esta página
  // es la que tiene que seguir en pie aunque sea a pedazos.
  let interruptores: InterruptorParaUi[] | null = null;
  try {
    interruptores = await listarInterruptores();
  } catch {
    interruptores = null;
  }

  let corridas: CorridaCruzada[] | null = null;
  try {
    corridas = await corridasRecientes(15);
  } catch {
    corridas = null;
  }

  let bitacora: EntradaBitacora[] | null = null;
  try {
    bitacora = await ultimasEntradasBitacora({ limite: 50, filtroAccion: filtroBitacora });
  } catch {
    bitacora = null;
  }

  const r = await getResumenNegocio();
  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Activity {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Observabilidad & Operación"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── El kill switch (0110) ─────────────────────────────────────── */}
          <div className="card p-3">
            <div className="flex items-center justify-between gap-3">
              <TituloSeccion>Interruptores — apagar un agente en cinco segundos</TituloSeccion>
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>⌘K también los mueve</span>
            </div>
            <p className="text-xs mt-1 mb-2" style={{ color: 'var(--muted)' }}>
              Sin fila = encendido: el default seguro es que el sistema corre. Apagar exige motivo.
              La palanca es global por agente (v1), no por flota, y los crons fallan cerrado: si no
              pueden leerla, no corren.
            </p>
            {interruptores === null ? (
              <EstadoError mensaje="No se pudieron leer los interruptores. La consulta falló — no es que estén todos encendidos, es que no se pudo mirar. Los crons, ante lo mismo, NO corren (fail-closed)." />
            ) : (
              <SeccionInterruptores interruptores={interruptores} accion={accionInterruptor} />
            )}
          </div>

          {/* ── La traza de corridas ──────────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Corridas recientes — todos los agentes, todas las flotas</TituloSeccion>
            {corridas === null ? (
              <div className="mt-2">
                <EstadoError mensaje="No se pudo leer el historial de corridas. La consulta falló — no es que los agentes no hayan corrido, es que no se pudo mirar." />
              </div>
            ) : corridas.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<ListTree width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  La bitácora de corridas (0102) existe y está vacía de verdad: los agentes no han
                  corrido todavía — la base está en cero porque no hay clientes, no porque falte código.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-3 py-2 font-medium">Agente</th>
                      <th className="px-3 py-2 font-medium">Flota</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      <th className="px-3 py-2 font-medium">Tareas</th>
                      <th className="px-3 py-2 font-medium">Duración</th>
                      <th className="px-3 py-2 font-medium">Inicio</th>
                      <th className="px-3 py-2 font-medium text-right">Traza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridas.map((c) => {
                      const pill = PILL_CORRIDA[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
                      return (
                        <tr key={c.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{etiquetaInterruptor(`agente:${c.agente}`)}</td>
                          {/* Corrida sin flota = del negocio (ventas, 0105) — se dice, no se deja en blanco. */}
                          <td className="px-3 py-2">{c.tenantNombre ?? (c.tenantId === null ? 'Likida (negocio)' : '—')}</td>
                          <td className="px-3 py-2"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                          <td className="px-3 py-2 tabular" style={{ color: 'var(--muted)' }}>
                            {c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas}/${c.tareasTotal}` : '—'}
                          </td>
                          <td className="px-3 py-2 tabular whitespace-nowrap" style={{ color: 'var(--muted)' }}>{duracion(c.duracionMs)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.inicio)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Link href={`/admin/corridas/${c.id}`} className="text-xs font-medium underline underline-offset-2">
                              abrir traza
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── El primer lector de la bitácora (0053) ────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Bitácora de auditoría — todas las flotas</TituloSeccion>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Las últimas 50 entradas (es una ventana, no un export). Hasta hoy esta tabla tenía
              siete escritores y cero lectores — este es el primero.
            </p>
            <form method="GET" className="flex items-center gap-2 mt-2">
              <Search width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <input
                name="b"
                defaultValue={filtroBitacora}
                placeholder="Filtrar por acción (interruptor, flota.creada, impersonacion…)"
                className="text-xs rounded-lg px-2.5 py-1.5 w-72 outline-none"
                style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              />
              <button type="submit" className="text-xs font-medium rounded-lg px-3 py-1.5 hairline">Filtrar</button>
            </form>
            {bitacora === null ? (
              <div className="mt-2">
                <EstadoError mensaje="No se pudo leer la bitácora. La consulta falló — no es que nadie haya tocado nada, es que no se pudo mirar." />
              </div>
            ) : bitacora.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<ScrollText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  {filtroBitacora
                    ? <>Ninguna entrada coincide con «{filtroBitacora}» en las acciones registradas.</>
                    : <>La bitácora existe y está vacía: ninguna operación administrativa se ha registrado todavía.</>}
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-3 py-2 font-medium">Cuándo</th>
                      <th className="px-3 py-2 font-medium">Acción</th>
                      <th className="px-3 py-2 font-medium">Quién</th>
                      <th className="px-3 py-2 font-medium">Flota</th>
                      <th className="px-3 py-2 font-medium">Entidad</th>
                      <th className="px-3 py-2 font-medium">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bitacora.map((e) => (
                      <tr key={e.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>{fechaHoraMx(e.ocurrioEn)}</td>
                        <td className="px-3 py-2 font-medium whitespace-nowrap"><code className="font-mono text-xs">{e.accion}</code></td>
                        {/* Sin actor no se inventa uno: los escritores viejos no firmaban. */}
                        <td className="px-3 py-2 text-xs">{e.actor ?? 'sistema'}</td>
                        <td className="px-3 py-2 text-xs">{e.tenantNombre ?? (e.tenantId === null ? 'plataforma' : '—')}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--muted)' }}>
                          {e.entidad ?? '—'}{e.entidadId ? ` · ${e.entidadId.slice(0, 8)}` : ''}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--muted)' }}>
                          {e.detalle ? <code className="font-mono text-[11px] break-all">{JSON.stringify(e.detalle)}</code> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Lo que ya vivía aquí ──────────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Salud del sistema</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
              {/* MEDIDO, no fijo (auditoría 4, D3): el pill decía "Conectado"
                  por decreto. Lo único que se puede afirmar desde aquí es si hay
                  DSN — "configurado", nunca "conectado". */}
              <a href="https://sentry.io" target="_blank" rel="noopener noreferrer"
                className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                    <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                    Errores — Sentry
                  </div>
                  {sentryActivo()
                    ? <StatusPill estado="ok">DSN configurado</StatusPill>
                    : <StatusPill estado="bad">Sin DSN — ciego</StatusPill>}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Se enlaza en vez de reconstruirse.</div>
              </a>
              <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer"
                className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                    <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                    Uptime, deploys y latencia de edge — Vercel
                  </div>
                  {/* No hay medición de Vercel desde adentro (si esto renderiza,
                      Vercel contestó): neutral honesto, no verde de adorno. */}
                  <StatusPill estado="neutral">No medido</StatusPill>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
              </a>
            </div>
          </div>

          <div className="card p-4">
            <TituloSeccion>Actividad de IA en el tiempo</TituloSeccion>
            <div className="mt-3">
              {r.porDia.length > 1 ? (
                <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  Sin historial suficiente todavía.
                </div>
              )}
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Proxy honesto de actividad, no de rendimiento: enseña cuánto gasta la IA día a día, no qué tan rápido responde.
            </p>
          </div>

          <div className="card p-3">
            <TituloSeccion>Rendimiento por llamada</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio icono={<Power width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Latencia p50/p95/p99 por llamada, tasa de éxito de tool-calls, tasa de escalamiento a humano, tiempo de
                resolución end-to-end — ninguno se instrumenta hoy (no hay columna de duración en{' '}
                <code className="font-mono text-xs">llm_costo</code>). La traza de una CORRIDA sí existe ya — el link
                &quot;abrir traza&quot; de arriba — con su costo de IA correlacionado por ventana de tiempo.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
