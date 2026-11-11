import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import {
  FileText, Banknote, Wallet, CalendarClock, HandCoins, TriangleAlert, Truck, ClipboardCheck,
} from 'lucide-react';
import type {
  FacturacionClientes, RenglonCartera, ClienteCartera, RenglonSinFacturar,
} from '@/lib/likida/facturacion_clientes';
import { CUBETAS_AUDITOR, type AuditoriaCobranza, type CubetaAuditor } from '@/lib/likida/auditor_cobranza';
import { EstadoVacio, EstadoError } from '../estados';

// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta. Se usa `fechaMx` (CON
// año) y no `fechaCorta` en toda la pantalla a propósito: su propio comentario
// dice que el año se omite cuando "ya es obvio por contexto", y en una cartera
// por antigüedad no lo es — la cubeta de "más de 60 días" cruza meses y en
// enero cruza el año, que es justo cuando el corte importa.
import { mxn, numero, fechaMx } from '@/lib/formato';
import {
  FormaFactura, FormaPago, FormaEmitir, FormaCancelar, Plegable, type AccionForma,
} from './forma';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { AvisoCompacto, MarcoPagina, TituloRecuadro } from '@/app/ui-v2/componentes';

/** Lo que la página inyecta para que la pantalla además CAPTURE. Opcional a
 *  propósito: sin esto la vista sigue siendo pura-props y se puede mirar con
 *  fixtures sin sesión, igual que siempre. */
export interface CapturaFacturacion {
  /** `null` = la lectura del catálogo falló, distinto de `[]` = no hay ninguno
   *  (AUDITORÍA 22, FE-1). Mismo criterio que `auditoria` más abajo. */
  clientes: ReadonlyArray<{ id: string; nombre: string; diasCredito: number | null }> | null;
  /** `YYYY-MM-DD` en hora de México, para los defaults de fecha. */
  hoy: string;
  factura: AccionForma;
  pago: AccionForma;
  emitir: AccionForma;
  cancelar: AccionForma;
}

/**
 * FACTURACIÓN A CLIENTES — el link que el sidebar pintaba y daba 404.
 *
 * La ruta llevaba días declarada en `rutas.ts` y clasificada como área `dinero`
 * en `visibilidad.ts`, y la página no existía. Ésta es la pantalla, y contesta
 * cuatro preguntas y nada más:
 *
 *   · qué facturé y a quién,
 *   · cuánto me deben y DESDE HACE CUÁNTO (corriente / 1-30 / 31-60 / más de 60),
 *   · qué está vencido de verdad,
 *   · qué viajes ya se liquidaron y nadie facturó — el dinero en la mesa.
 *
 * TRES ESTADOS POR BLOQUE, como en Rentabilidad y Clientes: dato real, vacío que
 * dice QUÉ lo enciende, o el error DICHO. Lo que no se hace en ninguno de los
 * tres es rellenar con un cero: `factura_emitida` está vacía en todas las flotas
 * hoy, y una pantalla de cobranza en $0.00 se lee como "no te deben nada", que
 * es una medición — y es falsa.
 *
 * Pura props a propósito, para poder mirarla con fixtures sin sesión.
 */
