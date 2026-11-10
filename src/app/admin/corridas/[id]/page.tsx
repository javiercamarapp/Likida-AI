import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { notFound } from 'next/navigation';
import { trazaDeCorrida, type TrazaCorrida } from '@/lib/admin/corridas-cruzadas';
import { fechaHoraMx, numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { valorLegible } from '../../valor-legible';
import { Aviso, BotonEnlace, EstadoError, MarcoPagina, StatusChip, Tarjeta, type TonoEstado } from '../../../ui-v2/componentes';
import { TiraCifras } from '../../../ui-v2/graficas';
import { etiquetaContadorVigia, etiquetaInterruptor } from '../../observabilidad/etiquetas';
import '../../sistema.css';

export const dynamic = 'force-dynamic';

const CHIP: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: 'Parcial' },
  fallo: { tono: 'bad', etiqueta: 'Fallo' },
};

const DISPARO: Record<string, string> = {
  cron: 'Programado',
  manual: 'Manual («Ejecutar ahora»)',
  correo: 'Por correo entrante',
  whatsapp: 'Confirmado por WhatsApp',
};

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * LA TRAZA DE UNA CORRIDA — misma anatomía que
 * /admin/soporte: una fila de `agente_corrida` (0102) abierta con todo lo
 * que se puede AFIRMAR de ella: agente, flota, estado, duración, tareas, su
 * resumen, su error redactado, y el costo de IA de esa flota EN LA VENTANA
 * de la corrida.
 *
 * El costo es CORRELACIÓN POR TIEMPO, no un join: `llm_costo` no tiene
 * `corrida_id` y no se le inventa — la cifra se rotula "en la ventana", con
 * su supuesto a la vista (ver corridas-cruzadas.ts). `requireSuperadmin()`
 * ya lo hizo el layout de /admin.
 */
export default async function TrazaCorridaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { id } = await params;
  // Un id que ni siquiera es uuid es un 404, no un error de consulta.
  if (!UUID.test(id)) notFound();

  // Error DICHO, no tragado: una traza en blanco sobre una base caída afirmaría "esta corrida no dejó nada", que es lo contrario de una traza.
  let traza: TrazaCorrida | null | undefined;
  try {
    traza = await trazaDeCorrida(id);
  } catch {
    traza = undefined;
  }
  if (traza === null) notFound();

  const volver = <BotonEnlace href="/admin/corridas" variante="ghost" tamano="sm">Volver a Corridas</BotonEnlace>;
  const c = traza?.corrida;
  const chip = c ? (CHIP[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }) : null;
  const flota = c ? (c.tenantNombre ?? (c.tenantId === null ? 'Likida (negocio)' : '—')) : '—';

  // UN solo marco para los dos casos (lectura caída o traza): cambian el título y el cuerpo, el marco no se duplica.
  return (
    <MarcoPagina
      titulo={c ? `Traza: ${etiquetaInterruptor(`agente:${c.agente}`)}` : 'Traza de la corrida'}
      apoyo={c ? `${flota} · ${fechaHoraMx(c.inicio)}` : undefined}
      acciones={<>{chip ? <StatusChip tono={chip.tono}>{chip.etiqueta}</StatusChip> : null}{volver}</>}
    >
      {traza === undefined ? (
        <EstadoError reintentar>No se pudo leer la corrida. La consulta falló: no es que no exista, es que no se pudo mirar.</EstadoError>
      ) : (
        <CuerpoTraza traza={traza as TrazaCorrida} flota={flota} />
      )}
    </MarcoPagina>
  );
}

