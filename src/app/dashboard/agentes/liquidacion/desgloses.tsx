import Link from 'next/link';
import { Mail, Route } from 'lucide-react';
import './liquidacion.css';
import { fechaCorta, fechaMx, numero, hoyMx, inicioDiaMx, fechaHoraMx } from '@/lib/formato';
import { dinero } from '@/lib/likida/liquidacion_externa/presentacion';
import { calcularInsightsA1, entradaDesdeFichas, type InsightA1 } from '@/lib/likida/liquidacion_externa/insights_a1';
import type { EntregaCorreo, EstadoEntregaCorreo, Excepcion, TipoExcepcion } from '@/lib/likida/liquidacion_externa/repo_correo';
import type { DetalleDesglose, LecturaDetalle, RolDetalle } from './detalle_desglose';
import {
  AvisoCompacto, BarraPeriodo, BotonConfirmar, BotonEnlace, CampoTexto, EstadoError, EstadoVacio, hrefConParams, MarcoPagina, StatusChip,
  TablaBase, Tarjeta, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { EnlacePagina, NavPaginas } from '../../paginador';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// «DESGLOSES» — el tablero del desglose de pago por correo.
//
// Cada fila es una bitácora con su póliza: el desglose ya lo calculó el sistema
// de la flota y Likida lo manda por correo al operador, a su coordinador y a RH.
// Lo que esta pantalla tiene que dejar claro, sin abrir nada más:
//
//   · qué se mandó y a quién, con el estado de CADA destinatario;
//   · lo que pide a una persona (no se pudo entregar, retenido, sin póliza);
//   · un conteo que no se pudo leer NO es un cero: se pinta «—» y se dice;
//   · un error de entrega se enseña como frase que dice qué hacer, jamás el
//     cuerpo crudo del proveedor ni el correo completo de nadie.
//
// La lista es de lectura. El detalle de una bitácora (`PanelDetalleDesglose`, T-A1-29) trae las acciones: descargar el Excel,
// reenviar, corregir el correo del operador y liberar un envío retenido; y `SeccionExcepciones` junta lo que pide a una persona.
// ═══════════════════════════════════════════════════════════════════════════

export type RolVisible = 'operador' | 'coordinador' | 'rh';
export const ROLES_VISIBLES: readonly RolVisible[] = ['operador', 'coordinador', 'rh'];

export type EstadoDestino = 'entregado' | 'enviado' | 'pendiente' | 'no_entregado' | 'omitido' | 'sin_correo' | 'retenido' | 'sin_dato';

export interface DestinoVista {
  estado: EstadoDestino;
  /** Cuando es `retenido`: la razón ya clasificada («neto negativo» o «requiere revisión»). */
  retenidoPor?: 'neto' | 'revision' | 'poliza_provisional';
  /** Cuándo pasó el último cambio (entrega o rebote), si lo hay. */
  en?: string | null;
}

export interface FilaDesglose {
  liquidacionId: string;
  bitacora: string;
  operador: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  neto: number | null;
  moneda: 'MXN' | 'USD';
  terminal: string | null;
  /** T-A1-41: consecutivo de liquidación y número de pago del origen; ausentes = desglose de una sola bitácora. */
  numeroLiquidacion?: string | null;
  numeroPago?: string | null;
  destinos: Record<RolVisible, DestinoVista>;
}

export interface FilaSinPoliza { bitacora: string; desde: string; ultimaVez: string }

export interface FichasDesgloses {
  recibidosHoy: number | null;
  enviados: number | null;
  entregados: number | null;
  rebotados: number | null;
  retenidos: number | null;
  sinPoliza: number | null;
}

export type FiltroDesglose = 'enviado' | 'entregado' | 'rebotado' | 'retenido' | 'sin_poliza';
const FILTROS: readonly FiltroDesglose[] = ['enviado', 'entregado', 'rebotado', 'retenido', 'sin_poliza'];

export type LecturaDesgloses =
  | { ok: false }
  | { ok: true; fichas: FichasDesgloses; filas: FilaDesglose[]; sinPoliza: FilaSinPoliza[]; siguiente: string | null;
      /** Insights ya calculados con más datos que las fichas; sin ellos se calculan de las fichas. */
      insights?: InsightA1[];
      /** A37-S14-03: la lista «sin póliza» se cortó en el tope; hay más de las que se pintan. */
      sinPolizaTruncada?: boolean };

export interface DesglosesProps {
  lectura: Promise<LecturaDesgloses>;
  filtro: FiltroDesglose | null;
  /** Días AAAA-MM-DD ya validados (`leerDia`). */
  desde: string | null;
  hasta: string | null;
  /** Los campos de la query a conservar (`tenant`, `vista`, `rol`). */
  contexto: Array<[string, string]>;
}

/** Las acciones de servidor del detalle (las define la puerta, que re-valida la sesión en cada una). */
export interface AccionesDetalle {
  reenviar: (fd: FormData) => Promise<void>;
  liberar: (fd: FormData) => Promise<void>;
}

export interface PanelDetalleProps {
  lectura: Promise<LecturaDetalle>;
  acciones: AccionesDetalle;
  /** El código del resultado de la última acción (`des_msg`), ya validado con `leerMensajeDesglose`. */
  mensaje: MensajeDesglose | null;
  /** Los campos de la query a conservar (`tenant`, `vista`, `rol`). */
  contexto: Array<[string, string]>;
  /** El filtro y las fechas vigentes de la lista, para que «Cerrar» no los pierda. */
  params: Array<[string, string]>;
}

/** Cuántas excepciones se pintan; la página pide una más para saber si hay otras sin mostrar (A37-S14-03). */
export const TOPE_EXCEPCIONES = 50;
/** Cuántas bitácoras «sin póliza» se pintan en su lista; la página pide una más (A37-S14-03). */
export const TOPE_SIN_POLIZA = 200;

export interface SeccionExcepcionesProps {
  /** `null` = no se pudo leer. */
  excepciones: Promise<Excepcion[] | null>;
  contexto: Array<[string, string]>;
}

// ── Lo que viene de la URL: se valida aquí, no se confía ───────────────────

export function leerFiltroDesglose(v: string | undefined): FiltroDesglose | null {
  return v && (FILTROS as readonly string[]).includes(v) ? (v as FiltroDesglose) : null;
}

/** Un día AAAA-MM-DD real; cualquier otra cosa es «sin filtro». */
export function leerDia(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

// ── De las entregas de la base a lo que se pinta (puro) ────────────────────

const PRIORIDAD: Record<EstadoEntregaCorreo, number> = {
  rebotada: 0, queja: 0, fallida: 0, pendiente: 1, enviando: 1, enviada: 2, entregada: 3, omitida: 4,
};

const ESTADO_DE_ENTREGA: Record<EstadoEntregaCorreo, EstadoDestino> = {
  rebotada: 'no_entregado', queja: 'no_entregado', fallida: 'no_entregado', pendiente: 'pendiente', enviando: 'pendiente',
  enviada: 'enviado', entregada: 'entregado', omitida: 'omitido',
};

/**
 * El estado de CADA destinatario de un desglose. Una reposición (generación más alta) reemplaza a la anterior; si un rol tiene
 * varios correos (RH puede tener hasta tres), manda el peor: una persona que no recibió no se tapa con otra que sí.
 * Un desglose retenido no salió a nadie. Sin entrega del operador y sin retención ⇒ «Sin correo» (no hay a dónde mandarlo).
 */
export function destinosDe(entregas: EntregaCorreo[], retenidaMotivo: string | null): Record<RolVisible, DestinoVista> {
  if (retenidaMotivo) {
    const retenidoPor = /^póliza provisional/i.test(retenidaMotivo) ? 'poliza_provisional' : /neto/i.test(retenidaMotivo) ? 'neto' : 'revision';
    return { operador: { estado: 'retenido', retenidoPor }, coordinador: { estado: 'retenido', retenidoPor }, rh: { estado: 'retenido', retenidoPor } };
  }
  const out = {} as Record<RolVisible, DestinoVista>;
  for (const rol of ROLES_VISIBLES) {
    const deRol = entregas.filter((e) => e.rol === rol);
    if (deRol.length === 0) { out[rol] = { estado: rol === 'operador' ? 'sin_correo' : 'sin_dato' }; continue; }
    const gen = Math.max(...deRol.map((e) => e.generacion));
    const peor = deRol.filter((e) => e.generacion === gen).sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado])[0];
    out[rol] = { estado: ESTADO_DE_ENTREGA[peor.estado], en: peor.rebotadaEn ?? peor.entregadaEn ?? peor.enviadaEn };
  }
  return out;
}

