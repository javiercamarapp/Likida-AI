import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mxn } from '@/lib/utils';
import { hoyMx } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { getPorCobrar } from '@/lib/saas/transferencia';
import { getPiezasDunningPlataforma, getUltimaCorridaDunningPlataforma, type CorridaDunning, type PiezaDunning } from '@/lib/likida/repo';
import { armarEstadoDunning, type SelloToque } from '@/lib/likida/cobranza_estado';
import type { FacturaPorCobrar } from '@/lib/saas/transferencia';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio, StatusPill, type Estado } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Cobranza / Facturas — Likida cobrando a SUS clientes (no confundir con
 * `gasto`: los comprobantes de gasto de un viaje son recibos del conductor,
 * un concepto totalmente distinto).
 *
 * E1-B (P0-7): esta página decía que el dunning era «por venir», pero el agente
 * `cobranza_saas` (`agentes/exito.ts`) ya corre la cadencia de cinco toques
 * −3/0/+3/+7/+15 contra `factura_saas`. Ahora muestra el estado REAL: qué
 * facturas están por cobrar, qué toque le toca a cada una, y si su propuesta
 * está pendiente, aprobada, rechazada o enviada.
 *
 * LO QUE EL DUNNING NO HACE, y la página lo dice: produce PROPUESTAS a la
 * bandeja de aprobación, no envíos — no hay canal de correo al cliente
 * aprobado, así que nada sale solo. Y `null` es «no se pudo leer», `[]` es
 * «no hay nada»: cada lectura falla por separado y se avisa, para no decir
 * «nada por cobrar» con la base caída.
 */
const ROTULO_SELLO: Record<SelloToque, { texto: string; estado: Estado }> = {
  sin_propuesta: { texto: 'sin propuesta', estado: 'bad' },
  pendiente: { texto: 'propuesta pendiente', estado: 'warn' },
  aprobada: { texto: 'aprobada, sin enviar', estado: 'warn' },
  rechazada: { texto: 'rechazada', estado: 'neutral' },
  enviada: { texto: 'enviada', estado: 'ok' },
};

const hito = (h: number) => `D${h >= 0 ? '+' : ''}${h}`;

async function leer<T>(nombre: string, f: () => Promise<T>): Promise<{ dato: T | null; error: boolean }> {
  try { return { dato: await f(), error: false }; }
  catch (e) { logger.error(`admin.cobranza.${nombre}`, { err: e instanceof Error ? e.message : String(e) }); return { dato: null, error: true }; }
}

