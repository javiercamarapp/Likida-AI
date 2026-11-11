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

export function VistaCartaPorte({ datos, declarar = null, agregarMercancia = null, quitarMercancia = null, guardarDatosCliente = null, sufijo = '' }: {
  datos: EstadoCartaPorte | null;
  declarar?: AccionForma | null;
  agregarMercancia?: AccionForma | null;
  quitarMercancia?: AccionForma | null;
  guardarDatosCliente?: AccionForma | null;
  /** El `?tenant=&rol=` que se arrastra en cada link interno (ver sufijo.ts). */
  sufijo?: string;
}) {
  const acciones: AccionesCcp = { declarar, agregarMercancia, quitarMercancia, guardarDatosCliente };
  return (
    <MarcoPagina titulo="Carta Porte" apoyo="Por cada viaje en curso: si necesita el complemento Carta Porte 3.1 y qué dato falta, separado por responsable.">
      <AvisoCompacto tono="info"
        resumen="La ley limita la responsabilidad de cada parte a los datos que esa parte aportó. Likida no timbra ni garantiza cumplimiento: prepara, valida y deja rastro de quién declaró qué."
        mas={<p>Se evalúa como <strong>carga general</strong>: si mueves hidrocarburos, medicamentos o mercancía de despacho aduanero, el complemento es obligatorio siempre y ninguna facilidad aplica.</p>} />

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
          Tu flota declaró que mueve <strong>material peligroso</strong>: la carga es materia excluida
          y el complemento es obligatorio SIEMPRE — ninguna facilidad aplica (regla 2.7.7.2.1, cuarto párrafo).
          El semáforo de abajo ya lo refleja.
        </Aviso>
      )}
      {datos !== null && datos.dedicadoDeclarado === true && (
        <Aviso tono="warn">
          Tu flota declaró <strong>transporte dedicado</strong>: la regla 2.7.7.1.3 invierte los roles
          y el complemento puede tocarle emitirlo a tu cliente con CFDI de traslado. Confírmalo con tu
          contador — Likida lo advierte, no lo decide.
        </Aviso>
      )}
      {datos === null ? (
        <EstadoError>No pude leer los viajes en curso ni sus datos de unidad y operador. No se pinta un semáforo a medias: un «no necesita» sobre datos incompletos vale una presunción de contrabando.</EstadoError>
      ) : datos.viajes.length === 0 ? (
        <EstadoVacio contenido titulo="No hay viajes en curso">
          Al despachar el primero, aquí aparece si necesita Carta Porte —
          con las dos declaraciones que lo deciden (¿pisa carretera federal? ¿el tramo federal
          cabe en un radio de 30 km?) — y el semáforo de los 18 datos del transportista contra lo
          capturado en Unidades y Operadores.
        </EstadoVacio>
      ) : (
        <>
          {datos.viajes.map((v) => <TarjetaViaje key={v.viajeId} v={v} acciones={acciones} sufijo={sufijo} />)}
          {datos.viajes.length < datos.total && (
            <p className="rv-ccp__nota">
              Se evalúan los {numero(datos.viajes.length)} viajes más próximos de {numero(datos.total)} en curso.
            </p>
          )}
        </>
      )}
    </MarcoPagina>
  );
}

const PILL: Record<string, { rotulo: string; tono: 'warn' | 'ok' | 'bad' }> = {
  si: { rotulo: 'Necesita complemento', tono: 'warn' },
  no: { rotulo: 'Sin complemento', tono: 'ok' },
  falta_declarar: { rotulo: 'Falta declarar', tono: 'bad' },
};