/** ¿Este desglose cae en el filtro? (`sin_poliza` no vive aquí: no tiene fila de desglose.) */
export function cumpleFiltro(destinos: Record<RolVisible, DestinoVista>, filtro: FiltroDesglose | null): boolean {
  if (!filtro) return true;
  const estados = ROLES_VISIBLES.map((r) => destinos[r].estado);
  switch (filtro) {
    case 'enviado': return estados.includes('enviado');
    case 'entregado': return estados.includes('entregado');
    case 'rebotado': return estados.includes('no_entregado');
    case 'retenido': return estados.includes('retenido');
    default: return false;
  }
}

// ── Rótulos ────────────────────────────────────────────────────────────────

const ROTULO_ROL: Record<RolVisible, string> = { operador: 'Operador', coordinador: 'Coordinador', rh: 'RH' };
const DE_ROL: Record<RolVisible, string> = { operador: 'del operador', coordinador: 'del coordinador', rh: 'de RH' };

type Tono = Extract<TonoEstado, 'ok' | 'warn' | 'bad' | 'muted'>;

export function rotuloDestino(d: DestinoVista, tx: TAgentes = TR_ES.t): { rotulo: string; tono: Tono } {
  switch (d.estado) {
    case 'entregado': return { rotulo: tx('rest.entregado'), tono: 'ok' };
    case 'enviado': return { rotulo: tx('vigia.vista.est_enviado'), tono: 'ok' };
    case 'pendiente': return { rotulo: tx('rest.por_enviar'), tono: 'warn' };
    case 'no_entregado': return { rotulo: tx('rest.no_se_pudo_entregar'), tono: 'bad' };
    case 'omitido': return { rotulo: tx('rest.no_se_envio'), tono: 'muted' };
    case 'sin_correo': return { rotulo: tx('rest.sin_correo'), tono: 'bad' };
    case 'retenido': return { rotulo: d.retenidoPor === 'neto' ? 'Retenido: neto negativo' : d.retenidoPor === 'poliza_provisional' ? tx('rest.retenido_poliza_provisional') : tx('rest.retenido_pide_revision'), tono: 'warn' };
    default: return { rotulo: '—', tono: 'muted' };
  }
}

/** La instrucción llana de lo que sigue, o null si no pide nada. */
export function ayudaDestino(rol: RolVisible, d: DestinoVista, tx: TAgentes = TR_ES.t): string | null {
  switch (d.estado) {
    case 'no_entregado':
      return rol === 'rh'
        ? tx('rest.el_correo_de_rh_no_llego')
        : tx('rest.el_correo_reboto_corrigelo_y_reenvia', { deRol: DE_ROL[rol] });
    case 'sin_correo': return tx('rest.este_operador_no_tiene_correo_registrado');
    case 'retenido': return d.retenidoPor === 'neto' ? tx('rest.el_neto_salio_negativo_revisalo_antes') : d.retenidoPor === 'poliza_provisional' ? tx('rest.poliza_provisional_una_persona_debe_revisarlo') : tx('rest.una_regla_pidio_revisar_este_desglose');
    default: return null;
  }
}

