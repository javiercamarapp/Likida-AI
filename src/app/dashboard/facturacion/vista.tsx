import {
  FileText, Banknote, Wallet, CalendarClock, HandCoins, TriangleAlert, Truck, ClipboardCheck,
} from 'lucide-react';
import type {
  FacturacionClientes, RenglonCartera, ClienteCartera, RenglonSinFacturar,
} from '@/lib/likida/facturacion_clientes';
import { CUBETAS_AUDITOR, type AuditoriaCobranza, type CubetaAuditor } from '@/lib/likida/auditor_cobranza';
import { StatCard, EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta. Se usa `fechaMx` (CON
// año) y no `fechaCorta` en toda la pantalla a propósito: su propio comentario
// dice que el año se omite cuando "ya es obvio por contexto", y en una cartera
// por antigüedad no lo es — la cubeta de "más de 60 días" cruza meses y en
// enero cruza el año, que es justo cuando el corte importa.
import { mxn, numero, fechaMx } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import {
  FormaFactura, FormaPago, FormaEmitir, FormaCancelar, Plegable, type AccionForma,
} from './forma';

/** Lo que la página inyecta para que la pantalla además CAPTURE. Opcional a
 *  propósito: sin esto la vista sigue siendo pura-props y se puede mirar con
 *  fixtures sin sesión, igual que siempre. */
export interface CapturaFacturacion {
  clientes: ReadonlyArray<{ id: string; nombre: string; diasCredito: number | null }>;
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
export function VistaFacturacion({ datos, captura = null, auditoria = null }: {
  datos: FacturacionClientes | null;
  captura?: CapturaFacturacion | null;
  /** El cruce pactado/entregado/facturado/cobrado (auditor_cobranza.ts).
   *  `null` = su lectura falló; la sección pinta el error dicho, no un cero. */
  auditoria?: AuditoriaCobranza | null;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<FileText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Facturación a clientes"
        />

        <div className="px-5 py-5 flex-1 space-y-4">
          {datos === null ? (
            <EstadoError mensaje="No pude leer tus facturas emitidas, sus pagos ni tus viajes liquidados. No se enseña una cartera a medias: media tabla sumada se ve igual que la tabla entera, solo que más barata." />
          ) : datos.cartera.facturas.length === 0 && datos.viajesLiquidados === 0 ? (
            // El estado en el que abre una flota nueva: las tablas de la 0049
            // existen y están vacías. Se dice qué las llena, no se pintan
            // ceros — y desde el hallazgo A1 (auditoría 4), la captura que las
            // llena vive AQUÍ MISMO, no en una promesa.
            <>
              <EstadoVacio icono={<FileText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Esta pantalla trabaja con dos cosas que tu cuenta todavía no tiene: las{' '}
                <strong>facturas que le emites a tus clientes</strong> (con sus pagos) y{' '}
                <strong>viajes ya liquidados</strong>. En cuanto exista lo primero, aquí sale cuánto te
                deben y desde hace cuánto — corriente, 1 a 30, 31 a 60 y más de 60 días — y qué está
                vencido de verdad. En cuanto exista lo segundo, sale la lista de viajes cerrados que
                nadie facturó, que es el dinero que se queda en la mesa. Nada de esto se estima: si el
                dato no está, se dice. La primera factura se registra aquí abajo.
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
              {auditoria !== null && auditoria.cola.length > 0 && <BloqueAuditor auditoria={auditoria} />}
            </>
          ) : (
            <>
              <BloqueCartera datos={datos} captura={captura} />
              <BloqueEnLaMesa datos={datos} />
              <BloqueAuditor auditoria={auditoria} />
              <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                Todo lo de esta pantalla se fechó contra un solo día: <strong>{fechaMx(datos.hoy)}</strong>,
                en hora de México. Es lo que impide que una factura salga marcada como vencida y con
                cero días vencida en el mismo renglón.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** "1 factura" / "14 facturas". El "(s)" de paréntesis se lee como plantilla
 *  sin terminar, y esta pantalla la lee un contralor. */
function plural(n: number, uno: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

// ── La cartera ─────────────────────────────────────────────────────────────

function BloqueCartera({ datos, captura }: { datos: FacturacionClientes; captura: CapturaFacturacion | null }) {
  const c = datos.cartera;

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Lo que facturaste y lo que te deben
      </h2>

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
          Todavía no hay una sola factura emitida registrada. Al registrar la primera, aquí aparece
          cuánto te deben, desde hace cuánto y qué cliente concentra el atraso. Ojo: Likida guarda la
          factura que tú EXPIDES; los CFDI que recibes de tus proveedores son lo contrario y viven en
          los comprobantes de cada viaje.
        </EstadoVacio>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icono={<FileText width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Facturado a clientes" valor={c.facturado} formato="mxn"
              nota={`De ${plural(c.vivas, 'factura emitida', 'facturas emitidas')}`}
            />
            <StatCard
              icono={<HandCoins width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Cobrado" valor={c.cobrado} formato="mxn"
              nota="Suma de los pagos registrados contra esas facturas"
            />
            <StatCard
              icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Por cobrar" valor={c.porCobrar} formato="mxn"
              nota="Saldo vivo: no incluye borradores ni canceladas"
            />
            <StatCard
              icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Vencido" valor={c.vencido} formato="mxn"
              nota={c.vencido > 0
                ? 'Saldo que ya pasó su fecha pactada'
                : 'Nada ha pasado de su fecha pactada'}
            />
          </div>

          <TablaCubetas datos={datos} />

          {c.sinCondiciones > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              {c.sinCondiciones === 1
                ? '1 factura con saldo no tiene fecha de vencimiento porque su cliente no tiene días de crédito registrados'
                : `${numero(c.sinCondiciones)} facturas con saldo no tienen fecha de vencimiento porque su cliente no tiene días de crédito registrados`}
              {' '}— no entran a lo vencido. Suponerles 30 días pintaría de rojo un plazo que nadie
              pactó; captúrale los días de crédito al cliente y entran solas.
            </p>
          )}

          <TablaClientes clientes={c.clientes} />
          <TablaFacturas facturas={c.facturas} captura={captura} />

          {/* RECORTAR LA LISTA ESTÁ BIEN; RECORTAR LA CIFRA SIN DECIRLO, NO.
              Desde la 0152 la tabla trae a lo más 100 renglones —las más
              vencidas primero—, mientras que las cubetas, el por cobrar y el
              corte por cliente son de TODAS. Sin este renglón, quien cuente
              las filas y las sume no cuadraría contra las tarjetas de arriba
              y descartaría la tabla entera. */}
          {c.facturasTotal > c.facturas.length && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              Se listan las {numero(c.facturas.length)} más atrasadas de {numero(c.facturasTotal)} facturas.
              Las cubetas, el total por cobrar y el corte por cliente son de todas, no de esta lista.
            </p>
          )}

          {(c.borradores > 0 || c.canceladas > 0) && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {c.borradores > 0 && `${plural(c.borradores, 'factura está en borrador', 'facturas están en borrador')} y no suma al por cobrar: Likida no timbra, así que mientras no llegue su UUID del CFDI no le cobra a nadie. `}
              {c.canceladas > 0 && `${plural(c.canceladas, 'factura cancelada no es', 'facturas canceladas no son')} dinero que alguien deba; su viaje vuelve a la lista de sin facturar.`}
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
function TablaCubetas({ datos }: { datos: FacturacionClientes }) {
  const c = datos.cartera;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Antigüedad de saldos
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th className="px-3 py-2 font-medium">Cubeta</th>
            <th className="px-3 py-2 font-medium text-right">Facturas</th>
            <th className="px-3 py-2 font-medium text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {c.cubetas.map((b) => (
            <tr key={b.clave} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-3 py-2">
                <span className="font-medium" style={{ color: b.clave === 'sin_fecha' ? 'var(--warn)' : undefined }}>
                  {b.rotulo}
                </span>
                <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>{b.ayuda}</span>
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
            <td className="px-3 py-2 font-medium">Total por cobrar</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right tabular font-semibold">{mxn(c.porCobrar)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TablaClientes({ clientes }: { clientes: ClienteCartera[] }) {
  if (clientes.length === 0) return null;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Por cliente — a quién hay que hablarle
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium text-right">Facturado</th>
            <th className="px-3 py-2 font-medium text-right">Cobrado</th>
            <th className="px-3 py-2 font-medium text-right">Por cobrar</th>
            <th className="px-3 py-2 font-medium text-right">Corriente</th>
            <th className="px-3 py-2 font-medium text-right">1-30</th>
            <th className="px-3 py-2 font-medium text-right">31-60</th>
            <th className="px-3 py-2 font-medium text-right">+60</th>
            <th className="px-3 py-2 font-medium text-right">Sin fecha</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.cliente} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-3 py-2">
                <span className="font-medium">{c.cliente}</span>
                <span className="block text-[10.5px]" style={{ color: c.diasMasVencido === null ? 'var(--faint)' : 'var(--bad)' }}>
                  {c.diasMasVencido === null
                    ? `${plural(c.facturas, 'factura', 'facturas')}, nada vencido`
                    : `${plural(c.facturas, 'factura', 'facturas')} · lo más atrasado, ${numero(c.diasMasVencido)} días`}
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

const PILL_ESTATUS: Record<string, { rotulo: string; fg: string; bg: string }> = {
  borrador: { rotulo: 'borrador', fg: 'var(--muted)', bg: 'var(--canvas)' },
  cancelada: { rotulo: 'cancelada', fg: 'var(--muted)', bg: 'var(--canvas)' },
};

function TablaFacturas({ facturas, captura }: { facturas: RenglonCartera[]; captura: CapturaFacturacion | null }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <caption className="text-left px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Facturas emitidas
        </caption>
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th className="px-3 py-2 font-medium">Folio</th>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium text-right">Total</th>
            <th className="px-3 py-2 font-medium text-right">Pagado</th>
            <th className="px-3 py-2 font-medium text-right">Saldo</th>
            <th className="px-3 py-2 font-medium">Vence</th>
            <th className="px-3 py-2 font-medium">Antigüedad</th>
            {captura && <th className="px-3 py-2 font-medium">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {facturas.map((f) => <RenglonFactura key={f.id} f={f} captura={captura} />)}
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

function RenglonFactura({ f, captura }: { f: RenglonCartera; captura: CapturaFacturacion | null }) {
  const pill = PILL_ESTATUS[f.estatus];
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
          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium align-middle"
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
        {f.venceEn === null ? 'sin condiciones' : fechaMx(f.venceEn)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {!f.viva ? (
          <span style={{ color: 'var(--faint)' }}>no entra a la cartera</span>
        ) : !f.conSaldo ? (
          <span style={{ color: 'var(--ok)' }}>saldada</span>
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

function BloqueEnLaMesa({ datos }: { datos: FacturacionClientes }) {
  const m = datos.enLaMesa;

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Viajes liquidados que nadie facturó
      </h2>

      {datos.viajesLiquidados === 0 ? (
        <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no hay un solo viaje liquidado. En cuanto se cierre el primero, aquí sale si se
          quedó sin facturar y cuántos días lleva así — es el hueco entre operar y cobrar, y es el
          único de esta pantalla que no depende de que captures nada nuevo.
        </EstadoVacio>
      ) : m.total === 0 ? (
        // No es un cero disfrazado: se comprobaron los N liquidados y todos
        // tienen factura viva. Se dice el denominador para que se pueda creer.
        <p className="text-[12.5px]" style={{ color: 'var(--ok)' }}>
          {datos.viajesLiquidados === 1
            ? 'El único viaje liquidado ya tiene factura emitida.'
            : `Los ${numero(datos.viajesLiquidados)} viajes liquidados ya tienen factura emitida.`}
          {' '}No hay dinero esperando en la mesa.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icono={<Truck width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Viajes liquidados sin factura" valor={m.total} formato="numero"
              nota={`De ${plural(datos.viajesLiquidados, 'viaje liquidado', 'viajes liquidados')} en total`}
            />
            <StatCard
              icono={<Banknote width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Ingreso capturado sin facturar" valor={m.ingresoCapturado} formato="mxn"
              nota={m.sinIngreso === 0
                ? 'Todos traen su ingreso de flete capturado'
                : m.sinIngreso === 1
                  ? '1 viaje no trae ingreso capturado y NO entra a esta suma'
                  : `${numero(m.sinIngreso)} viajes no traen ingreso capturado y NO entran a esta suma`}
            />
            {/* Sin una sola fecha de cierre NO se pinta un "0" grande con la
                aclaración abajo: la cifra es lo que se lee, y ese 0 diría "se
                liquidaron hoy". La tarjeta se convierte en texto. */}
            {m.diasMasViejo === null ? (
              <div className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                <span className="block font-medium" style={{ color: 'var(--ink)' }}>El más viejo, sin facturar</span>
                Ninguno de estos viajes tiene fecha de cierre de su liquidación, así que no hay días
                que contar. No es cero días: es que no se puede fechar.
              </div>
            ) : (
              <StatCard
                icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
                etiqueta="El más viejo, sin facturar"
                valor={m.diasMasViejo} formato="numero"
                nota="días desde que se cerró su liquidación"
              />
            )}
          </div>

          {m.sinIngreso > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              La cifra de arriba es el PISO de lo que dejaste de facturar, no el total:{' '}
              {plural(m.sinIngreso, 'viaje no tiene', 'viajes no tienen')} el ingreso del flete capturado, y
              un viaje sin ese dato no vale $0 — no se sabe cuánto vale. El anticipo no sirve para
              rellenarlo: es lo que le adelantas al operador, no lo que te paga tu cliente.
            </p>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="px-3 py-2 font-medium">Viaje</th>
                  <th className="px-3 py-2 font-medium">Ruta</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Liquidado</th>
                  <th className="px-3 py-2 font-medium text-right">Sin facturar</th>
                  <th className="px-3 py-2 font-medium text-right">Ingreso</th>
                </tr>
              </thead>
              <tbody>
                {m.viajes.map((v) => <RenglonMesa key={v.viajeId} v={v} />)}
              </tbody>
            </table>
          </div>

          {m.viajes.length < m.total && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Se listan los {numero(m.viajes.length)} más antiguos de {numero(m.total)}. Las cifras de
              arriba sí son de los {numero(m.total)}: la lista se recorta, la suma no.
            </p>
          )}

          {m.conBorrador > 0 && (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {plural(m.conBorrador, 'de estos viajes ya tiene', 'de estos viajes ya tienen')} una factura en
              borrador: alguien la empezó y no llegó su UUID del CFDI. Cuentan como sin facturar
              porque un borrador no le cobra a nadie, pero ahí ya hay trabajo hecho.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function RenglonMesa({ v }: { v: RenglonSinFacturar }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2">
        <span className="cifra-mono">{v.folio}</span>
        {v.soloBorrador && (
          <span className="flex items-center gap-1 text-[10.5px] mt-0.5" style={{ color: 'var(--warn)' }}>
            <TriangleAlert width={11} height={11} strokeWidth={1.75} className="shrink-0" />
            tiene factura en borrador
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {v.ruta ?? <span style={{ color: 'var(--faint)' }}>sin ruta capturada</span>}
      </td>
      <td className="px-3 py-2">
        {v.cliente ?? <span style={{ color: 'var(--warn)' }}>sin asignar</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {v.liquidadoEn === null
          ? <span style={{ color: 'var(--faint)' }}>sin fecha de cierre</span>
          : fechaMx(v.liquidadoEn)}
      </td>
      <td className="px-3 py-2 text-right tabular">
        {/* Sin fecha de cierre no hay días que contar, y un 0 se leería como
            "se liquidó hoy" — la lectura más tranquilizadora posible sobre el
            renglón del que menos se sabe. */}
        {v.diasSinFacturar === null
          ? <span style={{ color: 'var(--faint)' }}>—</span>
          : <span style={{ color: v.diasSinFacturar > 30 ? 'var(--bad)' : undefined }}>
            {numero(v.diasSinFacturar)} días
          </span>}
      </td>
      <td className="px-3 py-2 text-right tabular font-medium">
        {v.ingreso === null
          ? <span className="text-[11px] font-normal" style={{ color: 'var(--warn)' }}>sin capturar</span>
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

function BloqueAuditor({ auditoria }: { auditoria: AuditoriaCobranza | null }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Auditor de cobranza — lo pactado contra lo entregado, lo facturado y lo cobrado
      </h2>

      {auditoria === null ? (
        <EstadoError mensaje="No pude cruzar los viajes contra sus tarifas, PODs, facturas y pagos. No se enseña una auditoría a medias: un cruce incompleto diría que no hay discrepancias en viajes que sí las tienen." />
      ) : auditoria.resumen.viajesAuditados === 0 ? (
        <EstadoVacio icono={<ClipboardCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          No hubo viajes iniciados entre el {fechaMx(auditoria.desde)} y el {fechaMx(auditoria.hasta)},
          que es la ventana que este auditor revisa. En cuanto los haya, aquí sale el cruce de cada uno:
          lo pactado con el cliente (tarifa o ingreso capturado), lo entregado (POD e hitos), lo
          facturado y lo cobrado — con cada discrepancia dicha y cifrada.
          {auditoria.viajesSinFecha > 0 && (
            <> Ojo: {auditoria.viajesSinFecha === 1
              ? 'hay 1 viaje sin fecha de inicio que queda'
              : `hay ${numero(auditoria.viajesSinFecha)} viajes sin fecha de inicio que quedan`} fuera
            de cualquier ventana.</>
          )}
        </EstadoVacio>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icono={<Truck width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Dinero dormido" valor={auditoria.resumen.dineroDormido} formato="mxn"
              nota={auditoria.resumen.dormidosSinMonto > 0
                ? `Entregado y sin facturar. Es el piso: ${plural(auditoria.resumen.dormidosSinMonto, 'entrega más no tiene', 'entregas más no tienen')} monto resoluble`
                : 'Viajes con entrega probada y ninguna factura viva'}
            />
            <StatCard
              icono={<TriangleAlert width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Facturado de menos" valor={auditoria.resumen.brechaFacturadoDeMenos} formato="mxn"
              nota="La brecha entre lo pactado y lo que suman las facturas"
            />
            <StatCard
              icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
              etiqueta="Margen real medido" valor={auditoria.resumen.margen.margen} formato="mxn"
              nota={auditoria.resumen.margen.viajesMedidos > 0
                ? `${auditoria.resumen.margen.margenPct === null ? '' : `${numero(auditoria.resumen.margen.margenPct)}% · `}pactado menos gastos liquidados, en ${plural(auditoria.resumen.margen.viajesMedidos, 'viaje medido', 'viajes medidos')}; ${numero(auditoria.resumen.margen.viajesSinDato)} sin las dos mitades`
                : 'Ningún viaje de la ventana tiene pactado Y liquidación: no se mide'}
            />
          </div>

          {auditoria.cola.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Los {numero(auditoria.resumen.viajesAuditados)} viajes de la ventana salieron sin
              discrepancias: lo facturado cuadra con lo pactado, lo entregado está facturado y no hay
              cobros a medias ni PODs faltantes con factura viva.
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
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px]" style={{ color: 'var(--faint)' }}>
                      <th className="px-3 py-2 font-medium">Viaje</th>
                      <th className="px-3 py-2 font-medium">Cliente</th>
                      <th className="px-3 py-2 font-medium">Hallazgo</th>
                      <th className="px-3 py-2 font-medium text-right">En juego</th>
                      <th className="px-3 py-2 font-medium">La nota, citable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditoria.cola.slice(0, LIMITE_COLA_AUDITOR).map((h) => (
                      <tr key={`${h.viajeId}-${h.cubeta}`} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-3 py-2">
                          <span className="cifra-mono">{h.folio}</span>
                          {h.ruta && <div className="text-[10.5px]" style={{ color: 'var(--faint)' }}>{h.ruta}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {h.cliente ?? <span style={{ color: 'var(--warn)' }}>sin asignar</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{ROTULO_CUBETA[h.cubeta].rotulo}</td>
                        <td className="px-3 py-2 text-right tabular font-medium">
                          {/* Sin monto resoluble no se inventa uno: la nota dice qué falta. */}
                          {h.monto === null ? <span style={{ color: 'var(--faint)' }}>—</span> : mxn(h.monto)}
                        </td>
                        <td className="px-3 py-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>{h.nota}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {auditoria.cola.length > LIMITE_COLA_AUDITOR && (
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  Se listan los {numero(LIMITE_COLA_AUDITOR)} hallazgos con más dinero enfrente
                  de {numero(auditoria.cola.length)}. Las tarjetas y los conteos de arriba son de todos.
                </p>
              )}
            </>
          )}

          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            Ventana auditada: viajes iniciados del <strong>{fechaMx(auditoria.desde)}</strong> al{' '}
            <strong>{fechaMx(auditoria.hasta)}</strong>, juzgados contra el {fechaMx(auditoria.hoy)}.
            {auditoria.viajesSinFecha > 0 && (
              <> {auditoria.viajesSinFecha === 1
                ? '1 viaje sin fecha de inicio queda'
                : `${numero(auditoria.viajesSinFecha)} viajes sin fecha de inicio quedan`} fuera de
              cualquier ventana; captúrales la fecha y entran solos.</>
            )}
            {' '}Este auditor propone: la refacturación la firma el humano — no emite ni cancela CFDI,
            ni toca la tarifa.
          </p>
        </>
      )}
    </section>
  );
}
