import Link from 'next/link';
import { Mail, AlertTriangle, Route } from 'lucide-react';
import { fechaCorta, numero, hoyMx, fechaHoraMx } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { ESTILO_CONTROL } from '@/app/admin/ui/forma';
import { dinero } from '@/lib/likida/liquidacion_externa/presentacion';
import type { EntregaCorreo, EstadoEntregaCorreo } from '@/lib/likida/liquidacion_externa/repo_correo';
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
// Es de lectura: reenviar y el detalle llegan en la siguiente pantalla.
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
  | { ok: true; fichas: FichasDesgloses; filas: FilaDesglose[]; sinPoliza: FilaSinPoliza[]; siguiente: string | null };

export interface DesglosesProps {
  lectura: Promise<LecturaDesgloses>;
  filtro: FiltroDesglose | null;
  /** Días AAAA-MM-DD ya validados (`leerDia`). */
  desde: string | null;
  hasta: string | null;
  /** Los campos de la query a conservar (`tenant`, `vista`, `rol`). */
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
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => <Fila key={f.liquidacionId} f={f} />)}
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

function Fila({ f }: { f: FilaDesglose }) {
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

/** El marco de la pantalla de un tenant que recibe el desglose por correo: la sección y los avisos, sin los KPIs, la cola ni la estrategia del flujo de fotos. */
export function VistaDesgloses({ desgloses, notificaciones }: { desgloses: React.ReactNode; notificaciones?: React.ReactNode }) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Route width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Liquidación automática" />
        <div className="px-5 py-5 flex-1 space-y-4">
          {desgloses}
          {notificaciones}
        </div>
      </div>
    </main>
  );
}
