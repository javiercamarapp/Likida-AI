import { GitCommitHorizontal } from 'lucide-react';
import { getActividadCodigo } from '@/lib/admin/actividad-codigo';
import { numero, fechaCorta } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/actividad-codigo — LOS PUNTITOS (16-ago-2026): el heatmap real de
// commits del repo, 52 semanas, con la rampa de tinta del design system
// (opacidad sobre --marca, jamás un hue nuevo) + los commits recientes.
// Todo dato viene de la API de GitHub; cada estado sin dato SE DICE.
// ═══════════════════════════════════════════════════════════════════════════

const CELDA = 11, GAP = 3;
const DIAS_ROTULO = ['', 'lun', '', 'mié', '', 'vie', ''];

function opacidad(commits: number, max: number): number {
  if (commits === 0) return 0;
  const t = Math.min(1, commits / Math.max(1, max));
  return 0.18 + t * 0.82;
}

export default async function ActividadCodigoPage() {
  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;
  const a = await getActividadCodigo();

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<GitCommitHorizontal {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Actividad de código — likida.ai"
        />

        <div className="px-5 py-4 flex-1 space-y-2.5">
          {a.estado === 'sin_token' && (
            <EstadoVacio>
              El repo es privado y <span className="cifra-mono">GITHUB_TOKEN</span> no está configurado —
              sin él, esta pantalla no puede afirmar nada sobre la actividad. Se genera en
              github.com/settings/tokens (solo lectura del repo) y va en las variables de Vercel.
            </EstadoVacio>
          )}
          {a.estado === 'calculando' && (
            <EstadoVacio>GitHub todavía está calculando la estadística del repo (contestó 202) — recarga en unos segundos.</EstadoVacio>
          )}
          {a.estado === 'error' && (
            <EstadoVacio>No se pudo leer la actividad: {a.detalle}. Esto NO significa que no haya commits.</EstadoVacio>
          )}

          {a.estado === 'ok' && (() => {
            const max = Math.max(...a.semanas.flatMap((s) => s.dias), 1);
            const mejorSemana = a.semanas.reduce((m, s) => (s.total > m.total ? s : m), a.semanas[0]);
            const ancho = a.semanas.length * (CELDA + GAP) + 28;
            const alto = 7 * (CELDA + GAP) + 4;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <StatCard icono={<GitCommitHorizontal {...ICONO} />} etiqueta="Commits — últimas 52 semanas" valor={a.totalAnual} formato="entero" />
                  <StatCard icono={<GitCommitHorizontal {...ICONO} />} etiqueta="Esta semana" valor={a.semanas[a.semanas.length - 1]?.total ?? 0} formato="entero" />
                  <StatCard icono={<GitCommitHorizontal {...ICONO} />} etiqueta="La mejor semana" valor={mejorSemana?.total ?? 0} formato="entero"
                    nota={mejorSemana ? `semana del ${fechaCorta(new Date(mejorSemana.semana * 1000).toISOString())}` : undefined} />
                </div>

                <div className="card p-4">
                  <TituloSeccion>Los puntitos — commits por día</TituloSeccion>
                  {/* Wide content scrollea DENTRO de su contenedor (regla). */}
                  <div className="overflow-x-auto mt-2 pb-1">
                    <svg width={ancho} height={alto} className="block">
                      {DIAS_ROTULO.map((d, i) => d && (
                        <text key={i} x={0} y={i * (CELDA + GAP) + CELDA} fontSize={9} fill="var(--faint)">{d}</text>
                      ))}
                      {a.semanas.map((s, x) => s.dias.map((n, y) => (
                        <rect key={`${x}-${y}`}
                          x={28 + x * (CELDA + GAP)} y={y * (CELDA + GAP)}
                          width={CELDA} height={CELDA} rx={2.5}
                          fill={n === 0 ? 'var(--line2)' : 'var(--marca)'}
                          opacity={n === 0 ? 0.6 : opacidad(n, max)}
                        >
                          <title>{`${n} commit${n === 1 ? '' : 's'} — ${new Date((s.semana + y * 86_400) * 1000).toISOString().slice(0, 10)}`}</title>
                        </rect>
                      )))}
                    </svg>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[10.5px]" style={{ color: 'var(--faint)' }}>
                    menos
                    {[0, 0.3, 0.6, 1].map((t) => (
                      <span key={t} className="inline-block rounded-[2.5px]" style={{ width: 10, height: 10, background: t === 0 ? 'var(--line2)' : 'var(--marca)', opacity: t === 0 ? 0.6 : 0.18 + t * 0.82 }} />
                    ))}
                    más · escala relativa al mejor día ({numero(max)})
                  </div>
                </div>

                <div className="card p-4">
                  <TituloSeccion>Últimos commits</TituloSeccion>
                  <table className="w-full text-[12.5px] mt-2">
                    <tbody>
                      {a.recientes.map((c) => (
                        <tr key={c.sha} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-1.5 cifra-mono" style={{ color: 'var(--muted)' }}>{c.sha}</td>
                          <td className="py-1.5 max-w-[520px] truncate">{c.mensaje}</td>
                          <td className="py-1.5 text-right" style={{ color: 'var(--faint)' }}>{c.fecha ? fechaCorta(c.fecha) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </main>
  );
}
