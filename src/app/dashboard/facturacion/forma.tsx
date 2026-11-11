'use client';

import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
// SOLO TIPOS de los módulos de servidor (importan `supabaseAdmin`): un import
// de valor arrastraría la llave de servicio al bundle. Los catálogos viajan
// como props desde la página. Mismo contrato que `clientes/forma.tsx`.
import type { RenglonSinFacturar } from '@/lib/likida/facturacion_clientes';
import {
  Casilla, CampoFecha, CampoSelect, CampoTexto, Fieldset, FormaEnCajon,
  type AccionDeForma, type ResultadoAccion,
} from '@/app/ui-v2/componentes';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

/** Las acciones de servidor de esta pantalla hablan `ResultadoForma` (su contrato y sus pruebas no cambian); el cajón del sistema habla
 *  `ResultadoAccion`. Este adaptador es la única costura: el error del servidor se enseña VERBATIM, los `DatoInvalido` están escritos
 *  para leerse aquí. */
function adaptar(accion: AccionForma): AccionDeForma {
  return async (_previo: ResultadoAccion, fd: FormData) => {
    const r = await accion(null, fd);
    if (r === null) return null;
    return r.ok ? { ok: r.mensaje } : { error: r.error };
  };
}

const MONO = 'cifra-mono';

// ── Registrar una factura emitida ──────────────────────────────────────────

/**
 * La captura de A1: la factura que la flota emitió (o empezó) a su cliente. Vive en un cajón del sistema (`FormaEnCajon`), no en un
 * `<details>` con formulario.
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

  return (
    <FormaEnCajon
      id="factura-nueva" titulo={tr('facturacion.forma.registrarFactura')} descripcion={tr('facturacion.forma.elVencimientoSaleDe')}
      accion={adaptar(accion)} boton={tr('facturacion.forma.registrarFactura')} disparador={tr('facturacion.forma.registrarFactura')}
    >
      {clientes === null ? (
        <p className="text-[12px] text-[color:var(--bad)]">{tr('facturacion.forma.tuCatalogoDeClientes')}</p>
      ) : clientes.length === 0 ? (
        <p className="text-[12px] text-[color:var(--warn)]">{tr('facturacion.forma.noTienesClientesDados')}</p>
      ) : (
        <CampoSelect id="ff-cliente" etiqueta={tr('facturacion.forma.cliente')} name="clienteId" obligatorio defaultValue="">
          <option value="">{tr('facturacion.forma.eligeAlCliente')}</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}{c.diasCredito === null ? ' ' + tr('facturacion.forma.sinDiasDeCredito') : ' ' + tr('facturacion.forma.diasDeCredito', { diasCredito: c.diasCredito })}
            </option>
          ))}
        </CampoSelect>
      )}

      <div className="grid grid-cols-2 gap-3">
        <CampoFecha id="ff-fecha" etiqueta={tr('facturacion.forma.fechaDeLaFactura')} name="fecha" obligatorio defaultValue={hoy} className="col-span-2" />
        <CampoTexto id="ff-serie" etiqueta={tr('facturacion.forma.serie')} name="serie" maxLength={25} placeholder={tr('facturacion.forma.aOpcional')}
          claseControl={MONO} ayuda={tr('facturacion.forma.laDelCfdiDejala')} />
        <CampoTexto id="ff-folio" etiqueta={tr('facturacion.forma.folio')} name="folio" maxLength={40} placeholder={tr('facturacion.forma.1024Opcional')}
          claseControl={MONO} />
        <CampoTexto id="ff-subtotal" etiqueta={tr('facturacion.forma.subtotalMxn')} name="subtotal" inputMode="decimal" obligatorio placeholder="10,000.00"
          claseControl={MONO} />
        <CampoTexto id="ff-iva" etiqueta="IVA (MXN)" name="iva" inputMode="decimal" obligatorio placeholder="1,600.00"
          claseControl={MONO} ayuda={tr('facturacion.forma.talComoQuedoEn')} />
        <CampoTexto id="ff-retencion" etiqueta={tr('facturacion.forma.retencionDeIvaMxn')} name="retencion" inputMode="decimal"
          placeholder={tr('facturacion.forma.40000VacioSi')} claseControl={MONO} ayuda={tr('facturacion.forma.siFacturasAUna')} className="col-span-2" />
        <CampoTexto id="ff-uuid" etiqueta={tr('facturacion.forma.folioFiscalDelCfdi')} name="cfdiUuid" maxLength={36}
          placeholder={tr('facturacion.forma.ad662d336934459cA128')} claseControl={MONO} ayuda={tr('facturacion.forma.likidaNoTimbraEl')} className="col-span-2" />
      </div>

      {viajesSinFacturar.length > 0 && (
        <Fieldset leyenda={tr('facturacion.forma.viajesQueAmparaEsta')} ayuda={tr('facturacion.forma.marcarViajesEsLo')}>
          {viajesSinFacturar.map((v) => (
            <Casilla key={v.viajeId} name="viajeIds" value={v.viajeId}
              etiqueta={<><span className={MONO}>{v.folio}</span> <span className="text-[color:var(--muted)]">{v.ruta ?? tr('facturacion.forma.sinRuta')} · {v.cliente ?? tr('facturacion.forma.sinClienteAsignado')}</span></>} />
          ))}
        </Fieldset>
      )}
    </FormaEnCajon>
  );
}

// ── Registrar un pago ──────────────────────────────────────────────────────

export function FormaPago({ accion, facturaId, hoy }: {
  accion: AccionForma;
  facturaId: string;
  hoy: string;
}) {
  const { t: tr } = useT('dinero', dinero);
  const campo = (n: string) => `fp-${facturaId}-${n}`;

  return (
    <FormaEnCajon
      id={`pago-${facturaId}`} titulo={tr('facturacion.forma.registrarPago')} accion={adaptar(accion)}
      boton={tr('facturacion.forma.registrarPago')} disparador={tr('facturacion.forma.registrarPago')}
    >
      {/* Dice QUÉ factura, nunca DE QUIÉN: el server action re-resuelve el
          tenant de la sesión y el motor ancla con `.eq('tenant_id', …)`. */}
      <input type="hidden" name="facturaId" value={facturaId} />
      <div className="grid grid-cols-2 gap-3">
        <CampoFecha id={campo('fecha')} etiqueta={tr('facturacion.forma.fechaDelPago')} name="fecha" obligatorio defaultValue={hoy} />
        <CampoTexto id={campo('monto')} etiqueta={tr('facturacion.forma.montoMxn')} name="monto" inputMode="decimal" obligatorio placeholder="5,000.00"
          claseControl={MONO} />
        <p className="col-span-2 -mt-1 text-[11px] text-[color:var(--faint)]">{tr('facturacion.forma.losPagosParcialesSon')}</p>
        <CampoTexto id={campo('metodo')} etiqueta={tr('facturacion.forma.metodo')} name="metodo" maxLength={40} placeholder={tr('facturacion.forma.transferenciaOpcional')} />
        <CampoTexto id={campo('ref')} etiqueta={tr('facturacion.forma.referencia')} name="referencia" maxLength={80} placeholder={tr('facturacion.forma.claveDeRastreoO')}
          claseControl={MONO} />
      </div>
    </FormaEnCajon>
  );
}

