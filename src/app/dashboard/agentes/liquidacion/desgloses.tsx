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
  retenidoPor?: 'neto' | 'revision';
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
    const retenidoPor = /neto/i.test(retenidaMotivo) ? 'neto' : 'revision';
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

export function rotuloDestino(d: DestinoVista): { rotulo: string; tono: Tono } {
  switch (d.estado) {
    case 'entregado': return { rotulo: 'Entregado', tono: 'ok' };
    case 'enviado': return { rotulo: 'Enviado', tono: 'ok' };
    case 'pendiente': return { rotulo: 'Por enviar', tono: 'warn' };
    case 'no_entregado': return { rotulo: 'No se pudo entregar', tono: 'bad' };
    case 'omitido': return { rotulo: 'No se envió', tono: 'muted' };
    case 'sin_correo': return { rotulo: 'Sin correo', tono: 'bad' };
    case 'retenido': return { rotulo: d.retenidoPor === 'neto' ? 'Retenido: neto negativo' : 'Retenido: pide revisión', tono: 'warn' };
    default: return { rotulo: '—', tono: 'muted' };
  }
}

/** La instrucción llana de lo que sigue, o null si no pide nada. */
export function ayudaDestino(rol: RolVisible, d: DestinoVista): string | null {
  switch (d.estado) {
    case 'no_entregado':
      return rol === 'rh'
        ? 'El correo de RH no llegó: corrígelo en la configuración.'
        : `El correo ${DE_ROL[rol]} rebotó: corrígelo y reenvía.`;
    case 'sin_correo': return 'Este operador no tiene correo registrado: agrégalo y reenvía.';
    case 'retenido': return d.retenidoPor === 'neto' ? 'El neto salió negativo: revísalo antes de liberar el envío.' : 'Una regla pidió revisar este desglose antes de enviarlo.';
    default: return null;
  }
}

const ROTULO_FILTRO: Record<FiltroDesglose, string> = {
  enviado: 'Enviados', entregado: 'Entregados', rebotado: 'No se pudieron entregar', retenido: 'Retenidos', sin_poliza: 'Sin póliza',
};

// ── La sección ─────────────────────────────────────────────────────────────

const AYUDA_VENTANA = ' Al abrirla, la lista se limita a esos 30 días.';

function query(contexto: Array<[string, string]>, extra: Array<[string, string]> = []): string {
  return `?${new URLSearchParams([...contexto, ...extra]).toString()}`;
}