function TarjetaViaje({ v, acciones, sufijo }: { v: ViajeCcp; acciones: AccionesCcp; sufijo: string }) {
  const pill = PILL[v.decision.necesita];
  const c = v.checklist;
  const listos = 18 - c.faltanTransportista;
  const b = v.borrador;

  return (
    <Tarjeta titulo={v.folio ?? v.viajeId.slice(0, 8)} acciones={<StatusChip tono={pill.tono}>{pill.rotulo}</StatusChip>}>
      <div className="rv-ccp__viaje">
        <p className="rv-ccp__nota">
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? 'sin ruta capturada'}
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
          <span>Unidad: {v.unidadEconomico ?? <em className="rv-ccp__falta">sin asignar</em>}</span>
          <span>Operador: {v.operadorNombre ?? <em className="rv-ccp__falta">sin datos</em>}</span>
          <span>Cliente: {v.clienteNombre ?? <em className="rv-ccp__falta">sin asignar</em>}</span>
          <span>
            Datos del transportista: <strong>{numero(listos)} de 18</strong>
            {c.transportistaListo && <StatusChip tono="ok">completos</StatusChip>}
          </span>
          <span>
            Del cliente: <strong>{numero(19 - c.faltanCliente)} de 19</strong>{' '}
            <span className="rv-ccp__tenue">(los aporta tu cliente; su hueco es responsabilidad suya)</span>
          </span>
        </div>

        <Disclosure variante="linea" titulo="Los 37 datos, uno por uno">
          <div className="rv-ccp__dos">
            <ListaCampos titulo="Del transportista (18) — responde tu flota" campos={c.campos.filter((x) => x.responsable === 'transportista')} />
            <ListaCampos titulo="Del cliente (19) — pídeselos ANTES del viaje" campos={c.campos.filter((x) => x.responsable === 'cliente')} />
          </div>
        </Disclosure>

        {acciones.declarar && (
          <Disclosure variante="linea" titulo="Declarar la ruta de este viaje">
            <FormaDeclaracion accion={acciones.declarar} viajeId={v.viajeId} inicial={v.declarado} />
          </Disclosure>
        )}

        <Disclosure variante="linea" titulo={`Mercancía del viaje (${numero(v.mercancias.length)} ${v.mercancias.length === 1 ? 'renglón' : 'renglones'})`}>
          <div className="rv-ccp__viaje">
            {v.mercancias.length > 0 && (
              <ul className="rv-ccp__merc">
                {v.mercancias.map((m) => (
                  <li key={m.id}>
                    <span>{m.descripcion}</span>
                    <span className="rv-ccp__mono">
                      {m.bienesTransp ?? <em className="rv-ccp__falta">sin clave SAT</em>}
                      {' · '}{numero(m.cantidad)} {m.claveUnidad ?? <em className="rv-ccp__falta">sin unidad</em>}
                      {' · '}{m.pesoKg !== null ? `${numero(m.pesoKg)} kg` : <em className="rv-ccp__falta">sin peso</em>}
                    </span>
                    {m.materialPeligroso === true && <StatusChip tono="warn">material peligroso</StatusChip>}
                    {m.materialPeligroso === null && <span className="rv-ccp__tenue">peligroso sin declarar</span>}
                    {acciones.quitarMercancia && <BotonBorrarMercancia accion={acciones.quitarMercancia} mercanciaId={m.id} />}
                  </li>
                ))}
              </ul>
            )}
            {acciones.agregarMercancia && <FormaMercancia accion={acciones.agregarMercancia} viajeId={v.viajeId} />}
          </div>
        </Disclosure>

        {acciones.guardarDatosCliente && (
          <Disclosure variante="linea" titulo="Datos del cliente (CPs, RFC del destinatario)">
            <FormaDatosCliente accion={acciones.guardarDatosCliente} viajeId={v.viajeId} inicial={v.datosCliente} />
          </Disclosure>
        )}

        <div className="rv-ccp__pie">
          {b.borrador !== null ? (
            b.fallas.length === 0 ? (
              <StatusChip tono="ok">Borrador armado y SIN fallas del validador — listo para que tu PAC lo timbre.</StatusChip>
            ) : (
              <StatusChip tono="warn">
                {`Borrador armado con ${numero(b.fallas.length)} ${b.fallas.length === 1 ? 'falla' : 'fallas'} que el PAC rechazaría: ${b.fallas.map((f) => f.campo).join(', ')}.`}
              </StatusChip>
            )
          ) : (
            <span className="rv-ccp__nota">
              Borrador aún no armable — faltan {numero(b.faltantes.length)} {b.faltantes.length === 1 ? 'dato' : 'datos'}.
            </span>
          )}
          <BotonEnlace href={`/dashboard/carta-porte/borrador/${v.viajeId}${sufijo}`} variante="secondary" tamano="sm" icono={<Icono icono={Printer} />}>
            Ver borrador imprimible
          </BotonEnlace>
        </div>
      </div>
    </Tarjeta>
  );
}

function ListaCampos({ titulo, campos }: { titulo: string; campos: EstadoCampoCcp[] }) {
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
                <span className="rv-ccp__tenue"> — se captura en {c.fuente.split('.')[0] === 'unidad' ? 'Unidades' : c.fuente.split('.')[0] === 'operador' ? 'Operadores' : c.fuente.split('.')[0] === 'viaje' ? 'el viaje' : c.fuente.split('.')[0] === 'cliente' ? 'Clientes' : c.fuente}</span>
              )}
              {c.presente === null && (
                <span className="rv-ccp__tenue">
                  {c.responsable === 'cliente'
                    ? ' — sin casilla en Likida todavía; pídeselo a tu cliente antes del viaje'
                    : ' — sin casilla en Likida todavía; se declara al emitir el CFDI'}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
