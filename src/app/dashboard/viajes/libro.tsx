import {
  BookOpenCheck, Banknote, ReceiptText, Scale, Percent,
  FileText, HandCoins, CalendarClock, Lock,
} from 'lucide-react';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { EstadoError } from '@/app/admin/ui/kit';
import {
  rotuloFacturacion, rotuloCobro,
  type RenglonLibro, type EstadoDocumental,
} from '@/lib/likida/libro_viaje';

// ═══════════════════════════════════════════════════════════════════════════
// EL LIBRO MAYOR DEL VIAJE, EN PANTALLA.
//
// Pura props, sin estado y sin sesión: se puede mirar con fixtures bajo un
// preview temporal (CLAUDE.md §Cómo se verifica) sin montar un login. El
// criterio vive todo en `lib/likida/libro_viaje.ts`; aquí solo se pinta.
//
// ── LAS TRES REGLAS QUE ESTA VISTA NO ROMPE ───────────────────────────────
//
// 1. NINGÚN HUECO SE PINTA COMO CIFRA. Donde falta el dato no va "$0.00" ni un
//    "—" mudo: va la frase que dice qué capturar. Un guion manda al contralor a
//    adivinar en qué pantalla se teclea eso, y la respuesta que más se adivina
//    —el anticipo— es justo la equivocada.
//
// 2. LA PALABRA "UTILIDAD" NO APARECE. `ingreso − comprobado` es CONTRIBUCIÓN:
//    no resta sueldo del operador, mantenimiento, llantas, seguro,
//    depreciación, financiamiento ni administración. Un viaje puede salir con
//    contribución sana y haber perdido dinero, y eso se dice en pantalla, no en
//    un tooltip: de esa distinción dependen decisiones de tarifa.
//
// 3. EL VERDE NO SE REGALA. Una contribución positiva se pinta en tinta
//    neutra, no en verde: verde se lee como "ganaste", y esta cifra todavía no
//    puede afirmar eso. El rojo sí se usa cuando la contribución es negativa —
//    ahí el viaje ya perdió dinero ANTES de los costos fijos, y eso no admite
//    matices.
//
// ── POR QUÉ `puedeVerDinero` ES OBLIGATORIO Y NO OPCIONAL ─────────────────
//
// `/dashboard/viajes` es área `operacion` (lib/auth/visibilidad.ts), y ahí SÍ
// entra el encargado —el jefe de tráfico—, que por la matriz de la 0044 no ve
// finanzas. El 4-ago-2026 esa misma página ya le filtró los anticipos una vez.
// El motor lee con la service role, que pasa por encima del RLS de
// `ve_finanzas()`, así que la única puerta real es la de la página. Como prop
// requerida, el integrador no la puede olvidar: tiene que decidirla.
//
// Ojo al integrarlo: `dinero_por_area.test.ts` escanea SOLO `page.tsx` y
// `vista.tsx` de cada ruta de operación. Este archivo imprime `mxn(` y queda
// fuera de ese escaneo — hay que agregarlo a la superficie de la prueba, o el
// despertador queda apagado justo donde ya sonó.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = { width: 14, height: 14, strokeWidth: 1.75 } as const;

const PILL_ESTATUS: Record<string, { etiqueta: string; fg: string; bg: string }> = {
  liquidado: { etiqueta: 'Liquidado', fg: 'var(--ok)', bg: 'var(--okbg)' },
  en_cuadre: { etiqueta: 'En cuadre', fg: 'var(--warn)', bg: 'var(--warnbg)' },
  abierto: { etiqueta: 'Abierto', fg: 'var(--muted)', bg: 'var(--canvas)' },
};

/** El semáforo del respaldo fiscal. `sin_comprobantes` va neutro a propósito:
 *  un viaje que todavía no recibe fotos no es un viaje mal documentado. */
const TONO_DOCUMENTAL: Record<EstadoDocumental, { fg: string; bg: string }> = {
  sin_comprobantes: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  sin_cfdi: { fg: 'var(--bad)', bg: 'var(--badbg)' },
  parcial: { fg: 'var(--warn)', bg: 'var(--warnbg)' },
  con_cfdi: { fg: 'var(--ok)', bg: 'var(--okbg)' },
};

