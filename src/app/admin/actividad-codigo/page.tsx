import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getActividadCodigo } from '@/lib/admin/actividad-codigo';
import { numero, fechaCorta } from '@/lib/formato';
import { Aviso, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { AvisoGitHub } from '../ui/aviso-github';

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

type Commit = Extract<Awaited<ReturnType<typeof getActividadCodigo>>, { estado: 'ok' }>['recientes'][number];

const COLUMNAS_COMMITS: ColumnaBase<Commit>[] = [
  { id: 'sha', titulo: 'Commit', celda: (c) => <span className="cifra-mono text-muted">{c.sha}</span> },
  { id: 'mensaje', titulo: 'Asunto', principal: true, celda: (c) => <span className="block max-w-[520px] truncate">{c.mensaje}</span> },
  { id: 'fecha', titulo: 'Fecha', alinear: 'der', celda: (c) => (c.fecha ? fechaCorta(c.fecha) : '—') },
];

export default async function ActividadCodigoPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const a = await getActividadCodigo();

  return (
    <EsqueletoPanelCifras
      titulo="Actividad de código — likida.ai"
      etiquetaCifras="Commits del repositorio"
      cifras={a.estado === 'ok' ? [
        { etiqueta: 'Commits — últimas 52 semanas', valor: a.totalAnual, formato: 'entero' },
        { etiqueta: 'Esta semana', valor: a.semanas[a.semanas.length - 1]?.total ?? 0, formato: 'entero' },
        (() => {
          const mejor = a.semanas.reduce((m, s) => (s.total > m.total ? s : m), a.semanas[0]);
          return { etiqueta: 'La mejor semana', valor: mejor?.total ?? 0, formato: 'entero' as const,
            nota: mejor ? `semana del ${fechaCorta(new Date(mejor.semana * 1000).toISOString())}` : undefined };
        })(),
      ] : undefined}
      avisos={<>
        {a.estado === 'sin_token' && <AvisoGitHub causa="sin_token" />}
        {a.estado === 'calculando' && (
          <Aviso tono="info">GitHub todavía está calculando la estadística del repo (contestó 202) — recarga en unos segundos.</Aviso>
        )}
        {a.estado === 'error' && (
          <>
            <AvisoGitHub causa="error" />
            <Aviso tono="warn">No se pudo leer la actividad: {a.detalle}. Esto NO significa que no haya commits.</Aviso>
          </>
        )}
      </>}
    >
      {a.estado === 'ok' && (() => {
        const max = Math.max(...a.semanas.flatMap((s) => s.dias), 1);
        const ancho = a.semanas.length * (CELDA + GAP) + 28;
        const alto = 7 * (CELDA + GAP) + 4;
        return (
          <>
            <Tarjeta titulo="Los puntitos — commits por día">
              {/* Wide content scrollea DENTRO de su contenedor (regla). */}
              <div className="overflow-x-auto pb-1">
                <svg width={ancho} height={alto} className="block">
                  {DIAS_ROTULO.map((d, i) => d && (
                    <text key={i} x={0} y={i * (CELDA + GAP) + CELDA} fontSize={11} fill="var(--muted)">{d}</text>
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
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                menos
                {[0, 0.3, 0.6, 1].map((t) => (
                  <svg key={t} width={10} height={10} aria-hidden="true">
                    <rect width={10} height={10} rx={2.5} fill={t === 0 ? 'var(--line2)' : 'var(--marca)'} opacity={t === 0 ? 0.6 : 0.18 + t * 0.82} />
                  </svg>
                ))}
                más · escala relativa al mejor día ({numero(max)})
              </div>
            </Tarjeta>

            <Tarjeta titulo="Últimos commits">
              {/* FE-19: un asunto de commit largo no estira la página. */}
              <TablaBase
                etiqueta="Últimos commits"
                columnas={COLUMNAS_COMMITS}
                filas={a.recientes}
                idFila={(c) => c.sha}
                altoMaximo={false}
                vacio={{ titulo: 'Sin commits recientes' }}
              />
            </Tarjeta>
          </>
        );
      })()}
    </EsqueletoPanelCifras>
  );
}

export const metadata: Metadata = { title: 'Actividad de código' };
