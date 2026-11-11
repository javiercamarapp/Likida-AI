import {
  listarAgentes, DEPARTAMENTOS, DISPARADORES, ESTADOS_AGENTE, type AgenteDefinido,
} from '@/lib/likida/agentes/definiciones';
import { listarInterruptores } from '@/lib/likida/interruptores';
import { contarPendientesPorAgente } from '@/lib/likida/agentes/insumos';
import { estadoRealDeAgente, TONO_ESTADO_REAL, type EstadoReal } from '@/lib/likida/agentes/estado-real';
import { autonomiaDe } from '@/lib/likida/agentes/autonomia';
import { nombreNivelTr, rotuloEstadoRealTr } from '@/lib/i18n/rotulos_tr';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { getConsumoPorAgente } from '@/lib/admin/consumo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';
import { fechaHoraMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import {
  Aviso, Chip, Disclosure, FormaConAviso, MarcoPagina, StatusChip, Tarjeta, TablaBase, CampoTexto, CampoSelect, type ColumnaBase,
  type ResultadoAccion, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { AccionesAgente } from './acciones-agente';
import { getT } from '@/lib/i18n/servidor';
import { corridaDe, haceTiempo, leerCorridas, resultadoCorrida } from './corrida-visual';
import './agentes.css';

export type AccionAlta = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
/** Apagar/encender la palanca de un agente, desde su propia fila (siempre con motivo). */
export type AccionPalanca = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
export type AccionConfig = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Éxito de 30 días POR agente (RPC `consumo_agentes`, agrupa en la base). LANZA en error: su celda dice «no se pudo leer». */
async function exitoTreintaDias(): Promise<Map<string, { ok: number; total: number }>> {
  const desde = new Date(ahoraMs() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin().rpc('consumo_agentes', { p_desde: desde, p_inicio_hoy: new Date(ahoraMs()).toISOString() });
  if (error) throw new Error(`exitoTreintaDias: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('exitoTreintaDias: consumo_agentes devolvió otra forma.');
  const acc = new Map<string, { ok: number; total: number }>();
  for (const f of data as Array<Record<string, unknown>>) {
    const agente = typeof f.agente === 'string' ? f.agente : '';
    if (!agente) continue;
    const total = Number(f.n ?? 0);
    acc.set(agente, { ok: total - Number(f.fallos ?? 0), total });
  }
  return acc;
}

async function ultimaCorridaDe(agente: string): Promise<{ inicio: string; estado: string } | null> {
  const { data, error } = await supabaseAdmin().from('agente_corrida').select('inicio, estado').eq('agente', agente).order('inicio', { ascending: false }).limit(1);
  if (error) throw new Error(`ultimaCorridaDe/${agente}: ${error.message}`);
  const f = (data ?? [])[0] as { inicio?: string; estado?: string } | undefined;
  return f ? { inicio: String(f.inicio), estado: String(f.estado) } : null;
}

const HORAS = 3_600_000;

type Corrida = { inicio: string; estado: string } | null | 'error';
interface Fila { a: AgenteDefinido; real: EstadoReal; motivo: string | null; corrida: Corrida; apagado: boolean | null | undefined }

/** El contenido REAL del panel, exportado aparte: la puerta vive en page.tsx y el preview monta ESTO. Las server actions llegan por props. */
export async function PanelAgentesContenido({ accionAlta, accionPalanca, accionConfig }: {
  accionAlta: AccionAlta; accionPalanca: AccionPalanca; accionConfig: AccionConfig;
}) {
  const { t } = await getT('admin_agentes');
  const { t: ts } = await getT('admin_sistema');
  const ahora = ahoraMs();
  const { t: tr } = await getT('agentes');
  const [agentes, interruptores, exito, consumo, insumosPendientes, parados] = await Promise.all([
    listarAgentes(),
    safe(() => listarInterruptores()),
    safe(() => exitoTreintaDias()),
    safe(() => getConsumoPorAgente(ahora)),
    safe(() => contarPendientesPorAgente()),
    getAgentesParados(ahora),
  ]);
  const costoDe = new Map<string, number>((consumo?.agentes ?? []).map((a) => [a.agente, a.gastado30dUsd]));
  const apagadoDe = new Map<string, boolean>((interruptores ?? []).map((i) => [i.id as string, i.apagado]));
  const motivoDe = new Map<string, string | null>((parados?.parados ?? []).map((p) => [p.agente, p.motivo]));

  const corridas = await leerCorridas(agentes.map((a) => a.id), ultimaCorridaDe);

  const filas: Fila[] = agentes.map((a) => {
    const c: Corrida = corridaDe(corridas, a.id); // null = sin corridas (neutro); 'error' = la consulta falló
    const apagado = interruptores === null ? null : apagadoDe.get(`agente:${a.id}`);
    const motivo = motivoDe.get(a.id) ?? null;
    const real = estadoRealDeAgente({
      estado: a.estado,
      runnerHabilitado: a.runnerHabilitado,
      presupuestoDiaUsd: a.presupuestoDiaUsd,
      apagado,
      horasSinCorrer: c === 'error' ? undefined : c === null ? null : (ahora - Date.parse(c.inicio)) / HORAS,
      motivoSalto: motivo,
    });
    return { a, real, motivo, corrida: c, apagado };
  });

  const vivos = filas.filter((f) => f.a.estado === 'vivo');
  const corriendo = vivos.filter((f) => f.real === 'corriendo').length;
  const bloqueados = vivos.filter((f) => f.real === 'bloqueado_bandeja').length;
  const parados72 = vivos.filter((f) => f.real === 'parado').length;
  const apagados = interruptores === null ? null : vivos.filter((f) => f.apagado === true).length;
  const costo30 = consumo === null ? null : consumo.agentes.reduce((s, a) => s + a.gastado30dUsd, 0);
  const rotuloDepto = new Map<string, string>(DEPARTAMENTOS.map((d) => [d.valor, d.rotulo]));
  const estadosRotulo = ESTADOS_AGENTE.map((e) => ({ valor: e.valor as string, rotulo: e.rotulo as string }));

  const columnas: ColumnaBase<Fila>[] = [
    {
      id: 'agente', titulo: t('agentes_contenido.agente'), principal: true,
      celda: ({ a }) => {
        const e = exito?.get(a.id);
        const pct = e && e.total > 0 ? t('agentes_contenido.de_exito', { Math: Math.round((e.ok / e.total) * 100), total: e.total }) : exito === null ? t('agentes_contenido.exito_sin_dato') : t('agentes_contenido.sin_corridas_en_30');
        const costo = consumo === null ? 'costo sin dato' : (costoDe.get(a.id) ?? 0) > 0 ? t('agentes_contenido.en_30_dias', { costoDe: usd(costoDe.get(a.id) ?? 0) }) : t('agentes_contenido.sin_costo_medido');
        const tope = a.presupuestoDiaUsd === null ? t('agentes_contenido.sin_tope_declarado') : t('agentes_contenido.dia', { presupuestoDiaUsd: usd(a.presupuestoDiaUsd) });
        // Una sola línea de apoyo (departamento y éxito); modelo, tope y costo van en el tooltip y en «Configurar», no en cada fila.
        return (
          <span title={`${a.modeloRol ?? 'modelo sin declarar'} · ${tope} · ${costo}`}>
            <strong>{a.nombre}</strong>
            <span className="rv-agente-sub">{rotuloDepto.get(a.departamento) ?? a.departamento} · {pct}</span>
          </span>
        );
      },
    },
    {
      id: 'estado', titulo: t('agentes_contenido.estado_real'),
      // Solo el chip: el motivo (la misma frase larga en 30 filas) se dice UNA vez en el aviso de arriba; aquí queda en el título del chip.
      celda: ({ a, real, motivo }) => (
        <>
          <span title={motivo && (real === 'bloqueado_bandeja' || real === 'parado') ? motivo : undefined}>
            <StatusChip tono={TONO_ESTADO_REAL[real] as TonoEstado}>{rotuloEstadoRealTr(real, ts)}</StatusChip>
          </span>
          {a.experimental ? <Chip>Experimental</Chip> : null}
        </>
      ),
    },
    {
      id: 'corrida', titulo: t('agentes_contenido.ultima_corrida'),
      celda: ({ a, corrida }) => corrida === 'error'
        ? <span className="rv-agente-nowrap">{t('agentes_contenido.no_se_pudo_leer')}</span>
        : corrida === null
          ? <span className="rv-agente-nowrap">{a.estado === 'vivo' ? t('agentes_contenido.sin_corridas_todavia') : t('agentes_contenido.no_corre_en_el')}</span>
          : (
            <>
              <span className="rv-agente-fecha">{fechaHoraMx(corrida.inicio)}</span>
              {(() => {
                const r = resultadoCorrida(corrida.estado, tr);
                return (
                  <span className="rv-agente-sub rv-agente-resultado">
                    {r.tono ? <StatusChip tono={r.tono}>{r.texto}</StatusChip> : r.texto}
                    <span> · {haceTiempo(corrida.inicio, ahora, tr)}</span>
                  </span>
                );
              })()}
            </>
          ),
    },
    {
      id: 'autonomia', titulo: t('agentes_contenido.autonomia'),
      celda: ({ a }) => {
        const n = autonomiaDe(a.id);
        return <span className="rv-agente-nowrap">{`${n.nivel} · ${nombreNivelTr(n.nivel, ts)}`}</span>;
      },
    },
    {
      id: 'palanca', titulo: t('agentes_contenido.kill_switch'),
      celda: ({ a, apagado }) => a.estado !== 'vivo'
        ? <span className="rv-agente-nowrap">—</span>
        : apagado === null
          ? <span className="rv-agente-nowrap">{t('agentes_contenido.no_se_pudo_leer')}</span>
          : apagado === undefined
            ? <span className="rv-agente-nowrap">{t('agentes_contenido.sin_palanca_propia')}</span>
            : <StatusChip tono={apagado ? 'bad' : 'ok'}>{apagado ? 'Apagado' : 'Encendido'}</StatusChip>,
    },
    {
      id: 'acciones', titulo: t('agentes_contenido.acciones'),
      celda: ({ a, apagado }) => (
        <AccionesAgente
          id={a.id} nombre={a.nombre} palanca={`agente:${a.id}`}
          apagado={a.estado === 'vivo' && typeof apagado === 'boolean' ? apagado : null}
          accionPalanca={accionPalanca} accionConfig={accionConfig} estados={estadosRotulo}
          actual={{
            estado: a.estado, runnerHabilitado: a.runnerHabilitado,
            presupuestoDiaUsd: a.presupuestoDiaUsd, modeloRol: a.modeloRol,
          }}
          etiquetaInsumos={insumosPendientes === null ? t('agentes_contenido.insumos_2') : (insumosPendientes.get(a.id) ?? 0) > 0 ? t('agentes_contenido.insumos', { insumosPendientes: insumosPendientes.get(a.id) ?? 0 }) : t('agentes_contenido.insumos_2')}
        />
      ),
    },
  ];

  return (
    <MarcoPagina
      area="Agentes"
      titulo={t('agentes_contenido.agentes')}
      apoyo={t('agentes_contenido.que_agentes_hay_cuales')}
    >
      {parados === null ? (
        <Aviso tono="warn">{t('agentes_contenido.no_se_pudo_leer_2')}</Aviso>
      ) : bloqueados + parados72 > 0 ? (
        <Aviso tono="warn">
          {bloqueados + parados72} agentes vivos llevan {parados.umbralHoras}  {t('agentes_contenido.horas_o_mas_sin')}
          {bloqueados > 0 ? `; ${bloqueados} por la bandeja de aprobaciones llena` : ''}. Vaciar la bandeja los destraba; no se reabren por sí solos.
        </Aviso>
      ) : null}

      <TiraCifras
        etiqueta={t('agentes_contenido.estado_de_los_agentes')}
        items={[
          { etiqueta: t('agentes_contenido.agentes_vivos'), valor: vivos.length, estado: 'ok', nota: t('agentes_contenido.en_el_catalogo', { length: agentes.length }) },
          { etiqueta: t('agentes_contenido.corriendo_de_verdad'), valor: parados === null || interruptores === null ? null : corriendo, estado: parados === null || interruptores === null ? 'error' : 'ok', nota: t('agentes_contenido.con_corrida_reciente_y') },
          { etiqueta: t('agentes_contenido.bloqueados_o_parados'), valor: parados === null ? null : bloqueados + parados72, estado: parados === null ? 'error' : 'ok', tono: parados !== null && bloqueados + parados72 > 0 ? 'warn' : undefined, nota: t('agentes_contenido.h_sin_correr_o', { umbralHoras: parados?.umbralHoras ?? 72 }) },
          { etiqueta: t('agentes_contenido.apagados'), valor: apagados, estado: apagados === null ? 'error' : 'ok', tono: apagados ? 'bad' : undefined, nota: t('agentes_contenido.con_el_kill_switch') },
          { etiqueta: t('agentes_contenido.costo_de_ia_30'), valor: costo30 === null ? null : usd(costo30), estado: costo30 === null ? 'error' : 'ok', nota: t('agentes_contenido.suma_de_los_agentes') },
        ]}
      />

      <Tarjeta
        titulo={t('agentes_contenido.catalogo_de_agentes')}
        estado={agentes.length === 0 ? 'vacio' : 'ok'}
        mensaje={t('agentes_contenido.el_catalogo_esta_vacio')}
        detalle={t('agentes_contenido.da_de_alta_un')}
      >
        <TablaBase
          etiqueta={t('agentes_contenido.agentes_del_catalogo')}
          columnas={columnas}
          filas={filas}
          idFila={(f) => f.a.id}
          tarjetaMovil
          altoMaximo={false}
          vacio={{ titulo: t('agentes_contenido.sin_agentes') }}
        />
      </Tarjeta>

      <Disclosure titulo={t('agentes_contenido.dar_de_alta_un')} resumen="Nace diseñado, nunca vivo">
        <FormaConAviso accion={accionAlta} boton="Dar de alta" columnas="md:grid-cols-1">
          <div className="rv-agente-alta">
            <CampoTexto etiqueta={t('agentes_contenido.id_tecnico')} name="id" required obligatorio placeholder="cazador_censo" ayuda={t('agentes_contenido.minusculas_numeros_y_guion')} />
            <CampoTexto etiqueta={t('agentes_contenido.nombre')} name="nombre" required obligatorio placeholder={t('agentes_contenido.cazador_de_censo')} />
            <CampoSelect etiqueta={t('agentes_contenido.departamento')} name="departamento" defaultValue="leads">
              {DEPARTAMENTOS.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
            </CampoSelect>
            <CampoSelect etiqueta={t('agentes_contenido.disparador')} name="disparador" defaultValue="manual">
              {DISPARADORES.map((d) => <option key={d} value={d}>{d}</option>)}
            </CampoSelect>
            <CampoTexto etiqueta={t('agentes_contenido.que_hace')} name="descripcion" placeholder={t('agentes_contenido.una_linea_honesta')} />
            <CampoTexto etiqueta={t('agentes_contenido.donde_vive_su_prompt')} name="promptRef" placeholder="13-Agentes-de-AI/…/prompts/x.md" />
            <CampoTexto etiqueta={t('agentes_contenido.presupuesto_por_dia_usd')} name="presupuestoDiaUsd" placeholder={t('agentes_contenido.vacio_sin_tope_declarado')} ayuda={t('agentes_contenido.el_tope_se_declara')} />
          </div>
        </FormaConAviso>
        <p className="rv-agente-sub">{t('agentes_contenido.un_agente_nuevo_nace')}</p>
      </Disclosure>

      <Disclosure titulo={t('agentes_contenido.como_se_lee_el')} resumen="Qué significa cada rótulo">
        <ul>
          <li><strong>Corriendo</strong>{t('agentes_contenido.vivo_con_palanca_arriba')}</li>
          <li><strong>{t('agentes_contenido.bloqueado_por_bandeja')}</strong>{t('agentes_contenido.el_runner_lo_salta')}</li>
          <li><strong>Parado</strong>{t('agentes_contenido.habilitado_pero_sin_corrida')}</li>
          <li><strong>{t('agentes_contenido.sin_presupuesto')}</strong>{t('agentes_contenido.el_runner_no_despacha')}</li>
          <li><strong>{t('agentes_contenido.corre_por_su_cron')}</strong>{t('agentes_contenido.no_depende_del_runner')}</li>
        </ul>
        <p className="rv-agente-sub">{t('agentes_contenido.la_autonomia_es_el')}</p>
      </Disclosure>
    </MarcoPagina>
  );
}
