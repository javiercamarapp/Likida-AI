import Link from 'next/link';
import { Truck, ArrowRight, Download, RefreshCw, FileText } from 'lucide-react';
import { fechaCorta, numero, hoyMx, fechaHoraMx } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { ESTILO_CONTROL } from '@/app/admin/ui/forma';
import { dinero } from '@/lib/likida/liquidacion_externa/presentacion';
import { motivoDeFallo } from '@/lib/likida/liquidacion_externa/api';
import {
  ESTADOS, type EstadoLiquidacionExterna, type LiquidacionExterna,
} from '@/lib/likida/liquidacion_externa/repo';

// ═══════════════════════════════════════════════════════════════════════════
// «LIQUIDACIONES EXTERNAS» — el tablero del modo «solo entrega».
//
// Estas liquidaciones NO las calculó Likida: las calculó el SAP/TMS de la flota
// y Likida solo las entrega al chofer por WhatsApp. Por eso:
//
//   · viven en su propia sección y NO se mezclan con la cola de revisión ni con
//     los KPIs del agente (cuyas cifras sí salen del motor de cuadre);
//   · el rótulo de las cifras dice «calculada por tu sistema»: el contralor no
//     debe creer que Likida verificó un cálculo que no hizo;
//   · cada conteo es un conteo EXACTO de la base, y `null` se pinta «—» con su
//     leyenda: un cero que nadie midió afirmaría «nada falló» estando ciego.
//
// Lo primero que tiene que ver la oficina: las que el chofer marcó «No
// coincide», y las que fallaron — son las dos que piden una persona.
// ═══════════════════════════════════════════════════════════════════════════

export interface FichasExternas {
  porEstado: Record<EstadoLiquidacionExterna, number | null>;
  noCoincide: number | null;
}

export interface PaginaExternas {
  filas: LiquidacionExterna[];
  hayMas: boolean;
  siguiente: string | null;
  total: number | null;
}

export interface ExternasProps {
  fichas: Promise<FichasExternas>;
  pagina: Promise<PaginaExternas>;
  filtroEstado: FiltroExterno | null;
  /** Los campos de la query a conservar (`tenant`, `vista`, `rol`). */
  contexto: Array<[string, string]>;
  /** Mensaje de la última acción (`ext_msg`), ya validado contra la lista. */
  mensaje: 'reintentada' | 'no_aplica' | 'no_encontrada' | 'error' | null;
  puedeReintentar: boolean;
  /** Server action del host: reintenta UNA entrega fallida. */
  reintentar: (fd: FormData) => Promise<void>;
}

const ROTULO_ESTADO: Record<EstadoLiquidacionExterna, { rotulo: string; ayuda: string; fg: string; bg: string }> = {
  pendiente: { rotulo: 'Pendiente', ayuda: 'Recibida; todavía no entra a la cola de WhatsApp.', fg: 'var(--muted)', bg: 'var(--canvas)' },
  en_cola: { rotulo: 'En cola', ayuda: 'En la cola de WhatsApp; se reintenta sola.', fg: 'var(--warn)', bg: 'var(--warnbg)' },
  enviada: { rotulo: 'Enviada', ayuda: 'WhatsApp aceptó el mensaje; el chofer todavía no responde.', fg: 'var(--ok)', bg: 'var(--okbg)' },
  acusada: { rotulo: 'Con respuesta', ayuda: 'El chofer apretó un botón.', fg: 'var(--ok)', bg: 'var(--okbg)' },
  fallida: { rotulo: 'Falló', ayuda: 'No se pudo entregar. Se puede reintentar.', fg: 'var(--bad)', bg: 'var(--badbg)' },
};

const MENSAJES: Record<NonNullable<ExternasProps['mensaje']>, { texto: string; tono: 'ok' | 'bad' }> = {
  reintentada: { texto: 'Listo: la entrega se reintentó. Si WhatsApp la acepta, pasa a «Enviada».', tono: 'ok' },
  no_aplica: { texto: 'Esa liquidación ya no está fallida (alguien más la reintentó, o ya salió): no se mandó otra vez.', tono: 'bad' },
  no_encontrada: { texto: 'No encontré esa liquidación en tu flota.', tono: 'bad' },
  error: { texto: 'No se pudo reintentar ahorita. Vuelve a intentarlo en un momento.', tono: 'bad' },
};

export function leerMensajeExterno(v: string | undefined): ExternasProps['mensaje'] {
  return v === 'reintentada' || v === 'no_aplica' || v === 'no_encontrada' || v === 'error' ? v : null;
}

/** El filtro de la URL: un estado de entrega, o `no_coincide` (la respuesta del
 *  chofer que más pide a una persona, que vive dentro de `acusada`). */
export type FiltroExterno = EstadoLiquidacionExterna | 'no_coincide';

export function leerFiltroExterno(v: string | undefined): FiltroExterno | null {
  if (v === 'no_coincide') return 'no_coincide';
  return v && (ESTADOS as readonly string[]).includes(v) ? (v as EstadoLiquidacionExterna) : null;
}

