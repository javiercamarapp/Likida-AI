import { uniformes } from '@/app/admin/cifras-uniformes';
import { observadas } from '../sello-observado';
import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getActividadCodigo } from '@/lib/admin/actividad-codigo';
import { numero, fechaCorta } from '@/lib/formato';
import { FilaTarjetas, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { BotonReintentar } from '../../ui-v2/componentes/boton-reintentar';
import { Columnas } from '../../ui-v2/graficas';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import type { TSistema } from '@/lib/i18n/sistema_tr';
import '../sistema.css';
import './actividad-codigo.css';
import '../compacto-lote-a.css';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/actividad-codigo — LOS PUNTITOS (16-ago-2026): el heatmap real de
// commits del repo, 52 semanas, con la rampa de tinta del design system
// (opacidad sobre --marca, jamás un hue nuevo) + los commits recientes.
// Todo dato viene de la API de GitHub; cada estado sin dato SE DICE.
// ═══════════════════════════════════════════════════════════════════════════

const CELDA = 11, GAP = 3;
/** Rótulos del eje de días (domingo a sábado, semana de GitHub): solo lunes, miércoles y viernes llevan nombre. */
const DIAS_ROTULO = (t: TSistema): string[] => ['', t('actividad_codigo.dia_lun'), '', t('actividad_codigo.dia_mie'), '', t('actividad_codigo.dia_vie'), ''];

function opacidad(commits: number, max: number): number {
  if (commits === 0) return 0;
  const t = Math.min(1, commits / Math.max(1, max));
  return 0.18 + t * 0.82;
}

type Commit = Extract<Awaited<ReturnType<typeof getActividadCodigo>>, { estado: 'ok' }>['recientes'][number];

const columnasCommits = (t: TSistema): ColumnaBase<Commit>[] => [
  { id: 'sha', titulo: t('actividad_codigo.col_commit'), celda: (c) => <span className="adm-codigo-sha">{c.sha}</span> },
  { id: 'mensaje', titulo: t('actividad_codigo.col_asunto'), principal: true, celda: (c) => <span className="adm-codigo-asunto">{c.mensaje}</span> },
  { id: 'fecha', titulo: t('actividad_codigo.col_fecha'), alinear: 'der', celda: (c) => (c.fecha ? fechaCorta(c.fecha) : '—') },
];

export default async function ActividadCodigoPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { t, tp } = await getT('admin_sistema');
  const { t: ti } = await getT('admin_inicio');
  const a = await getActividadCodigo();
  const ok = a.estado === 'ok';
  // F26: el esqueleto se dibuja SIEMPRE. Sin lectura, cada bloque dice «No disponible ahora. No es cero.» (con Reintentar) o que GitHub
  // sigue calculando; nunca un cero ni una página casi vacía.
  const calculando = a.estado === 'calculando';
  // Neutro (caja punteada) para todo lo que no hay que alarmar: GitHub sin conectar, calculando o una lectura caída. NUNCA un rojo por
  // celda ni un «Reintentar» por celda: el único Reintentar vive en el aviso de arriba y solo cuando la lectura de verdad falló.
  const mensajeSinLectura = calculando ? t('actividad_codigo.calculando') : a.estado === 'sin_token' ? t('actividad_codigo.sin_conexion') : t('actividad_codigo.no_disponible');
    const mejor = ok ? a.semanas.reduce((m, s) => (s.total > m.total ? s : m), a.semanas[0]) : undefined;
  const max = ok ? Math.max(...a.semanas.flatMap((s) => s.dias), 1) : 1;
  const ancho = ok ? a.semanas.length * (CELDA + GAP) + 28 : 0;
  const alto = 7 * (CELDA + GAP) + 4;

  // F26 ronda 5: sin lectura hay UN solo estado de página (Rovaq 2.12), no 4 cifras «Sin dato» + aviso + 3 vacíos idénticos.
  const estadoUnico = a.estado === 'ok' ? null : (
    <Tarjeta
      titulo={t('actividad_codigo.estado_lectura')}
      estado="vacio"
      mensaje={mensajeSinLectura}
      detalle={a.estado === 'sin_token' ? t('actividad_codigo.sin_conexion_detalle') : a.estado === 'calculando' ? t('actividad_codigo.calculando_detalle') : t('actividad_codigo.error_detalle', { detalle: a.detalle })}
      accionVacio={a.estado === 'sin_token' ? undefined : <BotonReintentar contexto={ti('raiz7.contexto_actividad_codigo')} />}
    />
  );

  return (
    <EsqueletoPanelCifras
      titulo={t('actividad_codigo.titulo')}
      apoyo={t('actividad_codigo.apoyo')}
      etiquetaCifras={t('actividad_codigo.cifras_etiqueta')}
      cifras={!ok ? undefined : observadas(uniformes([
        { etiqueta: t('actividad_codigo.etq_anual'), ...(ok ? { valor: a.totalAnual, formato: 'entero' as const } : { valor: null }) },
        { etiqueta: t('actividad_codigo.etq_semana'), ...(ok ? { valor: a.semanas[a.semanas.length - 1]?.total ?? 0, formato: 'entero' as const } : { valor: null }) },
        { etiqueta: t('actividad_codigo.etq_mejor'), ...(ok ? { valor: mejor?.total ?? 0, formato: 'entero' as const, nota: mejor ? t('actividad_codigo.semana_del', { fecha: fechaCorta(new Date(mejor.semana * 1000).toISOString()) }) : undefined } : { valor: null }) },
        { etiqueta: t('actividad_codigo.kpi_recientes'), ...(ok ? { valor: a.recientes.length, formato: 'entero' as const } : { valor: null }) },
      ]), t('a1r4.observado'))}
      variante="12"
      graficas={!ok ? undefined : [
        <Tarjeta key="puntitos" titulo={t('actividad_codigo.puntitos')} contenida>
          {ok ? (
            <>
              {/* Wide content scrollea DENTRO de su contenedor (regla). */}
              <div className="adm-codigo-rejilla">
                <svg width={ancho} height={alto} className="adm-codigo-svg">
                  {DIAS_ROTULO(t).map((d, i) => d && (
                    <text key={i} className="adm-codigo-dia" x={0} y={i * (CELDA + GAP) + CELDA}>{d}</text>
                  ))}
                  {a.semanas.map((s, x) => s.dias.map((n, y) => (
                    <rect key={`${x}-${y}`}
                      x={28 + x * (CELDA + GAP)} y={y * (CELDA + GAP)}
                      width={CELDA} height={CELDA} rx={2.5}
                      fill={n === 0 ? 'var(--line2)' : 'var(--marca)'}
                      opacity={n === 0 ? 0.6 : opacidad(n, max)}
                    >
                      <title>{tp('actividad_codigo.commits_dia', n, { fecha: new Date((s.semana + y * 86_400) * 1000).toISOString().slice(0, 10) })}</title>
                    </rect>
                  )))}
                </svg>
              </div>
              <div className="adm-codigo-escala">
                {t('actividad_codigo.menos')}
                {[0, 0.3, 0.6, 1].map((t) => (
                  <svg key={t} width={10} height={10} aria-hidden="true">
                    <rect width={10} height={10} rx={2.5} fill={t === 0 ? 'var(--line2)' : 'var(--marca)'} opacity={t === 0 ? 0.6 : 0.18 + t * 0.82} />
                  </svg>
                ))}
                {t('actividad_codigo.mas_escala', { max: numero(max) })}
              </div>
            </>
          ) : null}
        </Tarjeta>,
      ]}
    >
      {estadoUnico}
      {ok ? <FilaTarjetas variante="6-6">
        <Tarjeta titulo={t('actividad_codigo.por_semana')} contenida>
          {ok ? (
            <Columnas
              etiqueta={t('actividad_codigo.por_semana')}
              formato="numero"
              datos={a.semanas.slice(-12).map((s) => ({ etiqueta: fechaCorta(new Date(s.semana * 1000).toISOString()), valor: s.total }))}
            />
          ) : null}
        </Tarjeta>
        <Tarjeta titulo={t('actividad_codigo.ultimos_commits')} contenida>
          {/* FE-19: un asunto de commit largo no estira la página. */}
          {ok ? (
            <TablaBase
              etiqueta={t('actividad_codigo.ultimos_commits')}
              columnas={columnasCommits(t)}
              filas={a.recientes}
              idFila={(c) => c.sha}
              altoMaximo={false}
              densa
              vacio={{ titulo: t('actividad_codigo.sin_commits') }} tarjetaMovil />
          ) : null}
        </Tarjeta>
      </FilaTarjetas> : null}
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('actividad_codigo.titulo_pestana') };
}
