import Link from 'next/link';
import {
  Inbox, ShieldCheck, Bot, Wrench, ReceiptText, LifeBuoy, ClipboardCheck,
  ArrowRight, AlertTriangle,
} from 'lucide-react';
import {
  getBandejaEscalaciones, NOMBRE_FUENTE, conteoDeFuente,
  type BandejaEscalaciones, type FuenteEscalacion, type ItemEscalacion,
} from '@/lib/admin/escalaciones';
import { ahoraMs } from '@/lib/saludo';
import { fechaHoraMx, fechaMx, numero } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/** El glifo de cada fuente — mismo vocabulario visual que el resto de /admin
 *  (ShieldCheck es Compliance, LifeBuoy es Soporte, Bot son los agentes). */
const ICONO_FUENTE: Record<FuenteEscalacion, typeof Inbox> = {
  arco: ShieldCheck,
  corridas: Bot,
  talachas: Wrench,
  facturas_proveedor: ReceiptText,
  tickets: LifeBuoy,
  liquidaciones: ClipboardCheck,
};

/** "hace 3 h" / "hace 2 d" contra el MISMO reloj del servidor con el que se
 *  calculó el SLA de los tickets (ahoraMs inyectado a la bandeja) — dos
 *  relojes en la misma fila terminan contándose historias distintas. */
function edadDe(desdeIso: string, ahora: number): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/** El orden fijo con el que se recorren las fuentes en KPIs y errores. */
const FUENTES: FuenteEscalacion[] = [
  'arco', 'corridas', 'talachas', 'facturas_proveedor', 'tickets', 'liquidaciones',
];

/**
 * ESCALACIONES — la bandeja del superadmin: UNA cola con todo lo que hoy
 * espera a un humano, ordenada por urgencia (patrón Agent Inbox del informe
 * de consolas). Nada aquí se mide nuevo: son las seis lecturas que ya
 * existían — ARCO (compliance), corridas en fallo (bitácora 0102), talachas
 * por autorizar (0107), facturas de proveedor pendientes (0091), tickets
 * (0051) y liquidaciones en `revisar` — aplanadas por
 * `lib/admin/escalaciones.ts`, que es también quien alimenta la campana.
 *
 * Anatomía de página (misma que /admin/soporte): BarraPagina + tarjetas
 * blancas sobre el lienzo tenue. Los errores van POR FUENTE: si una tabla
 * no se pudo leer, SU tarjeta lo dice ("no se pudo leer" ≠ 0) y la cola
 * sigue enseñando lo que sí se leyó.
 */
/** Cuántos pendientes se listan de una vez. Los CONTEOS de arriba siguen
 *  siendo de toda la cola — lo acotado es la tabla, y se declara. */
const TOPE_COLA = 50;

// AUDITORÍA 24, ADM-4 (ALTO): las tarjetas de arriba pintaban
// `bandeja.fuentes[f].items?.length` — para `corridas`, `tickets` y
// `liquidaciones` esa lista viene TOPADA (`TOPE_CORRIDAS_FALLIDAS`,
// `TOPE_TICKETS`, `LIMITE_LIQUIDACIONES_REVISAR`), mientras el pie de la
// tabla afirmaba "Los conteos de arriba SÍ son de toda la cola". Con 300
// corridas en fallo la tarjeta decía 20 y el pie mentía sobre esa misma
// tarjeta. `conteoDeFuente` (lib/admin/escalaciones.ts) ya trae el total
// REAL de cada fuente — esto solo cambia de dónde lee la tarjeta.

