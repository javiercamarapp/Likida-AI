import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import Link from 'next/link';
import { getEstadoEvals } from '@/lib/admin/evals';
import { getCalidadCorridas, getCalidadOcr } from '@/lib/admin/calidad';
import { ahoraMs } from '@/lib/saludo';
import { numero, porcentaje, fechaHoraMx } from '@/lib/formato';
import { Aviso, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';

import { getT } from '@/lib/i18n/servidor';
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
function estadoDeVeredicto(v: string | null): { tono: TonoEstado; texto: string } {
  if (v === 'paso') return { tono: 'ok', texto: 'pasó' };
  if (v === 'fallo') return { tono: 'bad', texto: 'falló' };
  if (v === 'revisar') return { tono: 'warn', texto: 'en revisión (juez humano)' };
  return { tono: 'neutral', texto: 'sin veredicto' };
}

type EstadoEvals = NonNullable<Awaited<ReturnType<typeof getEstadoEvals>>>;

/** Una tarjeta de examen (analista o contador): drift de prompt, última corrida, casos activos y cómo correrlo. Las dos comparten
 *  forma; solo cambian el aviso de drift, las notas del runner y el script. */
function TarjetaExamen({ titulo, estado, avisoDrift, conNotas }: {
  titulo: string;
  estado: EstadoEvals | null;
  avisoDrift: string;
  conNotas?: boolean;
}) {
  return (
    <Tarjeta titulo={titulo}>
      {estado === null ? (
        <p className="m-0 text-sm text-[var(--bad)]">
          No se pudo leer el estado del examen — esto NO significa que el examen esté bien ni mal.
        </p>
      ) : (
        <>
          {estado.driftDePrompt && (
            <Aviso tono="warn">
              {estado.ultima === null ? 'El examen NUNCA se ha corrido: el prompt vivo no está examinado.' : avisoDrift}
            </Aviso>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {estado.ultima === null ? (
              <span className="text-muted">Sin corridas registradas.</span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  Última corrida:{' '}
                  <StatusChip tono={estadoDeVeredicto(estado.ultima.veredicto).tono}>
                    {estadoDeVeredicto(estado.ultima.veredicto).texto}
                  </StatusChip>
                </span>
                <span className="text-muted">{fechaHoraMx(estado.ultima.iniciadaEn)}</span>
                {estado.ultima.casos !== null && <span className="text-muted">{numero(estado.ultima.casos)} caso(s)</span>}
              </>
            )}
            <span className="text-muted">{numero(estado.casosActivos)} caso(s) activos en el banco</span>
          </div>
          {/* La calificación desglosada, tal cual la dejó el runner — buena o mala, aquí no se maquilla. */}
          {conNotas && estado.ultima?.notas && <p className="m-0 mt-2 text-xs text-muted">{estado.ultima.notas}</p>}
          <p className="m-0 mt-2 text-xs text-muted">
            El detalle y el juez humano viven en <Link href="/admin/evals" className="underline">Evals</Link>.
            El examen lo corre a mano el equipo técnico (gasta llamadas reales).
          </p>
        </>
      )}
    </Tarjeta>
  );
}

const COLUMNAS_TROPIEZOS: ColumnaBase<AgenteCorridas>[] = [
  { id: 'agente', titulo: 'Agente con tropiezos', principal: true, celda: (a) => <span className="cifra-mono">{a.agente}</span> },
  { id: 'ok', titulo: 'Ok', alinear: 'der', celda: (a) => <span className="tabular">{numero(a.ok)}</span> },
  { id: 'parcial', titulo: 'Parciales', alinear: 'der', celda: (a) => <span className={`tabular ${a.parcial > 0 ? 'text-[var(--warn)]' : ''}`}>{numero(a.parcial)}</span> },
  { id: 'fallo', titulo: 'Fallos', alinear: 'der', celda: (a) => <span className={`tabular ${a.fallo > 0 ? 'text-[var(--bad)]' : ''}`}>{numero(a.fallo)}</span> },
];

export default async function CalidadEvalsPage() {
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

  return (
    <MarcoPagina titulo={t('calidad_evals.calidad_evals')}>
      <Tarjeta titulo={t('calidad_evals.la_calidad_que_ya')}>
        <p className="m-0 text-sm leading-relaxed text-muted">
          
          {t('calidad_evals.cuatro_fuentes_reales_el')}
        </p>
      </Tarjeta>

      {/* ── 1 · El examen del analista (EVALOPS 0134) ─────────────────── */}
      <TarjetaExamen
        titulo={t('calidad_evals.el_examen_del_analista')}
        estado={evals}
        avisoDrift="El prompt vivo NO es el examinado — la regla de re-examen exige volver a correrlo antes de desplegar cambios del agente."
      />

      {/* ── 1b · El examen fiscal del contador (E.26, 0254) ───────────── */}
      <TarjetaExamen
        titulo={t('calidad_evals.el_examen_del_contador')}
        estado={evalsContador}
        avisoDrift="El prompt vivo NO es el examinado (la huella cubre las reglas y el corpus de normas) — re-examina antes de desplegar cambios del agente o de las fichas."
        conNotas
      />

      {/* ── 2 · Los veredictos de las corridas de agentes (0102) ──────── */}
      <Tarjeta titulo={t('calidad_evals.corridas_de_agentes_ultimos', { DIAS_VENTANA })}>
        {corridas === null ? (
          <p className="m-0 text-sm text-[var(--bad)]">
            
            {t('calidad_evals.no_se_pudieron_leer')}
          </p>
        ) : corridas.total === 0 ? (
          <p className="m-0 text-sm text-muted">
            Cero corridas en la ventana. Eso no dice que los agentes estén sanos: dice que no corrieron —
            si deberían haber corrido, el lugar para investigarlo es <Link href="/admin/crons" className="underline">Crons</Link>.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="tabular">{numero(corridas.total)} corridas</span>
              <StatusChip tono="ok">{numero(corridas.ok)} ok</StatusChip>
              {corridas.parcial > 0 && <StatusChip tono="warn">{numero(corridas.parcial)} parciales</StatusChip>}
              {corridas.fallo > 0
                ? <StatusChip tono="bad">{numero(corridas.fallo)} fallos</StatusChip>
                : <span className="text-muted">0 fallos</span>}
            </div>
            {corridas.porAgente.some((a) => a.fallo > 0 || a.parcial > 0) && (
              <div className="mt-2">
                <TablaBase
                  etiqueta={t('calidad_evals.agentes_con_tropiezos_en')}
                  columnas={COLUMNAS_TROPIEZOS}
                  filas={corridas.porAgente.filter((a) => a.fallo > 0 || a.parcial > 0)}
                  idFila={(a) => a.agente}
                  altoMaximo={false}
                />
              </div>
            )}
            <p className="m-0 mt-2 text-xs text-muted">
              El detalle corrida por corrida vive en <Link href="/admin/corridas" className="underline">Corridas</Link>;
              la ficha de cada agente, en <Link href="/admin/agentes" className="underline">Agentes</Link>.
            </p>
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
          <p className="m-0 text-sm text-muted">
            El banco existe y ninguna foto tiene medición todavía — la medición se corre
            desde <Link href="/admin/qa" className="underline">QA</Link> y gasta llamadas reales.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span>
                Precisión de campos:{' '}
                <span className="tabular font-semibold">
                  {ocr.precisionPct === null ? 'sin medir' : porcentaje(ocr.precisionPct)}
                </span>
                {ocr.precisionPct !== null && (
                  <span className="text-muted"> ({numero(ocr.camposOk)} ok / {numero(ocr.camposOk + ocr.camposMal)} medidos)</span>
                )}
              </span>
              <span className="tabular text-muted">{numero(ocr.fotosMedidas)} foto(s) medidas</span>
              {ocr.alucinaciones > 0
                ? <StatusChip tono="bad">{numero(ocr.alucinaciones)} alucinación(es)</StatusChip>
                : <StatusChip tono="ok">0 alucinaciones</StatusChip>}
              {ocr.camposNoMedidos > 0 && (
                <span className="text-muted">{numero(ocr.camposNoMedidos)} campo(s) sin medir</span>
              )}
            </div>
            <p className="m-0 mt-2 text-xs text-muted">
              Misma aritmética que el panel de <Link href="/admin/qa" className="underline">QA</Link> (ok/(ok+mal), lo
              no medido fuera del denominador). Última medición: {ocr.ultimaMedicionEn ? fechaHoraMx(ocr.ultimaMedicionEn) : '—'}.
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
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_agentes');
  return { title: t('calidad_evals.calidad_evals') };
}
