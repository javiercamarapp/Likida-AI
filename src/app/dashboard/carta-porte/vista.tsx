import { ScrollText, TriangleAlert, CircleCheck, CircleHelp } from 'lucide-react';
import type { EstadoCartaPorte, ViajeCcp } from '@/lib/likida/carta_porte_datos';
import type { EstadoCampoCcp } from '@/lib/likida/carta_porte';
import { AVISO_VALOR_MERCANCIA } from '@/lib/likida/relojes_legales';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { numero } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import { FormaDeclaracion, type AccionForma } from './forma';

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
export function VistaCartaPorte({ datos, declarar = null }: {
  datos: EstadoCartaPorte | null;
  declarar?: AccionForma | null;
}) {
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
              {datos.viajes.map((v) => <TarjetaViaje key={v.viajeId} v={v} declarar={declarar} />)}
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

function TarjetaViaje({ v, declarar }: { v: ViajeCcp; declarar: AccionForma | null }) {
  const pill = PILL[v.decision.necesita];
  const c = v.checklist;
  const listos = 18 - c.faltanTransportista;

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

      {declarar && (
        <details>
          <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
            style={{ color: 'var(--marca)' }}>
            Declarar la ruta de este viaje
          </summary>
          <div className="pt-3">
            <FormaDeclaracion accion={declarar} viajeId={v.viajeId} inicial={v.declarado} />
          </div>
        </details>
      )}
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