const rotuloFiltro = (tx: TAgentes = TR_ES.t): Record<FiltroDesglose, string> => ({
  enviado: tx('rest.enviados'), entregado: tx('rest.entregados'), rebotado: tx('rest.no_se_pudieron_entregar'), retenido: tx('rest.retenidos'), sin_poliza: tx('rest.sin_poliza'),
});

// ── La sección ─────────────────────────────────────────────────────────────

const ayudaVentana = (tx: TAgentes = TR_ES.t) => (tx('rest.al_abrirla_la_lista_se_limita'));

function query(contexto: Array<[string, string]>, extra: Array<[string, string]> = []): string {
  return `?${new URLSearchParams([...contexto, ...extra]).toString()}`;
}

export async function SeccionDesgloses(p: DesglosesProps) {
  const { t: tx } = await getT('agentes');
  const lectura = await p.lectura;
  const params: Array<[string, string]> = [
    ...(p.filtro ? [['des_estado', p.filtro] as [string, string]] : []),
    ...(p.desde ? [['des_desde', p.desde] as [string, string]] : []),
    ...(p.hasta ? [['des_hasta', p.hasta] as [string, string]] : []),
  ];

  if (!lectura.ok) {
    // Primaria: una lista que no se pudo leer enseña su error, jamás «ningún desglose».
    return (
      <div id="desgloses">
        <Tarjeta titulo={tx('rest.desgloses_de_pago')} info="desgloses.lista">
          <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto, params)}#desgloses`} tamano="sm">{tx('rest.reintentar')}</BotonEnlace>}>{tx('rest.no_se_pudieron_leer_los_desgloses')}</EstadoError>
        </Tarjeta>
      </div>
    );
  }

  const { fichas, filas, sinPoliza, siguiente, sinPolizaTruncada } = lectura;
  const hoy = hoyMx();
  // A37-S14-04: las fichas de entregas cuentan los últimos 30 días (hoy y los 29 anteriores, como `fichasDesgloses`): el enlace abre la lista de esa MISMA ventana.
  const desde30 = hoyMx(new Date(Date.parse(inicioDiaMx(hoy)) - 29 * 24 * 3600 * 1000));
  const filtrando = !!(p.filtro || p.desde || p.hasta);
  const baseDes: Record<string, string> = { ...Object.fromEntries(p.contexto), ...(p.filtro ? { des_estado: p.filtro } : {}), ...(p.desde ? { des_desde: p.desde } : {}), ...(p.hasta ? { des_hasta: p.hasta } : {}) };
  const verSinPoliza = p.filtro === 'sin_poliza';

  return (
    <div id="desgloses">
    <Tarjeta titulo={tx('rest.desgloses_de_pago')} info="desgloses.lista" acciones={p.filtro ? <span className="rv-liq-sub">{tx('rest.filtro')}{' '}{rotuloFiltro(tx)[p.filtro]}</span> : undefined}>
      <p className="rv-liq-sub">{tx('rest.el_desglose_lo_calcula_el_sistema')}</p>

      <div className="rv-liq-fichas">
        <Ficha etiqueta={tx('rest.recibidos_hoy')} valor={fichas.recibidosHoy} ayuda={tx('rest.desgloses_que_llegaron_hoy_del_sistema')} href={query(p.contexto)} />
        <Ficha etiqueta={tx('rest.enviados_30_dias')} valor={fichas.enviados} ayuda={tx('rest.correos_que_salieron_en_los_ultimos_2', { ayudaVentana: ayudaVentana(tx) })}
          href={query(p.contexto, [['des_estado', 'enviado'], ['des_desde', desde30]])} />
        <Ficha etiqueta={tx('rest.entregados_30_dias')} valor={fichas.entregados} ayuda={tx('rest.correos_de_los_ultimos_30_dias_3', { ayudaVentana: ayudaVentana(tx) })}
          href={query(p.contexto, [['des_estado', 'entregado'], ['des_desde', desde30]])} />
        <Ficha etiqueta={tx('rest.rebotados_30_dias')} valor={fichas.rebotados} tono="bad" ayuda={tx('rest.correos_de_los_ultimos_30_dias_4', { ayudaVentana: ayudaVentana(tx) })}
          href={query(p.contexto, [['des_estado', 'rebotado'], ['des_desde', desde30]])} />
        <Ficha etiqueta={tx('rest.retenidos')} valor={fichas.retenidos} tono="bad" ayuda={tx('rest.desgloses_detenidos_antes_de_enviarse_por')}
          href={query(p.contexto, [['des_estado', 'retenido']])} />
        <Ficha etiqueta={tx('rest.sin_poliza')} valor={fichas.sinPoliza} tono="bad" ayuda={tx('rest.bitacoras_que_esperan_su_poliza_para')}
          href={query(p.contexto, [['des_estado', 'sin_poliza']])} />
      </div>

      <BloqueInsights insights={lectura.insights ?? calcularInsightsA1(entradaDesdeFichas(fichas))} />

      <BarraPeriodo etiqueta={tx('rest.periodo_y_filtros_de_desgloses')}
        chips={[
          ...(p.desde || p.hasta ? [{ id: 'rango', etiqueta: `${p.desde ? fechaMx(p.desde) : 'Inicio'} – ${p.hasta ? fechaMx(p.hasta) : 'hoy'}`, hrefQuitar: hrefConParams('', baseDes, { des_desde: null, des_hasta: null }) }] : []),
          ...(p.filtro ? [{ id: 'estado', etiqueta: `Estado: ${rotuloFiltro(tx)[p.filtro]}`, hrefQuitar: hrefConParams('', baseDes, { des_estado: null }) }] : []),
        ]}
        cajon={{
          accion: '?', ocultos: p.contexto, limpiarHref: query(p.contexto), nActivos: (p.filtro ? 1 : 0) + (p.desde || p.hasta ? 1 : 0),
          resumen: [p.filtro ? rotuloFiltro(tx)[p.filtro] : null, p.desde || p.hasta ? `${p.desde ? fechaMx(p.desde) : 'Inicio'} – ${p.hasta ? fechaMx(p.hasta) : 'hoy'}` : null].filter(Boolean).join(' · ') || undefined,
          periodo: { desde: p.desde ?? null, hasta: p.hasta ?? null, nombreDesde: 'des_desde', nombreHasta: 'des_hasta', max: hoy },
          campos: { items: [{ tipo: 'select', nombre: 'des_estado', etiqueta: tx('proveedores.vista.estado'), valor: p.filtro ?? '', opciones: [{ valor: '', rotulo: tx('rest.todos') }, ...FILTROS.map((f) => ({ valor: f, rotulo: rotuloFiltro(tx)[f] }))] }] },
        }} />

      {verSinPoliza ? (
        sinPoliza.length === 0 ? (
          <EstadoVacio icono={Mail} titulo={tx('rest.ninguna_espera_poliza')}>{tx('rest.ninguna_bitacora_esta_esperando_poliza')}</EstadoVacio>
        ) : (
          <>
            <TablaBase<FilaSinPoliza>
              etiqueta={tx('rest.bitacoras_esperando_poliza')}
              filas={sinPoliza}
              idFila={(s) => s.bitacora}
              tarjetaMovil
              columnas={[
                { id: 'bitacora', titulo: tx('vigia.vista.bitacora'), principal: true, celda: (s) => <strong>{s.bitacora}</strong> },
                { id: 'desde', titulo: tx('rest.esperando_desde'), celda: (s) => <span className="rv-liq-apagado">{fechaHoraMx(s.desde)}</span> },
                { id: 'ultima', titulo: tx('rest.ultima_revision'), celda: (s) => <span className="rv-liq-apagado">{fechaHoraMx(s.ultimaVez)}</span> },
              ]}
            />
            {sinPolizaTruncada && (
              <AvisoCompacto tono="warn" resumen={tx('rest.se_muestran_las_mas_recientes_hay', { length: sinPoliza.length })} />
            )}
            <p className="rv-liq-sub">{tx('rest.estas_bitacoras_no_se_enviaran_hasta')}</p>
          </>
        )
      ) : filas.length === 0 ? (
        <EstadoVacio icono={Route} titulo={filtrando ? tx('rest.ningun_desglose_con_ese_filtro') : tx('rest.aun_sin_desgloses')}>
          {filtrando
            ? tx('rest.ningun_desglose_cae_en_ese_filtro')
            : tx('rest.aun_no_hay_desgloses_llegan_cuando')}
        </EstadoVacio>
      ) : (
        <>
          <TablaBase<FilaDesglose>
            etiqueta={tx('rest.desgloses_de_liquidacion')}
            filas={filas}
            idFila={(f) => f.liquidacionId}
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              {
                id: 'bitacora', titulo: tx('vigia.vista.bitacora'), principal: true,
                celda: (f) => (
                  <>
                    <strong>{f.bitacora}</strong>
                    {f.terminal && <span className="rv-liq-nota">{f.terminal}</span>}
                    {f.numeroLiquidacion && (
                      <span className="rv-liq-nota">{tx('rest.liquidacion_2')}{' '}{f.numeroLiquidacion}{f.numeroPago ? ` · pago ${f.numeroPago}` : ''}
                      </span>
                    )}
                  </>
                ),
              },
              { id: 'operador', titulo: tx('conductores.forma.operador'), celda: (f) => <span className="rv-liq-apagado">{f.operador ?? '—'}</span> },
              {
                id: 'periodo', titulo: tx('rest.periodo'),
                celda: (f) => <span className="rv-liq-apagado">{f.periodoDesde && f.periodoHasta ? `${fechaCorta(f.periodoDesde)} – ${fechaCorta(f.periodoHasta)}` : '—'}</span>,
              },
              { id: 'neto', titulo: tx('rest.neto_de_tu_sistema'), alinear: 'der', celda: (f) => <span className="cifra-mono">{f.neto === null ? '—' : dinero(f.neto, f.moneda)}</span> },
              ...ROLES_VISIBLES.map((rol) => ({
                id: rol, titulo: ROTULO_ROL[rol],
                celda: (f: FilaDesglose) => {
                  const d = f.destinos[rol];
                  const r = rotuloDestino(d);
                  const ayuda = ayudaDestino(rol, d);
                  return (
                    <>
                      <StatusChip tono={r.tono} title={ayuda ?? undefined}>{r.rotulo}</StatusChip>
                      {d.en && (d.estado === 'entregado' || d.estado === 'enviado' || d.estado === 'no_entregado') && (
                        <span className="rv-liq-nota">{fechaHoraMx(d.en)}</span>
                      )}
                      {ayuda && <span className="rv-liq-nota" data-tono={r.tono === 'bad' ? 'bad' : undefined}>{ayuda}</span>}
                    </>
                  );
                },
              })),
              {
                id: 'detalle', titulo: tx('rest.detalle'),
                celda: (f) => <Link href={`${query(p.contexto, [...params, ['des_det', f.liquidacionId]])}#detalle-desglose`} className="rv-liq-enlace">{tx('rest.ver_detalle')}</Link>,
              },
            ]}
          />
          <div className="rv-liq-pagina">
            <p className="rv-liq-sub">{tx('rest.de_la_mas_nueva_a_la')}</p>
            {siguiente && (
              <NavPaginas>
                <EnlacePagina href={`${query(p.contexto, [...params, ['des_cursor', siguiente]])}#desgloses`} direccion="siguiente" />
              </NavPaginas>
            )}
          </div>
        </>
      )}
    </Tarjeta>
    </div>
  );
}

