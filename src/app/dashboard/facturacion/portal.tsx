import { revalidatePath } from 'next/cache';
import { Link2 } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { mxn, fechaMx, fechaHoraMx } from '@/lib/formato';
import { diasDeVigencia } from '@/lib/likida/portal_pago';
import { panelDelPortal, type PanelPortal } from '@/lib/likida/portal_pago_lectura';
import {
  crearLigaPago, revocarLigaPago, conciliarPropuesta, descartarPropuesta, registrarRepEmitido,
} from '@/lib/likida/portal_pago_escritura';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';

/**
 * EL PORTAL DE PAGO — la sección del contralor (0228).
 *
 * Vive en Facturación y no en una pantalla propia por la misma razón que el
 * auditor de cobranza y las estadías: lo que se decide aquí —conciliar un
 * depósito, revocar un enlace— es la MISMA cartera de arriba, y separarlo
 * obligaría a cruzar dos pantallas para responder una sola pregunta.
 *
 * ── LA REGLA QUE ESTA SECCIÓN EXISTE PARA SOSTENER ────────────────────────
 *
 * Lo que el cliente registra en su enlace NO toca la cartera. Aparece aquí,
 * como propuesta, con el saldo REAL de la factura al lado, y espera. Conciliar
 * es un botón que aprieta una persona después de mirar su estado de cuenta, y
 * es lo único que crea el abono de verdad — por `registrar_pago_tx`, el mismo
 * camino que el pago tecleado a mano.
 *
 * ── EL ENLACE SE ENSEÑA UNA VEZ ───────────────────────────────────────────
 *
 * La base guarda el sha256 del token, no el token. Así que el link completo
 * solo existe en el mensaje verde que sale al generarlo: si se pierde, se
 * revoca y se genera otro. No es una molestia de diseño, es la razón por la
 * que un volcado de esa tabla no abre las facturas de nadie.
 */

const RUTA = '/dashboard/facturacion';

