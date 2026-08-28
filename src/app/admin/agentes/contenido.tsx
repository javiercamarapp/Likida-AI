import { Bot, Plus } from 'lucide-react';
import {
  listarAgentes,
  DEPARTAMENTOS, DISPARADORES, ESTADOS_AGENTE, type AgenteDefinido,
} from '@/lib/likida/agentes/definiciones';
import { listarInterruptores } from '@/lib/likida/interruptores';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio, StatusPill, type Estado } from '../ui/kit';
import { FormaConAviso, Campo, type ResultadoAccion } from '../ui/forma';
import { PalancaAgente } from './palanca';

export type AccionAlta = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
/** Apagar/encender la palanca de un agente, desde su propia fila. */
export type AccionPalanca = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

export const dynamic = 'force-dynamic';

/**
 * /admin/agentes — el PANEL DEL CATÁLOGO (Fase 2 pieza 1): qué agentes hay,
 * en qué estado, cuándo corrió cada uno y con qué palanca. Antes de la 0116
 * solo los 7 vivos existían (y solo como código); ahora el catálogo es una
 * tabla y dar de alta un agente nuevo es la forma de abajo — el criterio de
 * terminado de la pieza: una fila, no una migración.
 */

import { getConsumoPorAgente } from '@/lib/admin/consumo';
import { ahoraMs } from '@/lib/saludo';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Éxito de 30 días POR agente: ok / total de agente_corrida. LANZA en
 *  error — el llamador pinta "no se pudo leer" en su celda. */
async function exitoTreintaDias(): Promise<Map<string, { ok: number; total: number }>> {
  const desde = new Date(ahoraMs() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from('agente_corrida').select('agente, estado').gte('inicio', desde).limit(5000);
  if (error) throw new Error(`exitoTreintaDias: ${error.message}`);
  const acc = new Map<string, { ok: number; total: number }>();
  for (const f of data ?? []) {
    const a = acc.get(f.agente) ?? { ok: 0, total: 0 };
    a.total += 1;
    if (f.estado === 'ok') a.ok += 1;
    acc.set(f.agente, a);
  }
  return acc;
}

/** La última corrida de UN agente del catálogo (dinámico — a diferencia de
 *  getUltimaCorridaPorAgente, que itera los 7 fijos). */
async function ultimaCorridaDe(agente: string): Promise<{ inicio: string; estado: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from('agente_corrida')
    .select('inicio, estado')
    .eq('agente', agente)
    .order('inicio', { ascending: false })
    .limit(1);
  if (error) throw new Error(`ultimaCorridaDe/${agente}: ${error.message}`);
  const f = (data ?? [])[0] as { inicio?: string; estado?: string } | undefined;
  return f ? { inicio: String(f.inicio), estado: String(f.estado) } : null;
}

const PILL_ESTADO: Record<string, Estado> = {
  vivo: 'ok', pausado: 'warn', disenado: 'neutral', retirado: 'bad',
};
const PILL_CORRIDA: Record<string, Estado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };

/** El contenido REAL del panel, exportado aparte (patrón inicio-contenido):
 *  la puerta vive en page.tsx y el preview headless monta ESTO — el
 *  componente real, nunca una copia. La server action llega por props. */