/** «Qué pasó · qué significa · qué hacer»: frases calculadas por reglas (sin IA), cada una con la fuente de su cifra. */
export function BloqueInsights({ insights, tr = TR_ES }: { insights: InsightA1[]; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (insights.length === 0) return null;
  return (
    <div className="rv-liq-insights" id="insights-desgloses" aria-label={tx('rest.lectura_de_los_desgloses')}>
      <p className="rv-liq-rotulo">{tx('rest.que_paso_que_significa_que_hacer')}</p>
      <ul className="rv-liq-insights__lista">
        {insights.map((i) => (
          <li key={i.id} data-insight={i.id} data-tono={i.tono} className="rv-liq-insight">
            <p className="rv-liq-insight__titulo">{i.quePaso}</p>
            <p className="rv-liq-sub">{i.queSignifica}</p>
            <p className="rv-liq-insight__hacer">{i.queHacer}</p>
            <p className="rv-liq-nota">{tx('rest.fuente')}{' '}{i.fuente}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `href` ausente = la ficha NO es un enlace (la vista de conteos de `nomina` no lleva a ninguna lista). */
export function Ficha({ etiqueta, valor, ayuda, href, tono, tr = TR_ES }: { etiqueta: string; valor: number | null; ayuda: string; href?: string; tono?: 'bad'; tr?: TrAgentes }) {
  const { t: tx } = tr;
  // `null` = no se pudo contar: «—», jamás un cero que nadie midió.
  const alerta = tono === 'bad' && valor !== null && valor > 0;
  const contenido = (
    <>
      <span className="rv-liq-ficha__rotulo">{etiqueta}</span>
      <span className="rv-liq-ficha__valor cifra-mono">{valor === null ? '—' : numero(valor)}</span>
      {valor === null && <span className="rv-liq-nota">{tx('conductores.vista.no_se_pudo_contar')}</span>}
    </>
  );
  if (href === undefined) return <div title={ayuda} className="rv-liq-ficha" data-alerta={alerta || undefined}>{contenido}</div>;
  return (
    <Link href={href} title={ayuda} className="rv-liq-ficha" data-enlace="" data-alerta={alerta || undefined}>
      {contenido}
    </Link>
  );
}

// ── Resultado de una acción (el código viaja en la URL, el texto NO) ───────

export interface MensajeDesglose { texto: string; tono: 'ok' | 'bad' }

const mensajes = (tx: TAgentes = TR_ES.t): Record<string, MensajeDesglose> => ({
  reenvio_ok: { texto: tx('rest.listo_el_desglose_quedo_en_la'), tono: 'ok' },
  liberado_ok: { texto: tx('rest.listo_el_envio_se_libero_y'), tono: 'ok' },
  r_entrada: { texto: tx('rest.no_entendi_que_desglose_reenviar_vuelve'), tono: 'bad' },
  r_error: { texto: tx('rest.no_se_pudo_completar_vuelve_a'), tono: 'bad' },
  r_sin_permiso: { texto: tx('rest.solo_quien_administra_la_flota_puede'), tono: 'bad' },
  r_no_encontrada: { texto: tx('rest.no_encontre_ese_desglose_en_tu'), tono: 'bad' },
  r_correo_invalido: { texto: tx('rest.el_correo_nuevo_no_parece_un'), tono: 'bad' },
  r_correo_nuevo_no_aplica: { texto: tx('rest.el_correo_nuevo_es_del_operador'), tono: 'bad' },
  r_en_curso: { texto: tx('rest.la_entrega_anterior_todavia_se_esta'), tono: 'bad' },
  r_limite_diario: { texto: tx('rest.ya_se_reenvio_este_desglose_el'), tono: 'bad' },
  r_sin_destinatarios: { texto: tx('rest.no_hay_a_quien_enviarlo_falta'), tono: 'bad' },
  r_sin_archivo: { texto: tx('rest.este_desglose_no_tiene_archivo_para'), tono: 'bad' },
  r_no_disponible: { texto: tx('rest.no_pude_leer_el_estado_de'), tono: 'bad' },
  r_no_retenida: { texto: tx('rest.este_desglose_ya_no_esta_retenido'), tono: 'bad' },
  r_omitido_por_corte: { texto: tx('rest.este_desglose_es_anterior_a_la'), tono: 'bad' },
  r_reemplazado: { texto: tx('rest.este_desglose_ya_fue_reemplazado_por'), tono: 'bad' },
  r_no_liberable: { texto: tx('rest.este_desglose_trae_un_concepto_que'), tono: 'bad' },
});

/** Solo los códigos conocidos: un texto inventado en la URL no se pinta. */
export function leerMensajeDesglose(v: string | undefined, tx: TAgentes = TR_ES.t): MensajeDesglose | null {
  const m = mensajes(tx);
  return v && Object.prototype.hasOwnProperty.call(m, v) ? m[v]! : null;
}

// ── El detalle de una bitácora ─────────────────────────────────────────────

const ROTULO_ROL_DETALLE: Record<RolDetalle, string> = { operador: 'Operador', coordinador: 'Coordinador', rh: 'RH', archivo: 'Archivo', revisor: 'Revisor (primer mes)' };
const origenGeneracion = (tx: TAgentes = TR_ES.t) => ({ auto: tx('rest.envio_automatico'), reclamo: tx('rest.reclamo_del_operador'), manual: tx('rest.envio_manual') } as const);

const excepcion = (tx: TAgentes = TR_ES.t): Record<TipoExcepcion, { titulo: string; ayuda: string }> => ({
  sin_poliza: { titulo: tx('rest.sin_poliza'), ayuda: tx('rest.no_se_enviara_hasta_tener_poliza') },
  operador_no_encontrado: { titulo: tx('rest.operador_sin_alta'), ayuda: tx('rest.este_operador_no_esta_dado_de') },
  operador_sin_correo: { titulo: tx('rest.operador_sin_correo'), ayuda: tx('rest.el_operador_no_recibio_su_desglose') },
  coordinador_sin_correo: { titulo: tx('rest.coordinador_sin_correo'), ayuda: tx('rest.este_operador_no_tiene_coordinador_con') },
  total_no_cuadra: { titulo: tx('rest.el_total_no_cuadra'), ayuda: tx('rest.la_suma_de_los_renglones_no') },
  concepto_prohibido: { titulo: tx('rest.concepto_prohibido'), ayuda: tx('rest.trae_un_concepto_que_la_empresa') },
  neto_negativo: { titulo: tx('rest.retenido_neto_negativo'), ayuda: tx('rest.el_neto_salio_negativo_revisalo_y') },
  tipo_sin_regla: { titulo: tx('rest.retenido_tipo_de_operador_sin_regla'), ayuda: tx('rest.no_hay_regla_para_este_tipo') },
  correccion_pendiente: { titulo: tx('rest.correccion_pendiente'), ayuda: tx('rest.llego_una_version_distinta_de_este') },
  mapeo_invalido: { titulo: tx('rest.datos_invalidos'), ayuda: tx('rest.el_sistema_de_tu_empresa_mando') },
  unidades_mezcladas: { titulo: tx('rest.unidades_mezcladas'), ayuda: tx('rest.la_liquidacion_es_por_unidad_y') },
});

function Mensaje({ m }: { m: MensajeDesglose }) {
  return <AvisoCompacto tono={m.tono === 'ok' ? 'ok' : 'error'} resumen={m.texto} />;
}

function TablaRenglones({ titulo, renglones, moneda, tr = TR_ES }: { titulo: string; renglones: Array<{ descripcion: string; monto: number }>; moneda: 'MXN' | 'USD'; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div className="rv-liq-renglones">
      <h4 className="rv-liq-rotulo">{titulo}</h4>
      {renglones.length === 0 ? (
        <p className="rv-liq-sub">{tx('rest.sin_renglones')}</p>
      ) : (
        <TablaBase<{ descripcion: string; monto: number }>
          etiqueta={titulo}
          filas={renglones}
          idFila={(r) => `${r.descripcion}-${r.monto}`}
          densa
          altoMaximo={false}
          columnas={[
            { id: 'concepto', titulo: tx('proveedores.vista.concepto'), principal: true, celda: (r) => r.descripcion },
            { id: 'monto', titulo: tx('rest.monto'), alinear: 'der', celda: (r) => <span className="cifra-mono">{dinero(r.monto, moneda)}</span> },
          ]}
        />
      )}
    </div>
  );
}


function Reenviar({ d, accion, tr = TR_ES }: { d: DetalleDesglose; accion: AccionesDetalle['reenviar']; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const sinArchivo = d.retenido !== null;
  const opciones: Array<{ a: 'operador' | 'coordinador' | 'todos'; etiqueta: string; que: string; curso: boolean }> = [
    { a: 'operador', etiqueta: tx('rest.reenviar_al_operador'), que: 'al operador', curso: d.enCurso.operador },
    { a: 'coordinador', etiqueta: tx('rest.reenviar_al_coordinador'), que: 'a su coordinador', curso: d.enCurso.coordinador },
    { a: 'todos', etiqueta: tx('rest.reenviar_a_todos'), que: tx('rest.al_operador_a_su_coordinador_y'), curso: d.enCurso.operador || d.enCurso.coordinador || d.enCurso.rh },
  ];
  const hayCurso = opciones.some((o) => o.curso);
  return (
    <div>
      <h4 className="rv-liq-rotulo">{tx('rest.reenviar')}</h4>
      <div className="rv-liq-acciones">
        {opciones.map((o) => (
          <form key={o.a} action={accion}>
            <input type="hidden" name="id" value={d.liquidacionId} />
            <input type="hidden" name="a" value={o.a} />
            <input type="hidden" name="motivo" value="reclamo" />
            <BotonConfirmar
              etiqueta={o.etiqueta} titulo={tx('rest.reenviar_el_desglose')} etiquetaConfirmar={tx('rest.si_reenviar')} tono="normal"
              descripcion={tx('rest.se_volvera_a_mandar_el_desglose', { bitacora: d.bitacora, que: o.que })}
              deshabilitado={o.curso || sinArchivo} className="rv-btn rv-btn--secondary"
            />
          </form>
        ))}
      </div>
      {hayCurso && <p className="rv-liq-nota">{tx('rest.hay_un_envio_en_curso_espera')}</p>}
      {sinArchivo && <p className="rv-liq-nota">{tx('rest.este_desglose_esta_retenido_primero_libera')}</p>}

      <form action={accion} className="rv-liq-acciones rv-liq-acciones--forma">
        <input type="hidden" name="id" value={d.liquidacionId} />
        <input type="hidden" name="a" value="operador" />
        <input type="hidden" name="motivo" value="correccion_de_correo" />
        <CampoTexto tipo="email" etiqueta={tx('rest.correo_nuevo_del_operador')} name="correo_nuevo" required maxLength={254} autoComplete="off" placeholder={tx('rest.correo_del_operador')} />
        <BotonConfirmar
          etiqueta={tx('rest.corregir_correo_del_operador_y_reenviar')} titulo={tx('rest.corregir_el_correo_y_reenviar')} etiquetaConfirmar={tx('rest.si_corregir_y_reenviar')} tono="normal"
          descripcion={tx('rest.se_guarda_el_correo_nuevo_en')}
          deshabilitado={d.enCurso.operador || sinArchivo} className="rv-btn rv-btn--secondary"
        />
      </form>
    </div>
  );
}

function EstadoCabecera({ d, tr = TR_ES }: { d: DetalleDesglose; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <dl className="rv-liq-cabecera">
      <div><dt className="rv-liq-rotulo">{tx('conductores.forma.operador')}</dt><dd>{d.operador ?? '—'}</dd></div>
      <div><dt className="rv-liq-rotulo">{tx('rest.periodo')}</dt><dd>{`${fechaCorta(d.periodoDesde)} – ${fechaCorta(d.periodoHasta)}`}</dd></div>
      <div><dt className="rv-liq-rotulo">{tx('rest.terminal')}</dt><dd>{d.terminal ?? '—'}</dd></div>
      <div><dt className="rv-liq-rotulo">{d.totalOrigen === 'calculado' ? tx('rest.neto_calculado_de_los_renglones') : tx('rest.neto_de_tu_sistema')}</dt><dd className="cifra-mono rv-liq-neto">{dinero(d.neto, d.moneda)}</dd>{d.totalOrigen === 'calculado' && <dd className="rv-liq-nota">{tx('rest.tu_sistema_no_mando_su_propio')}</dd>}</div>
    </dl>
  );
}

/** CT-A12-09: «operador sin alta» tiene tres causas distintas y cada una se arregla distinto; la ayuda sigue a `detalle.motivo`. */
export function ayudaExcepcion(tipo: TipoExcepcion, detalle: Record<string, unknown> = {}, tx: TAgentes = TR_ES.t): string {
  if (tipo === 'operador_no_encontrado') {
    if (detalle.motivo === 'baja') return tx('rest.este_operador_esta_dado_de_baja');
    // Formato por nombre (supuesto hasta la especificación oficial): el sistema de tu empresa manda al operador solo por nombre.
    if (detalle.motivo === 'nombre_ambiguo') return tx('rest.el_sistema_de_tu_empresa_manda');
    if (detalle.motivo === 'nombre_sin_alta') return tx('rest.el_sistema_de_tu_empresa_manda_2');
    if (detalle.motivo === 'ambiguo') return tx('rest.el_numero_de_empleado_el_telefono');
  }
  return excepcion(tx)[tipo]?.ayuda ?? '';
}

function ListaExcepciones({ items, tr = TR_ES }: { items: Array<{ tipo: TipoExcepcion; desde: string; detalle?: Record<string, unknown> }>; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <ul className="rv-liq-excepciones">
      {items.map((x, i) => (
        <li key={`${x.tipo}-${i}`}>
          <strong>{excepcion(tx)[x.tipo].titulo}</strong>{ricoT(tx('rest.e0_desde_e0', { fechaHoraMx: fechaHoraMx(x.desde) }), { e0: (c) => <span className="rv-liq-apagado">{c}</span> })}<span className="rv-liq-nota">{ayudaExcepcion(x.tipo, x.detalle)}</span>
        </li>
      ))}
    </ul>
  );
}

export async function PanelDetalleDesglose(p: PanelDetalleProps) {
  const { t: tx } = await getT('agentes');
  const lectura = await p.lectura;
  const cerrar = `${query(p.contexto, p.params)}#desgloses`;
  const marco = (cuerpo: React.ReactNode, titulo = 'Detalle del desglose') => (
    <div id="detalle-desglose">
      <Tarjeta titulo={titulo} info="desgloses.detalle" acciones={<Link href={cerrar} className="rv-liq-enlace">{tx('vigia.vista.cerrar')}</Link>}>
        {p.mensaje && <Mensaje m={p.mensaje} />}
        {cuerpo}
      </Tarjeta>
    </div>
  );

  if (lectura.estado === 'error') {
    return marco(
      <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto, p.params)}#detalle-desglose`} tamano="sm">{tx('rest.reintentar')}</BotonEnlace>}>{tx('rest.no_se_pudo_leer_este_desglose')}</EstadoError>,
    );
  }
  if (lectura.estado === 'no_encontrado') return marco(<p className="rv-liq-sub">{tx('rest.no_encontre_ese_desglose_en_tu')}</p>);

  const d = lectura.detalle;
  return marco(
    <div className="rv-liq-detalle">
      <p className="rv-liq-detalle__bitacora">{tx('vigia.vista.bitacora')}{' '}{d.bitacora}</p>
      <EstadoCabecera d={d} />

      {d.retenido && (
        <div className="rv-liq-retenido">
          <p className="rv-liq-retenido__titulo">
            {d.retenido.por === 'neto' ? 'Retenido: neto negativo' : d.retenido.por === 'poliza_provisional' ? tx('rest.retenido_poliza_provisional') : tx('rest.retenido_pide_revision')}
          </p>
          <p className="rv-liq-sub">{tx('rest.este_desglose_no_se_ha_enviado')}{' '}{d.retenido.liberable ? tx('rest.si_el_monto_esta_bien_puedes') : tx('rest.corrigelo_en_el_sistema_de_tu')}
          </p>
          {d.retenido.liberable && (
            <form action={p.acciones.liberar}>
              <input type="hidden" name="id" value={d.liquidacionId} />
              <BotonConfirmar
                etiqueta={tx('rest.liberar_envio')} titulo={tx('rest.liberar_el_envio')} etiquetaConfirmar={tx('rest.si_liberar_y_enviar')} tono="normal"
                descripcion={tx('rest.se_enviara_el_desglose_de_la', { bitacora: d.bitacora })}
                className="rv-btn rv-btn--secondary"
              />
            </form>
          )}
        </div>
      )}

      <div className="rv-liq-renglones__fila">
        <TablaRenglones titulo={tx('rest.percepciones')} renglones={d.percepciones} moneda={d.moneda} />
        <TablaRenglones titulo={tx('rest.deducciones')} renglones={d.deducciones} moneda={d.moneda} />
      </div>

      <div>
        <h4 className="rv-liq-rotulo">{tx('rest.destinatarios')}</h4>
        {d.destinatarios.length === 0 ? (
          <p className="rv-liq-sub">
            {d.retenido ? tx('rest.aun_no_se_manda_a_nadie') : tx('rest.este_desglose_no_tiene_correos_programados')}
          </p>
        ) : (
          <TablaBase<DetalleDesglose['destinatarios'][number]>
            etiqueta={tx('rest.destinatarios_del_desglose')}
            filas={d.destinatarios}
            idFila={(x) => `${x.rol}-${x.correo}`}
            densa
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              { id: 'quien', titulo: tx('rest.quien'), principal: true, celda: (x) => ROTULO_ROL_DETALLE[x.rol] },
              { id: 'correo', titulo: tx('vigia.vista.correo'), celda: (x) => <span className="cifra-mono rv-liq-apagado">{x.correo}</span> },
              { id: 'estado', titulo: tx('proveedores.vista.estado'), celda: (x) => { const r = rotuloDestino(x.destino); return <StatusChip tono={r.tono}>{r.rotulo}</StatusChip>; } },
              { id: 'cuando', titulo: tx('rest.cuando'), celda: (x) => <span className="rv-liq-apagado">{x.en ? fechaHoraMx(x.en) : '—'}</span> },
            ]}
          />
        )}
      </div>

      {d.generaciones.length > 0 && (
        <div>
          <h4 className="rv-liq-rotulo">{tx('rest.historial_de_envios')}</h4>
          <ul className="rv-liq-excepciones">
            {d.generaciones.map((g) => (
              <li key={g.generacion}>{ricoT(tx('rest.strong_envio_strong', { generacion: g.generacion }), { strong: (c) => <strong>{c}</strong> })}<span className="rv-liq-apagado"> · {origenGeneracion(tx)[g.origen]} · {fechaHoraMx(g.creadaEn)} · {g.entregas === 1 ? '1 correo' : `${g.entregas} correos`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="rv-liq-rotulo">{tx('rest.archivo')}</h4>
        {d.descargaUrl ? (
          <div className="rv-liq-acciones">{ricoT(tx('rest.e0_descargar_el_excel_e0_e1', { descargaNombre: d.descargaNombre ?? '' }), { e0: (c) => <a href={d.descargaUrl ?? undefined} download={d.descargaNombre ?? undefined} className="rv-btn rv-btn--secondary">{c}</a>, e1: (c) => <span className="rv-liq-nota">{c}</span> })}</div>
        ) : (
          <p className="rv-liq-sub">{tx('rest.no_se_pudo_preparar_la_descarga')}</p>
        )}
      </div>

      <Reenviar d={d} accion={p.acciones.reenviar} />

      <div>
        <h4 className="rv-liq-rotulo">{tx('vigia.vista.excepciones')}</h4>
        {d.excepciones.length === 0
          ? <p className="rv-liq-sub">{tx('rest.sin_excepciones_abiertas_para_esta_bitacora')}</p>
          : <ListaExcepciones items={d.excepciones} />}
      </div>
    </div>,
  );
}

/** Lo que pide a una persona, de toda la flota: sin póliza, operador sin alta o sin correo, retenidos y correcciones pendientes. */
export async function SeccionExcepciones(p: SeccionExcepcionesProps) {
  const { t: tx } = await getT('agentes');
  const todas = await p.excepciones;
  const lista = todas === null ? null : todas.slice(0, TOPE_EXCEPCIONES);
  const hayMas = todas !== null && todas.length > TOPE_EXCEPCIONES;
  if (lista === null) {
    return (
      <div id="excepciones">
        <Tarjeta titulo={tx('vigia.vista.excepciones')} info="desgloses.excepciones">
          <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto)}#excepciones`} tamano="sm">{tx('rest.reintentar')}</BotonEnlace>}>{tx('rest.no_se_pudieron_leer_las_excepciones')}</EstadoError>
        </Tarjeta>
      </div>
    );
  }
  return (
    <div id="excepciones">
      <Tarjeta titulo={tx('vigia.vista.excepciones')} info="desgloses.excepciones">
        <p className="rv-liq-sub">{tx('rest.lo_que_necesita_a_una_persona')}</p>
        {lista.length === 0 ? (
          <EstadoVacio icono={Mail} titulo={tx('rest.todo_al_corriente')}>{tx('rest.sin_excepciones_abiertas')}</EstadoVacio>
        ) : (
          <>
            {hayMas && (
              <AvisoCompacto tono="warn" resumen={tx('rest.se_muestran_las_mas_recientes_hay_2', { topeExcepciones: TOPE_EXCEPCIONES })} />
            )}
            <ul className="rv-liq-excepciones">
              {lista.map((x) => {
                const bitacora = typeof x.detalle.bitacora === 'string' ? x.detalle.bitacora : x.claveExterna;
                return (
                  <li key={x.id}>
                    <strong>{excepcion(tx)[x.tipo]?.titulo ?? x.tipo}</strong>{ricoT(tx('rest.e0_bitacora_e0_e1_desde_e1', { bitacora, fechaHoraMx: fechaHoraMx(x.primeraVez) }), { e0: (c) => <span className="rv-liq-apagado">{c}</span>, e1: (c) => <span className="rv-liq-apagado">{c}</span> })}<span className="rv-liq-nota">{ayudaExcepcion(x.tipo, x.detalle)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Tarjeta>
    </div>
  );
}

/** El marco de la pantalla de un tenant que recibe el desglose por correo: la sección y los avisos, sin los KPIs, la cola ni la estrategia del flujo de fotos. */
export function VistaDesgloses({ desgloses, detalle, excepciones, notificaciones, cargas, tr = TR_ES }: {
  desgloses: React.ReactNode; detalle?: React.ReactNode; excepciones?: React.ReactNode; notificaciones?: React.ReactNode;
  /** Ola 1 · A1: la subida de archivos (desgloses y correos de operadores) mientras el sistema del cliente no manda los datos solo. */
  cargas?: React.ReactNode; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('liquidacion.vista.liquidacion_automatica')} apoyo={tx('rest.los_desgloses_de_liquidacion_que_llegan')}>
      {desgloses}
      {cargas}
      {detalle}
      {excepciones}
      {notificaciones}
    </MarcoPagina>
  );
}
