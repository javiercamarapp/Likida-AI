import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import {
  FileText, Banknote, Wallet, CalendarClock, HandCoins, TriangleAlert, Truck,
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
  FormaFactura, FormaPago, FormaEmitir, FormaCancelar, type AccionForma,
} from './forma';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { AvisoCompacto, Chip, StatusChip, TablaBase, TabsLinea, TituloRecuadro, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './facturacion.css';
import type { ReactNode } from 'react';

// Tonos del sistema como clases (sin `style=`): el color sale de los tokens, no de un literal.
const APAGADO = 'text-[color:var(--muted)]';
const TENUE = 'text-[color:var(--faint)]';
const MAL = 'text-[color:var(--bad)]';
const AVISO = 'text-[color:var(--warn)]';
const BIEN = 'text-[color:var(--ok)]';

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
export type SeccionFacturacion = 'cartera' | 'mesa' | 'auditor' | 'cobro';
export const SECCIONES_FACTURACION: readonly SeccionFacturacion[] = ['cartera', 'mesa', 'auditor', 'cobro'];

export function VistaFacturacion({ datos, captura = null, auditoria = null, tr = trEs, seccion = 'cartera', hrefSeccion, extras }: {
  datos: FacturacionClientes | null;
  captura?: CapturaFacturacion | null;
  /** El cruce pactado/entregado/facturado/cobrado (auditor_cobranza.ts).
   *  `null` = su lectura falló; la sección pinta el error dicho, no un cero. */
  auditoria?: AuditoriaCobranza | null; tr?: Tr;
  /** La pestaña vigente (Rovaq: hub con pestañas subrayadas). */
  seccion?: SeccionFacturacion;
  /** Enlace de cada pestaña; sin él no se pintan pestañas (fixtures sin sesión). */
  hrefSeccion?: (s: SeccionFacturacion) => string;
  /** Estadías y portal de pago: bloques independientes (sus lecturas y su fallo no tocan la cartera ni el auditor) que viven en su pestaña. */
  extras?: ReactNode;
}) {
  // «Registrar factura» es la acción de la pantalla: vive en el encabezado y abre un cajón del sistema (nunca un `<details>` con
  // formulario dentro de la tabla ni de una tarjeta).
  const alta = captura && datos !== null ? (
    <FormaFactura accion={captura.factura} clientes={captura.clientes}
      viajesSinFacturar={datos.enLaMesa.viajes} hoy={captura.hoy} />
  ) : undefined;
  const vacioTotal = datos !== null && datos.cartera.facturas.length === 0 && datos.viajesLiquidados === 0;
  // Pestañas con su contador real: solo cuando hay datos que contar (un contador en 0 inventado no se pinta).
  const pestanas = hrefSeccion && datos !== null && !vacioTotal ? (
    <TabsLinea
      etiqueta={tr('facturacion.vista.secciones')}
      actual={seccion}
      pestanas={[
        { clave: 'cartera', etiqueta: tr('facturacion.vista.tab.cartera'), href: hrefSeccion('cartera'), conteo: datos.cartera.facturasTotal },
        { clave: 'mesa', etiqueta: tr('facturacion.vista.tab.mesa'), href: hrefSeccion('mesa'), conteo: datos.enLaMesa.total, atencion: datos.enLaMesa.total > 0 },
        { clave: 'auditor', etiqueta: tr('facturacion.vista.tab.auditor'), href: hrefSeccion('auditor'), conteo: auditoria === null ? null : auditoria.cola.length, atencion: (auditoria?.cola.length ?? 0) > 0 },
        ...(extras ? [{ clave: 'cobro', etiqueta: tr('facturacion.vista.tab.cobro'), href: hrefSeccion('cobro') }] : []),
      ]}
    />
  ) : undefined;
  // Sin enlaces de pestaña (fixtures sin sesión) se pintan TODAS las secciones, como antes; con ellos, una por pestaña.
  const todo = !hrefSeccion;
  const conTitulo = todo;
  return (
    <EsqueletoTablaMaestra
      titulo={tr('facturacion.vista.facturacionAClientes')}
      apoyo={tr('facturacion.vista.facturasEmitidasSusPagos')}
      acciones={alta}
      filtros={pestanas}
    >
      {datos === null ? (
        <EstadoError mensaje={tr('facturacion.vista.noPudeLeerTus')} />
      ) : vacioTotal ? (
        // El estado en el que abre una flota nueva: las tablas de la 0049
        // existen y están vacías. Se dice qué las llena, no se pintan
        // ceros — y desde el hallazgo A1 (auditoría 4), la captura que las
        // llena vive AQUÍ MISMO, no en una promesa.
        <div className="rv-fact__bloques">
          <EstadoVacio>
            {rico(tr('facturacion.vista.estaPantallaTrabajaCon'), { strong: (c) => <strong>{c}</strong>, strong2: (c) => <strong>{c}</strong> })}
          </EstadoVacio>
          {/* Una flota sin facturas puede tener hallazgos IGUAL: el
              entregado-sin-facturar existe justamente antes de la primera
              factura. Si el auditor encontró algo, se enseña aquí también. */}
          {auditoria !== null && auditoria.cola.length > 0 && <BloqueAuditor tr={tr} auditoria={auditoria} conTitulo />}
          {extras}
        </div>
      ) : (
        <div className="rv-fact__bloques">
          {(todo || seccion === 'cartera') && <BloqueCartera tr={tr} datos={datos} captura={captura} conTitulo={conTitulo} />}
          {(todo || seccion === 'mesa') && <BloqueEnLaMesa tr={tr} datos={datos} conTitulo={conTitulo} />}
          {(todo || seccion === 'auditor') && <BloqueAuditor tr={tr} auditoria={auditoria} conTitulo={conTitulo} />}
          {(todo || seccion === 'cobro') && extras}
          <p className={`text-[11px] ${TENUE}`}>
            {rico(tr('facturacion.vista.todoLoDeEsta', { v: fechaMx(datos.hoy) }), { strong: (c) => <strong>{c}</strong> })}
          </p>
        </div>
      )}
    </EsqueletoTablaMaestra>
  );
}

/** "1 factura" / "14 facturas". El "(s)" de paréntesis se lee como plantilla
 *  sin terminar, y esta pantalla la lee un contralor. */
function plural(n: number, uno: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

/** Un cero de cubeta se pinta como «—». Es un cero MEDIDO (ese cliente no debe nada en ese tramo), pero nueve columnas de «$0.00»
 *  ahogan las tres cifras que sí piden una llamada. */
function MontoCubeta({ monto, atrasado = false }: { monto: number; atrasado?: boolean }) {
  return <span className={monto === 0 ? TENUE : atrasado ? MAL : undefined}>{monto === 0 ? '—' : mxn(monto)}</span>;
}

// ── La cartera ─────────────────────────────────────────────────────────────

function BloqueCartera({ datos, captura, conTitulo = true, tr = trEs }: { datos: FacturacionClientes; captura: CapturaFacturacion | null; conTitulo?: boolean; tr?: Tr }) {
  const c = datos.cartera;

  return (
    <section className="flex flex-col gap-3">
      {conTitulo && <TituloRecuadro info="facturacion.cartera">{tr('facturacion.vista.loQueFacturasteY')}</TituloRecuadro>}

      {c.facturas.length === 0 ? (
        <EstadoVacio>
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
            <p className={`text-[11px] ${TENUE}`}>
              {tr('facturacion.vista.seListanLasMas', { v: numero(c.facturas.length), v2: numero(c.facturasTotal) })}
            </p>
          )}

          {(c.borradores > 0 || c.canceladas > 0) && (
            <p className={`text-[11px] ${TENUE}`}>
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
type FilaCubeta = { clave: string; rotulo: string; ayuda: string | null; facturas: number | null; saldo: number; total: boolean };

function TablaCubetas({ datos, tr = trEs }: { datos: FacturacionClientes; tr?: Tr }) {
  const c = datos.cartera;
  const filas: FilaCubeta[] = [
    ...c.cubetas.map((b) => ({ clave: b.clave, rotulo: b.rotulo, ayuda: b.ayuda, facturas: b.facturas, saldo: b.saldo, total: false })),
    { clave: 'total', rotulo: tr('facturacion.vista.totalPorCobrar'), ayuda: null, facturas: null, saldo: c.porCobrar, total: true },
  ];
  const columnas: ColumnaBase<FilaCubeta>[] = [
    {
      id: 'cubeta', titulo: tr('facturacion.vista.cubeta'), principal: true,
      celda: (b) => (
        <>
          <span className={b.clave === 'sin_fecha' ? AVISO : undefined}>{b.rotulo}</span>
          {b.ayuda && <span className={`block text-[11px] font-normal ${TENUE}`}>{b.ayuda}</span>}
        </>
      ),
    },
    {
      id: 'facturas', titulo: tr('facturacion.vista.facturas'), alinear: 'der',
      celda: (b) => b.facturas === null ? null : <span className={`tabular ${b.facturas === 0 ? TENUE : ''}`}>{b.facturas === 0 ? '—' : numero(b.facturas)}</span>,
    },
    {
      id: 'saldo', titulo: tr('facturacion.vista.saldo'), alinear: 'der',
      celda: (b) => <span className={`tabular ${b.total ? 'font-semibold' : b.facturas === 0 ? TENUE : 'font-medium'}`}>{b.facturas === 0 ? '—' : mxn(b.saldo)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <TituloRecuadro nivel="h3" info="facturacion.cartera">{tr('facturacion.vista.antiguedadDeSaldos')}</TituloRecuadro>
      <TablaBase etiqueta={tr('facturacion.vista.antiguedadDeSaldos')} columnas={columnas} filas={filas} idFila={(b) => b.clave} altoMaximo={false} densa />
    </div>
  );
}

function TablaClientes({ clientes, tr = trEs }: { clientes: ClienteCartera[]; tr?: Tr }) {
  if (clientes.length === 0) return null;
  const columnas: ColumnaBase<ClienteCartera>[] = [
    {
      id: 'cliente', titulo: tr('facturacion.vista.cliente'), principal: true,
      celda: (c) => (
        <>
          <span>{c.cliente}</span>
          <span className={`block text-[11px] font-normal ${c.diasMasVencido === null ? TENUE : MAL}`}>
            {c.diasMasVencido === null
              ? tr('facturacion.vista.nadaVencido', { v: plural(c.facturas, 'factura', 'facturas') })
              : tr('facturacion.vista.loMasAtrasadoDias', { v: plural(c.facturas, 'factura', 'facturas'), v2: numero(c.diasMasVencido) })}
          </span>
        </>
      ),
    },
    { id: 'facturado', titulo: tr('facturacion.vista.facturado'), alinear: 'der', celda: (c) => <span className="tabular">{mxn(c.facturado)}</span> },
    { id: 'cobrado', titulo: tr('facturacion.vista.cobrado'), alinear: 'der', celda: (c) => <span className="tabular">{mxn(c.cobrado)}</span> },
    { id: 'saldo', titulo: tr('facturacion.vista.porCobrar'), alinear: 'der', celda: (c) => <span className="tabular font-medium">{mxn(c.saldo)}</span> },
    { id: 'corriente', titulo: tr('facturacion.vista.corriente'), alinear: 'der', celda: (c) => <span className="tabular"><MontoCubeta monto={c.porCubeta.corriente} /></span> },
    { id: 'v1', titulo: '1-30', alinear: 'der', celda: (c) => <span className="tabular"><MontoCubeta monto={c.porCubeta.v1_30} atrasado /></span> },
    { id: 'v31', titulo: '31-60', alinear: 'der', celda: (c) => <span className="tabular"><MontoCubeta monto={c.porCubeta.v31_60} atrasado /></span> },
    { id: 'v60', titulo: '+60', alinear: 'der', celda: (c) => <span className="tabular"><MontoCubeta monto={c.porCubeta.v60_mas} atrasado /></span> },
    { id: 'sf', titulo: tr('facturacion.vista.sinFecha'), alinear: 'der', celda: (c) => <span className="tabular"><MontoCubeta monto={c.porCubeta.sin_fecha} /></span> },
  ];
  return (
    <div className="flex flex-col gap-2">
      <TituloRecuadro nivel="h3" info="facturacion.cartera">{tr('facturacion.vista.porClienteAQuien')}</TituloRecuadro>
      <TablaBase etiqueta={tr('facturacion.vista.porClienteAQuien')} columnas={columnas} filas={clientes} idFila={(c) => c.cliente} altoMaximo={false} />
    </div>
  );
}

const pillEstatus = (tr: Tr): Record<string, string> => ({
  borrador: tr('facturacion.vista.borrador'),
  cancelada: tr('facturacion.vista.cancelada'),
});

/** Qué se le puede hacer a cada factura, según su estado REAL:
 *  borrador → sellarla con su UUID, o cancelarla;
 *  emitida con saldo → abonarle pagos; sin pagos aún → también cancelarla;
 *  pagada o cancelada → nada, y la celda lo dice con un guion. Cada acción abre su cajón del sistema. */
function CeldaAcciones({ f, captura }: { f: RenglonCartera; captura: CapturaFacturacion }) {
  const esBorrador = f.estatus === 'borrador';
  const puedeAbonar = f.viva && f.estatus === 'emitida' && f.conSaldo;
  // El borrador NO es "viva" (no entra a la cartera) y aun así se puede
  // cancelar: un borrador capturado por error no tiene otra salida.
  const puedeCancelar = (f.viva || esBorrador) && f.pagado === 0;
  if (!esBorrador && !puedeAbonar && !puedeCancelar) return <span className={TENUE}>—</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {esBorrador && <FormaEmitir accion={captura.emitir} facturaId={f.id} folioActual={f.folio} />}
      {puedeAbonar && <FormaPago accion={captura.pago} facturaId={f.id} hoy={captura.hoy} />}
      {puedeCancelar && <FormaCancelar accion={captura.cancelar} facturaId={f.id} />}
    </div>
  );
}

function TablaFacturas({ facturas, captura, tr = trEs }: { facturas: RenglonCartera[]; captura: CapturaFacturacion | null; tr?: Tr }) {
  const rotuloPill = pillEstatus(tr);
  // El color sale del MISMO criterio que el rótulo de la derecha, y por eso
  // exige las tres condiciones: viva, con saldo y vencida. Se vio mirando el
  // render — con solo `diasVencida !== null`, una factura PAGADA en mayo salía
  // con su "$0.00" en rojo junto a la palabra "saldada", y una CANCELADA con
  // sus $61,000 en rojo junto a "no entra a la cartera". Un renglón que se
  // contradice consigo mismo tira la confianza en la tabla entera.
  const rojo = (f: RenglonCartera) => f.viva && f.conSaldo && f.antiguedad.diasVencida !== null;
  const columnas: ColumnaBase<RenglonCartera>[] = [
    {
      id: 'folio', titulo: tr('facturacion.vista.folio'), principal: true,
      celda: (f) => (
        <>
          <span className="cifra-mono">{f.folio ?? '—'}</span>
          {rotuloPill[f.estatus] && <StatusChip tono="muted" className="ml-2 align-middle">{rotuloPill[f.estatus]}</StatusChip>}
        </>
      ),
    },
    { id: 'cliente', titulo: tr('facturacion.vista.cliente'), celda: (f) => f.cliente },
    { id: 'fecha', titulo: tr('facturacion.vista.fecha'), celda: (f) => <span className={`whitespace-nowrap ${APAGADO}`}>{fechaMx(f.fecha)}</span> },
    { id: 'total', titulo: tr('facturacion.vista.total'), alinear: 'der', celda: (f) => <span className="tabular">{mxn(f.total)}</span> },
    { id: 'pagado', titulo: tr('facturacion.vista.pagado'), alinear: 'der', celda: (f) => <span className="tabular">{mxn(f.pagado)}</span> },
    { id: 'saldo', titulo: tr('facturacion.vista.saldo'), alinear: 'der', celda: (f) => <span className={`tabular font-medium ${rojo(f) ? MAL : ''}`}>{mxn(f.saldo)}</span> },
    {
      id: 'vence', titulo: tr('facturacion.vista.vence'),
      celda: (f) => <span className={`whitespace-nowrap ${f.venceEn === null ? TENUE : APAGADO}`}>{f.venceEn === null ? tr('facturacion.vista.sinCondiciones') : fechaMx(f.venceEn)}</span>,
    },
    {
      id: 'antiguedad', titulo: tr('facturacion.vista.antiguedad'),
      celda: (f) => !f.viva ? (
        <span className={`whitespace-nowrap ${TENUE}`}>{tr('facturacion.vista.noEntraALa')}</span>
      ) : !f.conSaldo ? (
        <span className={`whitespace-nowrap ${BIEN}`}>{tr('facturacion.vista.saldada')}</span>
      ) : (
        <span className={`whitespace-nowrap ${rojo(f) ? MAL : f.antiguedad.cubeta === 'sin_fecha' ? AVISO : APAGADO}`}>{f.antiguedad.rotulo}</span>
      ),
    },
    ...(captura ? [{ id: 'acciones', titulo: tr('facturacion.vista.acciones'), alinear: 'der' as const, celda: (f: RenglonCartera) => <CeldaAcciones f={f} captura={captura} /> }] : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <TituloRecuadro nivel="h3" info="facturacion.cartera">{tr('facturacion.vista.facturasEmitidas2')}</TituloRecuadro>
      <TablaBase etiqueta={tr('facturacion.vista.facturasEmitidas2')} columnas={columnas} filas={facturas} idFila={(f) => f.id} altoMaximo={false} />
    </div>
  );
}

// ── El dinero en la mesa ───────────────────────────────────────────────────

function BloqueEnLaMesa({ datos, conTitulo = true, tr = trEs }: { datos: FacturacionClientes; conTitulo?: boolean; tr?: Tr }) {
  const m = datos.enLaMesa;
  const columnas: ColumnaBase<RenglonSinFacturar>[] = [
    {
      id: 'viaje', titulo: tr('facturacion.vista.viaje'), principal: true,
      celda: (v) => (
        <>
          <span className="cifra-mono">{v.folio}</span>
          {v.soloBorrador && (
            <span className={`flex items-center gap-1 text-[11px] font-normal ${AVISO}`}>
              <TriangleAlert width={11} height={11} strokeWidth={1.75} className="shrink-0" />
              {tr('facturacion.vista.tieneFacturaEnBorrador')}
            </span>
          )}
        </>
      ),
    },
    { id: 'ruta', titulo: tr('facturacion.vista.ruta'), celda: (v) => v.ruta ?? <span className={TENUE}>{tr('facturacion.vista.sinRutaCapturada')}</span> },
    { id: 'cliente', titulo: tr('facturacion.vista.cliente'), celda: (v) => v.cliente ?? <span className={AVISO}>{tr('facturacion.vista.sinAsignar')}</span> },
    {
      id: 'liquidado', titulo: tr('facturacion.vista.liquidado'),
      celda: (v) => v.liquidadoEn === null
        ? <span className={TENUE}>{tr('facturacion.vista.sinFechaDeCierre')}</span>
        : <span className={`whitespace-nowrap ${APAGADO}`}>{fechaMx(v.liquidadoEn)}</span>,
    },
    {
      id: 'dias', titulo: tr('facturacion.vista.sinFacturar'), alinear: 'der',
      // Sin fecha de cierre no hay días que contar, y un 0 se leería como
      // "se liquidó hoy" — la lectura más tranquilizadora posible sobre el
      // renglón del que menos se sabe.
      celda: (v) => v.diasSinFacturar === null
        ? <span className={TENUE}>—</span>
        : <span className={`tabular ${v.diasSinFacturar > 30 ? MAL : ''}`}>{tr('facturacion.vista.dias', { v: numero(v.diasSinFacturar) })}</span>,
    },
    {
      id: 'ingreso', titulo: tr('facturacion.vista.ingreso'), alinear: 'der',
      celda: (v) => v.ingreso === null
        ? <span className={`text-[11px] font-normal ${AVISO}`}>{tr('facturacion.vista.sinCapturar')}</span>
        : <span className="tabular font-medium">{mxn(v.ingreso)}</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      {conTitulo && <TituloRecuadro info="facturacion.en_la_mesa">{tr('facturacion.vista.viajesLiquidadosQueNadie')}</TituloRecuadro>}

      {datos.viajesLiquidados === 0 ? (
        <EstadoVacio>
          {tr('facturacion.vista.todaviaNoHayUn')}
        </EstadoVacio>
      ) : m.total === 0 ? (
        // No es un cero disfrazado: se comprobaron los N liquidados y todos
        // tienen factura viva. Se dice el denominador para que se pueda creer.
        <p className={`text-[12px] ${BIEN}`}>
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

          <TablaBase etiqueta={tr('facturacion.vista.viajesPorFacturar')} columnas={columnas} filas={m.viajes} idFila={(v) => v.viajeId} altoMaximo={false} />

          {m.viajes.length < m.total && (
            <p className={`text-[12px] ${APAGADO}`}>
              {tr('facturacion.vista.seListanLosMas', { v: numero(m.viajes.length), v2: numero(m.total), v3: numero(m.total) })}
            </p>
          )}

          {m.conBorrador > 0 && (
            <p className={`text-[11px] ${TENUE}`}>
              {tr('facturacion.vista.unaFacturaEnBorrador', { v: plural(m.conBorrador, tr('facturacion.vista.deEstosViajesYa'), tr('facturacion.vista.deEstosViajesYa2')) })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── El auditor de cobranza — el cruce pactado / entregado / facturado / cobrado ──

/** Cuántos hallazgos se listan. El TOTAL siempre se dice aparte: recortar la
 *  lista está bien, recortar la cifra sin decirlo no. */
const LIMITE_COLA_AUDITOR = 25;

const ROTULO_CUBETA: Record<CubetaAuditor, { rotulo: string; ayuda: string }> = Object.fromEntries(
  CUBETAS_AUDITOR.map((c) => [c.clave, { rotulo: c.rotulo, ayuda: c.ayuda }]),
) as Record<CubetaAuditor, { rotulo: string; ayuda: string }>;

function BloqueAuditor({ auditoria, conTitulo = true, tr = trEs }: { auditoria: AuditoriaCobranza | null; conTitulo?: boolean; tr?: Tr }) {
  type Hallazgo = AuditoriaCobranza['cola'][number];
  const columnas: ColumnaBase<Hallazgo>[] = [
    {
      id: 'viaje', titulo: tr('facturacion.vista.viaje'), principal: true,
      celda: (h) => (
        <>
          <span className="cifra-mono">{h.folio}</span>
          {h.ruta && <span className={`block text-[11px] font-normal ${TENUE}`}>{h.ruta}</span>}
        </>
      ),
    },
    { id: 'cliente', titulo: tr('facturacion.vista.cliente'), celda: (h) => h.cliente ?? <span className={AVISO}>{tr('facturacion.vista.sinAsignar')}</span> },
    { id: 'hallazgo', titulo: tr('facturacion.vista.hallazgo'), celda: (h) => <span className="whitespace-nowrap">{ROTULO_CUBETA[h.cubeta].rotulo}</span> },
    {
      id: 'monto', titulo: tr('facturacion.vista.enJuego'), alinear: 'der',
      // Sin monto resoluble no se inventa uno: la nota dice qué falta.
      celda: (h) => h.monto === null ? <span className={TENUE}>—</span> : <span className="tabular font-medium">{mxn(h.monto)}</span>,
    },
    { id: 'nota', titulo: tr('facturacion.vista.laNotaCitable'), celda: (h) => <span className={`text-[11px] ${APAGADO}`}>{h.nota}</span> },
  ];
  return (
    <section className="flex flex-col gap-3">
      {conTitulo && <TituloRecuadro info="facturacion.auditor">{tr('facturacion.vista.auditorDeCobranzaLo')}</TituloRecuadro>}

      {auditoria === null ? (
        <EstadoError mensaje={tr('facturacion.vista.noPudeCruzarLos')} />
      ) : auditoria.resumen.viajesAuditados === 0 ? (
        <EstadoVacio>
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
            <p className={`text-[12px] ${APAGADO}`}>
              {tr('facturacion.vista.losViajesDeLa', { v: numero(auditoria.resumen.viajesAuditados) })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {CUBETAS_AUDITOR.filter((c) => auditoria.resumen.porCubeta[c.clave] > 0).map((c) => (
                  <Chip key={c.clave}>
                    <span title={c.ayuda}>{c.rotulo} · {numero(auditoria.resumen.porCubeta[c.clave])}</span>
                  </Chip>
                ))}
              </div>

              <TablaBase etiqueta={tr('facturacion.vista.viajesFacturadosPorCliente')} columnas={columnas}
                filas={auditoria.cola.slice(0, LIMITE_COLA_AUDITOR)} idFila={(h) => `${h.viajeId}-${h.cubeta}`} altoMaximo={false} />

              {auditoria.cola.length > LIMITE_COLA_AUDITOR && (
                <p className={`text-[11px] ${TENUE}`}>
                  {tr('facturacion.vista.seListanLosHallazgos', { v: numero(LIMITE_COLA_AUDITOR), v2: numero(auditoria.cola.length) })}
                </p>
              )}
            </>
          )}

          <p className={`text-[11px] ${TENUE}`}>
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
