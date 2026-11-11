import { getT } from '@/lib/i18n/servidor';
import Link from 'next/link';
import { Plus, Landmark, Route as RouteIcon, ReceiptText, Fuel, Download } from 'lucide-react';
import {
  getAcreditables, getKpis, detectarAnomalias,
  type Acreditables, type DashboardKpis, type Anomalia,
} from '@/lib/likida/analytics';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { getConfig, type LikidaConfig } from '@/lib/likida/config';
import {
  resolverPeriodo, getGastosFiscales, getGastosFiscalesSeries,
  resumirPerdidas, resumirFiscal, opcionesFiscalesConPerfil, opcionesFiscalesDelPeriodo, ventanaLitrosElegibles,
  type GastoFiscal, type ResumenPerdidas, type ResumenFiscal, type GastosFiscalesSeries,
} from '@/lib/likida/fiscal';
import { getFacturacionClientes, type FacturacionClientes } from '@/lib/likida/facturacion_clientes';
import { saludo, ahoraMs } from '@/lib/saludo';
import { mxn, hoyMx, litros } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import {
  Aviso, BarraPeriodo, BotonEnlace, FilaTarjetas, Icono, Tarjeta, clasesBoton,
} from '@/app/ui-v2/componentes';
import { getPerfilCrudo } from '@/lib/likida/repo';
import { preguntaPendienteEstimuloPeaje } from '@/lib/likida/perfil/preguntas';
import { MotorFiscalPeriodo, PeriodoMotorProvider, SelectorPeriodoMotor } from '../motor-fiscal-periodo';
import { AvisoSinFlota } from '../sin-flota';
import { Bloque } from '../bloque';
import { EsqTarjetaV2 } from '@/app/ui-v2/componentes';
import './contador.css';
import { EstimuloPeaje } from './estimulo-peaje';
import { PerfilErp } from './perfil-erp';
import { Timbrado } from './timbrado';
import { CajonConfigFiscal } from './cajon-config';
import { BarList, ColumnasApiladas, DonaMini, KindBadge, type PeriodoApilado, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Inicio del PANEL DEL CONTADOR — el Resumen de quien vive del dinero y del
 * papel, y no despacha. Misma anatomía de página que el Resumen del dueño
 * (`resumen-v2.tsx`): `MarcoPagina`, tiras de cifras y tarjetas del kit. Lo que
 * cambia es el contenido: aquí no hay despacho, ni viajes recientes, ni carga
 * por operador — hay acreditables, deducibilidad y el papel que falta perseguir.
 *
 * VIVE EN SU PROPIO ARCHIVO, EXPORTADO, y no dentro de `page.tsx`, por dos
 * razones: Next rechaza exports extra en una Page, y sin export el preview
 * headless no puede montar el componente REAL sin sesión.
 */
export async function InicioContador({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '', searchParams = {},
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Aquí la mentira sería fiscal: "$0.00 de IVA
   *  acreditable" de una flota que no existe se lee como una medición. */
  tenantExiste?: boolean;
  /** Query string que los links internos deben cargar (`?tenant=`/`?vista=`/
   *  `?rol=` del superadmin) — mismo contrato que el sidebar; vacío para
   *  roles reales. Lo arma `page.tsx`, que es quien tiene los searchParams. */
  sufijo?: string;
  /** Lo necesita el formulario del estímulo de peaje (server action) para
   *  re-resolver el tenant igual que Políticas: el rol del render no es el
   *  de la acción. */
  searchParams?: { vista?: string; tenant?: string; rol?: string };
}) {
  const { t: tr } = await getT('dinero');
  // El MISMO "cuándo" que el Resumen del dueño (auditoría de diseño,
  // 8-ago-2026): todo lo fiscal de esta pantalla se corta al ejercicio en
  // curso, y `getKpis`/`detectarAnomalias` van sin ventana — un pendiente no
  // deja de ser pendiente por ser viejo.
  // DAT-08/FE-20 (auditoría prod): era `toISOString().slice(0,10)`, el día
  // UTC. De 18:00 a 24:00 hora de México el panel ya estaba en el día
  // siguiente, y el 31 de diciembre el `resolverPeriodo` de abajo abría el
  // ejercicio EQUIVOCADO: todo lo fiscal salía en ceros a las 6 de la tarde.
  const hoy = hoyMx(new Date(ahoraMs()));
  const periodoFiscal = resolverPeriodo(undefined, hoy);
  // FE-8 (auditoría 24): misma ventana que `ventanaLitrosElegibles` usa en
  // combustible-casetas/page.tsx y chat/page.tsx — antes cada pantalla
  // calculaba "días del ejercicio" a mano, con la misma cita legal (LIF
  // 2026, Art. 20-A) llegando a cifras distintas entre pantallas.
  const diasEjercicio = ventanaLitrosElegibles(hoy).dias;

  // ── LAS OCHO CONSULTAS, LANZADAS DE UNA (FE-14) ─────────────────────────
  // Sin `await`: salen todas en el mismo tick, igual que en el `Promise.all`
  // que había aquí, pero cada una se espera DENTRO del bloque que la usa. La
  // cáscara (barra, saludo, el botón de exportar, "Tus pantallas") no
  // depende de ninguna lectura y sale con el primer flush del stream, en vez
  // de esperar a que `getFacturacionClientes` recorra la cartera entera.
  // Todas pasan por `safe`, así que ninguna rechaza: resuelven a `null` y su
  // tarjeta pinta la leyenda honesta (null ≠ 0).
  const pAcred = safe<Acreditables>(() => getAcreditables(tenantId, diasEjercicio));
  const pKpis = safe<DashboardKpis>(() => getKpis(tenantId));
  const pAnomalias = safe<Anomalia[]>(() => detectarAnomalias(tenantId));
  // Devuelve `null` ante error (≠ 0) y la alerta simplemente no se pinta —
  // una alerta no puede afirmar en falso. Igual que en el Resumen del dueño,
  // no entra al conteo de secciones caídas: es solo una alerta.
  const pHuerfanos = safe<number | null>(() => contarHuerfanosPendientes(tenantId));
  const pCfgFiscal = safe<LikidaConfig>(() => getConfig(tenantId));
  const pGastosFiscales = safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodoFiscal));
  // "En riesgo/perdido" y "Recuperable" ciclan semanal/mensual/histórico
  // (`MotorFiscalPeriodo`) — serie aparte de `gastosFiscales`, que sigue
  // fija al ejercicio para el top de causas y el desglose.
  const pGastosFiscalesSeries = safe<GastosFiscalesSeries>(() => getGastosFiscalesSeries(tenantId, hoy));
  // La cartera: facturas emitidas y qué les falta de pago. El helper NO
  // atrapa por dentro (una base caída se leería como "no te debe nadie"),
  // así que aquí el `safe` la marca como sección caída, no como cero.
  const pFacturacion = safe<FacturacionClientes>(() => getFacturacionClientes(tenantId));

  // `resumirPerdidas`/`resumirFiscal` son puras: se calculan UNA vez aquí en
  // el servidor. `fiscal.ts` importa `supabaseAdmin` a nivel de módulo — un
  // Client Component no puede importarlo sin arrastrar el service-role al
  // bundle del navegador, por eso `MotorFiscalPeriodo` recibe datos planos.
  // `.then` sobre promesas YA lanzadas: no añade espera, solo dice qué hacer
  // cuando lleguen.
  const pResumenPerdidas: Promise<ResumenPerdidas | null> =
    Promise.all([pCfgFiscal, pGastosFiscales]).then(async ([cfg, gastos]) =>
      // A37-S45-06: con el perfil, igual que el chat y el MCP.
      cfg && gastos ? resumirPerdidas(gastos, await opcionesFiscalesConPerfil(tenantId, cfg)) : null);
  const pResumenPerdidasSeries: Promise<Record<'semanal' | 'mensual' | 'historico', ResumenPerdidas> | null> =
    Promise.all([pCfgFiscal, pGastosFiscalesSeries]).then(async ([cfg, series]) => {
      if (!cfg || !series) return null;
      const opciones = await opcionesFiscalesConPerfil(tenantId, cfg);
      return {
        semanal: resumirPerdidas(series.semanal, opciones),
        mensual: resumirPerdidas(series.mensual, opciones),
        historico: resumirPerdidas(series.historico, opciones),
      };
    });
  // Barras apiladas por mes (Rovaq «Brechas»): perdido / en riesgo / recuperable de cada mes del ejercicio, con el MISMO `resumirPerdidas`
  // que las demás cifras. Un comprobante sin fecha no entra a ningún mes (no se le inventa uno). Hasta los 8 meses más recientes con dato.
  const pBarrasMes: Promise<PeriodoApilado[] | null> =
    Promise.all([pCfgFiscal, pGastosFiscales]).then(async ([cfg, gastos]) => {
      if (!cfg || !gastos) return null;
      const opciones = await opcionesFiscalesConPerfil(tenantId, cfg);
      const porMes = new Map<string, GastoFiscal[]>();
      for (const g of gastos) {
        if (!g.fecha || !/^\d{4}-\d{2}/.test(g.fecha)) continue;
        const mes = g.fecha.slice(0, 7);
        porMes.set(mes, [...(porMes.get(mes) ?? []), g]);
      }
      return [...porMes.keys()].sort().slice(-8).map((mes) => {
        const r = resumirPerdidas(porMes.get(mes) ?? [], opciones);
        return { etiqueta: etiquetaMes(mes), partes: [r.montoPerdido, r.montoEnRiesgo, r.montoRecuperable] };
      });
    });
  // AUDITORÍA 25, FIS-C1/FIS-C2 (CRÍTICO): `resumirFiscal` necesita el
  // acumulado REAL del ejercicio (`combustibleEjercicio`) para partir el IVA
  // del diésel en efectivo igual que el motor — `opcionesDe(cfg)` solo trae
  // la config, no ese acumulado.
  const pResumenFiscal: Promise<ResumenFiscal | null> =
    Promise.all([pCfgFiscal, pGastosFiscales]).then(async ([cfg, gastos]) =>
      cfg && gastos ? resumirFiscal(gastos, await opcionesFiscalesDelPeriodo(tenantId, periodoFiscal, cfg)) : null);

  // El estímulo de peaje sin declarar deja el 50 % en $0 (el motor falla cerrado): se dice en un aviso ANTES de las cifras y la
  // pregunta se contesta en la configuración fiscal (cajón). `null` = no se pudo leer; entonces no se afirma nada.
  const pPeajePendiente = tenantExiste
    ? safe<boolean>(async () => preguntaPendienteEstimuloPeaje(await getPerfilCrudo(tenantId)) !== null)
    : Promise.resolve<boolean | null>(null);

  const [acred, resumenPerdidas, resumenFiscal, barrasMes] = await Promise.all([
    pAcred, pResumenPerdidas, pResumenFiscal, pBarrasMes,
  ]);
  const etq = periodoFiscal.etiqueta;

  // ── Cifras (4, todas con filete): lo que las liquidaciones cerradas certificaron + lo recuperable. Sin dato = «—», nunca 0. ──
  const falla = (etiqueta: string): PropsCifra => ({ etiqueta, valor: null, estado: 'error', mensaje: tr('contador.inicioContador.noSePudoCargar3'), reintentar: true, matiz: 1 });
  const cifras: PropsCifra[] = acred === null ? [falla(tr('contador.inicioContador.ivaAcreditableDeTus', { etiqueta: etq }))] : [
    { icono: <Icono icono={Landmark} />, etiqueta: tr('contador.inicioContador.ivaAcreditableDeTus', { etiqueta: etq }), info: 'contador.iva_liquidaciones', valor: acred.iva, formato: 'mxn', nota: tr('contador.inicioContador.livaArt5Lo'), matiz: 1 },
    { icono: <Icono icono={RouteIcon} />, etiqueta: tr('contador.inicioContador.estimuloDePeaje50', { etiqueta: etq }), info: 'contador.estimulo_peaje', valor: acred.peaje, formato: 'mxn', nota: tr('contador.inicioContador.lif2026Art20'), matiz: 1 },
    resumenPerdidas
      ? { icono: <Icono icono={ReceiptText} />, etiqueta: tr('contador.panel.recuperable', { etiqueta: etq }), info: 'contador.recuperable', valor: resumenPerdidas.montoRecuperable, formato: 'mxn', nota: tr('contador.inicioContador.gastoCuyaFacturaAun'), matiz: 1 }
      : { icono: <Icono icono={ReceiptText} />, etiqueta: tr('contador.panel.recuperable', { etiqueta: etq }), info: 'contador.recuperable', valor: null, estado: 'error', mensaje: tr('contador.inicioContador.noSePudoCalcular'), reintentar: true, matiz: 1 },
    // En LITROS, nunca en pesos: el estímulo es cuota DOF (semanal) × litros y la cuota no vive aquí (decisión D2).
    { icono: <Icono icono={Fuel} />, etiqueta: tr('contador.inicioContador.dieselElegibleParaEl'), info: 'contador.diesel_elegible', valor: acred.litrosDiesel, formato: 'litros', nota: tr('contador.inicioContador.lif2026Art202'), matiz: 1 },
  ];

  const titular = resumenPerdidas
    ? tr('contador.panel.titular', { etiqueta: etq, perdido: mxn(resumenPerdidas.montoEnRiesgo + resumenPerdidas.montoPerdido), recuperable: mxn(resumenPerdidas.montoRecuperable) })
    : undefined;

  return (
    <PeriodoMotorProvider>
    <EsqueletoPanelCifras
      titulo={tr('contador.inicioContador.contador')}
      area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
      apoyo={tr('contador.inicioContador.elDineroComprobadoY', { v: saludo(), v2: nombre ?? 'contador' })}
      acciones={(
        <>
          <CajonConfigFiscal id="config-fiscal" titulo={tr('contador.panel.configTitulo')} descripcion={tr('contador.panel.configNota')} disparador={tr('contador.panel.config')}>
            {/* Las tres piezas conservan su acción de servidor y su puerta de permisos; solo cambian de lugar. */}
            <EstimuloPeaje searchParams={searchParams} tenantExiste={tenantExiste} />
            <PerfilErp searchParams={searchParams} tenantExiste={tenantExiste} />
            <Timbrado searchParams={searchParams} tenantExiste={tenantExiste} sufijo={sufijo} />
          </CajonConfigFiscal>
          {/* La acción primaria del contador no es despachar: es meter el papel (Facturación es lectura Y captura desde la auditoría 4). */}
          <BotonEnlace variante="primary" href={`/dashboard/facturacion${sufijo}`} icono={<Icono icono={Plus} />}>
            {tr('contador.inicioContador.registrarFactura')}
          </BotonEnlace>
        </>
      )}
      titular={titular}
      filtros={(
        // Rovaq: el segmentado de periodo y los chips de alcance en UNA fila de filtros, arriba de las cifras (no dentro de una tarjeta).
        <BarraPeriodo etiqueta={tr('contador.panel.alcance')} selector={<SelectorPeriodoMotor />}
          chips={[{ id: 'ejercicio', etiqueta: tr('contador.panel.alcanceEjercicio', { etiqueta: etq }) }, { id: 'fuente', etiqueta: tr('contador.panel.alcanceFuente') }]} />
      )}
      avisos={(
        <>
          {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}
          <Bloque mensaje={tr('contador.inicioContador.noSePudieronLeer')} esqueleto={null}>
            <BloqueAlertas pKpis={pKpis} pAnomalias={pAnomalias} pHuerfanos={pHuerfanos} pFacturacion={pFacturacion} sufijo={sufijo} />
          </Bloque>
          <Bloque mensaje={tr('contador.inicioContador.noSePudoEvaluar')} esqueleto={null}>
            <AvisoEstado pAcred={pAcred} pKpis={pKpis} pAnomalias={pAnomalias} pCfgFiscal={pCfgFiscal}
              pGastosFiscales={pGastosFiscales} pGastosFiscalesSeries={pGastosFiscalesSeries} pFacturacion={pFacturacion} />
          </Bloque>
          <Bloque mensaje={tr('contador.inicioContador.noSePudoEvaluar')} esqueleto={null}>
            <BloquePeaje pPeajePendiente={pPeajePendiente} />
          </Bloque>
        </>
      )}
      cifras={cifras}
      etiquetaCifras={tr('contador.inicioContador.contador')}
      selloCifras={selloHoy(tr('contador.inicioContador.selloCertificadas'))}
      variante="8-4"
      graficas={[
        <Tarjeta key="barras" titulo={tr('contador.panel.barrasTitulo', { etiqueta: etq })} info="contador.en_riesgo"
          estado={barrasMes === null ? 'error' : barrasMes.length === 0 ? 'vacio' : 'ok'} contenida
          mensaje={barrasMes === null ? tr('contador.inicioContador.noSePudoCalcular') : tr('contador.panel.barrasVacio')}
          detalle={tr('contador.panel.barrasVacioDetalle')} reintentar acciones={<KindBadge tipo="calculado" />}>
          {barrasMes && barrasMes.length > 0 ? (
            <ColumnasApiladas etiqueta={tr('contador.panel.barrasTitulo', { etiqueta: etq })} formato="mxn" matiz={8} alto={168}
              series={[tr('contador.panel.barrasPerdido'), tr('contador.panel.barrasEnRiesgo'), tr('contador.panel.barrasRecuperable')]}
              periodos={barrasMes} />
          ) : null}
        </Tarjeta>,
        <Tarjeta key="iva" titulo={tr('contador.panel.ivaTitulo')} info="contador.iva_documentado" contenida acciones={<KindBadge tipo="observado" />}
          estado={resumenFiscal === null ? 'error' : resumenFiscal.n === 0 ? 'vacio' : 'ok'}
          mensaje={resumenFiscal === null ? tr('contador.inicioContador.noSePudoLeer2') : tr('contador.inicioContador.sinComprobantesLeidos')}
          detalle={tr('contador.inicioContador.todaviaNoHayComprobantes')} reintentar>
          {resumenFiscal && resumenFiscal.n > 0 ? (
            <>
              <DonaMini etiqueta={tr('contador.panel.ivaTitulo')} centro={mxn(resumenFiscal.ivaAcreditable + resumenFiscal.ivaNoAcreditable)}
                gajos={[
                  { etiqueta: tr('contador.inicioContador.ivaAcreditableDocumentado'), valor: resumenFiscal.ivaAcreditable },
                  { etiqueta: tr('contador.inicioContador.ivaDesglosadoQueNo'), valor: resumenFiscal.ivaNoAcreditable },
                ]} formato="mxn" />
              <p className="rv-cont__nota">{tr('contador.inicioContador.lasDosCubetasSuman')}</p>
            </>
          ) : null}
        </Tarjeta>,
      ]}
      saberes={{
        seSabe: { titulo: tr('contador.panel.saberSiTitulo'), items: [tr('contador.panel.saberSi1'), tr('contador.panel.saberSi2'), tr('contador.panel.saberSi3')] },
        noSeSabe: { titulo: tr('contador.panel.saberNoTitulo'), items: [tr('contador.panel.saberNo1'), tr('contador.panel.saberNo2'), tr('contador.panel.saberNo3')] },
      }}
      metodo={LEYENDA_CORTA}
    >
      <Bloque mensaje={tr('contador.inicioContador.noSePudoCargar')} esqueleto={<EsqTarjetaV2 alto={240} />}>
        <BloqueTablas pAcred={pAcred} pResumenPerdidas={pResumenPerdidas} pSeries={pResumenPerdidasSeries} pFacturacion={pFacturacion} sufijo={sufijo} hoy={hoy} />
      </Bloque>
    </EsqueletoPanelCifras>
    </PeriodoMotorProvider>
  );
}

