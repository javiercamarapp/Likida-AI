import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getActividadCodigo } from '@/lib/admin/actividad-codigo';
import { numero, fechaCorta } from '@/lib/formato';
import { Aviso, FilaTarjetas, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { Columnas } from '../../ui-v2/graficas';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import { AvisoGitHub } from '../ui/aviso-github';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/actividad-codigo — LOS PUNTITOS (16-ago-2026): el heatmap real de
// commits del repo, 52 semanas, con la rampa de tinta del design system
// (opacidad sobre --marca, jamás un hue nuevo) + los commits recientes.
// Todo dato viene de la API de GitHub; cada estado sin dato SE DICE.
// ═══════════════════════════════════════════════════════════════════════════

const CELDA = 11, GAP = 3;
const ETQ_ANUAL = 'Commits — últimas 52 semanas', ETQ_SEMANA = 'Esta semana', ETQ_MEJOR = 'La mejor semana';
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
  const { t } = await getT('admin_sistema');
  const a = await getActividadCodigo();
  const ok = a.estado === 'ok';
  // F26: el esqueleto se dibuja SIEMPRE. Sin lectura, cada bloque dice «No disponible ahora. No es cero.» (con Reintentar) o que GitHub
  // sigue calculando; nunca un cero ni una página casi vacía.
  const calculando = a.estado === 'calculando';
  const sinLectura = { estado: calculando ? 'vacio' as const : 'error' as const, mensaje: calculando ? t('actividad_codigo.calculando') : undefined, reintentar: true };
  const mejor = ok ? a.semanas.reduce((m, s) => (s.total > m.total ? s : m), a.semanas[0]) : undefined;
  const max = ok ? Math.max(...a.semanas.flatMap((s) => s.dias), 1) : 1;
  const ancho = ok ? a.semanas.length * (CELDA + GAP) + 28 : 0;
  const alto = 7 * (CELDA + GAP) + 4;

  return (
    <EsqueletoPanelCifras
      titulo="Actividad de código — likida.ai"
      etiquetaCifras="Commits del repositorio"
      cifras={[
        { etiqueta: ETQ_ANUAL, ...(ok ? { valor: a.totalAnual, formato: 'entero' as const } : { valor: null, ...sinLectura }) },
        { etiqueta: ETQ_SEMANA, ...(ok ? { valor: a.semanas[a.semanas.length - 1]?.total ?? 0, formato: 'entero' as const } : { valor: null, ...sinLectura }) },
        { etiqueta: ETQ_MEJOR, ...(ok ? { valor: mejor?.total ?? 0, formato: 'entero' as const, nota: mejor ? `semana del ${fechaCorta(new Date(mejor.semana * 1000).toISOString())}` : undefined } : { valor: null, ...sinLectura }) },
        { etiqueta: t('actividad_codigo.kpi_recientes'), ...(ok ? { valor: a.recientes.length, formato: 'entero' as const } : { valor: null, ...sinLectura }) },
      ]}
      avisos={ok ? null : <>
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
      variante="12"
      graficas={[
        <Tarjeta key="puntitos" titulo="Los puntitos — commits por día" {...(ok ? { estado: 'ok' as const } : sinLectura)} contenida>
          {ok ? (
            <>
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
            </>
          ) : null}
        </Tarjeta>,
      ]}
    >
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={t('actividad_codigo.por_semana')} {...(ok ? { estado: 'ok' as const } : sinLectura)} contenida>
          {ok ? (
            <Columnas
              etiqueta={t('actividad_codigo.por_semana')}
              formato="numero"
              datos={a.semanas.slice(-12).map((s) => ({ etiqueta: fechaCorta(new Date(s.semana * 1000).toISOString()), valor: s.total }))}
            />
          ) : null}
        </Tarjeta>
        <Tarjeta titulo="Últimos commits" {...(ok ? { estado: 'ok' as const } : sinLectura)} contenida>
          {/* FE-19: un asunto de commit largo no estira la página. */}
          {ok ? (
            <TablaBase
              etiqueta="Últimos commits"
              columnas={COLUMNAS_COMMITS}
              filas={a.recientes}
              idFila={(c) => c.sha}
              altoMaximo={false}
              densa
              vacio={{ titulo: 'Sin commits recientes' }}
            />
          ) : null}
        </Tarjeta>
      </FilaTarjetas>
    </EsqueletoPanelCifras>
  );
}

export const metadata: Metadata = { title: 'Actividad de código' };