export async function BloquePortalPago({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) return null;

  // Lectura independiente de la cartera: su fallo pinta el error DICHO, no una
  // bandeja vacía que se leería como «ningún cliente ha registrado nada».
  let panel: PanelPortal | null = null;
  try {
    panel = await panelDelPortal(tenantId);
  } catch (e) {
    logger.warn('portal_pago.panel_no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  async function generar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede generar enlaces de pago.' };
    const facturaId = String(fd.get('facturaId') ?? '');
    if (!facturaId) return { error: 'Elige la factura del enlace.' };
    try {
      const liga = await crearLigaPago(s.tenantId, facturaId, { id: s.userId });
      revalidatePath(RUTA);
      // EL ÚNICO MOMENTO en que el link completo existe. Se dice que es el
      // único, para que nadie cierre la pantalla creyendo que puede volver.
      return {
        ok: `Enlace generado — CÓPIALO AHORA, no se vuelve a mostrar: ${liga.url} · vence el ${fechaMx(liga.expiraEn)}. Si lo pierdes, revócalo y genera otro.`,
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'generar el enlace de pago') };
    }
  }

  async function revocar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede revocar enlaces de pago.' };
    try {
      await revocarLigaPago(s.tenantId, String(fd.get('ligaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: 'Enlace revocado. Quien lo tenga verá que ya no está disponible.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'revocar el enlace') };
    }
  }

  async function conciliar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede conciliar pagos.' };
    try {
      const r = await conciliarPropuesta(s.tenantId, String(fd.get('propuestaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: `Conciliado: ${mxn(r.monto)} entraron a la factura como abono real. Ya se refleja en la cartera de arriba.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'conciliar el pago') };
    }
  }

  async function descartar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede descartar pagos.' };
    try {
      await descartarPropuesta(
        s.tenantId,
        String(fd.get('propuestaId') ?? ''),
        String(fd.get('motivo') ?? ''),
        { id: s.userId },
      );
      revalidatePath(RUTA);
      return { ok: 'Descartado, con tu motivo anotado. Tu cliente lo ve en su enlace.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'descartar el registro') };
    }
  }

  async function anotarRep(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede registrar complementos de pago.' };
    try {
      await registrarRepEmitido(s.tenantId, {
        facturaId: String(fd.get('facturaId') ?? ''),
        pagoId: String(fd.get('pagoId') ?? ''),
        cfdiUuid: String(fd.get('cfdiUuid') ?? ''),
        fechaPago: String(fd.get('fechaPago') ?? ''),
        impPagado: String(fd.get('impPagado') ?? ''),
        formaPago: String(fd.get('formaPago') ?? ''),
        xml: String(fd.get('xml') ?? ''),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: 'Complemento registrado. Tu cliente ya lo ve en su enlace, y queda el sello de cuándo lo abrió.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'registrar el complemento de pago') };
    }
  }

  return (
    <section className="mt-3 rounded-2xl px-5 py-4 flex flex-col gap-3 hairline" style={{ background: 'var(--surface)' }}>
      <div className="flex items-start gap-2.5">
        <Link2 width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
        <div className="min-w-0">
          <p className="text-sm font-medium">Portal de pago del cliente</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Un enlace por factura para que tu cliente vea su saldo y te diga con qué
            referencia pagó. <strong>No cobra nada</strong> — no hay pasarela ni cargo. Lo que
            registre entra aquí como propuesta y <strong>no mueve tu cartera</strong> hasta que tú
            lo concilies. Los enlaces vencen a los {diasDeVigencia()} días y se pueden revocar.
          </p>
        </div>
      </div>

      {panel === null ? (
        <p className="text-xs" style={{ color: 'var(--bad)' }}>
          No pude leer el portal — recarga. Sin lectura no se afirma que nadie haya registrado un pago.
        </p>
      ) : (
        <>
          <Bandeja panel={panel} conciliar={conciliar} descartar={descartar} />
          <Enlaces panel={panel} generar={generar} revocar={revocar} />
          <Complemento panel={panel} anotarRep={anotarRep} />
        </>
      )}
    </section>
  );
}

// ── La bandeja: lo que tus clientes dicen que pagaron ──────────────────────

function Bandeja({ panel, conciliar, descartar }: {
  panel: PanelPortal;
  conciliar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  descartar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
}) {
  if (panel.pendientes.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Ningún cliente ha registrado un pago pendiente de conciliar.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">
        {panel.pendientes.length} pago(s) por conciliar — dichos de tu cliente, todavía fuera de la cartera
      </p>
      {panel.pendientes.map((p) => (
        <details key={p.id} className="rounded-xl hairline px-3.5 py-2.5">
          <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium">{p.cliente}</span>
            <span style={{ color: 'var(--muted)' }}>factura {p.factura}</span>
            <span style={{ color: 'var(--muted)' }}>ref. {p.referencia}</span>
            <span className="ml-auto font-medium">{mxn(p.monto)}</span>
          </summary>
          <div className="mt-2.5 flex flex-col gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            <span>
              Dice haber pagado el {fechaMx(p.fecha)}
              {p.metodo && ` por ${p.metodo}`}. Lo registró el {fechaHoraMx(p.registradaEn)}.
              {' '}Saldo de la factura ahora mismo:{' '}
              <strong>{p.saldo === null ? 'sin dato' : mxn(p.saldo)}</strong>
              {p.saldo === null && ' — no se pudo leer; no es cero.'}
            </span>
            <span>
              Cruza la referencia contra tu estado de cuenta ANTES de conciliar. Conciliar
              crea el abono de verdad sobre la factura, con las mismas reglas que un pago
              tecleado a mano (rechaza el sobrepago y sella la factura como pagada si la salda).
            </span>
            <div className="flex flex-col gap-3">
              <FormaConAviso accion={conciliar} boton={`Conciliar ${mxn(p.monto)}`} columnas="md:grid-cols-1">
                <input type="hidden" name="propuestaId" value={p.id} />
              </FormaConAviso>
              <FormaConAviso accion={descartar} boton="Descartar este registro" columnas="md:grid-cols-1">
                <input type="hidden" name="propuestaId" value={p.id} />
                <Campo
                  nombre="motivo"
                  etiqueta="¿Por qué lo descartas?"
                  requerido
                  ayuda="Tu cliente puede preguntar. «El depósito no aparece en el estado de cuenta del día», «la referencia es de otra factura»…"
                />
              </FormaConAviso>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

// ── Los enlaces vivos y el alta de uno nuevo ───────────────────────────────

function Enlaces({ panel, generar, revocar }: {
  panel: PanelPortal;
  generar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  revocar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
}) {
  return (
    <details className="rounded-xl hairline px-4 py-3">
      <summary className="text-xs font-medium cursor-pointer">
        Enlaces de pago ({panel.ligasVivas.length} vivo(s))
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <div>
          <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
            Genera el enlace de una factura emitida con saldo. Se muestra UNA sola vez:
            Likida guarda solo su huella, no el enlace, para que un volcado de la base no
            abra las facturas de nadie.
          </p>
          {panel.facturasSinLiga.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              No hay facturas emitidas con saldo y sin enlace vivo. Un borrador no puede tener
              enlace: todavía no le cobra a nadie.
            </p>
          ) : (
            <FormaConAviso accion={generar} boton="Generar enlace" columnas="md:grid-cols-1">
              <Selector
                nombre="facturaId"
                etiqueta="Factura"
                requerido
                opciones={[
                  { valor: '', texto: 'Elige…' },
                  ...panel.facturasSinLiga.map((f) => ({
                    valor: f.id,
                    texto: `${f.factura} · ${f.cliente} · saldo ${f.saldo === null ? 'sin dato' : mxn(f.saldo)}`,
                  })),
                ]}
              />
            </FormaConAviso>
          )}
        </div>

        {panel.ligasVivas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {panel.ligasVivas.map((l) => (
              <details key={l.id} className="rounded-xl hairline px-3.5 py-2.5">
                <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className="font-medium">{l.factura}</span>
                  <span style={{ color: 'var(--muted)' }}>{l.cliente}</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>
                    {l.ultimoAccesoEn ? `abierto ${fechaHoraMx(l.ultimoAccesoEn)}` : 'nunca se ha abierto'}
                  </span>
                </summary>
                <div className="mt-2.5 flex flex-col gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                  <span>
                    Huella <code>{l.prefijo}…</code> · vence el {fechaMx(l.expiraEn)}.
                    {!l.ultimoAccesoEn && ' Nadie lo ha abierto todavía: puede que el correo no haya llegado.'}
                  </span>
                  <FormaConAviso accion={revocar} boton="Revocar este enlace" columnas="md:grid-cols-1">
                    <input type="hidden" name="ligaId" value={l.id} />
                  </FormaConAviso>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

// ── El REP que la flota emite a su cliente ─────────────────────────────────

function Complemento({ panel, anotarRep }: {
  panel: PanelPortal;
  anotarRep: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
}) {
  return (
    <details className="rounded-xl hairline px-4 py-3">
      <summary className="text-xs font-medium cursor-pointer">
        Complemento de pago (REP) — entregarlo por el enlace
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Likida <strong>no timbra</strong>: el REP lo emite tu PAC, igual que la factura. Aquí
          se registra el que ya timbraste, y el enlace de tu cliente se lo entrega solo —
          con el sello de cuándo lo abrió. El XML es opcional: sin él, tu cliente ve el
          folio fiscal citable y la página le dice que el archivo te lo tiene que pedir a ti
          (nunca un botón de descarga que no baje nada).
        </p>
        {panel.ligasVivas.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Genera primero el enlace de la factura: sin él no hay a dónde entregarlo.
          </p>
        ) : (
          <FormaConAviso accion={anotarRep} boton="Registrar el complemento" columnas="md:grid-cols-2">
            <Selector
              nombre="facturaId"
              etiqueta="Factura del complemento"
              requerido
              opciones={[
                { valor: '', texto: 'Elige…' },
                ...panel.ligasVivas.map((l) => ({ valor: l.facturaId, texto: `${l.factura} · ${l.cliente}` })),
              ]}
            />
            <Campo
              nombre="pagoId"
              etiqueta="Id del abono que ampara"
              requerido
              ayuda="El que quedó al conciliar. Aparece en la bitácora de la flota, en el renglón «pago.registrado»."
            />
            <Campo nombre="cfdiUuid" etiqueta="Folio fiscal (UUID) del REP" requerido
              ayuda="Cópialo tal cual del acuse de tu PAC." />
            <Campo nombre="fechaPago" etiqueta="Fecha del pago" tipo="date" requerido />
            <Campo nombre="impPagado" etiqueta="Importe pagado" requerido
              ayuda="El que trae el complemento, no el de la factura." />
            <Campo nombre="formaPago" etiqueta="Forma de pago del SAT (2 dígitos)"
              ayuda="03 transferencia, 01 efectivo, 02 cheque… Déjalo vacío si no lo tienes." />
            <Campo nombre="xml" etiqueta="XML del complemento (opcional)"
              ayuda="Pégalo si lo tienes a la mano. Vacío = tu cliente verá el folio citable, no una descarga vacía." />
          </FormaConAviso>
        )}
      </div>
    </details>
  );
}
