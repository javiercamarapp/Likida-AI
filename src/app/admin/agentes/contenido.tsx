import Link from 'next/link';
import {
  listarAgentes, DEPARTAMENTOS, DISPARADORES, ESTADOS_AGENTE, type AgenteDefinido,
} from '@/lib/likida/agentes/definiciones';
import { listarInterruptores } from '@/lib/likida/interruptores';
import { contarPendientesPorAgente } from '@/lib/likida/agentes/insumos';
import { estadoRealDeAgente, ROTULO_ESTADO_REAL, TONO_ESTADO_REAL, type EstadoReal } from '@/lib/likida/agentes/estado-real';
import { autonomiaDe, NOMBRE_NIVEL } from '@/lib/likida/agentes/autonomia';
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
import { KillSwitchAgente, ConfigurarAgente } from './acciones-agente';
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

const TONO_CORRIDA: Record<string, TonoEstado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };
const HORAS = 3_600_000;

/** Tono por antigüedad: una última corrida vieja NO se pinta como «viva». */
function tonoPorAntiguedad(inicioIso: string, ahora: number): TonoEstado {
  const h = (ahora - Date.parse(inicioIso)) / HORAS;
  return h < 48 ? 'ok' : h < 168 ? 'warn' : 'bad';
}

type Corrida = { inicio: string; estado: string } | null | 'error';
interface Fila { a: AgenteDefinido; real: EstadoReal; motivo: string | null; corrida: Corrida; apagado: boolean | null | undefined }