export function VistaFacturacion({ datos, captura = null, auditoria = null, tr = trEs }: {
  datos: FacturacionClientes | null;
  captura?: CapturaFacturacion | null;
  /** El cruce pactado/entregado/facturado/cobrado (auditor_cobranza.ts).
   *  `null` = su lectura falló; la sección pinta el error dicho, no un cero. */
  auditoria?: AuditoriaCobranza | null; tr?: Tr;
}) {
  return (
    <MarcoPagina titulo={tr('facturacion.vista.facturacionAClientes')} apoyo={tr('facturacion.vista.facturasEmitidasSusPagos')}>
      {datos === null ? (
        <EstadoError mensaje={tr('facturacion.vista.noPudeLeerTus')} />
      ) : datos.cartera.facturas.length === 0 && datos.viajesLiquidados === 0 ? (
        // El estado en el que abre una flota nueva: las tablas de la 0049
        // existen y están vacías. Se dice qué las llena, no se pintan
        // ceros — y desde el hallazgo A1 (auditoría 4), la captura que las
        // llena vive AQUÍ MISMO, no en una promesa.
        <>
          <EstadoVacio icono={<FileText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            {rico(tr('facturacion.vista.estaPantallaTrabajaCon'), { strong: (c) => <strong>{c}</strong>, strong2: (c) => <strong>{c}</strong> })}
          </EstadoVacio>
          {captura && (
            <div className="card p-4">
              <Plegable resumen="＋ Registrar una factura emitida">
                <FormaFactura accion={captura.factura} clientes={captura.clientes}
                  viajesSinFacturar={[]} hoy={captura.hoy} />
              </Plegable>
            </div>
          )}
          {/* Una flota sin facturas puede tener hallazgos IGUAL: el
              entregado-sin-facturar existe justamente antes de la primera
              factura. Si el auditor encontró algo, se enseña aquí también. */}
          {auditoria !== null && auditoria.cola.length > 0 && <BloqueAuditor tr={tr} auditoria={auditoria} />}
        </>
      ) : (
        <>
          <BloqueCartera tr={tr} datos={datos} captura={captura} />
          <BloqueEnLaMesa tr={tr} datos={datos} />
          <BloqueAuditor tr={tr} auditoria={auditoria} />
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {rico(tr('facturacion.vista.todoLoDeEsta', { v: fechaMx(datos.hoy) }), { strong: (c) => <strong>{c}</strong> })}
          </p>
        </>
      )}
    </MarcoPagina>
  );
}

/** "1 factura" / "14 facturas". El "(s)" de paréntesis se lee como plantilla
 *  sin terminar, y esta pantalla la lee un contralor. */
function plural(n: number, uno: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

// ── La cartera ─────────────────────────────────────────────────────────────

function BloqueCartera({ datos, captura, tr = trEs }: { datos: FacturacionClientes; captura: CapturaFacturacion | null; tr?: Tr }) {
  const c = datos.cartera;

  return (
    <section className="space-y-3">
      <TituloRecuadro info="facturacion.cartera">{tr('facturacion.vista.loQueFacturasteY')}</TituloRecuadro>

      {captura && (
        <div className="card p-4">
          <Plegable resumen="＋ Registrar una factura emitida">
            <FormaFactura accion={captura.factura} clientes={captura.clientes}
              viajesSinFacturar={datos.enLaMesa.viajes} hoy={captura.hoy} />
          </Plegable>
        </div>
      )}

      {c.facturas.length === 0 ? (
        <EstadoVacio icono={<Banknote width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {tr('facturacion.vista.todaviaNoHayUna')}
        </EstadoVacio>
      ) : (
        <>
          <TiraCifras sello={selloHoy(tr('facturacion.vista.selloFacturasEmitidas'))}>
            <Cifra
              icono={<FileText width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.facturadoAClientes')} info="facturacion.facturado" valor={c.facturado} formato="mxn"
              nota={`De ${plural(c.vivas, tr('facturacion.vista.facturaEmitida'), tr('facturacion.vista.facturasEmitidas'))}`}
            />
            <Cifra
              icono={<HandCoins width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.cobrado')} info="facturacion.cobrado" valor={c.cobrado} formato="mxn"
              nota={tr('facturacion.vista.sumaDeLosPagos')}
            />
            <Cifra
              icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.porCobrar')} info="facturacion.por_cobrar" valor={c.porCobrar} formato="mxn"
              nota={tr('facturacion.vista.saldoVivoNoIncluye')}
            />
            <Cifra
              icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.vencido')} info="facturacion.vencido" valor={c.vencido} formato="mxn"
              nota={c.vencido > 0
                ? tr('facturacion.vista.saldoQueYaPaso')
                : tr('facturacion.vista.nadaHaPasadoDe')}
            />
          </TiraCifras>

          <TablaCubetas tr={tr} datos={datos} />

          {c.sinCondiciones > 0 && (
            <AvisoCompacto tono="warn"
              resumen={c.sinCondiciones === 1
                ? tr('facturacion.vista.1FacturaConSaldo')
                : tr('facturacion.vista.facturasConSaldoNo', { v: numero(c.sinCondiciones) })}
              mas={tr('facturacion.vista.noEntranALo')} />
          )}

          <TablaClientes tr={tr} clientes={c.clientes} />
          <TablaFacturas tr={tr} facturas={c.facturas} captura={captura} />

          {/* RECORTAR LA LISTA ESTÁ BIEN; RECORTAR LA CIFRA SIN DECIRLO, NO.
              Desde la 0152 la tabla trae a lo más 100 renglones —las más
              vencidas primero—, mientras que las cubetas, el por cobrar y el
              corte por cliente son de TODAS. Sin este renglón, quien cuente
              las filas y las sume no cuadraría contra las tarjetas de arriba
              y descartaría la tabla entera. */}
          {c.facturasTotal > c.facturas.length && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {tr('facturacion.vista.seListanLasMas', { v: numero(c.facturas.length), v2: numero(c.facturasTotal) })}
            </p>
          )}

          {(c.borradores > 0 || c.canceladas > 0) && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {c.borradores > 0 && tr('facturacion.vista.yNoSumaAl', { v: plural(c.borradores, tr('facturacion.vista.facturaEstaEnBorrador'), tr('facturacion.vista.facturasEstanEnBorrador')) }) + ' '}
              {c.canceladas > 0 && tr('facturacion.vista.dineroQueAlguienDeba', { v: plural(c.canceladas, tr('facturacion.vista.facturaCanceladaNoEs'), tr('facturacion.vista.facturasCanceladasNoSon')) })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** La antigüedad de saldos. El renglón de total existe para que el contralor
 *  pueda comprobar de un vistazo que las cubetas cuadran con el por cobrar —
 *  es la única prueba que le puede hacer a esta tabla sin abrir nada. */
function TablaCubetas({ datos, tr = trEs }: { datos: FacturacionClientes; tr?: Tr }) {
  const c = datos.cartera;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {tr('facturacion.vista.antiguedadDeSaldos')}
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.cubeta')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.facturas')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.saldo')}</th>
          </tr>
        </thead>
        <tbody>
          {c.cubetas.map((b) => (
            <tr key={b.clave} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-3 py-2">
                <span className="font-medium" style={{ color: b.clave === 'sin_fecha' ? 'var(--warn)' : undefined }}>
                  {b.rotulo}
                </span>
                <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{b.ayuda}</span>
              </td>
              <td className="px-3 py-2 text-right tabular" style={{ color: b.facturas === 0 ? 'var(--faint)' : undefined }}>
                {b.facturas === 0 ? '—' : numero(b.facturas)}
              </td>
              <td className="px-3 py-2 text-right tabular font-medium" style={{ color: b.facturas === 0 ? 'var(--faint)' : undefined }}>
                {b.facturas === 0 ? '—' : mxn(b.saldo)}
              </td>
            </tr>
          ))}
          <tr className="border-t" style={{ borderColor: 'var(--line)' }}>
            <td className="px-3 py-2 font-medium">{tr('facturacion.vista.totalPorCobrar')}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right tabular font-semibold">{mxn(c.porCobrar)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TablaClientes({ clientes, tr = trEs }: { clientes: ClienteCartera[]; tr?: Tr }) {
  if (clientes.length === 0) return null;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {tr('facturacion.vista.porClienteAQuien')}
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.cliente')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.facturado')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.cobrado')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.porCobrar')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.corriente')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">1-30</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">31-60</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">+60</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.sinFecha')}</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.cliente} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-3 py-2">
                <span className="font-medium">{c.cliente}</span>
                <span className="block text-[11px]" style={{ color: c.diasMasVencido === null ? 'var(--faint)' : 'var(--bad)' }}>
                  {c.diasMasVencido === null
                    ? tr('facturacion.vista.nadaVencido', { v: plural(c.facturas, 'factura', 'facturas') })
                    : tr('facturacion.vista.loMasAtrasadoDias', { v: plural(c.facturas, 'factura', 'facturas'), v2: numero(c.diasMasVencido) })}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular">{mxn(c.facturado)}</td>
              <td className="px-3 py-2 text-right tabular">{mxn(c.cobrado)}</td>
              <td className="px-3 py-2 text-right tabular font-medium">{mxn(c.saldo)}</td>
              <Celda monto={c.porCubeta.corriente} />
              <Celda monto={c.porCubeta.v1_30} atrasado />
              <Celda monto={c.porCubeta.v31_60} atrasado />
              <Celda monto={c.porCubeta.v60_mas} atrasado />
              <Celda monto={c.porCubeta.sin_fecha} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un cero de cubeta se pinta como "—". Es un cero MEDIDO (ese cliente no debe
 *  nada en ese tramo), pero nueve columnas de "$0.00" ahogan las tres cifras
 *  que sí piden una llamada. */
function Celda({ monto, atrasado = false }: { monto: number; atrasado?: boolean }) {
  return (
    <td className="px-3 py-2 text-right tabular"
      style={{ color: monto === 0 ? 'var(--faint)' : atrasado ? 'var(--bad)' : undefined }}>
      {monto === 0 ? '—' : mxn(monto)}
    </td>
  );
}

const pillEstatus = (tr: Tr): Record<string, { rotulo: string; fg: string; bg: string }> => ({
  borrador: { rotulo: tr('facturacion.vista.borrador'), fg: 'var(--muted)', bg: 'var(--canvas)' },
  cancelada: { rotulo: tr('facturacion.vista.cancelada'), fg: 'var(--muted)', bg: 'var(--canvas)' },
});
function TablaFacturas({ facturas, captura, tr = trEs }: { facturas: RenglonCartera[]; captura: CapturaFacturacion | null; tr?: Tr }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {tr('facturacion.vista.facturasEmitidas2')}
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.folio')}</th>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.cliente')}</th>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.fecha')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.total')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.pagado')}</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.saldo')}</th>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.vence')}</th>
            <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.antiguedad')}</th>
            {captura && <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.acciones')}</th>}
          </tr>
        </thead>
        <tbody>
          {facturas.map((f) => <RenglonFactura tr={tr} key={f.id} f={f} captura={captura} />)}
        </tbody>
      </table>
    </div>
  );
}