export async function SeccionDesgloses(p: DesglosesProps) {
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
        <Tarjeta titulo="Desgloses de pago" info="desgloses.lista">
          <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto, params)}#desgloses`} tamano="sm">Reintentar</BotonEnlace>}>
            No se pudieron leer los desgloses. No es que no haya: no pudimos consultarlos ahora.
          </EstadoError>
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
    <Tarjeta titulo="Desgloses de pago" info="desgloses.lista" acciones={p.filtro ? <span className="rv-liq-sub">Filtro: {ROTULO_FILTRO[p.filtro]}</span> : undefined}>
      <p className="rv-liq-sub">
        El desglose lo calcula el sistema de tu empresa. Likida lo manda por correo, en Excel, al operador, a su coordinador y a RH, y aquí ves
        el estado de cada envío.
      </p>

      <div className="rv-liq-fichas">
        <Ficha etiqueta="Recibidos hoy" valor={fichas.recibidosHoy} ayuda="Desgloses que llegaron hoy del sistema de tu empresa." href={query(p.contexto)} />
        <Ficha etiqueta="Enviados · 30 días" valor={fichas.enviados} ayuda={`Correos que salieron en los últimos 30 días y esperan confirmación de entrega. Se cuenta un correo por destinatario; la lista de abajo cuenta desgloses.${AYUDA_VENTANA}`}
          href={query(p.contexto, [['des_estado', 'enviado'], ['des_desde', desde30]])} />
        <Ficha etiqueta="Entregados · 30 días" valor={fichas.entregados} ayuda={`Correos de los últimos 30 días que el buzón de destino ya recibió. Se cuenta un correo por destinatario; la lista de abajo cuenta desgloses.${AYUDA_VENTANA}`}
          href={query(p.contexto, [['des_estado', 'entregado'], ['des_desde', desde30]])} />
        <Ficha etiqueta="Rebotados · 30 días" valor={fichas.rebotados} tono="bad" ayuda={`Correos de los últimos 30 días que no llegaron. Corrige la dirección y reenvía. Se cuenta un correo por destinatario; la lista de abajo cuenta desgloses.${AYUDA_VENTANA}`}
          href={query(p.contexto, [['des_estado', 'rebotado'], ['des_desde', desde30]])} />
        <Ficha etiqueta="Retenidos" valor={fichas.retenidos} tono="bad" ayuda="Desgloses detenidos antes de enviarse (por ejemplo, neto negativo)."
          href={query(p.contexto, [['des_estado', 'retenido']])} />
        <Ficha etiqueta="Sin póliza" valor={fichas.sinPoliza} tono="bad" ayuda="Bitácoras que esperan su póliza para poder enviarse."
          href={query(p.contexto, [['des_estado', 'sin_poliza']])} />
      </div>

      <BloqueInsights insights={lectura.insights ?? calcularInsightsA1(entradaDesdeFichas(fichas))} />

      <BarraPeriodo etiqueta="Periodo y filtros de desgloses"
        chips={[
          ...(p.desde || p.hasta ? [{ id: 'rango', etiqueta: `${p.desde ? fechaMx(p.desde) : 'Inicio'} – ${p.hasta ? fechaMx(p.hasta) : 'hoy'}`, hrefQuitar: hrefConParams('', baseDes, { des_desde: null, des_hasta: null }) }] : []),
          ...(p.filtro ? [{ id: 'estado', etiqueta: `Estado: ${ROTULO_FILTRO[p.filtro]}`, hrefQuitar: hrefConParams('', baseDes, { des_estado: null }) }] : []),
        ]}
        cajon={{
          accion: '?', ocultos: p.contexto, limpiarHref: query(p.contexto), nActivos: (p.filtro ? 1 : 0) + (p.desde || p.hasta ? 1 : 0),
          resumen: [p.filtro ? ROTULO_FILTRO[p.filtro] : null, p.desde || p.hasta ? `${p.desde ? fechaMx(p.desde) : 'Inicio'} – ${p.hasta ? fechaMx(p.hasta) : 'hoy'}` : null].filter(Boolean).join(' · ') || undefined,
          periodo: { desde: p.desde ?? null, hasta: p.hasta ?? null, nombreDesde: 'des_desde', nombreHasta: 'des_hasta', max: hoy },
          campos: { items: [{ tipo: 'select', nombre: 'des_estado', etiqueta: 'Estado', valor: p.filtro ?? '', opciones: [{ valor: '', rotulo: 'Todos' }, ...FILTROS.map((f) => ({ valor: f, rotulo: ROTULO_FILTRO[f] }))] }] },
        }} />

      {verSinPoliza ? (
        sinPoliza.length === 0 ? (
          <EstadoVacio icono={Mail} titulo="Ninguna espera póliza">
            Ninguna bitácora está esperando póliza.
          </EstadoVacio>
        ) : (
          <>
            <TablaBase<FilaSinPoliza>
              etiqueta="Bitácoras esperando póliza"
              filas={sinPoliza}
              idFila={(s) => s.bitacora}
              tarjetaMovil
              columnas={[
                { id: 'bitacora', titulo: 'Bitácora', principal: true, celda: (s) => <strong>{s.bitacora}</strong> },
                { id: 'desde', titulo: 'Esperando desde', celda: (s) => <span className="rv-liq-apagado">{fechaHoraMx(s.desde)}</span> },
                { id: 'ultima', titulo: 'Última revisión', celda: (s) => <span className="rv-liq-apagado">{fechaHoraMx(s.ultimaVez)}</span> },
              ]}
            />
            {sinPolizaTruncada && (
              <AvisoCompacto tono="warn" resumen={`Se muestran las ${sinPoliza.length} más recientes: hay más bitácoras sin póliza que no caben en esta lista.`} />
            )}
            <p className="rv-liq-sub">Estas bitácoras no se enviarán hasta tener póliza: revísalas en el sistema de tu empresa.</p>
          </>
        )
      ) : filas.length === 0 ? (
        <EstadoVacio icono={Route} titulo={filtrando ? 'Ningún desglose con ese filtro' : 'Aún sin desgloses'}>
          {filtrando
            ? 'Ningún desglose cae en ese filtro. Prueba con otro estado o con más fechas.'
            : 'Aún no hay desgloses: llegan cuando una bitácora tiene póliza.'}
        </EstadoVacio>
      ) : (
        <>
          <TablaBase<FilaDesglose>
            etiqueta="Desgloses de liquidación"
            filas={filas}
            idFila={(f) => f.liquidacionId}
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              {
                id: 'bitacora', titulo: 'Bitácora', principal: true,
                celda: (f) => (
                  <>
                    <strong>{f.bitacora}</strong>
                    {f.terminal && <span className="rv-liq-nota">{f.terminal}</span>}
                    {f.numeroLiquidacion && (
                      <span className="rv-liq-nota">
                        Liquidación {f.numeroLiquidacion}{f.numeroPago ? ` · pago ${f.numeroPago}` : ''}
                      </span>
                    )}
                  </>
                ),
              },
              { id: 'operador', titulo: 'Operador', celda: (f) => <span className="rv-liq-apagado">{f.operador ?? '—'}</span> },
              {
                id: 'periodo', titulo: 'Periodo',
                celda: (f) => <span className="rv-liq-apagado">{f.periodoDesde && f.periodoHasta ? `${fechaCorta(f.periodoDesde)} – ${fechaCorta(f.periodoHasta)}` : '—'}</span>,
              },
              { id: 'neto', titulo: 'Neto (de tu sistema)', alinear: 'der', celda: (f) => <span className="cifra-mono">{f.neto === null ? '—' : dinero(f.neto, f.moneda)}</span> },
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
                id: 'detalle', titulo: 'Detalle',
                celda: (f) => <Link href={`${query(p.contexto, [...params, ['des_det', f.liquidacionId]])}#detalle-desglose`} className="rv-liq-enlace">Ver detalle</Link>,
              },
            ]}
          />
          <div className="rv-liq-pagina">
            <p className="rv-liq-sub">De la más nueva a la más vieja.</p>
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
export function BloqueInsights({ insights }: { insights: InsightA1[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="rv-liq-insights" id="insights-desgloses" aria-label="Lectura de los desgloses">
      <p className="rv-liq-rotulo">Qué pasó · qué significa · qué hacer</p>
      <ul className="rv-liq-insights__lista">
        {insights.map((i) => (
          <li key={i.id} data-insight={i.id} data-tono={i.tono} className="rv-liq-insight">
            <p className="rv-liq-insight__titulo">{i.quePaso}</p>
            <p className="rv-liq-sub">{i.queSignifica}</p>
            <p className="rv-liq-insight__hacer">{i.queHacer}</p>
            <p className="rv-liq-nota">Fuente: {i.fuente}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `href` ausente = la ficha NO es un enlace (la vista de conteos de `nomina` no lleva a ninguna lista). */
export function Ficha({ etiqueta, valor, ayuda, href, tono }: { etiqueta: string; valor: number | null; ayuda: string; href?: string; tono?: 'bad' }) {
  // `null` = no se pudo contar: «—», jamás un cero que nadie midió.
  const alerta = tono === 'bad' && valor !== null && valor > 0;
  const contenido = (
    <>
      <span className="rv-liq-ficha__rotulo">{etiqueta}</span>
      <span className="rv-liq-ficha__valor cifra-mono">{valor === null ? '—' : numero(valor)}</span>
      {valor === null && <span className="rv-liq-nota">no se pudo contar</span>}
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

const MENSAJES: Record<string, MensajeDesglose> = {
  reenvio_ok: { texto: 'Listo: el desglose quedó en la cola y sale en unos minutos.', tono: 'ok' },
  liberado_ok: { texto: 'Listo: el envío se liberó y los correos salen en unos minutos.', tono: 'ok' },
  r_entrada: { texto: 'No entendí qué desglose reenviar. Vuelve a elegirlo.', tono: 'bad' },
  r_error: { texto: 'No se pudo completar. Vuelve a intentarlo en unos minutos: repetirlo es seguro.', tono: 'bad' },
  r_sin_permiso: { texto: 'Solo quien administra la flota puede hacer esto.', tono: 'bad' },
  r_no_encontrada: { texto: 'No encontré ese desglose en tu flota.', tono: 'bad' },
  r_correo_invalido: { texto: 'El correo nuevo no parece un correo. Revísalo (por ejemplo, que tenga @ y un dominio).', tono: 'bad' },
  r_correo_nuevo_no_aplica: { texto: 'El correo nuevo es del operador: usa la acción «Corregir correo y reenviar».', tono: 'bad' },
  r_en_curso: { texto: 'La entrega anterior todavía se está enviando. Espera a que termine antes de reenviar.', tono: 'bad' },
  r_limite_diario: { texto: 'Ya se reenvió este desglose el máximo de veces hoy. Intenta mañana o revisa por qué no llega.', tono: 'bad' },
  r_sin_destinatarios: { texto: 'No hay a quién enviarlo: falta el correo de ese destinatario.', tono: 'bad' },
  r_sin_archivo: { texto: 'Este desglose no tiene archivo para reenviar.', tono: 'bad' },
  r_no_disponible: { texto: 'No pude leer el estado de este desglose. Intenta de nuevo en unos minutos.', tono: 'bad' },
  r_no_retenida: { texto: 'Este desglose ya no está retenido: no hay nada que liberar.', tono: 'bad' },
  r_omitido_por_corte: { texto: 'Este desglose es anterior a la fecha de corte (o el sistema de origen ya lo envió): no se libera desde aquí.', tono: 'bad' },
  r_reemplazado: { texto: 'Este desglose ya fue reemplazado por una corrección: libera la corrección, no el original.', tono: 'bad' },
  r_no_liberable: { texto: 'Este desglose trae un concepto que la empresa prohibió enviar: corrígelo en su sistema; no se libera desde aquí.', tono: 'bad' },
};

/** Solo los códigos conocidos: un texto inventado en la URL no se pinta. */
export function leerMensajeDesglose(v: string | undefined): MensajeDesglose | null {
  return v && Object.prototype.hasOwnProperty.call(MENSAJES, v) ? MENSAJES[v]! : null;
}

// ── El detalle de una bitácora ─────────────────────────────────────────────

const ROTULO_ROL_DETALLE: Record<RolDetalle, string> = { operador: 'Operador', coordinador: 'Coordinador', rh: 'RH', archivo: 'Archivo', revisor: 'Revisor (primer mes)' };
const ORIGEN_GENERACION = { auto: 'Envío automático', reclamo: 'Reclamo del operador', manual: 'Envío manual' } as const;

const EXCEPCION: Record<TipoExcepcion, { titulo: string; ayuda: string }> = {
  sin_poliza: { titulo: 'Sin póliza', ayuda: 'No se enviará hasta tener póliza: revísala en el sistema de tu empresa.' },
  operador_no_encontrado: { titulo: 'Operador sin alta', ayuda: 'Este operador no está dado de alta en Likida: dalo de alta y el desglose se procesa en la siguiente lectura.' },
  operador_sin_correo: { titulo: 'Operador sin correo', ayuda: 'El operador no recibió su desglose porque no tiene correo (o el que tenía rebotó): corrígelo y reenvía.' },
  coordinador_sin_correo: { titulo: 'Coordinador sin correo', ayuda: 'Este operador no tiene coordinador con correo: asígnalo para que también le llegue.' },
  total_no_cuadra: { titulo: 'El total no cuadra', ayuda: 'La suma de los renglones no coincide con el neto: revísalo en el sistema de tu empresa.' },
  concepto_prohibido: { titulo: 'Concepto prohibido', ayuda: 'Trae un concepto que la empresa no quiere enviar: corrígelo en su sistema.' },
  neto_negativo: { titulo: 'Retenido: neto negativo', ayuda: 'El neto salió negativo. Revísalo y, si está bien, libera el envío.' },
  tipo_sin_regla: { titulo: 'Retenido: tipo de operador sin regla', ayuda: 'No hay regla para este tipo de operador. Revísalo y, si está bien, libera el envío.' },
  correccion_pendiente: { titulo: 'Corrección pendiente', ayuda: 'Llegó una versión distinta de este desglose y no se envió: una persona decide si se manda la corrección.' },
  mapeo_invalido: { titulo: 'Datos inválidos', ayuda: 'El sistema de tu empresa mandó datos que no se pudieron leer: avísale a quien lo administra.' },
  unidades_mezcladas: { titulo: 'Unidades mezcladas', ayuda: 'La liquidación es por unidad y este desglose trajo bitácoras de unidades distintas, así que no se guardó: tu sistema tiene que mandar un desglose por unidad.' },
};

function Mensaje({ m }: { m: MensajeDesglose }) {
  return <AvisoCompacto tono={m.tono === 'ok' ? 'ok' : 'error'} resumen={m.texto} />;
}

function TablaRenglones({ titulo, renglones, moneda }: { titulo: string; renglones: Array<{ descripcion: string; monto: number }>; moneda: 'MXN' | 'USD' }) {
  return (
    <div className="rv-liq-renglones">
      <h4 className="rv-liq-rotulo">{titulo}</h4>
      {renglones.length === 0 ? (
        <p className="rv-liq-sub">Sin renglones.</p>
      ) : (
        <TablaBase<{ descripcion: string; monto: number }>
          etiqueta={titulo}
          filas={renglones}
          idFila={(r) => `${r.descripcion}-${r.monto}`}
          densa
          altoMaximo={false}
          columnas={[
            { id: 'concepto', titulo: 'Concepto', principal: true, celda: (r) => r.descripcion },
            { id: 'monto', titulo: 'Monto', alinear: 'der', celda: (r) => <span className="cifra-mono">{dinero(r.monto, moneda)}</span> },
          ]}
        />
      )}
    </div>
  );
}


function Reenviar({ d, accion }: { d: DetalleDesglose; accion: AccionesDetalle['reenviar'] }) {
  const sinArchivo = d.retenido !== null;
  const opciones: Array<{ a: 'operador' | 'coordinador' | 'todos'; etiqueta: string; que: string; curso: boolean }> = [
    { a: 'operador', etiqueta: 'Reenviar al operador', que: 'al operador', curso: d.enCurso.operador },
    { a: 'coordinador', etiqueta: 'Reenviar al coordinador', que: 'a su coordinador', curso: d.enCurso.coordinador },
    { a: 'todos', etiqueta: 'Reenviar a todos', que: 'al operador, a su coordinador y a RH', curso: d.enCurso.operador || d.enCurso.coordinador || d.enCurso.rh },
  ];
  const hayCurso = opciones.some((o) => o.curso);
  return (
    <div>
      <h4 className="rv-liq-rotulo">Reenviar</h4>
      <div className="rv-liq-acciones">
        {opciones.map((o) => (
          <form key={o.a} action={accion}>
            <input type="hidden" name="id" value={d.liquidacionId} />
            <input type="hidden" name="a" value={o.a} />
            <input type="hidden" name="motivo" value="reclamo" />
            <BotonConfirmar
              etiqueta={o.etiqueta} titulo="Reenviar el desglose" etiquetaConfirmar="Sí, reenviar" tono="normal"
              descripcion={`Se volverá a mandar el desglose de la bitácora ${d.bitacora} ${o.que}. Queda registrado quién lo pidió.`}
              deshabilitado={o.curso || sinArchivo} className="rv-btn rv-btn--secondary"
            />
          </form>
        ))}
      </div>
      {hayCurso && <p className="rv-liq-nota">Hay un envío en curso: espera a que termine para reenviar.</p>}
      {sinArchivo && <p className="rv-liq-nota">Este desglose está retenido: primero libera el envío.</p>}

      <form action={accion} className="rv-liq-acciones rv-liq-acciones--forma">
        <input type="hidden" name="id" value={d.liquidacionId} />
        <input type="hidden" name="a" value="operador" />
        <input type="hidden" name="motivo" value="correccion_de_correo" />
        <CampoTexto tipo="email" etiqueta="Correo nuevo del operador" name="correo_nuevo" required maxLength={254} autoComplete="off" placeholder="Correo del operador" />
        <BotonConfirmar
          etiqueta="Corregir correo del operador y reenviar" titulo="Corregir el correo y reenviar" etiquetaConfirmar="Sí, corregir y reenviar" tono="normal"
          descripcion="Se guarda el correo nuevo en la ficha del operador y se le vuelve a mandar este desglose. Los próximos también irán a ese correo."
          deshabilitado={d.enCurso.operador || sinArchivo} className="rv-btn rv-btn--secondary"
        />
      </form>
    </div>
  );
}

function EstadoCabecera({ d }: { d: DetalleDesglose }) {
  return (
    <dl className="rv-liq-cabecera">
      <div><dt className="rv-liq-rotulo">Operador</dt><dd>{d.operador ?? '—'}</dd></div>
      <div><dt className="rv-liq-rotulo">Periodo</dt><dd>{`${fechaCorta(d.periodoDesde)} – ${fechaCorta(d.periodoHasta)}`}</dd></div>
      <div><dt className="rv-liq-rotulo">Terminal</dt><dd>{d.terminal ?? '—'}</dd></div>
      <div><dt className="rv-liq-rotulo">{d.totalOrigen === 'calculado' ? 'Neto calculado de los renglones' : 'Neto (de tu sistema)'}</dt><dd className="cifra-mono rv-liq-neto">{dinero(d.neto, d.moneda)}</dd>{d.totalOrigen === 'calculado' && <dd className="rv-liq-nota">Tu sistema no mandó su propio neto: no hay con qué compararlo.</dd>}</div>
    </dl>
  );
}

/** CT-A12-09: «operador sin alta» tiene tres causas distintas y cada una se arregla distinto; la ayuda sigue a `detalle.motivo`. */
export function ayudaExcepcion(tipo: TipoExcepcion, detalle: Record<string, unknown> = {}): string {
  if (tipo === 'operador_no_encontrado') {
    if (detalle.motivo === 'baja') return 'Este operador está dado de baja en Likida: reactívalo (o corrige su número de empleado) y el desglose se procesa en la siguiente lectura.';
    // Formato por nombre (supuesto hasta la especificación oficial): el sistema de tu empresa manda al operador solo por nombre.
    if (detalle.motivo === 'nombre_ambiguo') return 'El sistema de tu empresa manda al operador solo por nombre y hay más de un operador con ese nombre en Likida: no se sabe a quién corresponde, así que no se recibió. Distingue los nombres en Operadores y vuelve a mandar la bitácora.';
    if (detalle.motivo === 'nombre_sin_alta') return 'El sistema de tu empresa manda al operador solo por nombre y ninguno de Operadores coincide (o al que coincide le falta el número de empleado): no se recibió. Revisa que esté escrito igual y con su número de empleado, y vuelve a mandar la bitácora.';
    if (detalle.motivo === 'ambiguo') return 'El número de empleado, el teléfono o el id apuntan a más de un operador, o a operadores distintos: no se sabe a quién entregárselo. Corrige el duplicado en Operadores; no lo des de alta otra vez.';
  }
  return EXCEPCION[tipo]?.ayuda ?? '';
}

function ListaExcepciones({ items }: { items: Array<{ tipo: TipoExcepcion; desde: string; detalle?: Record<string, unknown> }> }) {
  return (
    <ul className="rv-liq-excepciones">
      {items.map((x, i) => (
        <li key={`${x.tipo}-${i}`}>
          <strong>{EXCEPCION[x.tipo].titulo}</strong>
          <span className="rv-liq-apagado"> · desde {fechaHoraMx(x.desde)}</span>
          <span className="rv-liq-nota">{ayudaExcepcion(x.tipo, x.detalle)}</span>
        </li>
      ))}
    </ul>
  );
}

export async function PanelDetalleDesglose(p: PanelDetalleProps) {
  const lectura = await p.lectura;
  const cerrar = `${query(p.contexto, p.params)}#desgloses`;
  const marco = (cuerpo: React.ReactNode, titulo = 'Detalle del desglose') => (
    <div id="detalle-desglose">
      <Tarjeta titulo={titulo} info="desgloses.detalle" acciones={<Link href={cerrar} className="rv-liq-enlace">Cerrar</Link>}>
        {p.mensaje && <Mensaje m={p.mensaje} />}
        {cuerpo}
      </Tarjeta>
    </div>
  );

  if (lectura.estado === 'error') {
    return marco(
      <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto, p.params)}#detalle-desglose`} tamano="sm">Reintentar</BotonEnlace>}>
        No se pudo leer este desglose. No es que no exista: no pudimos consultarlo ahora.
      </EstadoError>,
    );
  }
  if (lectura.estado === 'no_encontrado') return marco(<p className="rv-liq-sub">No encontré ese desglose en tu flota.</p>);

  const d = lectura.detalle;
  return marco(
    <div className="rv-liq-detalle">
      <p className="rv-liq-detalle__bitacora">Bitácora {d.bitacora}</p>
      <EstadoCabecera d={d} />

      {d.retenido && (
        <div className="rv-liq-retenido">
          <p className="rv-liq-retenido__titulo">
            {d.retenido.por === 'neto' ? 'Retenido: neto negativo' : 'Retenido: pide revisión'}
          </p>
          <p className="rv-liq-sub">
            Este desglose no se ha enviado a nadie.{' '}
            {d.retenido.liberable ? 'Si el monto está bien, puedes liberar el envío.' : 'Corrígelo en el sistema de tu empresa: no se libera desde aquí.'}
          </p>
          {d.retenido.liberable && (
            <form action={p.acciones.liberar}>
              <input type="hidden" name="id" value={d.liquidacionId} />
              <BotonConfirmar
                etiqueta="Liberar envío" titulo="Liberar el envío" etiquetaConfirmar="Sí, liberar y enviar" tono="normal"
                descripcion={`Se enviará el desglose de la bitácora ${d.bitacora} al operador, a su coordinador y a RH. Queda registrado quién lo liberó.`}
                className="rv-btn rv-btn--secondary"
              />
            </form>
          )}
        </div>
      )}

      <div className="rv-liq-renglones__fila">
        <TablaRenglones titulo="Percepciones" renglones={d.percepciones} moneda={d.moneda} />
        <TablaRenglones titulo="Deducciones" renglones={d.deducciones} moneda={d.moneda} />
      </div>

      <div>
        <h4 className="rv-liq-rotulo">Destinatarios</h4>
        {d.destinatarios.length === 0 ? (
          <p className="rv-liq-sub">
            {d.retenido ? 'Aún no se manda a nadie: el desglose está retenido.' : 'Este desglose no tiene correos programados.'}
          </p>
        ) : (
          <TablaBase<DetalleDesglose['destinatarios'][number]>
            etiqueta="Destinatarios del desglose"
            filas={d.destinatarios}
            idFila={(x) => `${x.rol}-${x.correo}`}
            densa
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              { id: 'quien', titulo: 'Quién', principal: true, celda: (x) => ROTULO_ROL_DETALLE[x.rol] },
              { id: 'correo', titulo: 'Correo', celda: (x) => <span className="cifra-mono rv-liq-apagado">{x.correo}</span> },
              { id: 'estado', titulo: 'Estado', celda: (x) => { const r = rotuloDestino(x.destino); return <StatusChip tono={r.tono}>{r.rotulo}</StatusChip>; } },
              { id: 'cuando', titulo: 'Cuándo', celda: (x) => <span className="rv-liq-apagado">{x.en ? fechaHoraMx(x.en) : '—'}</span> },
            ]}
          />
        )}
      </div>

      {d.generaciones.length > 0 && (
        <div>
          <h4 className="rv-liq-rotulo">Historial de envíos</h4>
          <ul className="rv-liq-excepciones">
            {d.generaciones.map((g) => (
              <li key={g.generacion}>
                <strong>Envío {g.generacion}</strong>
                <span className="rv-liq-apagado"> · {ORIGEN_GENERACION[g.origen]} · {fechaHoraMx(g.creadaEn)} · {g.entregas === 1 ? '1 correo' : `${g.entregas} correos`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="rv-liq-rotulo">Archivo</h4>
        {d.descargaUrl ? (
          <div className="rv-liq-acciones">
            <a href={d.descargaUrl} download={d.descargaNombre} className="rv-btn rv-btn--secondary">Descargar el Excel</a>
            <span className="rv-liq-nota">{d.descargaNombre} · el enlace vale 24 horas</span>
          </div>
        ) : (
          <p className="rv-liq-sub">No se pudo preparar la descarga ahora. Recarga la página para intentarlo de nuevo.</p>
        )}
      </div>

      <Reenviar d={d} accion={p.acciones.reenviar} />

      <div>
        <h4 className="rv-liq-rotulo">Excepciones</h4>
        {d.excepciones.length === 0
          ? <p className="rv-liq-sub">Sin excepciones abiertas para esta bitácora.</p>
          : <ListaExcepciones items={d.excepciones} />}
      </div>
    </div>,
  );
}

/** Lo que pide a una persona, de toda la flota: sin póliza, operador sin alta o sin correo, retenidos y correcciones pendientes. */
export async function SeccionExcepciones(p: SeccionExcepcionesProps) {
  const todas = await p.excepciones;
  const lista = todas === null ? null : todas.slice(0, TOPE_EXCEPCIONES);
  const hayMas = todas !== null && todas.length > TOPE_EXCEPCIONES;
  if (lista === null) {
    return (
      <div id="excepciones">
        <Tarjeta titulo="Excepciones" info="desgloses.excepciones">
          <EstadoError compacto accion={<BotonEnlace href={`${query(p.contexto)}#excepciones`} tamano="sm">Reintentar</BotonEnlace>}>
            No se pudieron leer las excepciones. No es que no haya: no pudimos consultarlas ahora.
          </EstadoError>
        </Tarjeta>
      </div>
    );
  }
  return (
    <div id="excepciones">
      <Tarjeta titulo="Excepciones" info="desgloses.excepciones">
        <p className="rv-liq-sub">Lo que necesita a una persona antes de que el desglose llegue completo.</p>
        {lista.length === 0 ? (
          <EstadoVacio icono={Mail} titulo="Todo al corriente">Sin excepciones abiertas.</EstadoVacio>
        ) : (
          <>
            {hayMas && (
              <AvisoCompacto tono="warn" resumen={`Se muestran las ${TOPE_EXCEPCIONES} más recientes: hay más excepciones abiertas que no caben en esta lista. Resuelve las visibles para ver el resto.`} />
            )}
            <ul className="rv-liq-excepciones">
              {lista.map((x) => {
                const bitacora = typeof x.detalle.bitacora === 'string' ? x.detalle.bitacora : x.claveExterna;
                return (
                  <li key={x.id}>
                    <strong>{EXCEPCION[x.tipo]?.titulo ?? x.tipo}</strong>
                    <span className="rv-liq-apagado"> · bitácora {bitacora}</span>
                    <span className="rv-liq-apagado"> · desde {fechaHoraMx(x.primeraVez)}</span>
                    <span className="rv-liq-nota">{ayudaExcepcion(x.tipo, x.detalle)}</span>
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
export function VistaDesgloses({ desgloses, detalle, excepciones, notificaciones, cargas }: {
  desgloses: React.ReactNode; detalle?: React.ReactNode; excepciones?: React.ReactNode; notificaciones?: React.ReactNode;
  /** Ola 1 · A1: la subida de archivos (desgloses y correos de operadores) mientras el sistema del cliente no manda los datos solo. */
  cargas?: React.ReactNode;
}) {
  return (
    <MarcoPagina titulo="Liquidación automática" apoyo="Los desgloses de liquidación que llegan por correo, sus excepciones y las notificaciones de entrega.">
      {desgloses}
      {cargas}
      {detalle}
      {excepciones}
      {notificaciones}
    </MarcoPagina>
  );
}
