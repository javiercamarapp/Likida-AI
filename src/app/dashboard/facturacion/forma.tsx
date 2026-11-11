'use client';

import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Ban } from 'lucide-react';
// SOLO TIPOS de los módulos de servidor (importan `supabaseAdmin`): un import
// de valor arrastraría la llave de servicio al bundle. Los catálogos viajan
// como props desde la página. Mismo contrato que `clientes/forma.tsx`.
import type { RenglonSinFacturar } from '@/lib/likida/facturacion_clientes';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton({ etiqueta, tono = 'marca' }: { etiqueta: string; tono?: 'marca' | 'peligro' }) {
  const { t: tr } = useT('dinero', dinero);
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className={`rv-btn ${tono === 'marca' ? 'rv-btn--primary' : 'rv-btn--danger'}`}
      style={tono === 'marca'
        ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
        : { background: 'var(--badbg)', color: 'var(--bad)' }}>
      {tono === 'marca'
        ? <Save width={14} height={14} strokeWidth={1.75} />
        : <Ban width={14} height={14} strokeWidth={1.75} />}
      {pending ? tr('facturacion.forma.guardando') : etiqueta}
    </button>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El error
 *  del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

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
  /**
   * `null` = la lectura del catálogo FALLÓ. No es lo mismo que `[]`, que es
   * «se leyó y de verdad no hay ninguno» (AUDITORÍA 22, FE-1). Confundirlos le
   * dice a una flota con 40 clientes que no tiene ninguno.
   */
  clientes: ReadonlyArray<{ id: string; nombre: string; diasCredito: number | null }> | null;
  viajesSinFacturar: ReadonlyArray<RenglonSinFacturar>;
  /** `YYYY-MM-DD` calculado en el servidor (hora de México), para que el
   *  default no dependa del reloj del navegador. */
  hoy: string;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="ff-cliente" className={ETIQUETA}>{tr('facturacion.forma.cliente')}</label>
          {clientes === null ? (
            <p className="text-[12px]" style={{ color: 'var(--bad)' }}>
              {tr('facturacion.forma.tuCatalogoDeClientes')}
            </p>
          ) : clientes.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              {tr('facturacion.forma.noTienesClientesDados')}
            </p>
          ) : (
            <select id="ff-cliente" name="clienteId" required
              className="w-full" style={{ background: 'var(--surface)' }}>
              <option value="">{tr('facturacion.forma.eligeAlCliente')}</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}{c.diasCredito === null ? ' ' + tr('facturacion.forma.sinDiasDeCredito') : ' ' + tr('facturacion.forma.diasDeCredito', { diasCredito: c.diasCredito })}
                </option>
              ))}
            </select>
          )}
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.elVencimientoSaleDe')}
          </p>
        </div>

        <div>
          <label htmlFor="ff-fecha" className={ETIQUETA}>{tr('facturacion.forma.fechaDeLaFactura')}</label>
          <input id="ff-fecha" name="fecha" type="date" required defaultValue={hoy}
            className="w-full" style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-serie" className={ETIQUETA}>{tr('facturacion.forma.serie')}</label>
          <input id="ff-serie" name="serie" type="text" maxLength={25} placeholder={tr('facturacion.forma.aOpcional')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.laDelCfdiDejala')}
          </p>
        </div>

        <div>
          <label htmlFor="ff-folio" className={ETIQUETA}>{tr('facturacion.forma.folio')}</label>
          <input id="ff-folio" name="folio" type="text" maxLength={40} placeholder={tr('facturacion.forma.1024Opcional')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-subtotal" className={ETIQUETA}>{tr('facturacion.forma.subtotalMxn')}</label>
          <input id="ff-subtotal" name="subtotal" type="text" inputMode="decimal" required
            placeholder="10,000.00" className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="ff-iva" className={ETIQUETA}>IVA (MXN)</label>
          <input id="ff-iva" name="iva" type="text" inputMode="decimal" required
            placeholder="1,600.00" className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.talComoQuedoEn')}
          </p>
        </div>

        <div>
          <label htmlFor="ff-retencion" className={ETIQUETA}>{tr('facturacion.forma.retencionDeIvaMxn')}</label>
          <input id="ff-retencion" name="retencion" type="text" inputMode="decimal"
            placeholder={tr('facturacion.forma.40000VacioSi')} className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.siFacturasAUna')}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="ff-uuid" className={ETIQUETA}>{tr('facturacion.forma.folioFiscalDelCfdi')}</label>
          <input id="ff-uuid" name="cfdiUuid" type="text" maxLength={36}
            placeholder={tr('facturacion.forma.ad662d336934459cA128')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.likidaNoTimbraEl')}
          </p>
        </div>

        {viajesSinFacturar.length > 0 && (
          <fieldset className="sm:col-span-2 hairline rounded-lg p-3">
            <legend className="text-[11px] font-medium px-1">{tr('facturacion.forma.viajesQueAmparaEsta')}</legend>
            <div className="space-y-1.5">
              {viajesSinFacturar.map((v) => (
                <label key={v.viajeId} className="flex items-center gap-2 text-[12px] cursor-pointer">
                  <input type="checkbox" name="viajeIds" value={v.viajeId} />
                  <span className="cifra-mono">{v.folio}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {v.ruta ?? tr('facturacion.forma.sinRuta')} · {v.cliente ?? tr('facturacion.forma.sinClienteAsignado')}
                  </span>
                </label>
              ))}
            </div>
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>
              {tr('facturacion.forma.marcarViajesEsLo')}
            </p>
          </fieldset>
        )}
      </div>

      <Aviso estado={estado} />
      <Boton etiqueta={tr('facturacion.forma.registrarFactura')} />
    </form>
  );
}

// ── Registrar un pago ──────────────────────────────────────────────────────

export function FormaPago({ accion, facturaId, hoy }: {
  accion: AccionForma;
  facturaId: string;
  hoy: string;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `fp-${facturaId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      {/* Dice QUÉ factura, nunca DE QUIÉN: el server action re-resuelve el
          tenant de la sesión y el motor ancla con `.eq('tenant_id', …)`. */}
      <input type="hidden" name="facturaId" value={facturaId} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={campo('fecha')} className={ETIQUETA}>{tr('facturacion.forma.fechaDelPago')}</label>
          <input id={campo('fecha')} name="fecha" type="date" required defaultValue={hoy}
            className="w-full" style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('monto')} className={ETIQUETA}>{tr('facturacion.forma.montoMxn')}</label>
          <input id={campo('monto')} name="monto" type="text" inputMode="decimal" required
            placeholder="5,000.00" className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {tr('facturacion.forma.losPagosParcialesSon')}
          </p>
        </div>
        <div>
          <label htmlFor={campo('metodo')} className={ETIQUETA}>{tr('facturacion.forma.metodo')}</label>
          <input id={campo('metodo')} name="metodo" type="text" maxLength={40}
            placeholder={tr('facturacion.forma.transferenciaOpcional')} className="w-full" style={{ background: 'var(--surface)' }} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor={campo('ref')} className={ETIQUETA}>{tr('facturacion.forma.referencia')}</label>
          <input id={campo('ref')} name="referencia" type="text" maxLength={80}
            placeholder={tr('facturacion.forma.claveDeRastreoO')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton etiqueta={tr('facturacion.forma.registrarPago')} />
    </form>
  );
}

// ── Marcar un borrador como emitida ────────────────────────────────────────

export function FormaEmitir({ accion, facturaId, folioActual }: {
  accion: AccionForma;
  facturaId: string;
  folioActual: string | null;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `fe-${facturaId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="facturaId" value={facturaId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('folio')} className={ETIQUETA}>{tr('facturacion.forma.folio')}</label>
          <input id={campo('folio')} name="folio" type="text" maxLength={40}
            defaultValue={folioActual ?? ''} placeholder={tr('facturacion.forma.elDelCfdiTimbrado')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={campo('uuid')} className={ETIQUETA}>{tr('facturacion.forma.folioFiscalUuid')}</label>
          <input id={campo('uuid')} name="cfdiUuid" type="text" maxLength={36} required
            placeholder={tr('facturacion.forma.delXmlODel')}
            className="w-full cifra-mono" style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton etiqueta={tr('facturacion.forma.marcarComoEmitida')} />
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="facturaId" value={facturaId} />
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {tr('facturacion.forma.cancelarlaAquiRegistraLa')}
      </p>
      <Aviso estado={estado} />
      <Boton etiqueta={tr('facturacion.forma.cancelarEstaFactura')} tono="peligro" />
    </form>
  );
}