// ── Marcar un borrador como emitida ────────────────────────────────────────

export function FormaEmitir({ accion, facturaId, folioActual }: {
  accion: AccionForma;
  facturaId: string;
  folioActual: string | null;
}) {
  const { t: tr } = useT('dinero', dinero);
  const campo = (n: string) => `fe-${facturaId}-${n}`;

  return (
    <FormaEnCajon
      id={`emitir-${facturaId}`} titulo={tr('facturacion.forma.marcarComoEmitida')} accion={adaptar(accion)}
      boton={tr('facturacion.forma.marcarComoEmitida')} disparador={tr('facturacion.forma.marcarComoEmitida')}
    >
      <input type="hidden" name="facturaId" value={facturaId} />
      <CampoTexto id={campo('folio')} etiqueta={tr('facturacion.forma.folio')} name="folio" maxLength={40} defaultValue={folioActual ?? ''}
        placeholder={tr('facturacion.forma.elDelCfdiTimbrado')} claseControl={MONO} />
      <CampoTexto id={campo('uuid')} etiqueta={tr('facturacion.forma.folioFiscalUuid')} name="cfdiUuid" maxLength={36} obligatorio
        placeholder={tr('facturacion.forma.delXmlODel')} claseControl={MONO} />
    </FormaEnCajon>
  );
}

// ── Cancelar ───────────────────────────────────────────────────────────────

/**
 * Cajón con el alcance dicho a la vista: abrirlo y enviarlo ES la confirmación, sin `confirm()` del navegador (bloquea los modales y
 * el headless de las verificaciones de render).
 */
export function FormaCancelar({ accion, facturaId }: { accion: AccionForma; facturaId: string }) {
  const { t: tr } = useT('dinero', dinero);
  return (
    <FormaEnCajon
      id={`cancelar-${facturaId}`} titulo={tr('facturacion.forma.cancelarEstaFactura')} accion={adaptar(accion)}
      boton={tr('facturacion.forma.cancelarEstaFactura')} disparador={tr('facturacion.forma.cancelar')}
    >
      <input type="hidden" name="facturaId" value={facturaId} />
      <p className="text-[12px] text-[color:var(--muted)]">{tr('facturacion.forma.cancelarlaAquiRegistraLa')}</p>
    </FormaEnCajon>
  );
}
