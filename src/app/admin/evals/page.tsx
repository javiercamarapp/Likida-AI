import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getEstadoEvals, veredictoAgregado, type AgenteExaminado, type EstadoEvals } from '@/lib/admin/evals';
import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { fechaHoraMx, numero } from '@/lib/formato';
import { Aviso, Boton, Chip, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import './evals.css';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

/** El JUEZ HUMANO del diseño (22-evaluacion.md): las trampas quedan en
 *  'revisar' a propósito y aquí se marcan. Al marcar, el veredicto de la
 *  CORRIDA se recalcula con la misma regla binaria (una trampa fallada
 *  tumba todo). */
async function marcarResultado(fd: FormData) {
  'use server';
  const { userId } = await requireSuperadmin();
  const id = String(fd.get('id') ?? '');
  const veredicto = String(fd.get('veredicto') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  if (veredicto !== 'paso' && veredicto !== 'fallo') return;
  const admin = supabaseAdmin();
  // A37-S06-10: la corrida a recalcular se DERIVA del resultado en la base, no del formulario (el cliente
  // podía mandar el id de otra corrida y recalcular su veredicto agregado).
  const { data: fila, error: errFila } = await admin.from('eval_resultado').select('corrida_id').eq('id', id).maybeSingle();
  if (errFila) {
    logger.error('evals.resultado_no_leido', { id, err: errFila.message });
    redirect('/admin/evals?error=marcar&paso=leer');
  }
  if (!fila?.corrida_id) return;
  const corridaId = String(fila.corrida_id);
  // Solo lo que sigue en revisión se marca — un veredicto emitido no se
  // reescribe en silencio (el WHERE es el candado).
  //
  // ADM-14 (auditoría 24, MEDIO): las TRES escrituras de aquí abajo
  // descartaban su `error` — el juez humano hacía clic en "pasó" creyendo
  // que quedó registrado y podía no ser cierto. `redirect('?error=marcar')`
  // en vez de un `return` mudo: el clic tiene que decir si de verdad pegó.
  const { data, error: errMarcar } = await admin.from('eval_resultado')
    // A37-S06-10: el juez queda identificado (quién y cuándo) en el detalle: el gate de re-examen tiene responsable.
    .update({ veredicto, detalle: `juez humano: ${veredicto} · ${userId} · ${new Date().toISOString()}` })
    .eq('id', id).eq('veredicto', 'revisar').select('id');
  if (errMarcar) {
    logger.error('evals.marcar_no_escrito', { id, err: errMarcar.message });
    redirect('/admin/evals?error=marcar');
  }
  if (!data?.length) return; // ya no estaba en 'revisar' (otro juez lo marcó primero) — no es un error
  const { data: todos, error: errLeer } = await admin.from('eval_resultado')
    .select('veredicto').eq('corrida_id', corridaId);
  if (errLeer) {
    logger.error('evals.recalculo_no_leido', { corridaId, err: errLeer.message });
    redirect('/admin/evals?error=marcar');
  }
  if (todos) {
    const { error: errAgregado } = await admin.from('eval_corrida')
      .update({ veredicto: veredictoAgregado(todos.map((t) => t.veredicto as 'paso' | 'fallo' | 'revisar')) })
      .eq('id', corridaId);
    if (errAgregado) {
      logger.error('evals.veredicto_corrida_no_escrito', { corridaId, err: errAgregado.message });
      redirect('/admin/evals?error=marcar');
    }
  }
  revalidatePath('/admin/evals');
}

const agentesTr = (t: TSistema = T_SISTEMA_ES): ReadonlyArray<{ agente: AgenteExaminado; titulo: string; comando: string }> => ([
  { agente: 'analista', titulo: t('evals.el_analista_chat_del_panel'), comando: 'npx tsx scripts/evals/correr-analista.ts' },
  // E.26 (fase 2 de EVALOPS): las 32 preguntas doradas de 22-evaluacion.md.
  // El hash del contador cubre reglas + CORPUS (corpus_texto.ts): cambiar una
  // ficha de normas/ también acusa drift, como exige la regla de re-examen.
  { agente: 'contador', titulo: t('evals.el_contador_examen_fiscal_de_32'), comando: 'npx tsx scripts/evals/correr-contador.ts' },
]);

interface PorCaso { id: string; veredicto: string; detalle: string | null; pregunta: string; tipo: string; clave: string | null }

const TONO: Record<string, TonoEstado> = { paso: 'ok', fallo: 'bad', revisar: 'warn' };

interface CorridaFila { id: string; agente: string; veredicto: string | null; iniciada_en: string; casos: number | null; costo_usd: number | null; prompt_hash: string }

/**
 * EVALOPS (0134 + 0254) — el estado del examen de CADA agente examinado y la
 * REGLA DE RE-EXAMEN con cara: si el prompt vivo no es el examinado, esta
 * página lo acusa en grande. Los exámenes se corren a mano (cuestan llamadas
 * reales); el comando de cada uno está en su tarjeta.
 */
export default async function Evals({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { t, idioma } = await getT('admin_sistema');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = await searchParams;
  const admin = supabaseAdmin();
  const secciones: Array<{ agente: AgenteExaminado; titulo: string; comando: string; estado: EstadoEvals | null; porCaso: PorCaso[] }> = [];
  let corridas: CorridaFila[] = [];
  // ADM-14 (auditoría 24, MEDIO): `r.data ?? []` sin comprobar `r.error` —
  // una lectura caída se pintaba idéntica a "ninguna corrida todavía", que
  // es justo lo contrario ("no se sabe" ≠ "no hay"). `corridasError` guarda
  // el porqué para que la pantalla lo diga.
  let corridasError: string | null = null;
  try {
    const r = await admin.from('eval_corrida')
      .select('id, agente, veredicto, iniciada_en, casos, costo_usd, prompt_hash')
      .order('iniciada_en', { ascending: false }).limit(10);
    if (r.error) throw new Error(r.error.message);
    corridas = r.data ?? [];
  } catch (e) {
    corridas = [];
    corridasError = e instanceof Error ? e.message : t('evals.no_se_pudo_leer');
  }

  // PERF (auditoría rendimiento, oct-2026): las lecturas de cada agente son
  // INDEPENDIENTES entre sí (cada una es su propio try/catch) — antes corrían
  // en un `for` secuencial, un viaje redondo a la base detrás del otro. Mismo
  // patrón que ya usa `/admin/calidad-evals` (Promise.all + catch por fuente):
  // el bloque de cada agente sigue cayendo solo a `estado = null` si falla,
  // sin tumbar al otro.
  secciones.push(...await Promise.all(agentesTr(t).map(async (def) => {
    let estado: EstadoEvals | null = null;
    let porCaso: PorCaso[] = [];
    try {
      estado = await getEstadoEvals(def.agente);
      if (estado.ultima) {
        const rr = await admin.from('eval_resultado')
          .select('id, veredicto, detalle, eval_caso(pregunta, tipo, clave)')
          .eq('corrida_id', estado.ultima.id).order('creado_en');
        // ADM-14: mismo hueco — `rr.data ?? []` sin mirar `rr.error` pintaba
        // "Aún no hay corrida registrada" sobre una lectura que en realidad
        // FALLÓ. Se lanza para que el catch de este bloque haga `estado =
        // null` (el mismo camino que ya usa la pantalla para "no se pudo
        // leer el estado del examen").
        if (rr.error) throw new Error(rr.error.message);
        porCaso = (rr.data ?? []).map((f) => {
          const caso = f.eval_caso as unknown as { pregunta: string; tipo: string; clave: string | null } | null;
          return { id: f.id, veredicto: f.veredicto, detalle: f.detalle, pregunta: caso?.pregunta ?? '—', tipo: caso?.tipo ?? '—', clave: caso?.clave ?? null };
        });
      }
    } catch { estado = null; }
    return { ...def, estado, porCaso };
  })));

  const sinLeer = secciones.filter((x) => x.estado === null).length;
  const sinReexaminar = secciones.filter((x) => x.estado?.driftDePrompt).length;

  const columnasCaso = (ultimaId: string | undefined): ColumnaBase<PorCaso>[] => [
    {
      id: 'caso', titulo: t('evals.caso'), principal: true,
      celda: (c) => (
        <>
          <span>{c.clave ? `${c.clave} · ` : ''}{c.pregunta}</span>
          {c.detalle ? <span className="rv-evals__sub">{c.detalle}</span> : null}
        </>
      ),
    },
    { id: 'tipo', titulo: t('evals.tipo'), celda: (c) => <Chip>{c.tipo}</Chip> },
    { id: 'veredicto', titulo: t('qa_banco_verdad.veredicto'), celda: (c) => <StatusChip tono={TONO[c.veredicto] ?? 'neutral'}>{c.veredicto}</StatusChip> },
    {
      id: 'juez', titulo: t('evals.juez_humano'),
      celda: (c) => c.veredicto === 'revisar' && ultimaId ? (
        <span className="rv-evals__juez">
          {(['paso', 'fallo'] as const).map((v) => (
            <form key={v} action={marcarResultado}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="corridaId" value={ultimaId} />
              <input type="hidden" name="veredicto" value={v} />
              <Boton type="submit" variante={v === 'paso' ? 'secondary' : 'danger'} tamano="sm">{v === 'paso' ? t('evals.paso') : t('qa_medicion_corrida.fallo')}</Boton>
            </form>
          ))}
        </span>
      ) : <span>—</span>,
    },
  ];

  const columnasCorrida: ColumnaBase<CorridaFila>[] = [
    { id: 'agente', titulo: t('observabilidad.agente'), principal: true, celda: (c) => <Chip>{c.agente}</Chip> },
    { id: 'veredicto', titulo: t('qa_banco_verdad.veredicto'), celda: (c) => c.veredicto ? <StatusChip tono={TONO[c.veredicto] ?? 'neutral'}>{c.veredicto}</StatusChip> : <StatusChip tono="muted">{t('evals.en_curso')}</StatusChip> },
    { id: 'casos', titulo: t('evals.casos'), alinear: 'der', celda: (c) => (c.casos === null ? '—' : numero(c.casos, idioma)) },
    { id: 'huella', titulo: t('evals.prompt'), celda: (c) => <span className="rv-evals__huella">{c.prompt_hash.slice(0, 10)}…</span> },
    { id: 'cuando', titulo: t('trust_safety.cuando'), alinear: 'der', celda: (c) => fechaHoraMx(c.iniciada_en, idioma) },
  ];

  return (
    <MarcoPagina
      area="Calidad"
      titulo={t('qa_corrida_viva.calidad')}
      apoyo={t('evals.examenes_el_estado_del_examen_de')}
    >
      {sp.error === 'marcar' && (
        <Aviso tono="error">{t('evals.no_se_pudo_registrar_el_veredicto')}</Aviso>
      )}

      <TiraCifras
        etiqueta={t('evals.examenes')}
        items={[
          { etiqueta: t('evals.agentes_examinados'), valor: agentesTr(t).length, estado: 'ok' },
          { etiqueta: t('evals.con_prompt_sin_re_examinar'), valor: sinLeer > 0 ? null : sinReexaminar, estado: sinLeer > 0 ? 'error' : 'ok', tono: sinReexaminar > 0 ? 'bad' : undefined, nota: t('evals.el_prompt_vivo_no_es_el') },
          { etiqueta: t('observabilidad.corridas_recientes'), valor: corridasError === null ? corridas.length : null, estado: corridasError === null ? 'ok' : 'error', nota: t('evals.las_ultimas_10_todos_los_agentes') },
        ]}
      />

      {secciones.map(({ agente, titulo, comando, estado, porCaso }) => (
        <Tarjeta key={agente} titulo={titulo} estado={estado === null ? 'error' : 'ok'} mensaje={t('evals.no_se_pudo_leer_el_estado', { agente })} reintentar>
          {estado !== null && (
            <>
              {/* ── EL GATE, con cara ── */}
              {estado.driftDePrompt ? (
                <Aviso tono="error" titulo={t('evals.el_prompt_del_cambio_desde_el', { agente, v: estado.ultima ? '' : t('evals.nunca_se_ha_examinado') })}>{t('evals.re_examina_antes_de_desplegar_cambios')}{agente === 'contador' ? t('evals.el_hash_cubre_reglas_corpus_de') : ''}{t('evals.corre')}{' '}<code className="tabular">{comando}</code>{' '}{t('evals.llamadas_reales_se_corre_a_mano')}<span className="rv-evals__sub">{t('evals.prompt_vivo_ultimo_examinado', { estado: estado.hashVivo.slice(0, 12) })}{' '}{estado.ultima ? `${estado.ultima.promptHash.slice(0, 12)}…` : 'ninguno'}</span>
                </Aviso>
              ) : (
                <Aviso tono="ok" titulo={t('evals.el_prompt_vivo_es_el_examinado', { v: estado.ultima?.veredicto ?? t('evals.sin_veredicto') })}>{rico(t('evals.e0_prompt_e0', { estado: estado.hashVivo.slice(0, 12) }), { e0: (c) => <span className="rv-evals__sub">{c}</span> })}</Aviso>
              )}

              {/* La calificación desglosada que dejó el runner (trampas, inventos, falsa cautela), tal cual, buena o mala. */}
              {estado.ultima?.notas ? <p className="rv-evals__nota">{rico(t('evals.strong_calificacion_de_la_ultima_corrida'), { strong: (c) => <strong>{c}</strong> })}{' '}{estado.ultima.notas}</p> : null}

              <TablaBase
                etiqueta={t('evals.ultima_corrida_del_caso_por_caso', { agente })}
                columnas={columnasCaso(estado.ultima?.id)}
                filas={porCaso}
                idFila={(c) => c.id}
                tarjetaMovil
                vacio={{ titulo: t('evals.sin_corrida_registrada'), texto: t('evals.el_examen_son_casos_sembrados_en', { numero: numero(estado.casosActivos, idioma) }) }}
              />
            </>
          )}
        </Tarjeta>
      ))}

      <Tarjeta titulo={t('evals.corridas_todos_los_agentes')} estado={corridasError !== null ? 'error' : 'ok'} mensaje={t('evals.no_se_pudo_leer_esto_no', { corridasError: corridasError ?? '' })} reintentar>
        <TablaBase
          etiqueta={t('evals.corridas_de_examenes')}
          columnas={columnasCorrida}
          filas={corridas}
          idFila={(c) => c.id}
          tarjetaMovil
          vacio={{ titulo: t('evals.ninguna_todavia') }}
        />
      </Tarjeta>
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('qa_corrida_viva.calidad') };
}