/** Qué se le puede hacer a cada factura, según su estado REAL:
 *  borrador → sellarla con su UUID, o cancelarla;
 *  emitida con saldo → abonarle pagos; sin pagos aún → también cancelarla;
 *  pagada o cancelada → nada, y la celda lo dice con un guion. */
function CeldaAcciones({ f, captura }: { f: RenglonCartera; captura: CapturaFacturacion }) {
  const esBorrador = f.estatus === 'borrador';
  const puedeAbonar = f.viva && f.estatus === 'emitida' && f.conSaldo;
  // El borrador NO es "viva" (no entra a la cartera) y aun así se puede
  // cancelar: un borrador capturado por error no tiene otra salida.
  const puedeCancelar = (f.viva || esBorrador) && f.pagado === 0;
  if (!esBorrador && !puedeAbonar && !puedeCancelar) {
    return <td className="px-3 py-2" style={{ color: 'var(--faint)' }}>—</td>;
  }
  return (
    <td className="px-3 py-2 space-y-1.5 min-w-[220px]">
      {esBorrador && (
        <Plegable resumen="Marcar emitida">
          <FormaEmitir accion={captura.emitir} facturaId={f.id} folioActual={f.folio} />
        </Plegable>
      )}
      {puedeAbonar && (
        <Plegable resumen="Registrar pago">
          <FormaPago accion={captura.pago} facturaId={f.id} hoy={captura.hoy} />
        </Plegable>
      )}
      {puedeCancelar && (
        <Plegable resumen="Cancelar">
          <FormaCancelar accion={captura.cancelar} facturaId={f.id} />
        </Plegable>
      )}
    </td>
  );
}