async function BloquePeaje({ pPeajePendiente }: { pPeajePendiente: Promise<boolean | null> }) {
  const { t: tr } = await getT('dinero');
  if ((await pPeajePendiente) !== true) return null;
  return <Aviso tono="warn" titulo={tr('contador.panel.peajeTitulo')}>{tr('contador.panel.peajeCuerpo')}</Aviso>;
}

/** «YYYY-MM» → «ene 26» (mes corto de México; sin día, el mes no se mueve por zona horaria). */
function etiquetaMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const nombre = new Intl.DateTimeFormat('es-MX', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1))).replace('.', '');
  return `${nombre} ${String(a).slice(2)}`;
}

/** Puente de lo facturado a lo cobrado (Inferido: se deduce de la cartera), y debajo Dónde gano / Dónde pierdo, cada una con su sello. */
async function BloqueTablas({ pAcred, pResumenPerdidas, pSeries, pFacturacion, sufijo, hoy }: {
  pAcred: Promise<Acreditables | null>;
  pResumenPerdidas: Promise<ResumenPerdidas | null>;
  pSeries: Promise<Record<'semanal' | 'mensual' | 'historico', ResumenPerdidas> | null>;
  pFacturacion: Promise<FacturacionClientes | null>;
  sufijo: string;
  hoy: string;
}) {
  const { t: tr } = await getT('dinero');
  const [acred, resumenPerdidas, series, facturacion] = await Promise.all([pAcred, pResumenPerdidas, pSeries, pFacturacion]);
  const causas = resumenPerdidas?.porCausa ?? [];
  const cartera = facturacion?.cartera ?? null;
  const gano = acred === null ? [] : [
    { clave: 'iva', etiqueta: tr('contador.panel.ganoIva'), valor: acred.iva, texto: mxn(acred.iva) },
    { clave: 'peaje', etiqueta: tr('contador.panel.ganoPeajeCorto'), valor: acred.peaje, texto: mxn(acred.peaje) },
    ...(resumenPerdidas ? [{ clave: 'recup', etiqueta: tr('contador.panel.ganoRecuperable'), valor: resumenPerdidas.montoRecuperable, texto: mxn(resumenPerdidas.montoRecuperable) }] : []),
  ];

  return (
    <>
      <Tarjeta titulo={tr('contador.panel.puenteTitulo')} contenida acciones={<KindBadge tipo="inferido" />}
        estado={cartera === null ? 'error' : cartera.facturasTotal === 0 ? 'vacio' : 'ok'}
        mensaje={cartera === null ? tr('contador.panel.puenteNoLeido') : tr('contador.panel.puenteVacio')} detalle={tr('contador.panel.puenteVacioDetalle')} reintentar>
        {cartera ? (
          <>
            <BarList etiqueta={tr('contador.panel.puenteTitulo')} maximo={Math.max(1, cartera.facturado)} items={[
              { clave: 'facturado', etiqueta: tr('contador.panel.puenteFacturado'), valor: cartera.facturado, texto: mxn(cartera.facturado) },
              { clave: 'cobrado', etiqueta: tr('contador.panel.puenteCobrado'), valor: cartera.cobrado, texto: mxn(cartera.cobrado) },
              { clave: 'porCobrar', etiqueta: tr('contador.panel.puentePorCobrar'), valor: cartera.porCobrar, texto: mxn(cartera.porCobrar) },
              { clave: 'vencido', etiqueta: tr('contador.panel.puenteVencido'), valor: cartera.vencido, texto: mxn(cartera.vencido) },
            ]} />
            <p className="rv-cont__nota">{tr('contador.panel.puenteNota')}</p>
          </>
        ) : null}
      </Tarjeta>
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={tr('contador.panel.tablaGano')} contenida estado={acred === null ? 'error' : 'ok'} mensaje={tr('contador.inicioContador.noSePudoCargar3')} reintentar
          acciones={(
            <>
              <KindBadge tipo="observado" />
              {/* El CSV de liquidaciones (puerta que faltaba, auditoría 2): ruta protegida por sesión, rol y tenant; exige ventana (ESC-8), se lleva el MES EN CURSO y lo dice.
                  Es un <a> y no un Link: un Link precargaría el CSV. */}
              <a href={`/api/export/liquidaciones${sufijo}${sufijo ? '&' : '?'}desde=${hoy.slice(0, 8)}01&hasta=${hoy}`} download className={clasesBoton('ghost', 'sm')}>
                <Icono icono={Download} /> {tr('contador.inicioContador.exportarCsvDelMes')}
              </a>
            </>
          )}>
          <BarList etiqueta={tr('contador.panel.tablaGano')} items={gano} />
          {acred ? <p className="rv-cont__nota">{tr('contador.panel.ganoDieselNota', { litros: litros(acred.litrosDiesel) })}</p> : null}
        </Tarjeta>
        <Tarjeta titulo={tr('contador.panel.tablaPierdo')} info="contador.en_riesgo" contenida acciones={<KindBadge tipo="calculado" />}
          estado={resumenPerdidas === null ? 'error' : 'ok'} mensaje={tr('contador.inicioContador.noSePudoCalcular')} reintentar>
          <MotorFiscalPeriodo series={series} causas={causas.map(({ titulo, n, monto }) => ({ titulo, n, monto }))} />
        </Tarjeta>
      </FilaTarjetas>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BLOQUES de aviso (FE-14): cada uno espera SOLO sus promesas.
// ═══════════════════════════════════════════════════════════════════════════


async function BloqueAlertas({ pKpis, pAnomalias, pHuerfanos, pFacturacion, sufijo }: {
  pKpis: Promise<DashboardKpis | null>;
  pAnomalias: Promise<Anomalia[] | null>;
  pHuerfanos: Promise<number | null>;
  pFacturacion: Promise<FacturacionClientes | null>;
  sufijo: string;
}) {
  const { t: tr } = await getT('dinero');
  const [kpis, anomalias, huerfanosPendientes, facturacion] =
    await Promise.all([pKpis, pAnomalias, pHuerfanos, pFacturacion]);

  // Las alertas accionables: cada una lleva a LA pantalla donde se resuelve,
  // con el sufijo del superadmin a cuestas, y SOLO si la cifra es mayor a
  // cero — una banda que siempre dice algo entrena a ignorarla.
  const alertas: Array<{ texto: string; href: string }> = [];
  if (kpis && kpis.porRevisar > 0) {
    alertas.push({
      texto: tr(kpis.porRevisar === 1 ? 'contador.inicioContador.revisionUna' : 'contador.inicioContador.revisionVarias', { n: kpis.porRevisar }),
      href: `/dashboard/agentes/liquidacion${sufijo}`,
    });
  }
  if (anomalias && anomalias.length > 0) {
    alertas.push({
      texto: `${anomalias.length} comprobante${anomalias.length === 1 ? '' : 's'} repetido${anomalias.length === 1 ? '' : 's'} entre viajes distintos`,
      href: `/dashboard/agentes/liquidacion${sufijo}`,
    });
  }
  if (huerfanosPendientes !== null && huerfanosPendientes !== undefined && huerfanosPendientes > 0) {
    alertas.push({
      texto: tr(huerfanosPendientes === 1 ? 'contador.inicioContador.huerfanoUno' : 'contador.inicioContador.huerfanosVarios', { n: huerfanosPendientes }),
      href: `/dashboard/huerfanos${sufijo}`,
    });
  }
  if (facturacion) {
    // "Emitida sin pago" = viva Y con saldo arriba del centavo de tolerancia
    // — el MISMO criterio que la vista `factura_saldo` (0049) y que la
    // pantalla de Facturación, para que el clic aterrice en la misma cuenta.
    const sinPago = facturacion.cartera.facturas.filter((f) => f.viva && f.conSaldo).length;
    if (sinPago > 0) {
      alertas.push({
        texto: tr(sinPago === 1 ? 'contador.inicioContador.sinCobrarUna' : 'contador.inicioContador.sinCobrarVarias', { n: sinPago, monto: mxn(facturacion.cartera.porCobrar), vencido: facturacion.cartera.vencido > 0 ? ' ' + tr('contador.inicioContador.yaVencido', { monto: mxn(facturacion.cartera.vencido) }) : '' }),
        href: `/dashboard/facturacion${sufijo}`,
      });
    }
  }
  if (alertas.length === 0) return null;

  return (
    <div className="rv-cont__alertas">
      {alertas.map((a) => (
        <Link key={a.texto} href={a.href} className="rv-cont__alerta">
          <span>{a.texto}</span>
          <span className="rv-cont__ver">{tr('contador.inicioContador.ver')}</span>
        </Link>
      ))}
    </div>
  );
}

async function AvisoEstado({
  pAcred, pKpis, pAnomalias, pCfgFiscal, pGastosFiscales, pGastosFiscalesSeries, pFacturacion,
}: {
  pAcred: Promise<Acreditables | null>;
  pKpis: Promise<DashboardKpis | null>;
  pAnomalias: Promise<Anomalia[] | null>;
  pCfgFiscal: Promise<LikidaConfig | null>;
  pGastosFiscales: Promise<GastoFiscal[] | null>;
  pGastosFiscalesSeries: Promise<GastosFiscalesSeries | null>;
  pFacturacion: Promise<FacturacionClientes | null>;
}) {
  const { t: tr } = await getT('dinero');
  // La MISMA regla que `estadoPanel` (estado.ts), sobre las secciones de ESTA
  // pantalla: "no hay nada" es una afirmación sobre el negocio y solo se hace
  // cuando TODO cargó. No se reusa la función porque su forma pide viajes y
  // liquidaciones, que aquí no se consultan — la regla sí se copia entera:
  // todo caído es error, algo caído se enseña CON aviso.
  const secciones = await Promise.all([
    pAcred, pKpis, pAnomalias, pCfgFiscal, pGastosFiscales, pGastosFiscalesSeries, pFacturacion,
  ]);
  const caidas = secciones.filter((s) => s === null).length;
  if (caidas === 0) return null;

  if (caidas === secciones.length) {
    return (
      <Aviso tono="error" titulo={tr('contador.inicioContador.noSePudieronCargar')}>
        {tr('contador.inicioContador.huboUnProblemaAl')}
      </Aviso>
    );
  }
  return (
    <Aviso tono="warn" titulo={tr('contador.inicioContador.faltanDatosPorCargar')}>
      {tr('contador.inicioContador.unaOMasSecciones')}
    </Aviso>
  );
}
