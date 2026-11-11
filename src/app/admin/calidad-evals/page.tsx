import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import Link from 'next/link';
import { getEstadoEvals } from '@/lib/admin/evals';
import { getCalidadCorridas, getCalidadOcr } from '@/lib/admin/calidad';
import { ahoraMs } from '@/lib/saludo';
import { numero, porcentaje, fechaHoraMx } from '@/lib/formato';
import { Aviso, FilaTarjetas, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { BarList, BarraApilada } from '../../ui-v2/graficas';

import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import type { Idioma } from '@/lib/i18n/idioma';
export const dynamic = 'force-dynamic';

/**
 * TABLERO DE CALIDAD (Frente F) — la agregación de lo que YA se mide.
 *
 * Esta página fue un empty-state honesto («Likida no tiene pipeline de
 * evaluación ni tabla de feedback») hasta que dejó de ser verdad por partes:
 *
 *   · EVALOPS (0134) examina al analista y acusa el drift de prompt.
 *   · EVALOPS fase 2 (E.26, 0254) examina al CONTADOR con las 32 preguntas
 *     doradas de 22-evaluacion.md — trampas, inventos y falsa cautela.
 *   · agente_corrida (0102) registra el veredicto de CADA corrida de agente.
 *   · El banco de QA (0239/0246) mide la precisión del OCR campo por campo
 *     contra verdad de terreno etiquetada a mano.
 *
 * Cuatro fuentes medidas. Aquí se JUNTAN — nada se
 * mide nuevo, cada tarjeta enlaza a su pantalla de detalle, y lo que sigue
 * sin fuente (feedback 👍/👎, CSAT, drift de calidad en producción) se sigue
 * diciendo abajo con su razón, no con una gráfica vacía.
 *
 * `requireSuperadmin()` ya lo hizo el layout; aquí solo lecturas. Cada una
 * cae por su lado a null y se DICE — un tablero de calidad que pinta ceros
 * sobre una base caída afirmaría exactamente lo que existe para desmentir.
 */

const DIAS_VENTANA = 7;

type AgenteCorridas = NonNullable<Awaited<ReturnType<typeof getCalidadCorridas>>>['porAgente'][number];

/** El veredicto del examen como chip de la casa. */
function estadoDeVeredicto(v: string | null, tx: TSistema = T_SISTEMA_ES): { tono: TonoEstado; texto: string } {
  if (v === 'paso') return { tono: 'ok', texto: tx('calidad_evals.paso') };
  if (v === 'fallo') return { tono: 'bad', texto: tx('qa_medicion_corrida.fallo_2') };
  if (v === 'revisar') return { tono: 'warn', texto: tx('calidad_evals.en_revision_juez_humano') };
  return { tono: 'neutral', texto: tx('calidad_evals.sin_veredicto') };
}

type EstadoEvals = NonNullable<Awaited<ReturnType<typeof getEstadoEvals>>>;

/** Una tarjeta de examen (analista o contador): drift de prompt, última corrida, casos activos y cómo correrlo. Las dos comparten
 *  forma; solo cambian el aviso de drift, las notas del runner y el script. */
function TarjetaExamen({ titulo, estado, avisoDrift, conNotas, tx = T_SISTEMA_ES, idioma }: {
  titulo: string;
  estado: EstadoEvals | null;
  avisoDrift: string;
  conNotas?: boolean; tx?: TSistema; idioma?: Idioma;
}) {
  return (
    <Tarjeta titulo={titulo}>
      {estado === null ? (
        <p className="m-0 text-sm text-[var(--bad)]">{tx('calidad_evals.no_se_pudo_leer_el_estado')}</p>
      ) : (
        <>
          {estado.driftDePrompt && (
            <Aviso tono="warn">
              {estado.ultima === null ? tx('calidad_evals.el_examen_nunca_se_ha_corrido') : avisoDrift}
            </Aviso>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {estado.ultima === null ? (
              <span className="text-muted">{tx('calidad_evals.sin_corridas_registradas')}</span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">{tx('calidad_evals.ultima_corrida')}{' '}<StatusChip tono={estadoDeVeredicto(estado.ultima.veredicto, tx).tono}>
                    {estadoDeVeredicto(estado.ultima.veredicto, tx).texto}
                  </StatusChip>
                </span>
                <span className="text-muted">{fechaHoraMx(estado.ultima.iniciadaEn, idioma)}</span>
                {estado.ultima.casos !== null && <span className="text-muted">{tx('calidad_evals.n_casos', { n: numero(estado.ultima.casos, idioma) })}</span>}
              </>
            )}{rico(tx('calidad_evals.e0_caso_s_activos_en_el', { numero: numero(estado.casosActivos, idioma) }), { e0: (c) => <span className="text-muted">{c}</span> })}</div>
          {/* La calificación desglosada, tal cual la dejó el runner — buena o mala, aquí no se maquilla. */}
          {conNotas && estado.ultima?.notas && <p className="m-0 mt-2 text-xs text-muted">{estado.ultima.notas}</p>}
          <p className="m-0 mt-2 text-xs text-muted">
            {rico(tx('calidad_evals.el_detalle_y_el_juez_humano'), { e0: (c) => <Link href="/admin/evals" className="underline">{c}</Link> })}
          </p>
        </>
      )}
    </Tarjeta>
  );
}

const columnasTropiezos = (tx: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<AgenteCorridas>[] => ([
  { id: 'agente', titulo: tx('calidad_evals.agente_con_tropiezos'), principal: true, celda: (a) => <span className="cifra-mono">{a.agente}</span> },
  { id: 'ok', titulo: 'Ok', alinear: 'der', celda: (a) => <span className="tabular">{numero(a.ok, idioma)}</span> },
  { id: 'parcial', titulo: tx('calidad_evals.parciales'), alinear: 'der', celda: (a) => <span className={`tabular ${a.parcial > 0 ? 'text-[var(--warn)]' : ''}`}>{numero(a.parcial, idioma)}</span> },
  { id: 'fallo', titulo: tx('observabilidad.fallos'), alinear: 'der', celda: (a) => <span className={`tabular ${a.fallo > 0 ? 'text-[var(--bad)]' : ''}`}>{numero(a.fallo, idioma)}</span> },
]);

export default async function CalidadEvalsPage() {
  const { t: tx, idioma } = await getT('admin_sistema');
  const { t } = await getT('admin_agentes');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const desdeIso = new Date(ahoraMs() - DIAS_VENTANA * 24 * 3600 * 1000).toISOString();
  const [evals, evalsContador, corridas, ocr] = await Promise.all([
    getEstadoEvals('analista').catch(() => null),
    // E.26 (fase 2): el examen fiscal de 32 preguntas doradas. Se lee aparte
    // y cae aparte — que el analista no se quede sin tarjeta porque el
    // corpus del contador no cargó, ni al revés.
    getEstadoEvals('contador').catch(() => null),
    getCalidadCorridas(desdeIso).catch(() => null),
    getCalidadOcr().catch(() => null),
  ]);

  const tropiezos = corridas === null ? [] : corridas.porAgente
    .filter((a) => a.fallo > 0 || a.parcial > 0)
    .sort((a, b) => (b.fallo * 2 + b.parcial) - (a.fallo * 2 + a.parcial))
    .slice(0, 6);
  const casos = evals !== null && evalsContador !== null ? evals.casosActivos + evalsContador.casosActivos : null;

  return (
    <EsqueletoPanelCifras
      titulo={t('calidad_evals.calidad_evals')}
      titular={t('calidad_evals.titular_corto')}
      etiquetaCifras={t('calidad_evals.calidad_evals')}
      cifras={[
        corridas === null
          ? { etiqueta: t('calidad_evals.kpi_corridas'), valor: null, estado: 'vacio' as const, mensaje: t('calidad_evals.no_leido') }
          : { etiqueta: t('calidad_evals.kpi_corridas'), valor: corridas.total, formato: 'entero' as const },
        corridas === null || corridas.total === 0
          ? { etiqueta: t('calidad_evals.kpi_pct_ok'), valor: null, estado: 'vacio' as const, mensaje: t('calidad_evals.sin_corridas_ventana') }
          : { etiqueta: t('calidad_evals.kpi_pct_ok'), valor: (corridas.ok / corridas.total) * 100, formato: 'porcentaje' as const },
        corridas === null
          ? { etiqueta: t('calidad_evals.kpi_fallos'), valor: null, estado: 'vacio' as const, mensaje: t('calidad_evals.no_leido') }
          : { etiqueta: t('calidad_evals.kpi_fallos'), valor: corridas.fallo, formato: 'entero' as const, tono: corridas.fallo > 0 ? 'bad' as const : undefined },
        ocr === null || ocr.precisionPct === null
          ? { etiqueta: t('calidad_evals.kpi_ocr'), valor: null, estado: 'vacio' as const, mensaje: ocr === null ? t('calidad_evals.no_leido') : tx('qa_medicion_corrida.sin_medir') }
          : { etiqueta: t('calidad_evals.kpi_ocr'), valor: ocr.precisionPct, formato: 'porcentaje' as const },
        casos === null
          ? { etiqueta: t('calidad_evals.kpi_casos'), valor: null, estado: 'vacio' as const, mensaje: t('calidad_evals.no_leido') }
          : { etiqueta: t('calidad_evals.kpi_casos'), valor: casos, formato: 'entero' as const, nota: t('calidad_evals.kpi_casos_nota') },
      ]}
      graficas={[
        <Tarjeta key="veredicto" titulo={t('calidad_evals.grafica_veredicto')} contenida
          {...(corridas === null ? { estado: 'vacio' as const, mensaje: t('calidad_evals.no_leido') } : corridas.total === 0 ? { estado: 'vacio' as const, mensaje: t('calidad_evals.sin_corridas_ventana') } : { estado: 'ok' as const })}>
          {corridas !== null && corridas.total > 0 ? (
            <BarraApilada
              etiqueta={t('calidad_evals.grafica_veredicto')}
              formato={(v) => numero(v, idioma)}
              tramos={[
                { etiqueta: 'OK', valor: corridas.ok },
                { etiqueta: tx('calidad_evals.parciales'), valor: corridas.parcial },
                { etiqueta: tx('observabilidad.fallos'), valor: corridas.fallo },
              ]}
            />
          ) : null}
        </Tarjeta>,
        <Tarjeta key="tropiezos" titulo={t('calidad_evals.grafica_tropiezos')} contenida
          {...(corridas === null ? { estado: 'vacio' as const, mensaje: t('calidad_evals.no_leido') } : tropiezos.length === 0 ? { estado: 'vacio' as const, mensaje: t('calidad_evals.sin_tropiezos') } : { estado: 'ok' as const })}>
          {tropiezos.length > 0 ? (
            <BarList
              etiqueta={t('calidad_evals.grafica_tropiezos')}
              formato={(v) => numero(v, idioma)}
              items={tropiezos.map((a) => ({ clave: a.agente, etiqueta: a.agente, valor: a.fallo + a.parcial, nota: `${numero(a.fallo, idioma)} / ${numero(a.parcial, idioma)}` }))}
            />
          ) : null}
        </Tarjeta>,
      ]}
    >
      <FilaTarjetas variante="6-6">
        {/* ── 1 · El examen del analista (EVALOPS 0134) ── */}
        <TarjetaExamen tx={tx} idioma={idioma}
          titulo={t('calidad_evals.el_examen_del_analista')}
          estado={evals}
          avisoDrift={tx('calidad_evals.el_prompt_vivo_no_es_el')}
        />
        {/* ── 1b · El examen fiscal del contador (E.26, 0254) ── */}
        <TarjetaExamen tx={tx} idioma={idioma}
          titulo={t('calidad_evals.el_examen_del_contador')}
          estado={evalsContador}
          avisoDrift={tx('calidad_evals.el_prompt_vivo_no_es_el_2')}
          conNotas
        />
      </FilaTarjetas>

      {/* ── 2 · Los veredictos de las corridas de agentes (0102) ──────── */}
      <Tarjeta titulo={t('calidad_evals.corridas_de_agentes_ultimos', { DIAS_VENTANA })}>
        {corridas === null ? (
          <p className="m-0 text-sm text-[var(--bad)]">
            
            {t('calidad_evals.no_se_pudieron_leer')}
          </p>
        ) : corridas.total === 0 ? (
          <p className="m-0 text-sm text-muted">{rico(tx('calidad_evals.cero_corridas_en_la_ventana_eso'), { e0: (c) => <Link href="/admin/crons" className="underline">{c}</Link> })}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="tabular">{tx('calidad_evals.n_corridas', { n: numero(corridas.total, idioma) })}</span>
              <StatusChip tono="ok">{tx('calidad_evals.n_ok', { n: numero(corridas.ok, idioma) })}</StatusChip>
              {corridas.parcial > 0 && <StatusChip tono="warn">{tx('calidad_evals.n_parciales', { n: numero(corridas.parcial, idioma) })}</StatusChip>}
              {corridas.fallo > 0
                ? <StatusChip tono="bad">{tx('calidad_evals.n_fallos', { n: numero(corridas.fallo, idioma) })}</StatusChip>
                : <span className="text-muted">{tx('calidad_evals.0_fallos')}</span>}
            </div>
            {corridas.porAgente.some((a) => a.fallo > 0 || a.parcial > 0) && (
              <div className="mt-2">
                <TablaBase
                  etiqueta={t('calidad_evals.agentes_con_tropiezos_en')}
                  columnas={columnasTropiezos(tx, idioma)}
                  filas={corridas.porAgente.filter((a) => a.fallo > 0 || a.parcial > 0)}
                  idFila={(a) => a.agente}
                  altoMaximo={false}
                />
              </div>
            )}
            <p className="m-0 mt-2 text-xs text-muted">{rico(tx('calidad_evals.el_detalle_corrida_por_corrida_vive'), { e0: (c) => <Link href="/admin/corridas" className="underline">{c}</Link>, e1: (c) => <Link href="/admin/agentes" className="underline">{c}</Link> })}</p>
          </>
        )}
      </Tarjeta>

      {/* ── 3 · La precisión del OCR contra verdad de terreno (0239/0246) ─ */}
      <Tarjeta titulo={t('calidad_evals.precision_del_ocr_banco')}>
        {ocr === null ? (
          <p className="m-0 text-sm text-[var(--bad)]">
            
            {t('calidad_evals.no_se_pudo_leer')}
          </p>
        ) : ocr.fotosMedidas === 0 ? (
          <p className="m-0 text-sm text-muted">{rico(tx('calidad_evals.el_banco_existe_y_ninguna_foto'), { e0: (c) => <Link href="/admin/qa" className="underline">{c}</Link> })}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span>{tx('calidad_evals.precision_de_campos')}{' '}<span className="tabular font-semibold">
                  {ocr.precisionPct === null ? tx('qa_medicion_corrida.sin_medir') : porcentaje(ocr.precisionPct, 1, idioma)}
                </span>
                {ocr.precisionPct !== null && (
                  <span className="text-muted">{tx('calidad_evals.ok_medidos', { numero: numero(ocr.camposOk, idioma), numero2: numero(ocr.camposOk + ocr.camposMal, idioma) })}</span>
                )}
              </span>{rico(tx('calidad_evals.e0_foto_s_medidas_e0', { numero: numero(ocr.fotosMedidas, idioma) }), { e0: (c) => <span className="tabular text-muted">{c}</span> })}{ocr.alucinaciones > 0
                ? <StatusChip tono="bad">{numero(ocr.alucinaciones, idioma)}{' '}{tx('calidad_evals.alucinacion_es')}</StatusChip>
                : <StatusChip tono="ok">{tx('calidad_evals.0_alucinaciones')}</StatusChip>}
              {ocr.camposNoMedidos > 0 && (
                <span className="text-muted">{numero(ocr.camposNoMedidos, idioma)}{' '}{tx('calidad_evals.campo_s_sin_medir')}</span>
              )}
            </div>
            <p className="m-0 mt-2 text-xs text-muted">{rico(tx('calidad_evals.misma_aritmetica_que_el_panel_de'), { e0: (c) => <Link href="/admin/qa" className="underline">{c}</Link> })}{' '}{ocr.ultimaMedicionEn ? fechaHoraMx(ocr.ultimaMedicionEn, idioma) : '—'}.
            </p>
          </>
        )}
      </Tarjeta>

      {/* ── Lo que SIGUE sin fuente — con su razón, no con gráfica vacía ─ */}
      <Tarjeta titulo={t('calidad_evals.lo_que_este_tablero')}>
        <ul className="m-0 list-none space-y-2 p-0 text-sm">
          {[
            t('calidad_evals.feedback_del_contralor_sobre'),
            t('calidad_evals.csat_necesita_encuestas_a'),
            t('calidad_evals.drift_de_calidad_en'),
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
              <span className="text-muted">{item}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_agentes');
  return { title: t('calidad_evals.calidad_evals') };
}
