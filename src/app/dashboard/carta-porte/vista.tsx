import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { TriangleAlert, CircleCheck, CircleHelp, Printer } from 'lucide-react';
import type { EstadoCartaPorte, ViajeCcp } from '@/lib/likida/carta_porte_datos';
import type { EstadoCampoCcp } from '@/lib/likida/carta_porte';
import { AVISO_VALOR_MERCANCIA } from '@/lib/likida/relojes_legales';
import { numero } from '@/lib/formato';
import { FormaDeclaracion, FormaMercancia, FormaDatosCliente, BotonBorrarMercancia, type AccionForma } from './forma';
import {
  Aviso, AvisoCompacto, BotonEnlace, Disclosure, EstadoError, EstadoVacio, Icono, MarcoPagina, StatusChip, Tarjeta,
} from '@/app/ui-v2/componentes';
import './carta-porte.css';

/**
 * CARTA PORTE — la pregunta del minuto tres de cualquier demo (hallazgo A3,
 * auditoría 4), contestada por viaje y ANTES de que la unidad salga:
 *
 *   1. ¿Este viaje necesita el complemento? — con las dos declaraciones de la
 *      flota (¿pisa federal?, radio) y la configuración de la unidad;
 *   2. ¿qué dato falta y DE QUIÉN ES? — los 37 del Apéndice 3, partidos 19
 *      del cliente / 18 del transportista, porque la responsabilidad ante el
 *      SAT se limita a los datos que aportó cada parte (regla 2.7.7.1.1).
 *
 * LO QUE ESTA PANTALLA NO PROMETE (y está escrito en ella): Likida no timbra
 * el CFDI ni garantiza cumplimiento — prepara, valida y deja rastro de quién
 * declaró qué. Un complemento que ampara un viaje que no ocurrió es un
 * comprobante FALSO por texto expreso de ley desde nov-2025 (CFF 29-A fr. IX).
 *
 * Pura props, para poder mirarla con fixtures sin sesión.
 */
export interface AccionesCcp {
  declarar: AccionForma | null;
  agregarMercancia: AccionForma | null;
  quitarMercancia: AccionForma | null;
  guardarDatosCliente: AccionForma | null;
}

export function VistaCartaPorte({ datos, declarar = null, agregarMercancia = null, quitarMercancia = null, guardarDatosCliente = null, sufijo = '', tr = trEs }: {
  datos: EstadoCartaPorte | null;
  declarar?: AccionForma | null;
  agregarMercancia?: AccionForma | null;
  quitarMercancia?: AccionForma | null;
  guardarDatosCliente?: AccionForma | null;
  /** El `?tenant=&rol=` que se arrastra en cada link interno (ver sufijo.ts). */
  sufijo?: string; tr?: Tr;
}) {
  const acciones: AccionesCcp = { declarar, agregarMercancia, quitarMercancia, guardarDatosCliente };
  return (
    <MarcoPagina titulo={tr('cartaPorte.vista.cartaPorte')} apoyo={tr('cartaPorte.vista.porCadaViajeEn')}>
      <AvisoCompacto tono="info"
        resumen={tr('cartaPorte.vista.laLeyLimitaLa')}
        mas={<p>{rico(tr('cartaPorte.vista.seEvaluaComoStrong'), { strong: (c) => <strong>{c}</strong> })}</p>} />

      {/* FASE 6 (relojes legales): el aviso que nadie da ANTES del
          siniestro. Es incondicional a propósito — Likida hoy no captura
          ValorMercancia, así que no hay un "por viaje" que evaluar: el
          dato correcto es que se declara AL EMITIR con el PAC, y la
          consecuencia de no hacerlo es una cifra concreta, no un regaño. */}
      <Aviso tono="warn" titulo={AVISO_VALOR_MERCANCIA.titulo}>
        {AVISO_VALOR_MERCANCIA.cuerpo}{' '}
        <span className="rv-ccp__tenue">{AVISO_VALOR_MERCANCIA.fundamento}</span>
      </Aviso>

      {datos !== null && datos.hazmatDeclarado === true && (
        <Aviso tono="warn">
          {rico(tr('cartaPorte.vista.tuFlotaDeclaroQue'), { strong: (c) => <strong>{c}</strong> })}
        </Aviso>
      )}
      {datos !== null && datos.dedicadoDeclarado === true && (
        <Aviso tono="warn">
          {rico(tr('cartaPorte.vista.tuFlotaDeclaroStrong'), { strong: (c) => <strong>{c}</strong> })}
        </Aviso>
      )}
      {datos === null ? (
        <EstadoError>{tr('cartaPorte.vista.noPudeLeerLos')}</EstadoError>
      ) : datos.viajes.length === 0 ? (
        <EstadoVacio contenido titulo={tr('cartaPorte.vista.noHayViajesEn')}>
          {tr('cartaPorte.vista.alDespacharElPrimero')}
        </EstadoVacio>
      ) : (
        <>
          {datos.viajes.map((v) => <TarjetaViaje tr={tr} key={v.viajeId} v={v} acciones={acciones} sufijo={sufijo} />)}
          {datos.viajes.length < datos.total && (
            <p className="rv-ccp__nota">
              {tr('cartaPorte.vista.seEvaluanLosViajes', { v: numero(datos.viajes.length), v2: numero(datos.total) })}
            </p>
          )}
        </>
      )}
    </MarcoPagina>
  );
}