export default async function EscalacionesPage() {
  const ahora = ahoraMs();
  // Nunca lanza: los fallos de lectura vienen por valor DENTRO de la bandeja.
  const bandeja: BandejaEscalaciones = await getBandejaEscalaciones(ahora);
  // FE-11: cuántas filas de la cola se DIBUJAN. La cola viene ordenada por
  // urgencia, así que recortar por la cola es recortar lo menos urgente.
  const cola = bandeja.cola.slice(0, TOPE_COLA);
  const recortada = bandeja.cola.length > TOPE_COLA;

  const ilegibles = FUENTES.filter((f) => bandeja.fuentes[f].error !== null);
  const legibles = FUENTES.filter((f) => bandeja.fuentes[f].error === null);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Inbox {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Escalaciones — todo lo que espera a un humano"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── Un conteo por fuente — solo las que SÍ se leyeron ─────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {legibles.map((f) => {
              const Icono = ICONO_FUENTE[f];
              return (
                <StatCard key={f} icono={<Icono {...ICONO} />}
                  etiqueta={NOMBRE_FUENTE[f]} valor={conteoDeFuente(f, bandeja.conteos)} formato="entero"
                />
              );
            })}
          </div>

          {/* ── Fuentes que NO se pudieron leer — dicho, nunca un 0 ───────── */}
          {ilegibles.map((f) => (
            <div key={f} className="card p-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--badbg)' }}>
                <AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
              </div>
              <p className="text-sm pt-1">
                <span className="font-semibold">{NOMBRE_FUENTE[f]}: no se pudo leer.</span>{' '}
                No es que haya 0 — la consulta falló y ahí puede haber pendientes que esta cola no está viendo.
                <span className="block text-xs mt-0.5 font-mono" style={{ color: 'var(--muted)' }}>{bandeja.fuentes[f].error}</span>
              </p>
            </div>
          ))}

          {/* ── LA cola ───────────────────────────────────────────────────── */}
          {bandeja.cola.length === 0 ? (
            legibles.length > 0 && (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                {ilegibles.length === 0 ? (
                  <>
                    <span className="font-semibold">La cola está vacía de verdad.</span>{' '}
                    Las seis fuentes se leyeron completas y ninguna tiene nada esperando a un humano:
                    ni solicitudes ARCO sin responder, ni corridas en fallo, ni talachas por autorizar,
                    ni facturas de proveedor pendientes, ni tickets abiertos, ni liquidaciones en revisión.
                  </>
                ) : (
                  <>
                    Las fuentes que sí se pudieron leer no tienen nada esperando — pero{' '}
                    {ilegibles.length === 1 ? 'una fuente quedó' : `${ilegibles.length} fuentes quedaron`} sin
                    leer (arriba), así que esto NO afirma que no haya pendientes en total.
                  </>
                )}
              </EstadoVacio>
            )
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 pt-3 pb-1">
                <TituloSeccion>La cola — lo más vencido o más viejo primero</TituloSeccion>
              </div>
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-4 py-2 font-medium">Qué espera</th>
                      <th className="px-4 py-2 font-medium">Fuente</th>
                      <th className="px-4 py-2 font-medium">Flota</th>
                      <th className="px-4 py-2 font-medium">Desde</th>
                      <th className="px-4 py-2 font-medium">Vence</th>
                      <th className="px-4 py-2 font-medium text-right">Se resuelve en</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cola.map((it: ItemEscalacion, i) => {
                      const Icono = ICONO_FUENTE[it.fuente];
                      return (
                        <tr key={`${it.fuente}-${it.desde}-${i}`} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{it.titulo}</div>
                            {it.detalle && (
                              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{it.detalle}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                              <Icono width={13} height={13} strokeWidth={1.75} /> {NOMBRE_FUENTE[it.fuente]}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">{it.tenantNombre}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>
                            {fechaHoraMx(it.desde)} · {edadDe(it.desde, ahora)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular" style={{ color: 'var(--muted)' }}>
                            {it.vence ? fechaMx(it.vence) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {it.href ? (
                              <Link href={it.href} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                                Resolver <ArrowRight width={11} height={11} strokeWidth={1.75} />
                              </Link>
                            ) : (
                              // Sin pantalla a la cual llevar, se dice — un
                              // link que rebota es peor que ninguno.
                              <span className="text-xs" style={{ color: 'var(--faint)' }}>sin ficha</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* FE-11: la tabla pintaba la cola ENTERA. Con las seis fuentes
                  acotadas hoy son cientos de <tr>, y el día que la cola de
                  liquidaciones se llene, miles — una página que no abre justo
                  cuando hay más que atender. Se pintan las 50 más urgentes y
                  se dice cuántas hay: el orden ya pone arriba lo que importa. */}
              <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
                {recortada
                  ? `Se listan las ${numero(TOPE_COLA)} más urgentes de ${numero(bandeja.cola.length)} en la cola.`
                  : `${numero(bandeja.cola.length)} ${bandeja.cola.length === 1 ? 'pendiente' : 'pendientes'} en la cola.`}
                {' '}El orden: lo que tiene plazo (ARCO, tickets con SLA) va por su plazo — vencido primero — y lo que
                no lo tiene, por cuánto lleva esperando. La campana de la consola suma exactamente estas fuentes.
                {recortada && ' Los conteos de arriba SÍ son de toda la cola: lo acotado es la tabla.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