export function LibroDelViaje({
  renglon,
  puedeVerDinero,
}: {
  /** `null` = no se pudo leer, o el viaje no es de esta flota. */
  renglon: RenglonLibro | null;
  /** `puedeVerArea(rol, 'dinero')` de la página. Ver el encabezado. */
  puedeVerDinero: boolean;
}) {
  if (renglon === null) {
    return <EstadoError mensaje="No pude leer el libro de este viaje. Ninguna de las cifras de abajo se muestra a medias: o están todas o se dice esto." />;
  }

  const { cobro, documental } = renglon;
  const est = PILL_ESTATUS[renglon.estatus]
    ?? { etiqueta: renglon.estatus, fg: 'var(--muted)', bg: 'var(--canvas)' };

  return (
    <section className="card p-4 space-y-4">

      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
            <BookOpenCheck {...ICONO} style={{ color: 'var(--marca)' }} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold leading-tight">
              Libro del viaje {renglon.folio}
            </h2>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--faint)' }}>
              {renglon.ruta ?? 'Sin ruta capturada'}
              {renglon.fechaInicio ? ` · inició ${fechaCorta(renglon.fechaInicio)}` : ''}
            </p>
          </div>
        </div>
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
          style={{ color: est.fg, background: est.bg }}>{est.etiqueta}</span>
      </div>

      {/* ── Quién, con qué, y quién manejó ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Dato etiqueta="Cliente" valor={renglon.cliente}
          hueco="Sin cliente asignado — el viaje no se puede atribuir a nadie." />
        <Dato etiqueta="Unidad" valor={renglon.unidad}
          hueco="Sin unidad — el viaje entró por WhatsApp, que no la pregunta." />
        <Dato etiqueta="Operador" valor={renglon.operador}
          hueco="Sin operador registrado." />
      </div>

      {!puedeVerDinero ? (
        // El jefe de tráfico ve el viaje, no sus pesos. Se dice por qué, para
        // que no parezca que la pantalla está rota o que faltan datos.
        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2.5"
          style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
          <Lock {...ICONO} style={{ color: 'var(--muted)', marginTop: 2 }} />
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            El ingreso del flete, la contribución y la cobranza de este viaje son cifras de
            finanzas, y tu rol no las ve. Lo de arriba y el estado de comprobantes sí son tuyos.
          </p>
        </div>
      ) : (
        <>
          {/* ── ¿Ganó dinero? ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Cifra
              icono={<Banknote {...ICONO} />}
              etiqueta="Ingreso del flete"
              valor={renglon.ingreso === null ? null : mxn(renglon.ingreso)}
              hueco="Sin registrar"
            />
            <Cifra
              icono={<ReceiptText {...ICONO} />}
              etiqueta="Gastos comprobados"
              valor={renglon.comprobado === null ? null : mxn(renglon.comprobado)}
              hueco="Sin liquidación"
            />
            <Cifra
              icono={<Scale {...ICONO} />}
              etiqueta="Contribución"
              valor={renglon.contribucion === null ? null : mxn(renglon.contribucion)}
              hueco="No se calcula"
              // Verde no: "positiva" todavía no significa "ganó". Rojo sí:
              // negativa ya perdió antes de los costos fijos.
              tono={renglon.contribucion !== null && renglon.contribucion < 0 ? 'bad' : undefined}
            />
            <Cifra
              icono={<Percent {...ICONO} />}
              etiqueta="Margen de contribución"
              valor={renglon.margenPct === null ? null : `${numero(renglon.margenPct)}%`}
              hueco="No se calcula"
              tono={renglon.margenPct !== null && renglon.margenPct < 0 ? 'bad' : undefined}
            />
          </div>

          {/* QUÉ falta. Sin esto, las dos celdas de arriba son un guion mudo. */}
          {renglon.falta && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>{renglon.falta}</p>
          )}

          {/* La aclaración va en la pantalla, no en un tooltip: es la
              diferencia entre "este viaje dejó dinero" y "este viaje dejó
              dinero ANTES de pagarle al operador y al taller". */}
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            Contribución NO es utilidad: es el ingreso menos lo que se comprobó en el viaje.
            Todavía no resta sueldo del operador, mantenimiento, llantas, seguro, depreciación,
            financiamiento ni administración. Un viaje puede salir con contribución sana y aun
            así haber perdido dinero — para eso hace falta tu costo por kilómetro, que Likida
            no conoce.
          </p>

          {/* ── Facturación y cobranza ────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Dato
              icono={<FileText {...ICONO} />}
              etiqueta="Facturado"
              valor={rotuloFacturacion(cobro.estadoFacturacion)}
              nota={cobro.totalFacturado === null ? undefined : mxn(cobro.totalFacturado)}
            />
            <Dato
              icono={<HandCoins {...ICONO} />}
              etiqueta="Cobrado"
              valor={rotuloCobro(cobro.estadoCobro)}
              nota={cobro.totalCobrado === null
                ? undefined
                : `${mxn(cobro.totalCobrado)}${cobro.saldo === null ? '' : ` · saldo ${mxn(cobro.saldo)}`}`}
            />
            <Dato
              icono={<CalendarClock {...ICONO} />}
              etiqueta="Días por cobrar"
              valor={cobro.diasPorCobrar === null
                ? null
                : cobro.diasPorCobrar === 1 ? '1 día' : `${numero(cobro.diasPorCobrar)} días`}
              hueco={cobro.estadoCobro === 'cobrado' ? 'Ya se cobró' : 'Nada por cobrar todavía'}
              nota={cobro.diasVencida === null
                ? undefined
                : cobro.diasVencida === 1 ? 'venció ayer' : `venció hace ${numero(cobro.diasVencida)} días`}
              tono={cobro.diasVencida === null ? undefined : 'bad'}
            />
          </div>

          {/* Las dos salvedades que hacen que las cifras de arriba NO sean
              del viaje, o que no haya vencimiento que reclamar. */}
          {cobro.importesCompartidos && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              Una de estas facturas ampara más viajes que éste, así que los importes de
              facturación y cobro son de la factura completa, no de este viaje. Likida no los
              reparte: no hay en el sistema cuánto de la factura corresponde a cada viaje.
            </p>
          )}
          {cobro.sinCondiciones && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Hay factura sin fecha de vencimiento porque su cliente no tiene días de crédito
              pactados. No se cuenta como vencida: no se pactó cuándo.
            </p>
          )}
        </>
      )}

      {/* ── Estado documental ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
          Estado documental
        </span>
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ color: TONO_DOCUMENTAL[documental.estado].fg, background: TONO_DOCUMENTAL[documental.estado].bg }}>
          {documental.rotulo}
        </span>
      </div>

      {/* ── Observaciones fiscales ────────────────────────────────── */}
      {puedeVerDinero && (
        <div className="space-y-2">
          <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>
            Observaciones fiscales
          </span>
          {renglon.observaciones === null ? (
            // "No hay liquidación" NO es "salió limpia". Son dos frases porque
            // son dos situaciones, y la segunda es una afirmación fiscal.
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Este viaje todavía no tiene liquidación, así que el motor no lo ha revisado. No
              es que no tenga observaciones: es que nadie lo ha cuadrado.
            </p>
          ) : renglon.observaciones.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--ok)' }}>
              El motor cuadró este viaje y no levantó ninguna observación.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {renglon.observaciones.map((o, i) => (
                <li key={`${o.tipo}-${i}`} className="flex items-start justify-between gap-3 rounded-lg px-2.5 py-2"
                  style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
                  <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {/* Sin frase del motor se enseña su código, no una
                        redacción inventada aquí: el código es rastreable. */}
                    {o.nota ?? o.tipo}
                  </span>
                  {o.monto !== null && o.monto > 0 && (
                    <span className="text-[12px] tabular font-medium whitespace-nowrap">{mxn(o.monto)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Un dato de texto con su hueco declarado. `valor === null` pinta el hueco en
 *  gris tenue, nunca un guion solo. */
function Dato({ icono, etiqueta, valor, hueco, nota, tono }: {
  icono?: React.ReactNode;
  etiqueta: string;
  valor: string | null;
  hueco?: string;
  nota?: string;
  tono?: 'bad' | 'warn';
}) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0"
      style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
      <div className="flex items-center gap-1.5">
        {icono && <span style={{ color: 'var(--faint)' }}>{icono}</span>}
        <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      </div>
      <div className="text-[13px] font-medium mt-1"
        style={valor === null ? { color: 'var(--faint)', fontWeight: 400 } : tono ? { color: `var(--${tono})` } : undefined}>
        {valor ?? hueco ?? 'Sin registrar'}
      </div>
      {nota && (
        <div className="text-[11px] mt-0.5" style={{ color: tono ? `var(--${tono})` : 'var(--faint)' }}>{nota}</div>
      )}
    </div>
  );
}

/** Una cifra de dinero. Misma regla que `Dato`: el hueco se escribe, no se
 *  rellena con $0.00 — un cero de encuadre se lee igual que un cero medido. */
function Cifra({ icono, etiqueta, valor, hueco, tono }: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: string | null;
  hueco: string;
  tono?: 'bad' | 'warn';
}) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0"
      style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
      <div className="flex items-center gap-1.5">
        <span style={{ color: 'var(--faint)' }}>{icono}</span>
        <span className="etiqueta-mono text-[10px] uppercase line-clamp-2" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      </div>
      {valor === null ? (
        <div className="text-[13px] mt-1" style={{ color: 'var(--faint)' }}>{hueco}</div>
      ) : (
        <div className="cifra-mono text-[18px] font-medium mt-1 tabular"
          style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      )}
    </div>
  );
}