export default async function CobranzaPage() {
  // La puerta de la PÁGINA, no solo la del layout: en Next un layout no se vuelve a
  // ejecutar si la petición RSC declara que el cliente ya lo tiene, así que lo único
  // que protege estos datos de TODAS las flotas (service role) es esta llamada.
  await requireSuperadmin();
  const hoy = hoyMx();
  const [facturas, piezas, corrida] = await Promise.all([
    leer<FacturaPorCobrar[]>('por_cobrar', getPorCobrar),
    leer<PiezaDunning[]>('piezas', () => getPiezasDunningPlataforma()),
    leer<CorridaDunning | null>('corrida', getUltimaCorridaDunningPlataforma),
  ]);
  const estado = facturas.dato ? armarEstadoDunning(facturas.dato, piezas.dato ?? [], hoy) : null;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Cobranza / Facturas"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {(facturas.error || piezas.error || corrida.error) && (
            <div className="card p-4 text-sm" role="alert">
              <span className="font-semibold">No se pudo leer todo el estado del dunning.</span>{' '}
              {facturas.error && 'Las facturas por cobrar no cargaron (no se afirma que no haya ninguna). '}
              {piezas.error && 'Las propuestas de recordatorio no cargaron (los toques no pueden mostrarse como «con propuesta» ni «sin propuesta»). '}
              {corrida.error && 'La última corrida del agente no cargó. '}
              Recarga la página; si persiste, revisa los registros.
            </div>
          )}

          <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">El dunning de las mensualidades de Likida ya corre.</span>{' '}
            El agente de cobranza SaaS recorre las facturas pendientes o fallidas y, para cada una, prepara un
            recordatorio en cinco toques —3 días antes del corte, el día, y +3, +7 y +15—. Son{' '}
            <span className="font-semibold">propuestas a la bandeja de aprobación, no envíos</span>: no hay
            canal de correo al cliente aprobado y nada sale solo; Javier edita y manda desde{' '}
            <Link href="/admin/aprobaciones" className="underline font-medium">Aprobaciones</Link>. Emitir la mensualidad,
            conciliar el pago contra el banco y timbrar el CFDI se hace en{' '}
            <Link href="/admin/costos-facturacion" className="underline font-medium">Costos &amp; Facturación</Link>.
            El vencimiento se toma como el inicio del periodo (la mensualidad se cobra por adelantado).
          </EstadoVacio>

          <div className="card p-4">
            <TituloSeccion>Última corrida del agente</TituloSeccion>
            <div className="mt-3 text-sm space-y-1">
              {corrida.error ? (
                <p style={{ color: 'var(--muted)' }}>No se pudo leer.</p>
              ) : corrida.dato === null ? (
                <p>
                  <StatusPill estado="warn">Nunca ha corrido</StatusPill>{' '}
                  <span style={{ color: 'var(--muted)' }}>No hay una sola corrida registrada de cobranza SaaS: ningún toque se ha preparado todavía.</span>
                </p>
              ) : (
                <>
                  <p>
                    <StatusPill estado={corrida.dato.estado === 'ok' ? 'ok' : 'bad'}>{corrida.dato.estado === 'ok' ? 'Última corrida OK' : 'Última corrida con fallo'}</StatusPill>{' '}
                    <span style={{ color: 'var(--muted)' }}>{corrida.dato.fin.slice(0, 16).replace('T', ' ')} UTC</span>
                  </p>
                  {corrida.dato.error && <p style={{ color: 'var(--bad)' }}>{corrida.dato.error}</p>}
                </>
              )}
            </div>
          </div>

          {estado && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Cifra etiqueta="Por cobrar" valor={`${estado.porCobrar} · ${mxn(estado.montoPorCobrar)}`} />
                <Cifra etiqueta="Vencidas" valor={`${estado.vencidas} · ${mxn(estado.montoVencido)}`} />
                <Cifra etiqueta="Toques sin propuesta" valor={String(estado.toquesSinPropuesta)}
                  nota={estado.toquesSinPropuesta > 0 ? 'El agente no ha preparado toques que ya tocaban.' : undefined}
                  alerta={estado.toquesSinPropuesta > 0 && !piezas.error} />
                <Cifra etiqueta="Propuestas pendientes / enviadas" valor={`${estado.propuestasPendientes} / ${estado.propuestasEnviadas}`} />
              </div>

              <div className="card p-4">
                <TituloSeccion>Facturas por cobrar y su cadencia</TituloSeccion>
                {estado.facturas.length === 0 ? (
                  <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
                    0 mensualidades por cobrar: no hay ninguna factura pendiente ni fallida. Es el estado real del
                    negocio, no un error de lectura.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3 text-sm">
                    {estado.facturas.map((f) => (
                      <li key={f.factura.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--line)' }}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{f.factura.tenantNombre}</span>
                          <span>{mxn(f.factura.monto)}</span>
                          <StatusPill estado={f.vencida ? 'bad' : 'neutral'}>
                            {f.dias >= 0 ? `${f.dias} días desde el corte` : `faltan ${-f.dias} días`}
                          </StatusPill>
                          <span style={{ color: 'var(--muted)' }}>
                            {f.factura.estado} · {f.factura.periodoInicio} a {f.factura.periodoFin}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {f.toques.length === 0 ? (
                            <span style={{ color: 'var(--muted)' }}>Aún no alcanza el primer toque ({hito(f.proximoHito ?? -3)}).</span>
                          ) : f.toques.map((t) => (
                            <StatusPill key={t.hito} estado={piezas.error ? 'neutral' : ROTULO_SELLO[t.sello].estado}>
                              {hito(t.hito)} · {piezas.error ? 'estado de la propuesta no disponible' : ROTULO_SELLO[t.sello].texto}
                            </StatusPill>
                          ))}
                          {f.proximoHito !== null && f.toques.length > 0 && (
                            <span className="text-xs self-center" style={{ color: 'var(--muted)' }}>siguiente: {hito(f.proximoHito)}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  Pendiente de construir: DSO (días de cobro) y tasa de recuperación de vencidos — necesitan historial
                  de facturas pagadas que aún no existe. El monto facturado y el cobrado por estatus están en la sección
                  «Por cobrar» de Costos &amp; Facturación.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Cifra({ etiqueta, valor, nota, alerta }: { etiqueta: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase etiqueta-mono" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      <div className="text-lg font-semibold mt-1" style={alerta ? { color: 'var(--bad)' } : undefined}>{valor}</div>
      {nota && <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{nota}</div>}
    </div>
  );
}
