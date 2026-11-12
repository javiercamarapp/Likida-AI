import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { clientesActivosCompletos, geocercasActivasCompletas } from '@/lib/likida/catalogo_selectores';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getEstadias, guardarPoliticaDetencion, vincularSitioCliente, VENTANA_ESTADIAS_DIAS,
  type EstadiasPanel,
} from '@/lib/likida/estadias/lector';
import type { EpisodioEstadia, FaseEpisodio, MotivoSinMonto } from '@/lib/likida/estadias/motor';
import { parsearImporteMx, mxn, fechaHoraMx } from '@/lib/formato';
import {
  CampoSelect, CampoTexto, Disclosure, FormaEnCajon, Tarjeta, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { EstadoError } from '../estados';

/**
 * ESTADÍAS Y DETENCIÓN (0207, ficha §8.3) — la sección del contralor.
 *
 * Vive en facturación por la misma razón que el auditor de cobranza: el
 * episodio que excede el pacto es un ACCESORIO COBRABLE del viaje, y quien
 * decide si se factura es el contralor — el agente prepara el renglón con su
 * evidencia, el humano factura (jamás se emite un CFDI desde aquí).
 *
 * El reloj es el de los hitos del chofer (0090) y la pantalla LO DICE: la
 * hora es la del mensaje de WhatsApp, no telemetría. Cuando el cliente tiene
 * su sitio dibujado (geocerca) y el GPS está conectado, la llegada/salida
 * MEDIDAS acompañan al reloj como evidencia independiente — las dos se
 * enseñan, ninguna se funde con la otra.
 */

const RUTA = '/dashboard/facturacion';

/** h:mm para minutos medidos. Los null no llegan aquí: se pintan aparte. */
function duracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

const rotuloFase = (tr: Tr): Record<FaseEpisodio, string> => ({
  corriendo: tr('facturacion.estadias.faseCorriendo'),
  cerrado: tr('facturacion.estadias.faseCerrado'),
  sin_salida_medible: tr('facturacion.estadias.faseSinSalida'),
  sellos_incoherentes: tr('facturacion.estadias.faseSellos'),
});
const rotuloSinMonto = (tr: Tr): Record<MotivoSinMonto, string> => ({
  sin_minutos: tr('facturacion.estadias.sinVentanaMedibleEl'),
  sin_horas_libres_pactadas: tr('facturacion.estadias.sinHorasLibresPactadas'),
  dentro_de_horas_libres: tr('facturacion.estadias.dentroDeLasHoras'),
  sin_tarifa_pactada: tr('facturacion.estadias.excedidoPeroSinTarifa'),
});
function Evidencia({ e, tr = trEs }: { e: EpisodioEstadia; tr?: Tr }) {
  if (e.evidencia.tipo === 'medida') {
    return (
      <span>
        {tr('facturacion.estadias.gpsEnPrimeraPosicion', { v: e.sitioNombre ?? tr('facturacion.estadias.elSitio'), v2: fechaHoraMx(e.evidencia.primeraEnSitio), v3: fechaHoraMx(e.evidencia.ultimaEnSitio), posiciones: e.evidencia.posiciones })}
      </span>
    );
  }
  const motivo = {
    sin_sitio_del_cliente: tr('facturacion.estadias.elClienteNoTiene'),
    sin_unidad: tr('facturacion.estadias.elViajeNoTiene'),
    sin_posiciones_en_sitio: tr('facturacion.estadias.sinPosicionesGpsDentro'),
  }[e.evidencia.motivo];
  return <span>{tr('facturacion.estadias.sinMedicionGpsEl', { motivo })}</span>;
}

function Renglon({ e, tr = trEs }: { e: EpisodioEstadia; tr?: Tr }) {
  const d = e.detencion;
  return (
    <Disclosure
      titulo={(
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>{e.folio ?? tr('facturacion.estadias.viajeCorto', { id: e.viajeId.slice(0, 8) })}</span>
          <span className="font-normal text-[color:var(--muted)]">{e.clienteNombre ?? tr('facturacion.estadias.sinCliente')}</span>
          {e.unidadEconomico && <span className="font-normal text-[color:var(--muted)]">{tr('facturacion.estadias.unidad', { unidadEconomico: e.unidadEconomico })}</span>}
          <span className="font-normal text-[color:var(--muted)]">
            {e.minutosSitio !== null ? duracion(e.minutosSitio) : rotuloFase(tr)[e.fase]}
            {e.fase === 'corriendo' && ' ' + tr('facturacion.estadias.corriendo')}
          </span>
        </span>
      )}
      resumen={d.monto !== null ? tr('facturacion.estadias.propuestos', { v: mxn(d.monto) }) : '—'}
    >
      <div className="flex flex-col gap-1 text-[12px] text-[color:var(--muted)]">
        <span>
          {tr('facturacion.estadias.rutaSitio', { origen: e.origen ?? '—', destino: e.destino ?? '—', sitio: e.sitioNombre ?? tr('facturacion.estadias.sinSitioDibujado') })}
        </span>
        <span>
          {tr('facturacion.estadias.llegadaAvisoDelChofer')} {fechaHoraMx(e.llegadaEn)}.
          {e.descargaEn && <> {tr('facturacion.estadias.descargandoDesde', { v: fechaHoraMx(e.descargaEn) })}</>}
          {' '}{tr('facturacion.estadias.salida', { cuando: e.regresoEn ? fechaHoraMx(e.regresoEn) : rotuloFase(tr)[e.fase] })}
        </span>
        <span><Evidencia tr={tr} e={e} /></span>
        {d.monto !== null ? (
          <span>
            {tr('facturacion.estadias.horasLibresPactadas')} {d.horasLibres} h ({e.origenPolitica === 'cliente' ? tr('facturacion.estadias.pactoDelCliente') : tr('facturacion.estadias.pactoDeFlota')}).
            {' '}{tr('facturacion.estadias.excedente', { duracion: duracion(d.minutosExcedentes as number), horas: d.horasCobrables ?? '' })}
            {' '}{rico(tr('facturacion.estadias.tarifaRenglon', { monto: mxn(d.monto) }), { strong: (c) => <strong>{c}</strong> })}
          </span>
        ) : (
          <span>{rotuloSinMonto(tr)[d.motivoSinMonto as MotivoSinMonto]}</span>
        )}
      </div>
    </Disclosure>
  );
}

// Referencia de módulo: las Server Actions sólo capturan `sp`, serializable.
// Una función local quedaría en sus argumentos cifrados y rompería el render.
// Vacío conserva null: nadie pactó cero por dejar el campo sin llenar.
function perilla(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : parsearImporteMx(s);
}

export async function BloqueEstadias({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { t: tr } = await getT('dinero');
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) return null;

  // Lecturas independientes de la cartera: su fallo pinta el error dicho, no
  // una sección vacía que se leería como "sin estadías".
  let panel: EstadiasPanel | null = null;
  let clientes: Array<{ id: string; nombre: string; geocercaId: string | null }> = [];
  let geocercas: Array<{ id: string; nombre: string }> = [];
  let leyoOk = true;
  try {
    panel = await getEstadias(tenantId);
    // A37-S18-06: TODOS los clientes y geocercas (antes `.limit(500)`: el cliente 501 no podía pactar detención ni vincular
    // su geocerca, y nada lo decía). Si la lectura no se puede completar LANZA y la sección dice que no se pudo leer.
    const [c, g] = await Promise.all([clientesActivosCompletos(tenantId), geocercasActivasCompletas(tenantId)]);
    clientes = c.map((x) => ({ id: x.id, nombre: x.nombre, geocercaId: x.geocercaId }));
    geocercas = g;
  } catch (e) {
    leyoOk = false;
    logger.warn('estadias.no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  async function pactarFlota(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.estadias.tuRolNoPuede') };
    try {
      await guardarPoliticaDetencion(s.tenantId, null, {
        horasLibres: perilla(fd.get('horasLibres')),
        tarifaHora: perilla(fd.get('tarifaHora')),
      }, s.userId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'pactar la detención de flota') };
    }
    revalidatePath(RUTA);
    return { ok: tr('facturacion.estadias.pactoDeFlotaGuardado') };
  }

  async function pactarCliente(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.estadias.tuRolNoPuede') };
    const clienteId = String(fd.get('clienteId') ?? '');
    if (!clienteId) return { error: tr('facturacion.estadias.eligeElClienteDel') };
    try {
      await guardarPoliticaDetencion(s.tenantId, clienteId, {
        horasLibres: perilla(fd.get('horasLibres')),
        tarifaHora: perilla(fd.get('tarifaHora')),
      }, s.userId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'pactar la detención del cliente') };
    }
    // A37-S18-08: el pacto YA quedó escrito. El sitio se vincula en el mismo
    // envío (mismo gesto de configuración; '' = no tocar, 'ninguno' = desvincular),
    // pero si el vínculo falla no se debe decir que el pacto no se guardó.
    const sitio = String(fd.get('geocercaId') ?? '');
    if (sitio !== '') {
      try {
        await vincularSitioCliente(s.tenantId, clienteId, sitio === 'ninguno' ? null : sitio);
      } catch (e) {
        revalidatePath(RUTA);
        const motivo = mensajeParaPantalla(e, 'vincular el sitio del cliente');
        return { error: tr('facturacion.estadias.elPactoDelCliente', { motivo }) };
      }
    }
    revalidatePath(RUTA);
    return { ok: tr('facturacion.estadias.pactoDelClienteGuardado') };
  }

  // Los pactos viven en dos cajones del sistema (flota y por cliente), en el encabezado de la tarjeta; ningún formulario dentro de un
  // `<details>`.
  const pactos = leyoOk && panel !== null ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <FormaEnCajon id="pacto-flota" titulo={tr('facturacion.estadias.tituloPactoFlota')} accion={pactarFlota}
        boton={tr('facturacion.estadias.guardarPactoDeFlota')} disparador={tr('facturacion.estadias.tituloPactoFlota')}
        descripcion={<>
          {tr('facturacion.estadias.pactoDeFlotaAplica')}
          {panel.politicaFlota
            ? ' ' + tr('facturacion.estadias.vigenteHLibresTarifa', { v: panel.politicaFlota.horasLibres ?? 'sin', v2: panel.politicaFlota.tarifaHora !== null ? mxn(panel.politicaFlota.tarifaHora) : tr('facturacion.estadias.sinPactar') })
            : ' ' + tr('facturacion.estadias.sinPactoDeFlota')}
        </>}>
        <CampoTexto tipo="number" step="any" name="horasLibres" etiqueta={tr('facturacion.estadias.horasLibres')}
          defaultValue={panel.politicaFlota?.horasLibres?.toString() ?? ''} ayuda={tr('facturacion.estadias.vacioNoPactadoEl')} />
        <CampoTexto tipo="number" step="any" name="tarifaHora" etiqueta={tr('facturacion.estadias.tarifaMxnPorHora')}
          defaultValue={panel.politicaFlota?.tarifaHora?.toString() ?? ''} ayuda={tr('facturacion.estadias.vacioSinTarifaEl')} />
      </FormaEnCajon>
      {clientes.length > 0 && (
        <FormaEnCajon id="pacto-cliente" titulo={tr('facturacion.estadias.tituloPactoCliente')} accion={pactarCliente}
          boton={tr('facturacion.estadias.guardarPactoDelCliente')} disparador={tr('facturacion.estadias.tituloPactoCliente')}
          descripcion={tr('facturacion.estadias.pactoPorClienteGana')}>
          <CampoSelect name="clienteId" etiqueta={tr('facturacion.estadias.cliente')} obligatorio defaultValue="">
            <option value="">{tr('facturacion.estadias.elige')}</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </CampoSelect>
          <CampoTexto tipo="number" step="any" name="horasLibres" etiqueta={tr('facturacion.estadias.horasLibres')} ayuda={tr('facturacion.estadias.vacioNoPactado')} />
          <CampoTexto tipo="number" step="any" name="tarifaHora" etiqueta={tr('facturacion.estadias.tarifaMxnPorHora2')} ayuda={tr('facturacion.estadias.vacioSinTarifa')} />
          <CampoSelect name="geocercaId" etiqueta={tr('facturacion.estadias.sitioDelClienteGeocerca')} ayuda={tr('facturacion.estadias.seDibujanEnEl')} defaultValue="">
            <option value="">{tr('facturacion.estadias.noCambiar')}</option>
            <option value="ninguno">{tr('facturacion.estadias.quitarVinculo')}</option>
            {geocercas.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </CampoSelect>
        </FormaEnCajon>
      )}
    </div>
  ) : undefined;

  return (
    <Tarjeta titulo={tr('facturacion.estadias.estadiasYDetencion')} acciones={pactos}>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-[color:var(--muted)]">
          {tr('facturacion.estadias.relojExplica', { dias: VENTANA_ESTADIAS_DIAS, rango: panel ? ` (${panel.ventana.desde} → ${panel.ventana.hasta})` : '' })}
        </p>

        {!leyoOk || panel === null ? (
          <EstadoError mensaje={tr('facturacion.estadias.noPudeLeerLas')} />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[color:var(--muted)]">
              <span>{rico(tr('facturacion.estadias.strongStrongEpisodiosEn', { total: panel.resumen.total }), { strong: (c) => <strong>{c}</strong> })}</span>
              <span>{rico(tr('facturacion.estadias.strongStrongConEl', { corriendo: panel.resumen.corriendo }), { strong: (c) => <strong>{c}</strong> })}</span>
              <span>
                {tr('facturacion.estadias.detencionPropuesta')}{' '}
                <strong>{panel.resumen.montoPropuesto !== null ? mxn(panel.resumen.montoPropuesto) : tr('facturacion.estadias.sinMontosQueProponer')}</strong>
                {panel.resumen.conMonto > 0 && ' ' + tr('facturacion.estadias.episodios', { conMonto: panel.resumen.conMonto })}
              </span>
              {panel.resumen.sinPolitica > 0 && (
                <span>{tr('facturacion.estadias.sinPactoSeMiden', { sinPolitica: panel.resumen.sinPolitica })}</span>
              )}
              {panel.resumen.sinSalidaMedible > 0 && (
                <span>{tr('facturacion.estadias.sinSalidaMedible', { sinSalidaMedible: panel.resumen.sinSalidaMedible })}</span>
              )}
            </div>

            {panel.episodios.length === 0 ? (
              <p className="text-[12px] text-[color:var(--muted)]">
                {tr('facturacion.estadias.ningunViajeSelloLlegada')}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {panel.episodios.slice(0, 40).map((e) => <Renglon tr={tr} key={e.viajeId} e={e} />)}
                {panel.episodios.length > 40 && (
                  <p className="text-[12px] text-[color:var(--muted)]">
                    {tr('facturacion.estadias.seMuestranLosPrimeros', { length: panel.episodios.length })}
                  </p>
                )}
              </div>
            )}

            {clientes.length === 0 && (
              <p className="text-[12px] text-[color:var(--muted)]">
                {tr('facturacion.estadias.noTienesClientesDados')}
              </p>
            )}
          </>
        )}
      </div>
    </Tarjeta>
  );
}