function RenglonFactura({ f, captura, tr = trEs }: { f: RenglonCartera; captura: CapturaFacturacion | null; tr?: Tr }) {
  const pill = pillEstatus(tr)[f.estatus];
  // El color sale del MISMO criterio que el rótulo de la derecha, y por eso
  // exige las tres condiciones: viva, con saldo y vencida. Se vio mirando el
  // render — con solo `diasVencida !== null`, una factura PAGADA en mayo salía
  // con su "$0.00" en rojo junto a la palabra "saldada", y una CANCELADA con
  // sus $61,000 en rojo junto a "no entra a la cartera". Un renglón que se
  // contradice consigo mismo tira la confianza en la tabla entera.
  const rojo = f.viva && f.conSaldo && f.antiguedad.diasVencida !== null;

  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2">
        <span className="cifra-mono">{f.folio ?? '—'}</span>
        {pill && (
          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-medium align-middle"
            style={{ color: pill.fg, background: pill.bg }}>
            {pill.rotulo}
          </span>
        )}
      </td>
      <td className="px-3 py-2">{f.cliente}</td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaMx(f.fecha)}</td>
      <td className="px-3 py-2 text-right tabular">{mxn(f.total)}</td>
      <td className="px-3 py-2 text-right tabular">{mxn(f.pagado)}</td>
      <td className="px-3 py-2 text-right tabular font-medium" style={{ color: rojo ? 'var(--bad)' : undefined }}>
        {mxn(f.saldo)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: f.venceEn === null ? 'var(--faint)' : 'var(--muted)' }}>
        {f.venceEn === null ? tr('facturacion.vista.sinCondiciones') : fechaMx(f.venceEn)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {!f.viva ? (
          <span style={{ color: 'var(--faint)' }}>{tr('facturacion.vista.noEntraALa')}</span>
        ) : !f.conSaldo ? (
          <span style={{ color: 'var(--ok)' }}>{tr('facturacion.vista.saldada')}</span>
        ) : (
          <span style={{ color: rojo ? 'var(--bad)' : f.antiguedad.cubeta === 'sin_fecha' ? 'var(--warn)' : 'var(--muted)' }}>
            {f.antiguedad.rotulo}
          </span>
        )}
      </td>
      {captura && <CeldaAcciones f={f} captura={captura} />}
    </tr>
  );
}