/** Todo lo que se sabe de una corrida. */
function CuerpoTraza({ traza, flota }: { traza: TrazaCorrida; flota: string }) {
  const { corrida: c, costo, costoNoDisponible } = traza;
  const resumen = c.resumen ? Object.entries(c.resumen).map(([k, v]) => [etiquetaContadorVigia(k), valorLegible(v)] as const).filter((p): p is readonly [string, string] => p[1] !== null) : [];
  return (
    <>
      <TiraCifras etiqueta="La corrida en cifras" items={[
        // NULL ≠ 0: una corrida que no se mide en tareas dice «—», no 0/0.
        { etiqueta: 'Tareas', valor: c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal}` : null, estado: c.tareasHechas !== null && c.tareasTotal !== null ? 'ok' : 'vacio', mensaje: 'Esta corrida no mide tareas.' },
        { etiqueta: 'Duración', valor: c.fin === null ? null : duracion(c.duracionMs), estado: c.fin === null ? 'vacio' : 'ok', mensaje: 'Sin fin registrado.' },
        costo
          ? { etiqueta: 'Costo de IA en la ventana', valor: usd(costo.costoUsd), nota: 'Correlación por tiempo, no un cruce exacto.' }
          : { etiqueta: 'Costo de IA en la ventana', valor: null, estado: 'vacio', mensaje: 'No se puede correlacionar.' },
      ]} />

      {c.error ? (
        // El motivo YA redactado para una persona — nunca el stack.
        <Aviso tono="error" titulo="Por qué falló">{c.error}</Aviso>
      ) : null}

      <Tarjeta titulo="La corrida">
        <ul className="adm-sis-lista">
          <li><span>Agente</span><span>{etiquetaInterruptor(`agente:${c.agente}`)}</span></li>
          <li><span>Flota</span><span>{flota}</span></li>
          <li><span>Disparo</span><span>{DISPARO[c.disparo] ?? c.disparo}</span></li>
          <li><span>Inicio</span><span>{fechaHoraMx(c.inicio)}</span></li>
          <li><span>Fin</span><span>{c.fin ? fechaHoraMx(c.fin) : 'Sin fin registrado'}</span></li>
        </ul>
        {resumen.length > 0 ? (
          <>
            <h3 className="adm-sis-titulo">Resumen de la corrida</h3>
            <ul className="adm-sis-lista">
              {resumen.map(([k, v]) => <li key={k}><span>{k}</span><span className="adm-sis-dato">{v}</span></li>)}
            </ul>
          </>
        ) : null}
      </Tarjeta>

      {/* ── El costo de IA, con su supuesto a la vista ─────────────────────── */}
      <Tarjeta titulo="Costo de IA en la ventana de la corrida" estado={costo ? 'ok' : 'vacio'} mensaje="No se puede correlacionar" detalle={costoNoDisponible ?? 'El costo de esta corrida no se puede correlacionar.'}>
        {costo ? (
          <>
            <ul className="adm-sis-lista">
              <li><span>Llamadas al modelo</span><span>{numero(costo.llamadas)}</span></li>
              <li><span>Tokens (entrada / salida)</span><span>{numero(costo.tokensIn)} / {numero(costo.tokensOut)}</span></li>
              <li><span>Costo</span><span>{usd(costo.costoUsd)}</span></li>
            </ul>
            <p className="adm-sis-nota">
              Cifra honesta con su supuesto: son las llamadas de ESTA flota registradas dentro del inicio y el fin de esta corrida. Es una correlación por tiempo, no un cruce exacto,
              porque el registro de costos no guarda a qué corrida pertenece cada llamada. Si otro proceso de la misma flota gastó IA en ese lapso (por ejemplo, un mensaje de WhatsApp), su costo cae en la ventana.
            </p>
          </>
        ) : null}
      </Tarjeta>

      {/* ── A dónde seguir desde aquí ──────────────────────────────────────── */}
      <Tarjeta titulo="Seguir la pista">
        <div className="adm-sis-acciones">
          {c.tenantId !== null ? (
            <BotonEnlace href={`/dashboard?tenant=${c.tenantId}&rol=flota_admin`} variante="secondary" tamano="sm">Abrir el panel de esta flota</BotonEnlace>
          ) : null}
          <BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm">Conversaciones de WhatsApp</BotonEnlace>
        </div>
        <p className="adm-sis-nota">Abrir el panel de una flota la muestra como la ve ella y deja el acceso firmado en la bitácora. Las conversaciones cruzan todas las flotas: la columna de flota dice cuáles son de {flota}.</p>
      </Tarjeta>
    </>
  );
}

export const metadata: Metadata = { title: 'Corrida' };
