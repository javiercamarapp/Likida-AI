import Link from 'next/link';
import { ScrollText, TriangleAlert, CircleCheck, CircleHelp, Package, Printer } from 'lucide-react';
import type { EstadoCartaPorte, ViajeCcp } from '@/lib/likida/carta_porte_datos';
import type { EstadoCampoCcp } from '@/lib/likida/carta_porte';
import { AVISO_VALOR_MERCANCIA } from '@/lib/likida/relojes_legales';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { numero } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import { FormaDeclaracion, FormaMercancia, FormaDatosCliente, BotonBorrarMercancia, type AccionForma } from './forma';

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
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ScrollText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Carta Porte"
        />

        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px] max-w-3xl" style={{ color: 'var(--muted)' }}>
            Por cada viaje en curso: si necesita el complemento Carta Porte 3.1 y qué dato falta,
            separado por responsable — la ley limita la responsabilidad de cada parte a los datos que
            esa parte aportó. Se evalúa como <strong>carga general</strong>: si mueves hidrocarburos,
            medicamentos o mercancía de despacho aduanero, el complemento es obligatorio siempre y
            ninguna facilidad aplica. Likida no timbra ni garantiza cumplimiento: prepara, valida y
            deja rastro de quién declaró qué.
          </p>

          {/* FASE 6 (relojes legales): el aviso que nadie da ANTES del
              siniestro. Es incondicional a propósito — Likida hoy no captura
              ValorMercancia, así que no hay un "por viaje" que evaluar: el
              dato correcto es que se declara AL EMITIR con el PAC, y la
              consecuencia de no hacerlo es una cifra concreta, no un regaño. */}
          <section className="card p-4 max-w-3xl space-y-1.5" style={{ borderLeft: '3px solid var(--warn)' }}>
            <p className="text-[12.5px] font-medium flex items-start gap-1.5">
              <TriangleAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
              {AVISO_VALOR_MERCANCIA.titulo}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{AVISO_VALOR_MERCANCIA.cuerpo}</p>
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{AVISO_VALOR_MERCANCIA.fundamento}</p>
          </section>

          {datos !== null && datos.hazmatDeclarado === true && (
            <p className="text-[12px] px-3.5 py-2.5 rounded-lg max-w-3xl" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
              Tu flota declaró que mueve <strong>material peligroso</strong>: la carga es materia excluida
              y el complemento es obligatorio SIEMPRE — ninguna facilidad aplica (regla 2.7.7.2.1, cuarto párrafo).
              El semáforo de abajo ya lo refleja.
            </p>
          )}
          {datos !== null && datos.dedicadoDeclarado === true && (
            <p className="text-[12px] px-3.5 py-2.5 rounded-lg max-w-3xl" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
              Tu flota declaró <strong>transporte dedicado</strong>: la regla 2.7.7.1.3 invierte los roles
              y el complemento puede tocarle emitirlo a tu cliente con CFDI de traslado. Confírmalo con tu
              contador — Likida lo advierte, no lo decide.
            </p>
          )}
          {datos === null ? (
            <EstadoError mensaje="No pude leer los viajes en curso ni sus datos de unidad y operador. No se pinta un semáforo a medias: un «no necesita» sobre datos incompletos vale una presunción de contrabando." />
          ) : datos.viajes.length === 0 ? (
            <EstadoVacio icono={<ScrollText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              No hay viajes en curso. Al despachar el primero, aquí aparece si necesita Carta Porte —
              con las dos declaraciones que lo deciden (¿pisa carretera federal? ¿el tramo federal
              cabe en un radio de 30 km?) — y el semáforo de los 18 datos del transportista contra lo
              capturado en Unidades y Operadores.
            </EstadoVacio>
          ) : (
            <>
              {datos.viajes.map((v) => <TarjetaViaje key={v.viajeId} v={v} acciones={acciones} sufijo={sufijo} />)}
              {datos.viajes.length < datos.total && (
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  Se evalúan los {numero(datos.viajes.length)} viajes más próximos de {numero(datos.total)} en curso.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const PILL: Record<string, { rotulo: string; fg: string; bg: string }> = {
  si: { rotulo: 'Necesita complemento', fg: 'var(--warn)', bg: 'var(--warnbg, var(--canvas))' },
  no: { rotulo: 'Sin complemento', fg: 'var(--ok)', bg: 'var(--okbg)' },
  falta_declarar: { rotulo: 'Falta declarar', fg: 'var(--bad)', bg: 'var(--badbg)' },
};

function TarjetaViaje({ v, acciones, sufijo }: { v: ViajeCcp; acciones: AccionesCcp; sufijo: string }) {
  const pill = PILL[v.decision.necesita];
  const c = v.checklist;
  const listos = 18 - c.faltanTransportista;
  const b = v.borrador;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="cifra-mono font-medium">{v.folio ?? v.viajeId.slice(0, 8)}</span>
        <span style={{ color: 'var(--muted)' }}>
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? 'sin ruta capturada'}
        </span>
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ color: pill.fg, background: pill.bg }}>
          {pill.rotulo}
        </span>
      </div>

      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {v.decision.motivo}{' '}
        <span style={{ color: 'var(--faint)' }}>({v.decision.fundamento})</span>
      </p>
      {v.decision.pendientes.length > 0 && (
        <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--warn)' }}>
          {v.decision.pendientes.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <TriangleAlert width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: 'var(--muted)' }}>
        <span>Unidad: {v.unidadEconomico ?? <em style={{ color: 'var(--warn)' }}>sin asignar</em>}</span>
        <span>Operador: {v.operadorNombre ?? <em style={{ color: 'var(--warn)' }}>sin datos</em>}</span>
        <span>Cliente: {v.clienteNombre ?? <em style={{ color: 'var(--warn)' }}>sin asignar</em>}</span>
        <span>
          Datos del transportista:{' '}
          <strong style={{ color: c.transportistaListo ? 'var(--ok)' : undefined }}>
            {numero(listos)} de 18
          </strong>
        </span>
        <span>
          Del cliente: <strong>{numero(19 - c.faltanCliente)} de 19</strong>{' '}
          <span style={{ color: 'var(--faint)' }}>(los aporta tu cliente; su hueco es responsabilidad suya)</span>
        </span>
      </div>

      <details>
        <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
          style={{ color: 'var(--marca)' }}>
          Los 37 datos, uno por uno
        </summary>
        <div className="pt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ListaCampos titulo="Del transportista (18) — responde tu flota" campos={c.campos.filter((x) => x.responsable === 'transportista')} />
          <ListaCampos titulo="Del cliente (19) — pídeselos ANTES del viaje" campos={c.campos.filter((x) => x.responsable === 'cliente')} />
        </div>
      </details>

      {acciones.declarar && (
        <details>
          <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
            style={{ color: 'var(--marca)' }}>
            Declarar la ruta de este viaje
          </summary>
          <div className="pt-3">
            <FormaDeclaracion accion={acciones.declarar} viajeId={v.viajeId} inicial={v.declarado} />
          </div>
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
          style={{ color: 'var(--marca)' }}>
          <Package width={13} height={13} strokeWidth={1.75} />
          Mercancía del viaje ({numero(v.mercancias.length)} {v.mercancias.length === 1 ? 'renglón' : 'renglones'})
        </summary>
        <div className="pt-3 space-y-3">
          {v.mercancias.length > 0 && (
            <ul className="space-y-1 text-[12px]">
              {v.mercancias.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>{m.descripcion}</span>
                  <span className="cifra-mono" style={{ color: 'var(--muted)' }}>
                    {m.bienesTransp ?? <em style={{ color: 'var(--warn)' }}>sin clave SAT</em>}
                    {' · '}{numero(m.cantidad)} {m.claveUnidad ?? <em style={{ color: 'var(--warn)' }}>sin unidad</em>}
                    {' · '}{m.pesoKg !== null ? `${numero(m.pesoKg)} kg` : <em style={{ color: 'var(--warn)' }}>sin peso</em>}
                  </span>
                  {m.materialPeligroso === true && <span className="text-[11px]" style={{ color: 'var(--warn)' }}>material peligroso</span>}
                  {m.materialPeligroso === null && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>peligroso sin declarar</span>}
                  {acciones.quitarMercancia && <BotonBorrarMercancia accion={acciones.quitarMercancia} mercanciaId={m.id} />}
                </li>
              ))}
            </ul>
          )}
          {acciones.agregarMercancia && <FormaMercancia accion={acciones.agregarMercancia} viajeId={v.viajeId} />}
        </div>
      </details>

      {acciones.guardarDatosCliente && (
        <details>
          <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
            style={{ color: 'var(--marca)' }}>
            Datos del cliente (CPs, RFC del destinatario)
          </summary>
          <div className="pt-3">
            <FormaDatosCliente accion={acciones.guardarDatosCliente} viajeId={v.viajeId} inicial={v.datosCliente} />
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {b.borrador !== null ? (
          b.fallas.length === 0 ? (
            <span style={{ color: 'var(--ok)' }}>
              Borrador armado y SIN fallas del validador — listo para que tu PAC lo timbre.
            </span>
          ) : (
            <span style={{ color: 'var(--warn)' }}>
              Borrador armado con {numero(b.fallas.length)} {b.fallas.length === 1 ? 'falla' : 'fallas'} que el PAC rechazaría: {b.fallas.map((f) => f.campo).join(', ')}.
            </span>
          )
        ) : (
          <span style={{ color: 'var(--muted)' }}>
            Borrador aún no armable — faltan {numero(b.faltantes.length)} {b.faltantes.length === 1 ? 'dato' : 'datos'}.
          </span>
        )}
        <Link href={`/dashboard/carta-porte/borrador/${v.viajeId}${sufijo}`}
          className="inline-flex items-center gap-1 font-medium hover:opacity-75"
          style={{ color: 'var(--marca)' }}>
          <Printer width={13} height={13} strokeWidth={1.75} />
          Ver borrador imprimible
        </Link>
      </div>
    </section>
  );
}

function ListaCampos({ titulo, campos }: { titulo: string; campos: EstadoCampoCcp[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
        {titulo}
      </h3>
      <ul className="space-y-0.5 text-[12px]">
        {campos.map((c) => (
          <li key={c.clave} className="flex items-start gap-1.5">
            {c.presente === true ? (
              <CircleCheck width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
            ) : c.presente === false ? (
              <TriangleAlert width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
            ) : (
              <CircleHelp width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--faint)' }} />
            )}
            <span>
              {c.rotulo}
              {c.presente === true && c.valor !== null && (
                <span className="cifra-mono ml-1" style={{ color: 'var(--muted)' }}>{c.valor}</span>
              )}
              {c.presente === false && c.fuente !== null && (
                <span className="ml-1" style={{ color: 'var(--faint)' }}>— se captura en {c.fuente.split('.')[0] === 'unidad' ? 'Unidades' : c.fuente.split('.')[0] === 'operador' ? 'Operadores' : c.fuente.split('.')[0] === 'viaje' ? 'el viaje' : c.fuente.split('.')[0] === 'cliente' ? 'Clientes' : c.fuente}</span>
              )}
              {c.presente === null && (
                <span className="ml-1" style={{ color: 'var(--faint)' }}>
                  {c.responsable === 'cliente'
                    ? '— sin casilla en Likida todavía; pídeselo a tu cliente antes del viaje'
                    : '— sin casilla en Likida todavía; se declara al emitir el CFDI'}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