export async function PanelAgentesContenido({ accionAlta, accionPalanca }: { accionAlta: AccionAlta; accionPalanca: AccionPalanca }) {

  const [agentes, interruptores, exito, consumo] = await Promise.all([
    listarAgentes(),
    safe(() => listarInterruptores()),
    safe(() => exitoTreintaDias()),
    safe(() => getConsumoPorAgente(ahoraMs())),
  ]);
  const costoDe = new Map<string, number>(
    (consumo?.agentes ?? []).map((a) => [a.agente, a.gastado30dUsd]),
  );
  // Llave como string plano: el Map se consulta con ids del CATÁLOGO
  // dinámico ('agente:<id>'), no solo con los 8 del tipo cerrado.
  const apagadoDe = new Map<string, (NonNullable<typeof interruptores>)[number]>(
    (interruptores ?? []).map((i) => [i.id as string, i]),
  );

  // La última corrida POR agente, cada lectura por su lado: una caída pinta
  // "no se pudo leer" en SU celda, no tumba la tabla.
  const corridas = new Map<string, { inicio: string; estado: string } | null | 'error'>();
  await Promise.all(agentes.map(async (a) => {
    try { corridas.set(a.id, await ultimaCorridaDe(a.id)); } catch { corridas.set(a.id, 'error'); }
  }));

  const rotuloDepartamento = new Map<string, string>(DEPARTAMENTOS.map((d) => [d.valor, d.rotulo]));
  const rotuloEstado = new Map<string, string>(ESTADOS_AGENTE.map((e) => [e.valor, e.rotulo]));

  function filaAgente(a: AgenteDefinido) {
    const c = corridas.get(a.id);
    const interruptor = apagadoDe.get(`agente:${a.id}`);
    return (
      <tr key={a.id} className="border-t transition-colors hover:bg-[var(--canvas)]" style={{ borderColor: 'var(--line2)' }}>
        <td className="px-4 py-2.5">
          <div className="font-medium">{a.nombre}</div>
          <div className="cifra-mono text-[11px]" style={{ color: 'var(--faint)' }}>{a.id}</div>
        </td>
        <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{rotuloDepartamento.get(a.departamento) ?? a.departamento}</td>
        <td className="px-4 py-2.5">
          <StatusPill estado={PILL_ESTADO[a.estado] ?? 'neutral'}>{rotuloEstado.get(a.estado) ?? a.estado}</StatusPill>
        </td>
        <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{a.disparador}</td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {c === 'error' ? (
            <span style={{ color: 'var(--bad)' }}>No se pudo leer</span>
          ) : c === null || c === undefined ? (
            <span style={{ color: 'var(--faint)' }}>{a.estado === 'vivo' ? 'Sin corridas todavía' : 'No corre en el producto'}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <StatusPill estado={PILL_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusPill>
              <span style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.inicio)}</span>
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {a.estado !== 'vivo' ? (
            <span style={{ color: 'var(--faint)' }}>—</span>
          ) : interruptor === undefined ? (
            <span style={{ color: interruptores === null ? 'var(--bad)' : 'var(--faint)' }}>
              {interruptores === null ? 'No se pudo leer' : 'Sin palanca propia'}
            </span>
          ) : (
            <PalancaAgente id={`agente:${a.id}`} apagado={interruptor.apagado} accion={accionPalanca} />
          )}
        </td>
        <td className="px-4 py-2.5 text-[12px]">
          {a.modeloRol
            ? <span className="cifra-mono">{a.modeloRol}</span>
            : <span style={{ color: 'var(--faint)' }}>Sin declarar</span>}
        </td>
        <td className="px-4 py-2.5 text-right tabular text-[12.5px]">
          {exito === null ? (
            <span style={{ color: 'var(--bad)' }}>No se pudo leer</span>
          ) : (() => {
            const e = exito.get(a.id);
            if (!e || e.total === 0) return <span style={{ color: 'var(--faint)' }}>—</span>;
            const pct = Math.round((e.ok / e.total) * 100);
            return <span style={{ color: pct >= 90 ? 'var(--ok)' : pct >= 60 ? 'inherit' : 'var(--bad)' }}>{pct}% <span style={{ color: 'var(--faint)' }}>/{e.total}</span></span>;
          })()}
        </td>
        <td className="px-4 py-2.5 text-right tabular text-[12.5px]">
          {consumo === null
            ? <span style={{ color: 'var(--bad)' }}>No se pudo leer</span>
            : (costoDe.get(a.id) ?? 0) > 0
              ? usd(costoDe.get(a.id) ?? 0)
              : <span style={{ color: 'var(--faint)' }}>$0 medido</span>}
        </td>
        <td className="px-4 py-2.5 text-right tabular text-[12.5px]">
          {a.presupuestoDiaUsd === null
            ? <span style={{ color: 'var(--faint)' }}>Sin tope declarado</span>
            : `${usd(a.presupuestoDiaUsd)}/día`}
        </td>
      </tr>
    );
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Bot width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Panel de agentes"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <TituloSeccion>El catálogo declarativo (0116)</TituloSeccion>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Un agente nuevo es una fila, no una migración. Los diseñados corren con su prompt a mano;
                solo los vivos corren dentro del producto.
              </p>
            </div>
            {agentes.length === 0 ? (
              <div className="px-4 pt-2 pb-4">
                <EstadoVacio>El catálogo está vacío — la 0116 siembra los 7 del producto al aplicarse.</EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-4 py-2 font-medium">Agente</th>
                      <th className="px-4 py-2 font-medium">Departamento</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 font-medium">Disparador</th>
                      <th className="px-4 py-2 font-medium">Última corrida</th>
                      <th className="px-4 py-2 font-medium">Kill switch</th>
                      <th className="px-4 py-2 font-medium">Modelo</th>
                      <th className="px-4 py-2 font-medium text-right">Éxito 30d</th>
                      <th className="px-4 py-2 font-medium text-right">Costo 30d</th>
                      <th className="px-4 py-2 font-medium text-right">Presupuesto</th>
                    </tr>
                  </thead>
                  <tbody>{agentes.map(filaAgente)}</tbody>
                </table>
              </div>
            )}
          </div>

          <section className="card p-4">
            <div className="flex items-center gap-2">
              <Plus width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Dar de alta un agente — nace diseñado, jamás vivo</TituloSeccion>
            </div>
            <div className="mt-3">
              <FormaConAviso accion={accionAlta} boton="Dar de alta">
                <Campo nombre="id" etiqueta="Id técnico" requerido placeholder="cazador_censo"
                  ayuda="Minúsculas, números y guión bajo. Es el nombre en corridas y bitácoras." />
                <Campo nombre="nombre" etiqueta="Nombre" requerido placeholder="Cazador de censo" />
                <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                  Departamento
                  <select name="departamento" className="text-sm" defaultValue="leads">
                    {DEPARTAMENTOS.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                  Disparador
                  <select name="disparador" className="text-sm" defaultValue="manual">
                    {DISPARADORES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <Campo nombre="descripcion" etiqueta="Qué hace" placeholder="Una línea honesta" />
                <Campo nombre="promptRef" etiqueta="Dónde vive su prompt" placeholder="13-Agentes-de-AI/…/prompts/x.md" />
                <Campo nombre="presupuestoDiaUsd" etiqueta="Presupuesto/día (USD)" placeholder="Vacío = sin tope declarado"
                  ayuda="El techo se DECLARA desde hoy; la medición por agente llega con el runner." />
              </FormaConAviso>
            </div>
          </section>

          <EstadoVacio>
            El runner de nivel 2 (ejecutar agentes declarativos dentro del producto, con sandbox de tools
            y presupuesto medido) es fase posterior a propósito — copiloto-del-fundador.md §4 dice por qué.
            La palanca de cada agente vivo ya se mueve desde su propia fila, aquí arriba; Observabilidad
            y el ⌘K siguen teniendo las 58 juntas, incluida la global.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
