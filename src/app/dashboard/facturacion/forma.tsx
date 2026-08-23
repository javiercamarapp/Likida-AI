'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2, Ban } from 'lucide-react';
// SOLO TIPOS de los módulos de servidor (importan `supabaseAdmin`): un import
// de valor arrastraría la llave de servicio al bundle. Los catálogos viajan
// como props desde la página. Mismo contrato que `clientes/forma.tsx`.
import type { RenglonSinFacturar } from '@/lib/likida/facturacion_clientes';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton({ etiqueta, tono = 'marca' }: { etiqueta: string; tono?: 'marca' | 'peligro' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={tono === 'marca'
        ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
        : { background: 'var(--badbg)', color: 'var(--bad)' }}>
      {tono === 'marca'
        ? <Save width={14} height={14} strokeWidth={1.75} />
        : <Ban width={14} height={14} strokeWidth={1.75} />}
      {pending ? 'Guardando…' : etiqueta}
    </button>
  );
}

/** El error se enseña VERBATIM: los `DatoInvalido` del motor están escritos
 *  para leerse aquí y son lo único que dice QUÉ corregir. */
function Aviso({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
  );
}

/** `<details>` nativo, igual que en Clientes: sin JavaScript sigue abriendo. */
export function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
        style={{ color: 'var(--marca)' }}>
        {resumen}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

// ── Registrar una factura emitida ──────────────────────────────────────────

/**
 * La captura de A1: la factura que la flota emitió (o empezó) a su cliente.
 *
 * TRES DECISIONES DE FORMA que vienen del motor, no del gusto:
 *  · El TOTAL no se teclea — lo calcula el servidor como subtotal + IVA.
 *    Pedir tres números que deben cuadrar entre sí fabrica el descuadre.
 *  · El UUID es OPCIONAL y eso decide el estatus: con UUID nace emitida, sin
 *    UUID nace borrador. El rótulo lo dice para que nadie crea que un
 *    borrador le cobra a alguien.
 *  · Los montos son `type="text"` con `inputMode="decimal"`: un contralor pega
 *    "11,600.00" desde su Excel y un input numérico lo descarta ENTERO.
 *
 * Y una cuarta desde la 0166 (RES-22): SERIE y FOLIO son campos SEPARADOS.
 * Iban juntos en «folio» porque la tabla no tenía dónde poner la serie, y el
 * consecutivo se comparaba sin serie ni ejercicio: la flota que reinicia
 * folios cada 1 de enero recibía «ya registraste una factura con ese folio» y
 * no podía capturar. Ahora la base compara flota + serie + folio + año.
 */
export function FormaFactura({ accion, clientes, viajesSinFacturar, hoy }: {
  accion: AccionForma;
  clientes: ReadonlyArray<{ id: string; nombre: string; diasCredito: number | null }>;
  viajesSinFacturar: ReadonlyArray<RenglonSinFacturar>;
  /** `YYYY-MM-DD` calculado en el servidor (hora de México), para que el
   *  default no dependa del reloj del navegador. */
  hoy: string;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="ff-cliente" className={ETIQUETA}>Cliente</label>
          {clientes.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
              No tienes clientes dados de alta. Una factura siempre es A ALGUIEN: dalos de alta
              primero en la pantalla de Clientes.
            </p>
          ) : (
            <select id="ff-cliente" name="clienteId" required
              className={CAMPO} style={{ background: 'var(--surface)' }}>
              <option value="">Elige al cliente…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}{c.diasCredito === null ? ' — sin días de crédito registrados' : ` — ${c.diasCredito} días de crédito`}
                </option>
              ))}
            </select>
          )}
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            El vencimiento sale de sus días de crédito. Sin días registrados, la factura nace sin
            fecha de vencimiento y la cartera lo dice — no se le inventan 30 días.
          </p>
        </div>

        <div>
          <label htmlFor="ff-fecha" className={ETIQUETA}>Fecha de la factura</label>
          <input id="ff-fecha" name="fecha" type="date" required defaultValue={hoy}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-serie" className={ETIQUETA}>Serie</label>
          <input id="ff-serie" name="serie" type="text" maxLength={25} placeholder="A (opcional)"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            La del CFDI. Déjala vacía si tu flota no usa series. Con ella, el folio 1 de la serie A
            y el folio 1 de la serie B son dos facturas distintas — y el folio se puede reiniciar
            cada año sin que la captura se trabe.
          </p>
        </div>

        <div>
          <label htmlFor="ff-folio" className={ETIQUETA}>Folio</label>
          <input id="ff-folio" name="folio" type="text" maxLength={40} placeholder="1024 (opcional)"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-subtotal" className={ETIQUETA}>Subtotal (MXN)</label>
          <input id="ff-subtotal" name="subtotal" type="text" inputMode="decimal" required
            placeholder="10,000.00" className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-iva" className={ETIQUETA}>IVA (MXN)</label>
          <input id="ff-iva" name="iva" type="text" inputMode="decimal" required
            placeholder="1,600.00" className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Tal como quedó en el CFDI. El total lo calculamos nosotros: subtotal + IVA, sin
            oportunidad de descuadre. Si la factura es tasa 0% o exenta, teclea 0.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="ff-uuid" className={ETIQUETA}>Folio fiscal del CFDI (UUID)</label>
          <input id="ff-uuid" name="cfdiUuid" type="text" maxLength={36}
            placeholder="ad662d33-6934-459c-a128-bdf0393f0f44 — vacío si aún no timbras"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Likida no timbra: el UUID lo da tu PAC y se copia del XML o del PDF. Con UUID la factura
            queda EMITIDA y entra a la cartera; sin UUID queda en BORRADOR, que no le cobra a nadie.
          </p>
        </div>

        {viajesSinFacturar.length > 0 && (
          <fieldset className="sm:col-span-2 hairline rounded-lg p-3">
            <legend className="text-[11px] font-medium px-1">Viajes que ampara esta factura</legend>
            <div className="space-y-1.5">
              {viajesSinFacturar.map((v) => (
                <label key={v.viajeId} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                  <input type="checkbox" name="viajeIds" value={v.viajeId} />
                  <span className="cifra-mono">{v.folio}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {v.ruta ?? 'sin ruta'} · {v.cliente ?? 'sin cliente asignado'}
                  </span>
                </label>
              ))}
            </div>
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>
              Marcar viajes es lo que saca cada uno de la lista de «liquidados sin facturar». Una
              factura puede amparar varios viajes, o ninguno (renta, estadía).
            </p>
          </fieldset>
        )}
      </div>

      <Aviso estado={estado} />
      <Boton etiqueta="Registrar factura" />
    </form>
  );
}