/** El contenido REAL del panel, exportado aparte: la puerta vive en page.tsx y el preview monta ESTO. Las server actions llegan por props. */
export async function PanelAgentesContenido({ accionAlta, accionPalanca, accionConfig }: {
  accionAlta: AccionAlta; accionPalanca: AccionPalanca; accionConfig: AccionConfig;
}) {
  const ahora = ahoraMs();
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

  const corridas = new Map<string, Corrida>();
  await Promise.all(agentes.map(async (a) => {
    try { corridas.set(a.id, await ultimaCorridaDe(a.id)); } catch { corridas.set(a.id, 'error'); }
  }));

  const filas: Fila[] = agentes.map((a) => {
    const c = corridas.get(a.id) ?? 'error';
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
      id: 'agente', titulo: 'Agente', principal: true,
      celda: ({ a }) => {
        const e = exito?.get(a.id);
        const pct = e && e.total > 0 ? `${Math.round((e.ok / e.total) * 100)} % de éxito (${e.total})` : exito === null ? 'éxito: no se pudo leer' : 'sin corridas en 30 días';
        const costo = consumo === null ? 'costo: no se pudo leer' : (costoDe.get(a.id) ?? 0) > 0 ? `${usd(costoDe.get(a.id) ?? 0)} en 30 días` : 'sin costo medido';
        const tope = a.presupuestoDiaUsd === null ? 'sin tope declarado' : `${usd(a.presupuestoDiaUsd)}/día`;
        return (
          <>
            <strong>{a.nombre}</strong>
            <span className="rv-agente-sub">{rotuloDepto.get(a.departamento) ?? a.departamento} · {a.modeloRol ?? 'modelo sin declarar'} · {tope}</span>
            <span className="rv-agente-sub">{pct} · {costo}</span>
          </>
        );
      },
    },
    {
      id: 'estado', titulo: 'Estado real',
      celda: ({ a, real, motivo }) => (
        <>
          <StatusChip tono={TONO_ESTADO_REAL[real] as TonoEstado}>{ROTULO_ESTADO_REAL[real]}</StatusChip>
          {a.experimental ? <Chip>Experimental</Chip> : null}
          {motivo && (real === 'bloqueado_bandeja' || real === 'parado') ? <span className="rv-agente-sub">{motivo}</span> : null}
        </>
      ),
    },
    {
      id: 'corrida', titulo: 'Última corrida',
      celda: ({ a, corrida }) => corrida === 'error'
        ? <span>No se pudo leer</span>
        : corrida === null
          ? <span>{a.estado === 'vivo' ? 'Sin corridas todavía' : 'No corre en el producto'}</span>
          : (
            <>
              <StatusChip tono={tonoPorAntiguedad(corrida.inicio, ahora)}>{fechaHoraMx(corrida.inicio)}</StatusChip>
              <span className="rv-agente-sub">Terminó: <StatusChip tono={TONO_CORRIDA[corrida.estado] ?? 'neutral'}>{corrida.estado}</StatusChip></span>
            </>
          ),
    },
    {
      id: 'autonomia', titulo: 'Autonomía',
      celda: ({ a }) => {
        const n = autonomiaDe(a.id);
        return <Chip>{`${n.nivel} · ${NOMBRE_NIVEL[n.nivel]}`}</Chip>;
      },
    },
    {
      id: 'palanca', titulo: 'Kill switch',
      celda: ({ a, apagado }) => a.estado !== 'vivo'
        ? <span>—</span>
        : apagado === null
          ? <span>No se pudo leer</span>
          : apagado === undefined
            ? <span>Sin palanca propia</span>
            : <KillSwitchAgente palanca={`agente:${a.id}`} nombre={a.nombre} apagado={apagado} accion={accionPalanca} />,
    },
    {
      id: 'acciones', titulo: 'Acciones',
      celda: ({ a }) => (
        <div className="rv-agente-acciones">
          <ConfigurarAgente
            id={a.id} nombre={a.nombre} accion={accionConfig} estados={estadosRotulo}
            actual={{
              estado: a.estado, runnerHabilitado: a.runnerHabilitado,
              presupuestoDiaUsd: a.presupuestoDiaUsd, modeloRol: a.modeloRol,
            }}
          />
          <Link className="rv-btn rv-btn--ghost rv-btn--sm" href={`/admin/agentes/${a.id}/insumos`}>
            {insumosPendientes === null ? 'Insumos' : (insumosPendientes.get(a.id) ?? 0) > 0 ? `Insumos (${insumosPendientes.get(a.id)})` : 'Insumos'}
          </Link>
        </div>
      ),
    },
  ];

  return (
    <MarcoPagina
      area="Agentes"
      titulo="Agentes"
      apoyo="Qué agentes hay, cuáles corren de verdad y cómo encenderlos, apagarlos o configurarlos."
    >
      {parados === null ? (
        <Aviso tono="warn">No se pudo leer qué agentes están parados. El estado real se muestra con la información que sí llegó; no equivale a «todos corren».</Aviso>
      ) : bloqueados + parados72 > 0 ? (
        <Aviso tono="warn">
          {bloqueados + parados72} agentes vivos llevan {parados.umbralHoras} horas o más sin correr
          {bloqueados > 0 ? `; ${bloqueados} por la bandeja de aprobaciones llena` : ''}. Vaciar la bandeja los destraba; no se reabren por sí solos.
        </Aviso>
      ) : null}

      <TiraCifras
        etiqueta="Estado de los agentes"
        items={[
          { etiqueta: 'Agentes vivos', valor: vivos.length, estado: 'ok', nota: `${agentes.length} en el catálogo` },
          { etiqueta: 'Corriendo de verdad', valor: parados === null || interruptores === null ? null : corriendo, estado: parados === null || interruptores === null ? 'error' : 'ok', nota: 'Con corrida reciente y palanca arriba' },
          { etiqueta: 'Bloqueados o parados', valor: parados === null ? null : bloqueados + parados72, estado: parados === null ? 'error' : 'ok', tono: parados !== null && bloqueados + parados72 > 0 ? 'warn' : undefined, nota: `${parados?.umbralHoras ?? 72} h sin correr o más` },
          { etiqueta: 'Apagados', valor: apagados, estado: apagados === null ? 'error' : 'ok', tono: apagados ? 'bad' : undefined, nota: 'Con el kill switch abajo' },
          { etiqueta: 'Costo de IA, 30 días', valor: costo30 === null ? null : usd(costo30), estado: costo30 === null ? 'error' : 'ok', nota: 'Suma de los agentes con costo medido' },
        ]}
      />

      <Tarjeta
        titulo="Catálogo de agentes"
        estado={agentes.length === 0 ? 'vacio' : 'ok'}
        mensaje="El catálogo está vacío"
        detalle="Da de alta un agente abajo o aplica el sembrado del catálogo."
      >
        <TablaBase
          etiqueta="Agentes del catálogo"
          columnas={columnas}
          filas={filas}
          idFila={(f) => f.a.id}
          tarjetaMovil
          vacio={{ titulo: 'Sin agentes' }}
        />
      </Tarjeta>

      <Disclosure titulo="Dar de alta un agente" resumen="Nace diseñado, nunca vivo">
        <FormaConAviso accion={accionAlta} boton="Dar de alta" columnas="md:grid-cols-1">
          <div className="rv-agente-alta">
            <CampoTexto etiqueta="Id técnico" name="id" required obligatorio placeholder="cazador_censo" ayuda="Minúsculas, números y guión bajo. Es el nombre en corridas y bitácoras." />
            <CampoTexto etiqueta="Nombre" name="nombre" required obligatorio placeholder="Cazador de censo" />
            <CampoSelect etiqueta="Departamento" name="departamento" defaultValue="leads">
              {DEPARTAMENTOS.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
            </CampoSelect>
            <CampoSelect etiqueta="Disparador" name="disparador" defaultValue="manual">
              {DISPARADORES.map((d) => <option key={d} value={d}>{d}</option>)}
            </CampoSelect>
            <CampoTexto etiqueta="Qué hace" name="descripcion" placeholder="Una línea honesta" />
            <CampoTexto etiqueta="Dónde vive su prompt" name="promptRef" placeholder="13-Agentes-de-AI/…/prompts/x.md" />
            <CampoTexto etiqueta="Presupuesto por día (USD)" name="presupuestoDiaUsd" placeholder="Vacío = sin tope declarado" ayuda="El tope se declara desde hoy; sin él el runner no lo despacha." />
          </div>
        </FormaConAviso>
        <p className="rv-agente-sub">Un agente nuevo nace sin palanca propia: para poder apagarlo hace falta darla de alta en el catálogo de interruptores, que hoy exige un cambio de código.</p>
      </Disclosure>

      <Disclosure titulo="Cómo se lee el estado real" resumen="Qué significa cada rótulo">
        <ul>
          <li><strong>Corriendo</strong>: vivo, con palanca arriba, presupuesto declarado y una corrida de las últimas 72 horas.</li>
          <li><strong>Bloqueado por bandeja</strong>: el runner lo salta porque la bandeja de aprobaciones está llena.</li>
          <li><strong>Parado</strong>: habilitado, pero sin corrida reciente por otra causa; el motivo sale del último latido del runner.</li>
          <li><strong>Sin presupuesto</strong>: el runner no despacha un agente sin tope diario declarado.</li>
          <li><strong>Corre por su cron</strong>: no depende del runner; su última corrida es la medida.</li>
        </ul>
        <p className="rv-agente-sub">La autonomía es el nivel L0 a L4 que el código declara para el agente; aquí solo se lee. Subirlo es un cambio de código revisado, nunca de esta pantalla.</p>
      </Disclosure>
    </MarcoPagina>
  );
}