const CLASE_CONTROL = 'text-[12.5px] rounded-lg px-2 py-1.5 min-w-[9rem]';

function query(contexto: Array<[string, string]>, extra: Array<[string, string]> = []): string {
  return `?${new URLSearchParams([...contexto, ...extra]).toString()}`;
}

/** El hijo más sencillo posible de la sección: la que llega por su cuenta. */
export async function SeccionExternas(p: ExternasProps) {
  const [fichas, pagina] = await Promise.all([p.fichas, p.pagina]);
  const hoy = hoyMx();
  const hace30 = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
  const sinNada = pagina.filas.length === 0 && !p.filtroEstado;

  return (
    <section className="card p-4" id="liquidaciones-externas">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5">
          <Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          Liquidaciones externas
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
          {pagina.total !== null ? `${numero(pagina.total)} en total` : 'Total no disponible'}
        </p>
      </div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
        Calculadas por el sistema de tu empresa (SAP/TMS). Likida solo las entrega al chofer por WhatsApp y registra su
        respuesta: no las recalcula ni las mezcla con las del cuadre de arriba.
      </p>

      {p.mensaje && (
        <p role="status" className="text-[12.5px] rounded-lg px-3 py-2 mb-3"
          style={{ background: MENSAJES[p.mensaje].tono === 'ok' ? 'var(--okbg)' : 'var(--badbg)', color: MENSAJES[p.mensaje].tono === 'ok' ? 'var(--ok)' : 'var(--bad)' }}>
          {MENSAJES[p.mensaje].texto}
        </p>
      )}

      {/* ── Las fichas: lo que pide a una persona, primero ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
        <Ficha etiqueta="No coincide" valor={fichas.noCoincide} tono="bad" ayuda="El chofer dice que su liquidación no cuadra. Revísala con él."
          href={query(p.contexto, [['ext_estado', 'no_coincide']])} />
        <Ficha etiqueta="Fallaron" valor={fichas.porEstado.fallida} tono="bad" ayuda={ROTULO_ESTADO.fallida.ayuda}
          href={query(p.contexto, [['ext_estado', 'fallida']])} />
        <Ficha etiqueta="Pendientes" valor={fichas.porEstado.pendiente} ayuda={ROTULO_ESTADO.pendiente.ayuda}
          href={query(p.contexto, [['ext_estado', 'pendiente']])} />
        <Ficha etiqueta="En cola" valor={fichas.porEstado.en_cola} ayuda={ROTULO_ESTADO.en_cola.ayuda}
          href={query(p.contexto, [['ext_estado', 'en_cola']])} />
        <Ficha etiqueta="Enviadas" valor={fichas.porEstado.enviada} ayuda={ROTULO_ESTADO.enviada.ayuda}
          href={query(p.contexto, [['ext_estado', 'enviada']])} />
        <Ficha etiqueta="Con respuesta" valor={fichas.porEstado.acusada} ayuda={ROTULO_ESTADO.acusada.ayuda}
          href={query(p.contexto, [['ext_estado', 'acusada']])} />
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3 justify-between">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {p.contexto.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="flex flex-col gap-1">
            <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Estado</span>
            <select name="ext_estado" defaultValue={p.filtroEstado ?? ''} className={CLASE_CONTROL} style={ESTILO_CONTROL}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => <option key={e} value={e}>{ROTULO_ESTADO[e].rotulo}</option>)}
              <option value="no_coincide">No coincide (respuesta del chofer)</option>
            </select>
          </label>
          <button type="submit" className="text-[12px] font-medium rounded-lg px-3 py-1.5"
            style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>Filtrar</button>
          {p.filtroEstado && (
            <Link href={query(p.contexto)} className="text-[12px] font-medium px-2 py-1.5 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--muted)' }}>Limpiar</Link>
          )}
        </form>

        {/* El CSV es de un PERIODO (máximo 3 meses): el rótulo lo dice. GET a la
            ruta de export, que re-gatea sesión, área y rol. */}
        <form method="get" action="/api/export/liquidaciones-externas" className="flex flex-wrap items-end gap-2">
          {p.contexto.filter(([k]) => k === 'tenant').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {p.filtroEstado && p.filtroEstado !== 'no_coincide' && <input type="hidden" name="estado" value={p.filtroEstado} />}
          {p.filtroEstado === 'no_coincide' && <input type="hidden" name="respuestaChofer" value="no_coincide" />}
          <label className="flex flex-col gap-1">
            <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Desde</span>
            <input type="date" name="desde" defaultValue={hace30} className={CLASE_CONTROL} style={ESTILO_CONTROL} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Hasta</span>
            <input type="date" name="hasta" defaultValue={hoy} className={CLASE_CONTROL} style={ESTILO_CONTROL} />
          </label>
          <button type="submit" className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-lg px-3 py-1.5 hairline">
            <Download width={12} height={12} strokeWidth={2} /> Exportar CSV
          </button>
        </form>
      </div>

      {pagina.filas.length === 0 ? (
        <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {sinNada
            ? 'Todavía no ha llegado ninguna liquidación de tu sistema. Cuando tu SAP/TMS la mande a Likida (POST /v1/liquidaciones-externas), la vas a ver aquí con su estado de entrega.'
            : 'Ninguna liquidación cae en ese estado.'}
        </EstadoVacio>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  <Th>Folio</Th><Th>Operador</Th><Th>Periodo</Th><Th derecha>Total (de tu sistema)</Th>
                  <Th>Estado</Th><Th>Respuesta del chofer</Th><Th>Enviada</Th><th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {pagina.filas.map((l) => <Fila key={l.id} l={l} p={p} />)}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2.5">
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>De la más nueva a la más vieja.</p>
            {pagina.siguiente && (
              <Link href={query(p.contexto, [...(p.filtroEstado ? [['ext_estado', p.filtroEstado] as [string, string]] : []), ['ext_cursor', pagina.siguiente]])}
                className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--marca)' }}>
                Siguientes <ArrowRight width={12} height={12} strokeWidth={2} />
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Fila({ l, p }: { l: LiquidacionExterna; p: ExternasProps }) {
  const e = ROTULO_ESTADO[l.estado] ?? { rotulo: l.estado, ayuda: '', fg: 'var(--muted)', bg: 'var(--canvas)' };
  const fallo = motivoDeFallo(l.ultimoError);
  const disputa = l.acuseTipo === 'no_coincide';
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line2)', background: disputa ? 'var(--badbg)' : undefined }}>
      <td className="py-2 font-medium">
        {l.claveExterna}
        {l.sistemaOrigen && <span className="block text-[11px] font-normal" style={{ color: 'var(--faint)' }}>{l.sistemaOrigen}</span>}
      </td>
      <td className="py-2" style={{ color: 'var(--muted)' }}>{l.operadorNombre ?? '—'}</td>
      <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaCorta(l.periodoDesde)} – {fechaCorta(l.periodoHasta)}</td>
      <td className="py-2 text-right cifra-mono">{dinero(l.total, l.moneda)}</td>
      <td className="py-2">
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" title={e.ayuda}
          style={{ color: e.fg, background: e.bg }}>{e.rotulo}</span>
        {l.via === 'plantilla' && <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>por plantilla (fuera de las 24 h)</span>}
        {/* El porqué, en frase: jamás el cuerpo crudo del error de Meta. */}
        {fallo && l.estado !== 'acusada' && <span className="block text-[11px] mt-0.5" style={{ color: 'var(--bad)' }}>{fallo.texto}</span>}
      </td>
      <td className="py-2">
        {l.acuseTipo === 'recibida' && <span style={{ color: 'var(--ok)' }}>Recibida</span>}
        {disputa && <span className="font-medium" style={{ color: 'var(--bad)' }}>No coincide</span>}
        {l.acuseTipo === null && <span style={{ color: 'var(--faint)' }}>Sin respuesta</span>}
        {l.acuseEn && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{fechaHoraMx(l.acuseEn)}</span>}
      </td>
      <td className="py-2" style={{ color: 'var(--muted)' }}>{l.enviadaEn ? fechaHoraMx(l.enviadaEn) : '—'}</td>
      <td className="py-2 text-right whitespace-nowrap">
        {l.pdfRuta && (
          <a href={`/api/export/liquidaciones-externas${query(p.contexto.filter(([k]) => k === 'tenant'), [['pdf', l.id]])}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity mr-3" style={{ color: 'var(--marca)' }}>
            <FileText width={12} height={12} strokeWidth={2} /> PDF
          </a>
        )}
        {l.estado === 'fallida' && p.puedeReintentar && (
          <form action={p.reintentar} className="inline">
            <input type="hidden" name="id" value={l.id} />
            <button type="submit" className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--marca)' }}>
              <RefreshCw width={12} height={12} strokeWidth={2} /> Reintentar
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

function Ficha({ etiqueta, valor, ayuda, href, tono }: { etiqueta: string; valor: number | null; ayuda: string; href: string; tono?: 'bad' }) {
  // `null` = no se pudo contar: «—», jamás un cero que nadie midió.
  const alerta = tono === 'bad' && valor !== null && valor > 0;
  return (
    <Link href={href} title={ayuda} className="card p-3 hover:opacity-80 transition-opacity block" style={alerta ? { borderColor: 'var(--bad)' } : undefined}>
      <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      <span className="text-[20px] font-semibold cifra-mono block" style={alerta ? { color: 'var(--bad)' } : undefined}>
        {valor === null ? '—' : numero(valor)}
      </span>
      {valor === null && <span className="text-[10px] block" style={{ color: 'var(--faint)' }}>no se pudo contar</span>}
    </Link>
  );
}

function Th({ children, derecha }: { children: React.ReactNode; derecha?: boolean }) {
  return <th className={`etiqueta-mono text-[10px] uppercase font-normal pb-2${derecha ? ' text-right' : ''}`}>{children}</th>;
}