// ── Registrar un pago ──────────────────────────────────────────────────────

export function FormaPago({ accion, facturaId, hoy }: {
  accion: AccionForma;
  facturaId: string;
  hoy: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `fp-${facturaId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      {/* Dice QUÉ factura, nunca DE QUIÉN: el server action re-resuelve el
          tenant de la sesión y el motor ancla con `.eq('tenant_id', …)`. */}
      <input type="hidden" name="facturaId" value={facturaId} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={campo('fecha')} className={ETIQUETA}>Fecha del pago</label>
          <input id={campo('fecha')} name="fecha" type="date" required defaultValue={hoy}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('monto')} className={ETIQUETA}>Monto (MXN)</label>
          <input id={campo('monto')} name="monto" type="text" inputMode="decimal" required
            placeholder="5,000.00" className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Los pagos parciales son la norma. Uno que rebase el saldo se rechaza con el saldo exacto.
          </p>
        </div>
        <div>
          <label htmlFor={campo('metodo')} className={ETIQUETA}>Método</label>
          <input id={campo('metodo')} name="metodo" type="text" maxLength={40}
            placeholder="transferencia (opcional)" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor={campo('ref')} className={ETIQUETA}>Referencia</label>
          <input id={campo('ref')} name="referencia" type="text" maxLength={80}
            placeholder="Clave de rastreo o folio del banco (opcional)"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton etiqueta="Registrar pago" />
    </form>
  );
}

// ── Marcar un borrador como emitida ────────────────────────────────────────

export function FormaEmitir({ accion, facturaId, folioActual }: {
  accion: AccionForma;
  facturaId: string;
  folioActual: string | null;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `fe-${facturaId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="facturaId" value={facturaId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('folio')} className={ETIQUETA}>Folio</label>
          <input id={campo('folio')} name="folio" type="text" maxLength={40}
            defaultValue={folioActual ?? ''} placeholder="El del CFDI timbrado"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('uuid')} className={ETIQUETA}>Folio fiscal (UUID)</label>
          <input id={campo('uuid')} name="cfdiUuid" type="text" maxLength={36} required
            placeholder="Del XML o del PDF del CFDI"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton etiqueta="Marcar como emitida" />
    </form>
  );
}

// ── Cancelar ───────────────────────────────────────────────────────────────

/**
 * Dentro de un `<details>` a propósito: abrirlo ES la confirmación, sin
 * `confirm()` del navegador (bloquea los modales y el headless de las
 * verificaciones de render).
 */
export function FormaCancelar({ accion, facturaId }: { accion: AccionForma; facturaId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="facturaId" value={facturaId} />
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        Cancelarla aquí registra la cancelación en Likida; la cancelación ante el SAT se hace con tu
        PAC. Sus viajes vuelven a la lista de «liquidados sin facturar». Una factura con pagos
        registrados no se puede cancelar hasta aclarar ese dinero.
      </p>
      <Aviso estado={estado} />
      <Boton etiqueta="Cancelar esta factura" tono="peligro" />
    </form>
  );
}
