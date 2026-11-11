import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { revalidatePath } from 'next/cache';
import { exigirStepUpAccion } from '@/lib/auth/stepup';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeTimbrar } from '@/lib/auth/permisos';
import type { ViajeCcp } from '@/lib/likida/carta_porte_datos';
import { armarCfdiTimbrable } from '@/lib/likida/carta_porte_cfdi';
import { generarIdCcp } from '@/lib/likida/carta_porte';
import {
  leerContextoTimbre, timbrarViaje, guardarReceptorFiscal, motivoDeReservaViva,
  liberarReservaTimbre, MINUTOS_MIN_LIBERAR_RESERVA,
} from '@/lib/likida/carta_porte_timbre';
import { solicitarCancelacionTimbre, confirmarCancelacionTimbre } from '@/lib/likida/carta_porte_cancelacion';
import { MOTIVOS_CANCELACION, type MotivoCancelacion } from '@/lib/likida/pac/tipos';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
// FE-23: las cifras del panel SOLO salen de aquí. Éstas se leen junto al botón
// que emite un CFDI irreversible, así que con más razón.
import { mxn } from '@/lib/formato';
import { sufijoTenant } from '../../sufijo';
import {
  AvisoCompacto, BotonEnlace, Campo, CampoSelect, CampoTexto, Casilla, Disclosure, FormaConAviso, Tarjeta, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import '../timbrado.css';

/**
 * LA SECCIÓN DE TIMBRE (0226; mudada al área `dinero` por la 0227 — auditoría
 * Fable c6-3) — el botón que convierte el borrador validado en CFDI timbrado,
 * con TODAS sus verdades a la vista:
 *
 *   · Sin PAC configurado la sección lo dice y no hay botón — jamás se
 *     simula un timbre.
 *   · Con faltantes, la lista dice QUÉ y DÓNDE se captura (el perfil del
 *     emisor vive con el contador; los datos del receptor se capturan aquí
 *     mismo porque el cliente es de este viaje).
 *   · El timbre sandbox se rotula como lo que es: una prueba que no ampara
 *     nada.
 *   · El botón lo aprieta un humano CON EL VERBO (`puedeTimbrar`: dueño o
 *     contador, nunca el jefe de tráfico); la acción re-lee y re-valida todo
 *     — el estado de esta pantalla pudo envejecer.
 *   · Una RESERVA viva (0227) se dice en pantalla: hay un timbrado en curso o
 *     uno que quedó ambiguo, y el botón no aparece.
 *
 * LAS DOS PUERTAS DE CADA ACCIÓN: el ÁREA (`puedeVerRuta` sobre esta ruta de
 * `dinero`) y el VERBO (`puedeTimbrar`). El área sola no bastaba: dejaba
 * timbrar a cualquiera que viera la pantalla.
 */

const t = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function SeccionTimbrado({ v, searchParams }: {
  v: ViajeCcp;
  searchParams: { tenant?: string; rol?: string; vista?: string };
}) {
  const { t: tr } = await getT('dinero');
  const RUTA = '/dashboard/timbrado';
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, searchParams);

  // Un error de lectura aquí LANZA (error boundary de la página): operar el
  // timbre a ciegas es peor que no pintar la sección.
  const ctx = await leerContextoTimbre(tenantId, v.viajeId);
  if (ctx === null) return null;

  const rutaActual = `${RUTA}/${v.viajeId}`;
  const puedeEmitir = puedeTimbrar(rol);

  async function timbrar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    // El ÁREA y el VERBO, en ese orden y los dos: el rol del render no es el
    // de la acción, y ver la pantalla nunca fue permiso para emitir un CFDI.
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoVe') };
    if (!puedeTimbrar(s.rol)) {
      return { error: tr('timbrado.viajeId.timbrar.tuRolNoPuede') };
    }
    // F9 (CT-SEG-05): segundo factor escalonado, tras bandera apagada por omisión (D8).
    const pasoMfa = await exigirStepUpAccion(s.rol, 'emitir_cfdi', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { error: pasoMfa };
    const metodo = String(fd.get('metodoPago')) === 'PUE' ? 'PUE' as const : 'PPD' as const;
    // Con PPD la forma ES 99 (Anexo 20) — el selector de forma solo aplica a PUE.
    const forma = metodo === 'PPD' ? '99' : (t(fd.get('formaPago')) ?? '');
    const fechaLlegadaEstimada = t(fd.get('fechaLlegadaEstimada'));
    // AUDITORÍA 24, FE-24 (MEDIO): esto NO estaba en try/catch. Un fallo de
    // red con el PAC lanzaba dentro de la server action, tiraba la página
    // entera al `error.tsx` y —peor— se saltaba el `revalidatePath`: el
    // contador no leía el «SIN RESPUESTA DEL PAC — verifica en el panel del
    // PAC» que la ruta controlada sí da (carta_porte_timbre.ts:359) y podía
    // reintentar creyendo que no pasó nada. Un CFDI se puede haber emitido.
    // El `finally` revalida SIEMPRE, también cuando lanzó: si el timbre salió
    // y la respuesta se perdió, la pantalla recargada lo enseña.
    try {
      const r = await timbrarViaje(s.tenantId, v.viajeId, {
        metodoPago: metodo,
        formaPago: forma,
        fechaLlegadaEstimada,
      }, { id: s.userId });
      if (!r.ok) {
        const detalle = r.faltantes && r.faltantes.length > 0 ? ` · ${r.faltantes.join(' · ')}` : '';
        return { error: `${r.motivo}${detalle}` };
      }
      return {
        ok: r.yaExistia
          ? tr('timbrado.viajeId.timbrar.esteViajeYaTenia', { uuid: r.uuid, modo: r.modo })
          : r.modo === 'sandbox'
            ? tr('timbrado.viajeId.timbrar.timbradoPrueba', { prueba: tr('timbrado.viajeId.timbrar.dePruebaNoAmpara'), uuid: r.uuid })
            : tr('timbrado.viajeId.timbrar.timbradoOk', { uuid: r.uuid }),
      };
    } catch (e) {
      return {
        error: tr('timbrado.viajeId.timbrar.errorPac', { mensaje: mensajeParaPantalla(e, 'timbrar') }),
      };
    } finally {
      revalidatePath(rutaActual);
    }
  }

  // AUDITORÍA OLA 1, #26: una reserva ambigua del PAC bloqueaba el viaje SIN salida.
  // Quien la libera DECLARA que verificó en el panel del PAC que no hay CFDI.
  async function liberarReserva(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoVe') };
    if (!puedeTimbrar(s.rol)) {
      return { error: tr('timbrado.viajeId.timbrar.tuRolNoPuede2') };
    }
    try {
      const r = await liberarReservaTimbre(s.tenantId, v.viajeId, { id: s.userId }, fd.get('verificadoEnPac') === 'on');
      if (!r.ok) return { error: r.motivo };
      return { ok: tr('timbrado.viajeId.timbrar.bloqueoLiberadoYaPuedes') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'liberar el bloqueo de timbrado') };
    } finally {
      revalidatePath(rutaActual);
    }
  }

  // 0541: CANCELAR el CFDI vía PAC. Mismas dos puertas (área + verbo) y bitácora.
  async function cancelarTimbre(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoVe') };
    if (!puedeTimbrar(s.rol)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoPuede3') };
    const pasoMfa = await exigirStepUpAccion(s.rol, 'emitir_cfdi', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { error: pasoMfa };
    const motivo = String(fd.get('motivo') ?? '') as MotivoCancelacion;
    try {
      const r = await solicitarCancelacionTimbre(s.tenantId, v.viajeId, { id: s.userId }, { motivo, folioSustitucion: t(fd.get('folioSustitucion')) });
      return r.ok ? { ok: r.mensaje } : { error: r.motivo };
    } catch (e) {
      return { error: tr('timbrado.viajeId.timbrar.noDesLaCancelacion', { v: mensajeParaPantalla(e, 'cancelar el CFDI') }) };
    } finally {
      revalidatePath(rutaActual);
    }
  }

  async function confirmarCancelacion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoVe') };
    if (!puedeTimbrar(s.rol)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoPuede4') };
    try {
      const r = await confirmarCancelacionTimbre(s.tenantId, v.viajeId, { id: s.userId }, fd.get('verificadoEnSat') === 'on');
      return r.ok ? { ok: r.mensaje } : { error: r.motivo };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'confirmar la cancelación') };
    } finally {
      revalidatePath(rutaActual);
    }
  }

  async function guardarReceptor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('timbrado.viajeId.timbrar.tuRolNoVe') };
    // Mismo verbo que timbrar: la razón social, el régimen y el uso CFDI del
    // receptor VAN DENTRO del comprobante. Capturarlos es declarar, y quien
    // declara es quien firma.
    if (!puedeTimbrar(s.rol)) {
      return { error: tr('timbrado.viajeId.timbrar.tuRolNoPuede5') };
    }
    // A37-A3-21 / A37-S20-07: el cliente sale del VIAJE (leído aquí, anclado al tenant), nunca del formulario:
    // un POST con el clienteId de otro cliente de la flota reescribiría sus datos fiscales.
    let clienteId: string | null;
    try {
      clienteId = (await leerContextoTimbre(s.tenantId, v.viajeId))?.clienteId ?? null;
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'leer el cliente del viaje') };
    }
    if (clienteId === null) return { error: tr('timbrado.viajeId.timbrar.elViajeNoTiene') };
    try {
      await guardarReceptorFiscal(s.tenantId, clienteId, {
        razonSocial: t(fd.get('razonSocial')),
        regimenFiscal: t(fd.get('regimenFiscal')),
        usoCfdi: t(fd.get('usoCfdi'))?.toUpperCase() ?? null,
        cpFiscal: t(fd.get('cpFiscal')),
      }, { id: s.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los datos fiscales del cliente') };
    }
    revalidatePath(rutaActual);
    return { ok: tr('timbrado.viajeId.timbrar.datosFiscalesDelCliente2') };
  }

  // ── Timbre ya emitido: el hecho, citable, con su descarga ────────────────
  if (ctx.timbreVigente !== null) {
    const tv = ctx.timbreVigente;
    return (
      <Tarjeta titulo={tr('timbrado.viajeId.timbrar.timbre')}>
        <div className="rv-timb__bloque">
          <p className="rv-timb__texto">
            {tv.modo === 'sandbox' ? tr('timbrado.viajeId.timbrar.timbreDePruebaSandbox') + ' ' : tr('timbrado.viajeId.timbrar.timbrado') + ' '}
            {tr('timbrado.viajeId.timbrar.folioFiscal')} <span className="rv-timb__mono">{tv.uuidFiscal}</span> · {tv.fechaTimbrado} · {tr('timbrado.viajeId.timbrar.pac', { proveedor: tv.proveedor.toUpperCase() })}.
          </p>
          <div>
            <BotonEnlace variante="secondary" tamano="sm"
              href={`/api/export/carta-porte-xml${sufijoTenant(searchParams) ? `${sufijoTenant(searchParams)}&` : '?'}viaje=${v.viajeId}&timbrado=1`}>
              {tr('timbrado.viajeId.timbrar.descargarXmlTimbrado')}
            </BotonEnlace>
          </div>
          {puedeEmitir && <CancelacionDelTimbre tr={tr} cancelacion={tv.cancelacion} cancelar={cancelarTimbre} confirmar={confirmarCancelacion} />}
        </div>
      </Tarjeta>
    );
  }

  // ── Reserva viva (0227): un intento en curso, o uno ambiguo ──────────────
  // Sin botón a propósito: volver a llamar al PAC podría emitir un SEGUNDO
  // CFDI real. El bloqueo real es el unique de la base; esto solo lo explica.
  if (ctx.reservaPendiente !== null) {
    return (
      <Tarjeta titulo={tr('timbrado.viajeId.timbrar.timbre')}>
        <div className="rv-timb__bloque">
          <AvisoCompacto tono="warn" resumen={motivoDeReservaViva(ctx.reservaPendiente)} />
          {ctx.reservaPendiente.reservadoEn !== null && (
            <p className="rv-timb__tenue">{tr('timbrado.viajeId.timbrar.apartadoDesde', { reservadoEn: ctx.reservaPendiente.reservadoEn })}</p>
          )}
          {/* Sin folio fiscal (el PAC no contestó): la salida existe, con candado. */}
          {ctx.reservaPendiente.uuidFiscal === null && puedeEmitir && (
            <>
              <p className="rv-timb__texto">
                {tr('timbrado.viajeId.timbrar.siYaVerificasteEn', { MINUTOS_MIN_LIBERAR_RESERVA })}
              </p>
              <FormaConAviso accion={liberarReserva} boton="Liberar el bloqueo" columnas="md:grid-cols-1">
                <Casilla name="verificadoEnPac" etiqueta={tr('timbrado.viajeId.timbrar.verifiqueEnElPanel')} />
              </FormaConAviso>
            </>
          )}
        </div>
      </Tarjeta>
    );
  }

  // ── Sin PAC: la verdad y cero botones ────────────────────────────────────
  if (!ctx.pac.configurado) {
    return (
      <Tarjeta titulo={tr('timbrado.viajeId.timbrar.timbre')}>
        <p className="rv-timb__texto">
          {tr('timbrado.viajeId.timbrar.sinPacConfiguradoEl')}
        </p>
      </Tarjeta>
    );
  }

  // ── El ensayo en seco: la MISMA función que arma el CFDI dice qué falta ──
  const ensayo = armarCfdiTimbrable(v, generarIdCcp(), ctx.emisor, ctx.receptor, ctx.ingresoFlete, {
    metodoPago: 'PPD', formaPago: '99', fechaLlegadaEstimada: null,
  });

  return (
    <Tarjeta titulo={tr('timbrado.viajeId.timbrar.timbre')}>
      <div className="rv-timb__bloque">
        <p className="rv-timb__texto">
          {tr('timbrado.viajeId.timbrar.pacAmbienteElCfdi', { v: ctx.pac.proveedor?.toUpperCase() ?? '', v2: ctx.emisor.modo === 'sandbox' ? tr('timbrado.viajeId.timbrar.sandboxTimbresDePrueba') : tr('timbrado.viajeId.timbrar.produccion') })}
        </p>

        {!ensayo.ok && (
          <div className="rv-timb__bloque">
            <p className="rv-timb__aviso">{tr('timbrado.viajeId.timbrar.paraTimbrarFalta')}</p>
            <ul className="rv-timb__faltan">
              {ensayo.faltantes.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}

        {ctx.clienteId !== null && puedeEmitir && (
          <Disclosure variante="linea" titulo={tr('timbrado.viajeId.timbrar.datosFiscalesDelCliente')}>
            <FormaConAviso accion={guardarReceptor} boton="Guardar datos del cliente" columnas="md:grid-cols-2">
              <CampoTexto id="razonSocial" name="razonSocial" etiqueta={tr('timbrado.viajeId.timbrar.razonSocialExactaA')} defaultValue={ctx.receptor.razonSocial ?? ''} />
              <CampoTexto id="regimenFiscal" name="regimenFiscal" etiqueta={tr('timbrado.viajeId.timbrar.regimenFiscalClave')} defaultValue={ctx.receptor.regimenFiscal ?? ''} placeholder="601" />
              <CampoTexto id="usoCfdi" name="usoCfdi" etiqueta={tr('timbrado.viajeId.timbrar.usoCfdi')} defaultValue={ctx.receptor.usoCfdi ?? ''} placeholder="S01 o G03" />
              <CampoTexto id="cpFiscal" name="cpFiscal" etiqueta={tr('timbrado.viajeId.timbrar.cpFiscal')} defaultValue={ctx.receptor.cpFiscal ?? ''} placeholder="64000" />
            </FormaConAviso>
          </Disclosure>
        )}

        {ensayo.ok && !puedeEmitir && (
          <p className="rv-timb__texto">
            {tr('timbrado.viajeId.timbrar.elComprobanteEstaListo')}
          </p>
        )}

        {puedeEmitir && (
          <div className="rv-timb__bloque">
            {ensayo.ok && (
              <p className="rv-timb__texto">
                {tr('timbrado.viajeId.timbrar.flete')} {mxn(ensayo.subTotal)} {tr('timbrado.viajeId.timbrar.masIva', { iva: mxn(ensayo.iva) })}
                {ensayo.retencionIva !== null ? ' ' + tr('timbrado.viajeId.timbrar.retencionIva4Receptor', { v: mxn(ensayo.retencionIva) }) : ''}
                {' '}= <strong>{tr('timbrado.viajeId.timbrar.total', { v: mxn(ensayo.total) })}</strong>.
              </p>
            )}
            <FormaConAviso accion={timbrar} boton={ctx.emisor.modo === 'sandbox' ? 'Timbrar (PRUEBA)' : 'Timbrar'} columnas="md:grid-cols-2">
              {/* AUDITORÍA 24, FIS-8 (MEDIO): el valor por defecto era PPD, y un CFDI PPD OBLIGA a emitir después un complemento de pago (CFDI de Pagos 2.0) al cobrar. Likida no lo emite todavía — `pac/sw.ts` lo declara, la pantalla no — y sin el REP el cliente de la flota no puede acreditar su IVA y la flota queda con una obligación pendiente que su sistema no le dijo. El defecto pasa a PUE (pago en una exhibición: se agota con el timbre y no arrastra nada) y PPD queda como elección explícita, con lo que arrastra escrito al lado. */}
              <CampoSelect id="metodoPago" name="metodoPago" etiqueta={tr('timbrado.viajeId.timbrar.metodoDePago')} defaultValue="PUE">
                <option value="PUE">{tr('timbrado.viajeId.timbrar.puePagoEnUna')}</option>
                <option value="PPD">{tr('timbrado.viajeId.timbrar.ppdPagoEnParcialidades')}</option>
              </CampoSelect>
              <CampoTexto id="formaPago" name="formaPago" etiqueta={tr('timbrado.viajeId.timbrar.formaDePagoObligatoria')} placeholder={tr('timbrado.viajeId.timbrar.03Transferencia01Efectivo')} ayuda={tr('timbrado.viajeId.timbrar.conPpdSeEnvia')} />
              <Campo etiqueta={tr('timbrado.viajeId.timbrar.llegadaEstimadaHoraLocal')} obligatorio ayuda={tr('timbrado.viajeId.timbrar.debeSerPosteriorA')}>
                <input id="fechaLlegadaEstimada" name="fechaLlegadaEstimada" type="datetime-local" className="rv-ctl" required />
              </Campo>
            </FormaConAviso>
            <AvisoCompacto tono="warn" resumen={tr('timbrado.viajeId.timbrar.siEligesPpdEse')}
              mas={tr('timbrado.viajeId.timbrar.siEligesPpdEse2')} />
          </div>
        )}
      </div>
    </Tarjeta>
  );
}


/**
 * 0541 — CANCELAR EL CFDI. Tres estados honestos (nunca «cancelado» sin que el SAT lo diga):
 *   · sin cancelación: el formulario (motivo SAT + folio de sustitución si es 01);
 *   · en proceso: el SAT recibió la solicitud pero el CFDI sigue vigente hasta ver el acuse;
 *     quien lo vio lo confirma aquí y recién entonces el viaje queda libre para re-timbrar;
 *   · rechazada / sin respuesta: se muestra el mensaje del PAC tal cual y se puede volver a pedir.
 */
function CancelacionDelTimbre({ cancelacion, cancelar, confirmar, tr = trEs }: {
  cancelacion: import('@/lib/likida/carta_porte_timbre').CancelacionTimbre | null;
  cancelar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  confirmar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>; tr?: Tr;
}) {
  if (cancelacion?.estado === 'en_proceso') {
    return (
      <div className="rv-timb__bloque">
        <AvisoCompacto tono="warn" resumen={tr('timbrado.viajeId.timbrar.cancelacionEnProcesoCodigo', { v: cancelacion.codigoSat ?? 's/d', motivo: cancelacion.motivo ?? '' })}
          mas={tr('timbrado.viajeId.timbrar.elSatRecibioLa')} />
        <FormaConAviso accion={confirmar} boton={tr('timbrado.viajeId.timbrar.confirmarQueYaEsta')} columnas="md:grid-cols-1">
          <Casilla name="verificadoEnSat" etiqueta={tr('timbrado.viajeId.timbrar.viElAcuseO')} />
        </FormaConAviso>
      </div>
    );
  }
  return (
    <Disclosure variante="linea" titulo={tr('timbrado.viajeId.timbrar.cancelarEsteCfdi')}>
      <div className="rv-timb__bloque">
        {cancelacion?.estado === 'rechazada' && (
          <AvisoCompacto tono="error" resumen={tr('timbrado.viajeId.timbrar.elPacNoCancelo', { v: cancelacion.error ?? tr('timbrado.viajeId.timbrar.sinDetalle') })} />
        )}
        {cancelacion?.estado === 'solicitada' && (
          <AvisoCompacto tono="warn" resumen={tr('timbrado.viajeId.timbrar.laUltimaSolicitudNo', { v: cancelacion.error ? ` (${cancelacion.error})` : '' })} />
        )}
        <p className="rv-timb__tenue">
          {tr('timbrado.viajeId.timbrar.laCancelacionTieneVentana')}
        </p>
        <FormaConAviso accion={cancelar} boton={tr('timbrado.viajeId.timbrar.pedirLaCancelacion')} columnas="md:grid-cols-2">
          <CampoSelect id="motivo" name="motivo" etiqueta={tr('timbrado.viajeId.timbrar.motivoSat')} defaultValue="02">
            {(Object.keys(MOTIVOS_CANCELACION) as MotivoCancelacion[]).map((k) => (
              <option key={k} value={k}>{`${k} — ${MOTIVOS_CANCELACION[k]}`}</option>
            ))}
          </CampoSelect>
          <CampoTexto id="folioSustitucion" name="folioSustitucion" etiqueta={tr('timbrado.viajeId.timbrar.folioFiscalDelCfdi')} placeholder="UUID" />
        </FormaConAviso>
      </div>
    </Disclosure>
  );
}