// ── El dinero en la mesa ───────────────────────────────────────────────────

function BloqueEnLaMesa({ datos, tr = trEs }: { datos: FacturacionClientes; tr?: Tr }) {
  const m = datos.enLaMesa;

  return (
    <section className="space-y-3">
      <TituloRecuadro info="facturacion.en_la_mesa">{tr('facturacion.vista.viajesLiquidadosQueNadie')}</TituloRecuadro>

      {datos.viajesLiquidados === 0 ? (
        <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {tr('facturacion.vista.todaviaNoHayUn')}
        </EstadoVacio>
      ) : m.total === 0 ? (
        // No es un cero disfrazado: se comprobaron los N liquidados y todos
        // tienen factura viva. Se dice el denominador para que se pueda creer.
        <p className="text-[12px]" style={{ color: 'var(--ok)' }}>
          {datos.viajesLiquidados === 1
            ? tr('facturacion.vista.elUnicoViajeLiquidado')
            : tr('facturacion.vista.losViajesLiquidadosYa', { v: numero(datos.viajesLiquidados) })}
          {' '}{tr('facturacion.vista.noHayDineroEsperando')}
        </p>
      ) : (
        <>
          <TiraCifras sello={selloHoy(tr('facturacion.vista.selloLiquidadosSinFactura'))}>
            <Cifra
              icono={<Truck width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.viajesLiquidadosSinFactura')} info="facturacion.sin_factura" valor={m.total} formato="numero"
              nota={tr('facturacion.vista.deEnTotal', { v: plural(datos.viajesLiquidados, tr('facturacion.vista.viajeLiquidado'), tr('facturacion.vista.viajesLiquidados')) })}
            />
            <Cifra
              icono={<Banknote width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.ingresoCapturadoSinFacturar')} info="facturacion.ingreso_sin_facturar" valor={m.ingresoCapturado} formato="mxn"
              nota={m.sinIngreso === 0
                ? tr('facturacion.vista.todosTraenSuIngreso')
                : m.sinIngreso === 1
                  ? tr('facturacion.vista.1ViajeNoTrae')
                  : tr('facturacion.vista.viajesNoTraenIngreso', { v: numero(m.sinIngreso) })}
            />
            {/* Sin una sola fecha de cierre NO se pinta un "0" grande con la aclaración abajo: la cifra es lo que se lee, y ese 0
                diría "se liquidaron hoy". La cifra queda sin dato y lo explica. */}
            {m.diasMasViejo === null ? (
              <Cifra
                icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
                etiqueta={tr('facturacion.vista.elMasViejoSin')} info="facturacion.mas_viejo" valor={null}
                mensaje={tr('facturacion.vista.ningunoDeEstosViajes')}
              />
            ) : (
              <Cifra
                icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
                etiqueta={tr('facturacion.vista.elMasViejoSin')} info="facturacion.mas_viejo"
                valor={m.diasMasViejo} formato="numero"
                nota={tr('facturacion.vista.diasDesdeQueSe')}
              />
            )}
          </TiraCifras>

          {m.sinIngreso > 0 && (
            <AvisoCompacto tono="warn"
              resumen={<>{tr('facturacion.vista.laCifraDeArriba', { v: plural(m.sinIngreso, tr('facturacion.vista.viajeNoTiene'), tr('facturacion.vista.viajesNoTienen')) })}</>}
              mas={tr('facturacion.vista.unViajeSinEse')} />
          )}

          <div className="card overflow-x-auto">
            <table aria-label={tr('facturacion.vista.viajesPorFacturar')} className="w-full text-[12px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.viaje')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.ruta')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.cliente')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.liquidado')}</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.sinFacturar')}</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.ingreso')}</th>
                </tr>
              </thead>
              <tbody>
                {m.viajes.map((v) => <RenglonMesa tr={tr} key={v.viajeId} v={v} />)}
              </tbody>
            </table>
          </div>

          {m.viajes.length < m.total && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {tr('facturacion.vista.seListanLosMas', { v: numero(m.viajes.length), v2: numero(m.total), v3: numero(m.total) })}
            </p>
          )}

          {m.conBorrador > 0 && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {tr('facturacion.vista.unaFacturaEnBorrador', { v: plural(m.conBorrador, tr('facturacion.vista.deEstosViajesYa'), tr('facturacion.vista.deEstosViajesYa2')) })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function RenglonMesa({ v, tr = trEs }: { v: RenglonSinFacturar; tr?: Tr }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2">
        <span className="cifra-mono">{v.folio}</span>
        {v.soloBorrador && (
          <span className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: 'var(--warn)' }}>
            <TriangleAlert width={11} height={11} strokeWidth={1.75} className="shrink-0" />
            {tr('facturacion.vista.tieneFacturaEnBorrador')}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {v.ruta ?? <span style={{ color: 'var(--faint)' }}>{tr('facturacion.vista.sinRutaCapturada')}</span>}
      </td>
      <td className="px-3 py-2">
        {v.cliente ?? <span style={{ color: 'var(--warn)' }}>{tr('facturacion.vista.sinAsignar')}</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {v.liquidadoEn === null
          ? <span style={{ color: 'var(--faint)' }}>{tr('facturacion.vista.sinFechaDeCierre')}</span>
          : fechaMx(v.liquidadoEn)}
      </td>
      <td className="px-3 py-2 text-right tabular">
        {/* Sin fecha de cierre no hay días que contar, y un 0 se leería como
            "se liquidó hoy" — la lectura más tranquilizadora posible sobre el
            renglón del que menos se sabe. */}
        {v.diasSinFacturar === null
          ? <span style={{ color: 'var(--faint)' }}>—</span>
          : <span style={{ color: v.diasSinFacturar > 30 ? 'var(--bad)' : undefined }}>
            {tr('facturacion.vista.dias', { v: numero(v.diasSinFacturar) })}
          </span>}
      </td>
      <td className="px-3 py-2 text-right tabular font-medium">
        {v.ingreso === null
          ? <span className="text-[11px] font-normal" style={{ color: 'var(--warn)' }}>{tr('facturacion.vista.sinCapturar')}</span>
          : mxn(v.ingreso)}
      </td>
    </tr>
  );
}

// ── El auditor de cobranza — el cruce pactado / entregado / facturado / cobrado ──

/** Cuántos hallazgos se listan. El TOTAL siempre se dice aparte: recortar la
 *  lista está bien, recortar la cifra sin decirlo no. */
const LIMITE_COLA_AUDITOR = 25;

const ROTULO_CUBETA: Record<CubetaAuditor, { rotulo: string; ayuda: string }> = Object.fromEntries(
  CUBETAS_AUDITOR.map((c) => [c.clave, { rotulo: c.rotulo, ayuda: c.ayuda }]),
) as Record<CubetaAuditor, { rotulo: string; ayuda: string }>;

function BloqueAuditor({ auditoria, tr = trEs }: { auditoria: AuditoriaCobranza | null; tr?: Tr }) {
  return (
    <section className="space-y-3">
      <TituloRecuadro info="facturacion.auditor">{tr('facturacion.vista.auditorDeCobranzaLo')}</TituloRecuadro>

      {auditoria === null ? (
        <EstadoError mensaje={tr('facturacion.vista.noPudeCruzarLos')} />
      ) : auditoria.resumen.viajesAuditados === 0 ? (
        <EstadoVacio icono={<ClipboardCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {tr('facturacion.vista.noHuboViajesVentana', { desde: fechaMx(auditoria.desde), hasta: fechaMx(auditoria.hasta) })}
          {auditoria.viajesSinFecha > 0 && (
            <>{' '}{auditoria.viajesSinFecha === 1
              ? tr('facturacion.vista.ojoSinFechaUno')
              : tr('facturacion.vista.ojoSinFechaVarios', { n: numero(auditoria.viajesSinFecha) })}</>
          )}
        </EstadoVacio>
      ) : (
        <>
          <TiraCifras sello={selloHoy(tr('facturacion.vista.auditoriaDeFacturacion'))}>
            <Cifra
              icono={<Truck width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.dineroDormido')} info="facturacion.dinero_dormido" valor={auditoria.resumen.dineroDormido} formato="mxn"
              nota={auditoria.resumen.dormidosSinMonto > 0
                ? tr('facturacion.vista.entregadoYSinFacturar', { v: plural(auditoria.resumen.dormidosSinMonto, tr('facturacion.vista.entregaMasNoTiene'), tr('facturacion.vista.entregasMasNoTienen')) })
                : tr('facturacion.vista.viajesConEntregaProbada')}
            />
            <Cifra
              icono={<TriangleAlert width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.facturadoDeMenos')} info="facturacion.facturado_de_menos" valor={auditoria.resumen.brechaFacturadoDeMenos} formato="mxn"
              nota={tr('facturacion.vista.laBrechaEntreLo')}
            />
            <Cifra
              icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
              etiqueta={tr('facturacion.vista.margenRealMedido')} info="facturacion.margen_medido" valor={auditoria.resumen.margen.margen} formato="mxn"
              nota={auditoria.resumen.margen.viajesMedidos > 0
                ? tr('facturacion.vista.pactadoMenosGastosLiquidados', { v: auditoria.resumen.margen.margenPct === null ? '' : `${numero(auditoria.resumen.margen.margenPct)}% · `, v2: plural(auditoria.resumen.margen.viajesMedidos, tr('facturacion.vista.viajeMedido'), tr('facturacion.vista.viajesMedidos')), v3: numero(auditoria.resumen.margen.viajesSinDato) })
                : tr('facturacion.vista.ningunViajeDeLa')}
            />
          </TiraCifras>

          {auditoria.cola.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {tr('facturacion.vista.losViajesDeLa', { v: numero(auditoria.resumen.viajesAuditados) })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {CUBETAS_AUDITOR.filter((c) => auditoria.resumen.porCubeta[c.clave] > 0).map((c) => (
                  <span key={c.clave} title={c.ayuda}
                    className="text-[11px] px-2 py-0.5 rounded-full hairline"
                    style={{ color: 'var(--muted)' }}>
                    {c.rotulo} · {numero(auditoria.resumen.porCubeta[c.clave])}
                  </span>
                ))}
              </div>

              <div className="card overflow-x-auto">
                <table aria-label={tr('facturacion.vista.viajesFacturadosPorCliente')} className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[11px]" style={{ color: 'var(--faint)' }}>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.viaje')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.cliente')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.hallazgo')}</th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">{tr('facturacion.vista.enJuego')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('facturacion.vista.laNotaCitable')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditoria.cola.slice(0, LIMITE_COLA_AUDITOR).map((h) => (
                      <tr key={`${h.viajeId}-${h.cubeta}`} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-3 py-2">
                          <span className="cifra-mono">{h.folio}</span>
                          {h.ruta && <div className="text-[11px]" style={{ color: 'var(--faint)' }}>{h.ruta}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {h.cliente ?? <span style={{ color: 'var(--warn)' }}>{tr('facturacion.vista.sinAsignar')}</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{ROTULO_CUBETA[h.cubeta].rotulo}</td>
                        <td className="px-3 py-2 text-right tabular font-medium">
                          {/* Sin monto resoluble no se inventa uno: la nota dice qué falta. */}
                          {h.monto === null ? <span style={{ color: 'var(--faint)' }}>—</span> : mxn(h.monto)}
                        </td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>{h.nota}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {auditoria.cola.length > LIMITE_COLA_AUDITOR && (
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  {tr('facturacion.vista.seListanLosHallazgos', { v: numero(LIMITE_COLA_AUDITOR), v2: numero(auditoria.cola.length) })}
                </p>
              )}
            </>
          )}

          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {rico(tr('facturacion.vista.ventanaAuditada', { desde: fechaMx(auditoria.desde), hasta: fechaMx(auditoria.hasta), hoy: fechaMx(auditoria.hoy) }), { strong: (c) => <strong>{c}</strong> })}
            {auditoria.viajesSinFecha > 0 && (
              <>{' '}{auditoria.viajesSinFecha === 1
                ? tr('facturacion.vista.sinFechaUno')
                : tr('facturacion.vista.sinFechaVarios', { n: numero(auditoria.viajesSinFecha) })}</>
            )}
            {' '}{tr('facturacion.vista.esteAuditorProponeLa')}
          </p>
        </>
      )}
    </section>
  );
}
