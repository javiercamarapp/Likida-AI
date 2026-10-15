import Link from 'next/link';
import { Mail, AlertTriangle, Route } from 'lucide-react';
import { fechaCorta, numero, hoyMx, fechaHoraMx } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { ESTILO_CONTROL } from '@/app/admin/ui/forma';
import { dinero } from '@/lib/likida/liquidacion_externa/presentacion';
import { BotonConfirmar } from '@/app/admin/ui/confirmar';
import { calcularInsightsA1, entradaDesdeFichas, type InsightA1 } from '@/lib/likida/liquidacion_externa/insights_a1';
import type { EntregaCorreo, EstadoEntregaCorreo, Excepcion, TipoExcepcion } from '@/lib/likida/liquidacion_externa/repo_correo';
import type { DetalleDesglose, LecturaDetalle, RolDetalle } from './detalle_desglose';
import { BarraPagina } from '../../resumen-visual';
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
      insights?: InsightA1[] };

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

type Tono = 'ok' | 'warn' | 'bad' | 'muted';
const COLOR: Record<Tono, { fg: string; bg: string }> = {
  ok: { fg: 'var(--ok)', bg: 'var(--okbg)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warnbg)' },
  bad: { fg: 'var(--bad)', bg: 'var(--badbg)' },
  muted: { fg: 'var(--muted)', bg: 'var(--canvas)' },
};

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

