import type { Metadata } from 'next';
import {
  Inbox, ShieldCheck, Bot, Wrench, ReceiptText, LifeBuoy, ClipboardCheck, ArrowRight,
} from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  getBandejaEscalaciones, NOMBRE_FUENTE, conteoDeFuente,
  type BandejaEscalaciones, type FuenteEscalacion, type ItemEscalacion,
} from '@/lib/admin/escalaciones';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { leerResumenBandeja } from '@/lib/admin/cola-aprobacion';
import { ahoraMs } from '@/lib/saludo';
import { fechaHoraMx, fechaMx, numero } from '@/lib/formato';
import { Aviso, BotonEnlace, EstadoVacio, MarcoPagina, StatusChip, TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import { TiraCifras } from '../../ui-v2/graficas';
import { BloqueAgentesParados } from './agentes-parados';
import '../bandeja.css';

export const dynamic = 'force-dynamic';

const ICONO_FUENTE: Record<FuenteEscalacion, typeof Inbox> = {
  arco: ShieldCheck,
  corridas: Bot,
  talachas: Wrench,
  facturas_proveedor: ReceiptText,
  tickets: LifeBuoy,
  liquidaciones: ClipboardCheck,
};

/** "hace 3 h" / "hace 2 d" contra el MISMO reloj del servidor con el que se calculó el SLA de los tickets (ahoraMs inyectado a la
 *  bandeja) — dos relojes en la misma fila terminan contándose historias distintas. */
function edadDe(desdeIso: string, ahora: number): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

const FUENTES: FuenteEscalacion[] = ['arco', 'corridas', 'talachas', 'facturas_proveedor', 'tickets', 'liquidaciones'];

/** Cuántos pendientes se listan de una vez. Los CONTEOS de arriba siguen siendo de toda la cola — lo acotado es la tabla, y se declara. */
const TOPE_COLA = 50;

/**
 * ESCALACIONES — la bandeja del superadmin: UNA cola con todo lo que hoy espera a un humano, ordenada por urgencia. Nada aquí se mide
 * nuevo: son las seis lecturas de `lib/admin/escalaciones.ts` (que también alimenta la campana y el número de la pestaña). Los errores
 * van POR FUENTE: una fuente que no se pudo leer lo dice ("no se pudo leer" ≠ 0) y la cola sigue enseñando lo que sí se leyó.
 * Piloto de `TablaBase` (lista corta en memoria, directo en la rejilla, nunca dentro de una tarjeta).
 *
 * ADM-4: las cifras usan `conteoDeFuente` (total REAL), no el tamaño de una lista topada.
 * Además: «Agentes que no corrieron y por qué» (`getAgentesParados`), el P0 de visibilidad de la auditoría.
 */
export default async function EscalacionesPage() {
  await requireSuperadmin();
  const ahora = ahoraMs();
  // Nunca lanzan: los fallos de lectura vienen por valor (bandeja) o como null (parados, cola).
  const [bandeja, parados, cola]: [BandejaEscalaciones, Awaited<ReturnType<typeof getAgentesParados>>, Awaited<ReturnType<typeof leerResumenBandeja>>] =
    await Promise.all([getBandejaEscalaciones(ahora), getAgentesParados(ahora), leerResumenBandeja(ahora)]);
  // La cola viene ordenada por urgencia, así que recortar por la cola es recortar lo menos urgente.
  const cola50 = bandeja.cola.slice(0, TOPE_COLA);
  const recortada = bandeja.cola.length > TOPE_COLA;

  const ilegibles = FUENTES.filter((f) => bandeja.fuentes[f].error !== null);
  const legibles = FUENTES.filter((f) => bandeja.fuentes[f].error === null);

  const columnas: ColumnaBase<ItemEscalacion>[] = [
    {
      id: 'que', titulo: 'Qué espera', principal: true,
      celda: (it) => <>{it.titulo}{it.detalle ? <span className="bj-nota"> {it.detalle}</span> : null}</>,
    },
    {
      id: 'fuente', titulo: 'Fuente',
      celda: (it) => { const Icono = ICONO_FUENTE[it.fuente]; return <span className="bj-fuente"><Icono width={13} height={13} strokeWidth={1.75} aria-hidden="true" />{NOMBRE_FUENTE[it.fuente]}</span>; },
    },
    { id: 'flota', titulo: 'Flota', celda: (it) => it.tenantNombre },
    { id: 'desde', titulo: 'Desde', celda: (it) => `${fechaHoraMx(it.desde)} · ${edadDe(it.desde, ahora)}` },
    {
      id: 'vence', titulo: 'Vence',
      celda: (it) => (it.vence
        ? <StatusChip tono={new Date(it.vence).getTime() < ahora ? 'bad' : 'neutral'}>{fechaMx(it.vence)}</StatusChip>
        : '—'),
    },
    {
      id: 'resolver', titulo: 'Se resuelve en', alinear: 'der',
      // Sin pantalla a la cual llevar, se dice — un link que rebota es peor que ninguno.
      celda: (it) => (it.href
        ? <BotonEnlace href={it.href} variante="secondary" tamano="sm">Resolver <ArrowRight width={11} height={11} strokeWidth={1.75} aria-hidden="true" /></BotonEnlace>
        : 'sin ficha'),
    },
  ];

  return (
    <MarcoPagina titulo="Escalaciones" apoyo="Todo lo que espera a un humano, lo más vencido primero.">
      <TiraCifras
        etiqueta="Escalaciones por fuente"
        items={legibles.map((f) => {
          const Icono = ICONO_FUENTE[f];
          return { etiqueta: NOMBRE_FUENTE[f], valor: conteoDeFuente(f, bandeja.conteos), formato: 'entero' as const, icono: <Icono width={15} height={15} strokeWidth={1.75} /> };
        })}
      />

      {/* Fuentes que NO se pudieron leer — dicho, nunca un 0. */}
      {ilegibles.map((f) => (
        <Aviso key={f} tono="error" titulo={`${NOMBRE_FUENTE[f]}: no se pudo leer.`}>
          No es que haya 0 — la consulta falló y ahí puede haber pendientes que esta cola no está viendo. {bandeja.fuentes[f].error}
        </Aviso>
      ))}

      {bandeja.cola.length === 0 ? (
        legibles.length > 0 && (
          <EstadoVacio titulo={ilegibles.length === 0 ? 'La cola está vacía de verdad' : 'Sin pendientes en lo que se leyó'}>
            {ilegibles.length === 0 ? (
              <>
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
        <section className="bj-bloque" aria-labelledby="cola-escalaciones">
          <h2 className="bj-titulo" id="cola-escalaciones">La cola — lo más vencido o más viejo primero</h2>
          <TablaBase
            etiqueta="Cola de escalaciones" columnas={columnas} filas={cola50}
            idFila={(it) => `${it.fuente}-${it.desde}-${it.titulo}`} tarjetaMovil
          />
          <p className="bj-nota">
            {recortada
              ? `Se listan las ${numero(TOPE_COLA)} más urgentes de ${numero(bandeja.cola.length)} en la cola.`
              : `${numero(bandeja.cola.length)} ${bandeja.cola.length === 1 ? 'pendiente' : 'pendientes'} en la cola.`}
            {' '}El orden: lo que tiene plazo (ARCO, tickets con SLA) va por su plazo — vencido primero — y lo que
            no lo tiene, por cuánto lleva esperando. La campana de la consola suma exactamente estas fuentes.
            {recortada && ' Los conteos de arriba SÍ son de toda la cola: lo acotado es la tabla.'}
          </p>
        </section>
      )}

      <BloqueAgentesParados datos={parados} cola={cola} />
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Escalaciones' };