const pillDe = (tr: Tr): Record<string, { rotulo: string; tono: 'warn' | 'ok' | 'bad' }> => ({
  si: { rotulo: tr('cartaPorte.vista.necesitaComplemento'), tono: 'warn' },
  no: { rotulo: tr('cartaPorte.vista.sinComplemento'), tono: 'ok' },
  falta_declarar: { rotulo: tr('cartaPorte.vista.faltaDeclarar'), tono: 'bad' },
});
function TarjetaViaje({ v, acciones, sufijo, tr = trEs }: { v: ViajeCcp; acciones: AccionesCcp; sufijo: string; tr?: Tr }) {
  const pill = pillDe(tr)[v.decision.necesita];
  const c = v.checklist;
  const listos = 18 - c.faltanTransportista;
  const b = v.borrador;

  return (
    <Tarjeta titulo={v.folio ?? v.viajeId.slice(0, 8)} acciones={<StatusChip tono={pill.tono}>{pill.rotulo}</StatusChip>}>
      <div className="rv-ccp__viaje">
        <p className="rv-ccp__nota">
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? tr('cartaPorte.vista.sinRutaCapturada')}
        </p>
        <p className="rv-ccp__nota">
          {v.decision.motivo}{' '}
          <span className="rv-ccp__tenue">({v.decision.fundamento})</span>
        </p>
        {v.decision.pendientes.length > 0 && (
          <ul className="rv-ccp__pendientes">
            {v.decision.pendientes.map((p) => (
              <li key={p}><Icono icono={TriangleAlert} />{p}</li>
            ))}
          </ul>
        )}

        <div className="rv-ccp__datos">
          <span>{tr('cartaPorte.vista.unidadDosPuntos')} {v.unidadEconomico ?? <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinAsignar')}</em>}</span>
          <span>{tr('cartaPorte.vista.operadorDosPuntos')} {v.operadorNombre ?? <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinDatos')}</em>}</span>
          <span>{tr('cartaPorte.vista.clienteDosPuntos')} {v.clienteNombre ?? <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinAsignar')}</em>}</span>
          <span>
            {tr('cartaPorte.vista.datosDelTransportista')} <strong>{tr('cartaPorte.vista.listosDe18', { n: numero(listos) })}</strong>
            {c.transportistaListo && <StatusChip tono="ok">{tr('cartaPorte.vista.completos')}</StatusChip>}
          </span>
          <span>
            {rico(tr('cartaPorte.vista.delClienteStrongDe', { v: numero(19 - c.faltanCliente) }), { strong: (c) => <strong>{c}</strong>, span: (c) => <span className="rv-ccp__tenue">{c}</span> })}
          </span>
        </div>

        <Disclosure variante="linea" titulo={tr('cartaPorte.vista.los37DatosUno')}>
          <div className="rv-ccp__dos">
            <ListaCampos tr={tr} titulo={tr('cartaPorte.vista.delTransportista18Responde')} campos={c.campos.filter((x) => x.responsable === 'transportista')} />
            <ListaCampos tr={tr} titulo={tr('cartaPorte.vista.delCliente19Pideselos')} campos={c.campos.filter((x) => x.responsable === 'cliente')} />
          </div>
        </Disclosure>

        {acciones.declarar && (
          <Disclosure variante="linea" titulo={tr('cartaPorte.vista.declararLaRutaDe')}>
            <FormaDeclaracion accion={acciones.declarar} viajeId={v.viajeId} inicial={v.declarado} />
          </Disclosure>
        )}

        <Disclosure variante="linea" titulo={tr('cartaPorte.vista.mercanciaDelViaje', { v: numero(v.mercancias.length), v2: v.mercancias.length === 1 ? tr('cartaPorte.vista.renglon') : tr('cartaPorte.vista.renglones') })}>
          <div className="rv-ccp__viaje">
            {v.mercancias.length > 0 && (
              <ul className="rv-ccp__merc">
                {v.mercancias.map((m) => (
                  <li key={m.id}>
                    <span>{m.descripcion}</span>
                    <span className="rv-ccp__mono">
                      {m.bienesTransp ?? <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinClaveSat')}</em>}
                      {' · '}{numero(m.cantidad)} {m.claveUnidad ?? <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinUnidad')}</em>}
                      {' · '}{m.pesoKg !== null ? `${numero(m.pesoKg)} kg` : <em className="rv-ccp__falta">{tr('cartaPorte.vista.sinPeso')}</em>}
                    </span>
                    {m.materialPeligroso === true && <StatusChip tono="warn">{tr('cartaPorte.vista.materialPeligroso')}</StatusChip>}
                    {m.materialPeligroso === null && <span className="rv-ccp__tenue">{tr('cartaPorte.vista.peligrosoSinDeclarar')}</span>}
                    {acciones.quitarMercancia && <BotonBorrarMercancia accion={acciones.quitarMercancia} mercanciaId={m.id} />}
                  </li>
                ))}
              </ul>
            )}
            {acciones.agregarMercancia && <FormaMercancia accion={acciones.agregarMercancia} viajeId={v.viajeId} />}
          </div>
        </Disclosure>

        {acciones.guardarDatosCliente && (
          <Disclosure variante="linea" titulo={tr('cartaPorte.vista.datosDelClienteCps')}>
            <FormaDatosCliente accion={acciones.guardarDatosCliente} viajeId={v.viajeId} inicial={v.datosCliente} />
          </Disclosure>
        )}

        <div className="rv-ccp__pie">
          {b.borrador !== null ? (
            b.fallas.length === 0 ? (
              <StatusChip tono="ok">{tr('cartaPorte.vista.borradorArmadoYSin')}</StatusChip>
            ) : (
              <StatusChip tono="warn">
                {tr(b.fallas.length === 1 ? 'cartaPorte.vista.borradorFallaUna' : 'cartaPorte.vista.borradorFallasVarias', { n: numero(b.fallas.length), campos: b.fallas.map((f) => f.campo).join(', ') })}
              </StatusChip>
            )
          ) : (
            <span className="rv-ccp__nota">
              {tr('cartaPorte.vista.borradorAunNoArmable', { v: numero(b.faltantes.length), v2: b.faltantes.length === 1 ? tr('cartaPorte.vista.dato') : tr('cartaPorte.vista.datos') })}
            </span>
          )}
          <BotonEnlace href={`/dashboard/carta-porte/borrador/${v.viajeId}${sufijo}`} variante="secondary" tamano="sm" icono={<Icono icono={Printer} />}>
            {tr('cartaPorte.vista.verBorradorImprimible')}
          </BotonEnlace>
        </div>
      </div>
    </Tarjeta>
  );
}

function ListaCampos({ titulo, campos, tr = trEs }: { titulo: string; campos: EstadoCampoCcp[]; tr?: Tr }) {
  return (
    <div>
      <p className="rv-ccp__sub">{titulo}</p>
      <ul className="rv-ccp__campos">
        {campos.map((c) => (
          <li key={c.clave}>
            <Icono icono={c.presente === true ? CircleCheck : c.presente === false ? TriangleAlert : CircleHelp} />
            <span>
              {c.rotulo}
              {c.presente === true && c.valor !== null && (
                <span className="rv-ccp__mono"> {c.valor}</span>
              )}
              {c.presente === false && c.fuente !== null && (
                <span className="rv-ccp__tenue"> {tr('cartaPorte.vista.seCapturaEn', { v: c.fuente.split('.')[0] === 'unidad' ? tr('cartaPorte.vista.unidades') : c.fuente.split('.')[0] === 'operador' ? tr('cartaPorte.vista.operadores') : c.fuente.split('.')[0] === 'viaje' ? tr('cartaPorte.vista.elViaje') : c.fuente.split('.')[0] === 'cliente' ? tr('cartaPorte.vista.clientes') : c.fuente })}</span>
              )}
              {c.presente === null && (
                <span className="rv-ccp__tenue">
                  {c.responsable === 'cliente'
                    ? ' ' + tr('cartaPorte.vista.sinCasillaEnLikida')
                    : ' ' + tr('cartaPorte.vista.sinCasillaEnLikida2')}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