const CLASE_CONTROL = 'text-[12.5px] rounded-lg px-2 py-1.5 min-w-[9rem]';

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
      <section className="card p-4" id="desgloses" role="alert">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--badbg)' }}>
            <AlertTriangle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-sm">No se pudieron leer los desgloses. No es que no haya: no pudimos consultarlos ahora.</p>
            <Link href={`${query(p.contexto, params)}#desgloses`} className="inline-block mt-2 text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
              Reintentar
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const { fichas, filas, sinPoliza, siguiente } = lectura;
  const hoy = hoyMx();
  const filtrando = !!(p.filtro || p.desde || p.hasta);
  const verSinPoliza = p.filtro === 'sin_poliza';

  return (
    <section className="card p-4" id="desgloses">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5">
          <Mail width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          Desgloses de pago
        </h2>
        {p.filtro && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Filtro: {ROTULO_FILTRO[p.filtro]}</p>}
      </div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
        El desglose lo calcula el sistema de tu empresa. Likida lo manda por correo, en Excel, al operador, a su coordinador y a RH, y aquí ves
        el estado de cada envío.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
        <Ficha etiqueta="Recibidos hoy" valor={fichas.recibidosHoy} ayuda="Desgloses que llegaron hoy del sistema de tu empresa." href={query(p.contexto)} />
        <Ficha etiqueta="Enviados" valor={fichas.enviados} ayuda="Correos que ya salieron y esperan confirmación de entrega."
          href={query(p.contexto, [['des_estado', 'enviado']])} />
        <Ficha etiqueta="Entregados" valor={fichas.entregados} ayuda="Correos que el buzón de destino ya recibió."
          href={query(p.contexto, [['des_estado', 'entregado']])} />
        <Ficha etiqueta="Rebotados" valor={fichas.rebotados} tono="bad" ayuda="Correos que no llegaron. Corrige la dirección y reenvía."
          href={query(p.contexto, [['des_estado', 'rebotado']])} />
        <Ficha etiqueta="Retenidos" valor={fichas.retenidos} tono="bad" ayuda="Desgloses detenidos antes de enviarse (por ejemplo, neto negativo)."
          href={query(p.contexto, [['des_estado', 'retenido']])} />
        <Ficha etiqueta="Sin póliza" valor={fichas.sinPoliza} tono="bad" ayuda="Bitácoras que esperan su póliza para poder enviarse."
          href={query(p.contexto, [['des_estado', 'sin_poliza']])} />
      </div>

      <BloqueInsights insights={lectura.insights ?? calcularInsightsA1(entradaDesdeFichas(fichas))} />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-3">
        {p.contexto.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex flex-col gap-1">
          <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Estado</span>
          <select name="des_estado" defaultValue={p.filtro ?? ''} className={CLASE_CONTROL} style={ESTILO_CONTROL}>
            <option value="">Todos</option>
            {FILTROS.map((f) => <option key={f} value={f}>{ROTULO_FILTRO[f]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Desde</span>
          <input type="date" name="des_desde" defaultValue={p.desde ?? ''} max={hoy} className={CLASE_CONTROL} style={ESTILO_CONTROL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Hasta</span>
          <input type="date" name="des_hasta" defaultValue={p.hasta ?? ''} max={hoy} className={CLASE_CONTROL} style={ESTILO_CONTROL} />
        </label>
        <button type="submit" className="text-[12px] font-medium rounded-lg px-3 py-1.5" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>Filtrar</button>
        {filtrando && (
          <Link href={query(p.contexto)} className="text-[12px] font-medium px-2 py-1.5 hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>Limpiar</Link>
        )}
      </form>

      {verSinPoliza ? (
        sinPoliza.length === 0 ? (
          <EstadoVacio icono={<Mail width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            Ninguna bitácora está esperando póliza.
          </EstadoVacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: 'var(--faint)' }}><Th>Bitácora</Th><Th>Esperando desde</Th><Th>Última revisión</Th></tr></thead>
              <tbody>
                {sinPoliza.map((s) => (
                  <tr key={s.bitacora} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                    <td className="py-2 font-medium">{s.bitacora}</td>
                    <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaHoraMx(s.desde)}</td>
                    <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaHoraMx(s.ultimaVez)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>Estas bitácoras no se enviarán hasta tener póliza: revísalas en el sistema de tu empresa.</p>
          </div>
        )
      ) : filas.length === 0 ? (
        <EstadoVacio icono={<Route width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {filtrando
            ? 'Ningún desglose cae en ese filtro. Prueba con otro estado o con más fechas.'
            : 'Aún no hay desgloses: llegan cuando una bitácora tiene póliza.'}
        </EstadoVacio>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  <Th>Bitácora</Th><Th>Operador</Th><Th>Periodo</Th><Th derecha>Neto (de tu sistema)</Th>
                  {ROLES_VISIBLES.map((r) => <Th key={r}>{ROTULO_ROL[r]}</Th>)}
                  <Th>Detalle</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => <Fila key={f.liquidacionId} f={f} href={`${query(p.contexto, [...params, ['des_det', f.liquidacionId]])}#detalle-desglose`} />)}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2.5">
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>De la más nueva a la más vieja.</p>
            {siguiente && (
              <NavPaginas>
                <EnlacePagina href={`${query(p.contexto, [...params, ['des_cursor', siguiente]])}#desgloses`} direccion="siguiente" />
              </NavPaginas>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Fila({ f, href }: { f: FilaDesglose; href: string }) {
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
      <td className="py-2 font-medium">
        {f.bitacora}
        {f.terminal && <span className="block text-[11px] font-normal" style={{ color: 'var(--faint)' }}>{f.terminal}</span>}
      </td>
      <td className="py-2" style={{ color: 'var(--muted)' }}>{f.operador ?? '—'}</td>
      <td className="py-2" style={{ color: 'var(--muted)' }}>
        {f.periodoDesde && f.periodoHasta ? `${fechaCorta(f.periodoDesde)} – ${fechaCorta(f.periodoHasta)}` : '—'}
      </td>
      <td className="py-2 text-right cifra-mono">{f.neto === null ? '—' : dinero(f.neto, f.moneda)}</td>
      {ROLES_VISIBLES.map((rol) => {
        const d = f.destinos[rol];
        const r = rotuloDestino(d);
        const ayuda = ayudaDestino(rol, d);
        return (
          <td key={rol} className="py-2">
            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" title={ayuda ?? undefined}
              style={{ color: COLOR[r.tono].fg, background: COLOR[r.tono].bg }}>{r.rotulo}</span>
            {d.en && (d.estado === 'entregado' || d.estado === 'enviado' || d.estado === 'no_entregado') && (
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{fechaHoraMx(d.en)}</span>
            )}
            {ayuda && <span className="block text-[11px] mt-0.5" style={{ color: r.tono === 'bad' ? 'var(--bad)' : 'var(--muted)' }}>{ayuda}</span>}
          </td>
        );
      })}
      <td className="py-2">
        <Link href={href} className="text-[12px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--marca)' }}>Ver detalle</Link>
      </td>
    </tr>
  );
}

const COLOR_INSIGHT: Record<InsightA1['tono'], string> = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--faint)' };

/** «Qué pasó · qué significa · qué hacer»: frases calculadas por reglas (sin IA), cada una con la fuente de su cifra. */
export function BloqueInsights({ insights }: { insights: InsightA1[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="mb-3" id="insights-desgloses" aria-label="Lectura de los desgloses">
      <p className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>Qué pasó · qué significa · qué hacer</p>
      <ul className="space-y-2">
        {insights.map((i) => (
          <li key={i.id} data-insight={i.id} className="rounded-lg hairline px-3 py-2" style={{ borderLeft: `3px solid ${COLOR_INSIGHT[i.tono]}` }}>
            <p className="text-[13px] font-medium">{i.quePaso}</p>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{i.queSignifica}</p>
            <p className="text-[12px]">{i.queHacer}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--faint)' }}>Fuente: {i.fuente}</p>
          </li>
        ))}
      </ul>
    </div>
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
  r_no_liberable: { texto: 'Este desglose trae un concepto que la empresa prohibió enviar: corrígelo en su sistema; no se libera desde aquí.', tono: 'bad' },
};

/** Solo los códigos conocidos: un texto inventado en la URL no se pinta. */
export function leerMensajeDesglose(v: string | undefined): MensajeDesglose | null {
  return v && Object.prototype.hasOwnProperty.call(MENSAJES, v) ? MENSAJES[v]! : null;
}

// ── El detalle de una bitácora ─────────────────────────────────────────────

const ROTULO_ROL_DETALLE: Record<RolDetalle, string> = { operador: 'Operador', coordinador: 'Coordinador', rh: 'RH', archivo: 'Archivo' };
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
};

function Mensaje({ m }: { m: MensajeDesglose }) {
  return (
    <p role="status" className="text-[12.5px] rounded-lg px-3 py-2 mb-3"
      style={m.tono === 'ok' ? { color: 'var(--ok)', background: 'var(--okbg)' } : { color: 'var(--bad)', background: 'var(--badbg)' }}>
      {m.texto}
    </p>
  );
}

function TablaRenglones({ titulo, renglones, moneda }: { titulo: string; renglones: Array<{ descripcion: string; monto: number }>; moneda: 'MXN' | 'USD' }) {
  return (
    <div className="flex-1 min-w-[16rem]">
      <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>{titulo}</h4>
      {renglones.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Sin renglones.</p>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {renglones.map((r, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                <td className="py-1.5">{r.descripcion}</td>
                <td className="py-1.5 text-right cifra-mono">{dinero(r.monto, moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const CLASE_BOTON = 'hairline h-8 rounded-lg px-3 text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40';

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
      <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Reenviar</h4>
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <form key={o.a} action={accion}>
            <input type="hidden" name="id" value={d.liquidacionId} />
            <input type="hidden" name="a" value={o.a} />
            <input type="hidden" name="motivo" value="reclamo" />
            <BotonConfirmar
              etiqueta={o.etiqueta} titulo="Reenviar el desglose" etiquetaConfirmar="Sí, reenviar" tono="normal"
              descripcion={`Se volverá a mandar el desglose de la bitácora ${d.bitacora} ${o.que}. Queda registrado quién lo pidió.`}
              deshabilitado={o.curso || sinArchivo} className={CLASE_BOTON}
            />
          </form>
        ))}
      </div>
      {hayCurso && <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>Hay un envío en curso: espera a que termine para reenviar.</p>}
      {sinArchivo && <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>Este desglose está retenido: primero libera el envío.</p>}

      <form action={accion} className="flex flex-wrap items-end gap-2 mt-3">
        <input type="hidden" name="id" value={d.liquidacionId} />
        <input type="hidden" name="a" value="operador" />
        <input type="hidden" name="motivo" value="correccion_de_correo" />
        <label className="flex flex-col gap-1">
          <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Correo nuevo del operador</span>
          <input type="email" name="correo_nuevo" required maxLength={254} autoComplete="off" placeholder="Correo del operador"
            className={`${CLASE_CONTROL} min-w-[16rem]`} style={ESTILO_CONTROL} />
        </label>
        <BotonConfirmar
          etiqueta="Corregir correo del operador y reenviar" titulo="Corregir el correo y reenviar" etiquetaConfirmar="Sí, corregir y reenviar" tono="normal"
          descripcion="Se guarda el correo nuevo en la ficha del operador y se le vuelve a mandar este desglose. Los próximos también irán a ese correo."
          deshabilitado={d.enCurso.operador || sinArchivo} className={CLASE_BOTON}
        />
      </form>
    </div>
  );
}

function EstadoCabecera({ d }: { d: DetalleDesglose }) {
  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3 text-[13px]">
      <div><dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Operador</dt><dd>{d.operador ?? '—'}</dd></div>
      <div><dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Periodo</dt><dd>{`${fechaCorta(d.periodoDesde)} – ${fechaCorta(d.periodoHasta)}`}</dd></div>
      <div><dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Terminal</dt><dd>{d.terminal ?? '—'}</dd></div>
      <div><dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Neto (de tu sistema)</dt><dd className="cifra-mono font-semibold">{dinero(d.neto, d.moneda)}</dd></div>
    </dl>
  );
}

function ListaExcepciones({ items }: { items: Array<{ tipo: TipoExcepcion; desde: string }> }) {
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={`${x.tipo}-${i}`} className="text-[12.5px]">
          <span className="font-medium">{EXCEPCION[x.tipo].titulo}</span>
          <span style={{ color: 'var(--faint)' }}> · desde {fechaHoraMx(x.desde)}</span>
          <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>{EXCEPCION[x.tipo].ayuda}</span>
        </li>
      ))}
    </ul>
  );
}

export async function PanelDetalleDesglose(p: PanelDetalleProps) {
  const lectura = await p.lectura;
  const cerrar = `${query(p.contexto, p.params)}#desgloses`;
  const marco = (cuerpo: React.ReactNode, titulo = 'Detalle del desglose') => (
    <section className="card p-4" id="detalle-desglose">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <h2 className="font-display text-[15px] font-semibold">{titulo}</h2>
        <Link href={cerrar} className="text-[12px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>Cerrar</Link>
      </div>
      {p.mensaje && <Mensaje m={p.mensaje} />}
      {cuerpo}
    </section>
  );

  if (lectura.estado === 'error') {
    return marco(
      <div role="alert" className="flex items-start gap-3">
        <AlertTriangle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
        <div>
          <p className="text-sm">No se pudo leer este desglose. No es que no exista: no pudimos consultarlo ahora.</p>
          <Link href={`${query(p.contexto, p.params)}#detalle-desglose`} className="inline-block mt-2 text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">Reintentar</Link>
        </div>
      </div>,
    );
  }
  if (lectura.estado === 'no_encontrado') return marco(<p className="text-[13px]" style={{ color: 'var(--muted)' }}>No encontré ese desglose en tu flota.</p>);

  const d = lectura.detalle;
  return marco(
    <div className="space-y-4">
      <p className="text-[13px] font-medium">Bitácora {d.bitacora}</p>
      <EstadoCabecera d={d} />

      {d.retenido && (
        <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--warnbg)' }}>
          <p className="text-[13px] font-medium" style={{ color: 'var(--warn)' }}>
            {d.retenido.por === 'neto' ? 'Retenido: neto negativo' : 'Retenido: pide revisión'}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Este desglose no se ha enviado a nadie.{' '}
            {d.retenido.liberable ? 'Si el monto está bien, puedes liberar el envío.' : 'Corrígelo en el sistema de tu empresa: no se libera desde aquí.'}
          </p>
          {d.retenido.liberable && (
            <form action={p.acciones.liberar} className="mt-2">
              <input type="hidden" name="id" value={d.liquidacionId} />
              <BotonConfirmar
                etiqueta="Liberar envío" titulo="Liberar el envío" etiquetaConfirmar="Sí, liberar y enviar" tono="normal"
                descripcion={`Se enviará el desglose de la bitácora ${d.bitacora} al operador, a su coordinador y a RH. Queda registrado quién lo liberó.`}
                className={CLASE_BOTON}
              />
            </form>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <TablaRenglones titulo="Percepciones" renglones={d.percepciones} moneda={d.moneda} />
        <TablaRenglones titulo="Deducciones" renglones={d.deducciones} moneda={d.moneda} />
      </div>

      <div>
        <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Destinatarios</h4>
        {d.destinatarios.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {d.retenido ? 'Aún no se manda a nadie: el desglose está retenido.' : 'Este desglose no tiene correos programados.'}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: 'var(--faint)' }}><Th>Quién</Th><Th>Correo</Th><Th>Estado</Th><Th>Cuándo</Th></tr></thead>
            <tbody>
              {d.destinatarios.map((x, i) => {
                const r = rotuloDestino(x.destino);
                return (
                  <tr key={`${x.rol}-${i}`} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                    <td className="py-1.5">{ROTULO_ROL_DETALLE[x.rol]}</td>
                    <td className="py-1.5 cifra-mono" style={{ color: 'var(--muted)' }}>{x.correo}</td>
                    <td className="py-1.5">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: COLOR[r.tono].fg, background: COLOR[r.tono].bg }}>{r.rotulo}</span>
                    </td>
                    <td className="py-1.5" style={{ color: 'var(--muted)' }}>{x.en ? fechaHoraMx(x.en) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {d.generaciones.length > 0 && (
        <div>
          <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Historial de envíos</h4>
          <ul className="text-[12.5px] space-y-0.5">
            {d.generaciones.map((g) => (
              <li key={g.generacion}>
                <span className="font-medium">Envío {g.generacion}</span>
                <span style={{ color: 'var(--muted)' }}> · {ORIGEN_GENERACION[g.origen]} · {fechaHoraMx(g.creadaEn)} · {g.entregas === 1 ? '1 correo' : `${g.entregas} correos`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Archivo</h4>
        {d.descargaUrl ? (
          <>
            <a href={d.descargaUrl} download={d.descargaNombre} className={`${CLASE_BOTON} inline-flex items-center`}>Descargar el Excel</a>
            <span className="text-[11px] ml-2" style={{ color: 'var(--faint)' }}>{d.descargaNombre} · el enlace vale 24 horas</span>
          </>
        ) : (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo preparar la descarga ahora. Recarga la página para intentarlo de nuevo.</p>
        )}
      </div>

      <Reenviar d={d} accion={p.acciones.reenviar} />

      <div>
        <h4 className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Excepciones</h4>
        {d.excepciones.length === 0
          ? <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Sin excepciones abiertas para esta bitácora.</p>
          : <ListaExcepciones items={d.excepciones} />}
      </div>
    </div>,
  );
}

/** Lo que pide a una persona, de toda la flota: sin póliza, operador sin alta o sin correo, retenidos y correcciones pendientes. */
export async function SeccionExcepciones(p: SeccionExcepcionesProps) {
  const lista = await p.excepciones;
  if (lista === null) {
    return (
      <section className="card p-4" id="excepciones" role="alert">
        <p className="text-sm">No se pudieron leer las excepciones. No es que no haya: no pudimos consultarlas ahora.</p>
        <Link href={`${query(p.contexto)}#excepciones`} className="inline-block mt-2 text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">Reintentar</Link>
      </section>
    );
  }
  return (
    <section className="card p-4" id="excepciones">
      <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5 mb-1">
        <AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        Excepciones
      </h2>
      <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>Lo que necesita a una persona antes de que el desglose llegue completo.</p>
      {lista.length === 0 ? (
        <EstadoVacio icono={<Mail width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>Sin excepciones abiertas.</EstadoVacio>
      ) : (
        <ul className="space-y-2">
          {lista.map((x) => {
            const bitacora = typeof x.detalle.bitacora === 'string' ? x.detalle.bitacora : x.claveExterna;
            return (
              <li key={x.id} className="text-[12.5px]">
                <span className="font-medium">{EXCEPCION[x.tipo]?.titulo ?? x.tipo}</span>
                <span style={{ color: 'var(--muted)' }}> · bitácora {bitacora}</span>
                <span style={{ color: 'var(--faint)' }}> · desde {fechaHoraMx(x.primeraVez)}</span>
                <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>{EXCEPCION[x.tipo]?.ayuda ?? ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** El marco de la pantalla de un tenant que recibe el desglose por correo: la sección y los avisos, sin los KPIs, la cola ni la estrategia del flujo de fotos. */
export function VistaDesgloses({ desgloses, detalle, excepciones, notificaciones }: {
  desgloses: React.ReactNode; detalle?: React.ReactNode; excepciones?: React.ReactNode; notificaciones?: React.ReactNode;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Route width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Liquidación automática" />
        <div className="px-5 py-5 flex-1 space-y-4">
          {desgloses}
          {detalle}
          {excepciones}
          {notificaciones}
        </div>
      </div>
    </main>
  );
}
