import { getT } from '@/lib/i18n/servidor';
import Link from 'next/link';
import { Plus, MessageCircle, Landmark, Route as RouteIcon, ReceiptText, Fuel, Wallet, FileX2, FileSearch, Download } from 'lucide-react';
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
  type Periodo,
} from '@/lib/likida/fiscal';
import { getFacturacionClientes, type FacturacionClientes } from '@/lib/likida/facturacion_clientes';
import { saludo, ahoraMs } from '@/lib/saludo';
import { mxn, hoyMx } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { areaDeRuta } from '@/lib/auth/visibilidad';
import { AUTOMATIZACIONES, DINERO_FISCAL, SISTEMA, type Item } from '../rutas';
import { MotorFiscal } from '../resumen-visual';
import {
  Aviso, BotonEnlace, EsqCifrasV2, EsqTarjetaV2, EstadoVacio, Icono, MarcoPagina, Tarjeta, clasesBoton,
} from '@/app/ui-v2/componentes';
import { MotorFiscalPeriodo } from '../motor-fiscal-periodo';
import { AvisoSinFlota } from '../sin-flota';
import { Bloque } from '../bloque';
import './contador.css';
import { EstimuloPeaje } from './estimulo-peaje';
import { PerfilErp } from './perfil-erp';
import { Timbrado } from './timbrado';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Inicio del PANEL DEL CONTADOR — el Resumen de quien vive del dinero y del
 * papel, y no despacha. Misma anatomía de página que el Resumen del dueño
 * (`inicio-contenido.tsx`): barra de página, saludo con chip de fecha sobre
 * el lienzo tenue, y tarjetas blancas encima. Lo que cambia es el contenido:
 * aquí no hay despacho, ni viajes recientes, ni carga por operador — hay
 * acreditables, deducibilidad y el papel que falta perseguir.
 *
 * VIVE EN SU PROPIO ARCHIVO, EXPORTADO, y no dentro de `page.tsx`, por las
 * dos razones que `InicioContenido` ya documenta (y que ya cobraron una vez
 * cada una): Next rechaza exports extra en una Page, y sin export el preview
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
  // AUDITORÍA 25, FIS-C1/FIS-C2 (CRÍTICO): `resumirFiscal` necesita el
  // acumulado REAL del ejercicio (`combustibleEjercicio`) para partir el IVA
  // del diésel en efectivo igual que el motor — `opcionesDe(cfg)` solo trae
  // la config, no ese acumulado.
  const pResumenFiscal: Promise<ResumenFiscal | null> =
    Promise.all([pCfgFiscal, pGastosFiscales]).then(async ([cfg, gastos]) =>
      cfg && gastos ? resumirFiscal(gastos, await opcionesFiscalesDelPeriodo(tenantId, periodoFiscal, cfg)) : null);

  // Los accesos del final salen del MISMO mapa que gatea las páginas
  // (`areaDeRuta`), no de una lista escrita a mano: una pantalla de dinero
  // nueva aparece aquí sola, y una que cambie de área desaparece sola. El
  // chat se excluye porque ya tiene su botón fijo en la barra de arriba.
  // No consulta nada: se pinta con el primer flush.
  const pantallas: Item[] = [...AUTOMATIZACIONES, ...DINERO_FISCAL, ...SISTEMA]
    .filter((it) => areaDeRuta(it.href) === 'dinero' && it.href !== '/dashboard/chat');

  return (
    // El scroll vive DENTRO del panel (patrón FASE 1.5). Lienzo tenue
    // (`--g1`) con tarjetas blancas encima — la misma anatomía que el
    // Resumen del dueño, porque es la misma casa con otro contenido.
    <MarcoPagina
      titulo={tr('contador.inicioContador.contador')}
      area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
      apoyo={tr('contador.inicioContador.elDineroComprobadoY', { v: saludo(), v2: nombre ?? 'contador' })}
      acciones={(
        <>
          {/* Un link directo, no `BarraAcciones`: su buscador indexa los
              VIAJES (registro operativo, área `operacion`) y esta
              pantalla no debe cargar datos de un área que su lector
              principal no ve. El asistente sí es suyo (chat es dinero). */}
          <BotonEnlace variante="secondary" tamano="sm" href={`/dashboard/chat${sufijo}`} icono={<Icono icono={MessageCircle} />}>
            {tr('contador.inicioContador.chateaConTusDatos')}
          </BotonEnlace>
          {/* AUDITORÍA 2, ALTO (proceso faltante): el CSV de liquidaciones para el ERP/Excel ya existía en
              /api/export/liquidaciones —bien protegido por sesión, rol (`puedeExportar`) y tenant— pero NO tenía puerta en
              ninguna pantalla, así que el contador no podía sacar sus datos. Un `<a download>` a esa ruta, con el `?tenant=`
              del sufijo del superadmin (vacío para roles reales, que usan su sesión). Es la puerta que faltaba, no un
              endpoint nuevo.
              ESCALA 50k (22-ago-2026, ESC-8): la ruta ahora EXIGE ventana (máx. 3 meses) porque el CSV completo de un
              cliente grande no cabe en la respuesta de la plataforma. La puerta del contador se lleva el MES EN CURSO, que
              es su unidad de trabajo, y lo dice en el rótulo: un botón que promete "todo" y entrega un mes sería el recorte
              silencioso de siempre. Es un <a> y no un Link: un Link precargaría el CSV. */}
          <a href={`/api/export/liquidaciones${sufijo}${sufijo ? '&' : '?'}desde=${hoy.slice(0, 8)}01&hasta=${hoy}`} download
            className={clasesBoton('secondary', 'sm')}>
            <Icono icono={Download} /> {tr('contador.inicioContador.exportarCsvDelMes')}
          </a>
          {/* La acción primaria del contador no es despachar: es meter el papel. Facturación es lectura Y captura desde la
              auditoría 4 (A1), y este botón es su puerta. */}
          <BotonEnlace variante="primary" tamano="sm" href={`/dashboard/facturacion${sufijo}`} icono={<Icono icono={Plus} />}>
            {tr('contador.inicioContador.registrarFactura')}
          </BotonEnlace>
        </>
      )}
    >
          {/* ANTES QUE NINGUNA CIFRA: los ceros de una flota que no existe no
              son una medición, y menos una fiscal. Sin consulta de por medio,
              o sea que llega con el primer flush — que es exactamente lo que
              "antes que ninguna cifra" pide. */}
          {!tenantExiste && (
            <div><AvisoSinFlota tenantId={tenantId} /></div>
          )}

          {/* FASE 3: la pregunta del 50% de peaje va ANTES que las cifras.
              Sin declaración el motor fail-open y pinta un estímulo que
              quizá no toca — esa cifra no puede ser lo primero que se ve. */}
          <EstimuloPeaje searchParams={searchParams} tenantExiste={tenantExiste} />

          {/* PLAN MAESTRO 26-ago, sección B: la plantilla que desbloquea el
              export a SAP B1/CONTPAQi. Sin ella el export responde 409 para
              cualquier flota — el lector existía desde la 0178, el escritor
              es este formulario. */}
          <PerfilErp searchParams={searchParams} tenantExiste={tenantExiste} />

          <Timbrado searchParams={searchParams} tenantExiste={tenantExiste} sufijo={sufijo} />

          {/* Condicional de verdad (solo si hay fuego): sin esqueleto, para no
              reservar un hueco que casi siempre queda vacío. */}
          <Bloque mensaje={tr('contador.inicioContador.noSePudieronLeer')} esqueleto={null}>
            <BloqueAlertas pKpis={pKpis} pAnomalias={pAnomalias} pHuerfanos={pHuerfanos}
              pFacturacion={pFacturacion} sufijo={sufijo} />
          </Bloque>

          {/* El aviso de pantalla incompleta necesita saber de las SIETE
              secciones, o sea que es por definición el bloque más lento. Con
              el streaming ya no gobierna el render —cada tarjeta de abajo
              degrada sola y dice lo suyo—: queda como lo que en el fondo
              siempre fue, un aviso, y llega cuando puede. */}
          <Bloque mensaje={tr('contador.inicioContador.noSePudoEvaluar')} esqueleto={null}>
            <AvisoEstado pAcred={pAcred} pKpis={pKpis} pAnomalias={pAnomalias} pCfgFiscal={pCfgFiscal}
              pGastosFiscales={pGastosFiscales} pGastosFiscalesSeries={pGastosFiscalesSeries}
              pFacturacion={pFacturacion} />
          </Bloque>

          {/* ── Lo acreditable que tus liquidaciones ya certificaron ──
              Sale de `liquidacion.*_acreditable` (getAcreditables): son
              las MISMAS cifras que cada PDF imprimió al cerrar, sumadas
              al ejercicio — no un recálculo. El desglose de más abajo sí
              recalcula sobre comprobantes, y por eso cada bloque dice de
              dónde sale: dos números parecidos sin su fuente se leen
              como dos cálculos. */}
          <div>
            <Bloque mensaje={tr('contador.inicioContador.noSePudoCargar')}
              esqueleto={<EsqCifrasV2 n={4} />}>
              <BloqueAcreditables pAcred={pAcred} pResumenPerdidas={pResumenPerdidas} periodoFiscal={periodoFiscal} />
            </Bloque>
          </div>

          {/* ── Motor fiscal — las mismas piezas que el Resumen del
              dueño, porque el motor ES la pantalla del contador. */}
          <div>
            <Bloque mensaje={tr('contador.inicioContador.noSePudoCargar2')} esqueleto={<EsqTarjetaV2 alto={240} />}>
              <BloqueFiscal pResumenPerdidas={pResumenPerdidas} pResumenPerdidasSeries={pResumenPerdidasSeries}
                periodoFiscal={periodoFiscal} />
            </Bloque>
          </div>

          {/* ── El gasto del ejercicio, por su suerte fiscal
              (`resumirFiscal`). Las cubetas deducible/no deducible/por
              confirmar del motor son POR LIQUIDACIÓN y no se persisten
              agregadas (recalcularlas aquí sería otra copia de la lógica
              del dinero — ver `reconstruir` en analytics.ts), así que lo
              que se afirma es lo que las columnas sí sostienen: el IVA
              documentado, en sus dos cubetas que SUMAN todo el IVA
              desglosado, y el estado de cada CFDI ante el SAT. */}
          <div>
            <Bloque mensaje={tr('contador.inicioContador.noSePudoLeer')} esqueleto={<EsqTarjetaV2 alto={160} />}>
              <BloqueDesglose pResumenFiscal={pResumenFiscal} periodoFiscal={periodoFiscal} />
            </Bloque>
          </div>

          {/* ── Sus pantallas: solo rutas de área `dinero`, del mismo
              mapa que las gatea. Todos los links cargan el sufijo. Cero
              consultas: entra con el primer flush. */}
          <Tarjeta titulo={tr('contador.inicioContador.tusPantallas')}>
            <div className="rv-cont__pantallas">
              {pantallas.map((it) => (
                <Link key={it.href} href={`${it.href}${sufijo}`} className="rv-cont__pantalla">
                  <Icono icono={it.Icono} />
                  <span>{it.nombre}</span>
                </Link>
              ))}
            </div>
          </Tarjeta>

          <p className="rv-cont__pie">{LEYENDA_CORTA}</p>
    </MarcoPagina>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BLOQUES (FE-14). Cada uno espera SOLO sus promesas: por eso el de al
// lado no lo espera.
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

async function BloqueAcreditables({ pAcred, pResumenPerdidas, periodoFiscal }: {
  pAcred: Promise<Acreditables | null>;
  pResumenPerdidas: Promise<ResumenPerdidas | null>;
  periodoFiscal: Periodo;
}) {
  const { t: tr } = await getT('dinero');
  const [acred, resumenPerdidas] = await Promise.all([pAcred, pResumenPerdidas]);
  if (acred === null) {
    return (
      <Aviso tono="error">{tr('contador.inicioContador.noSePudoCargar3')}</Aviso>
    );
  }
  return (
    <TiraCifras sello={selloHoy(tr('contador.inicioContador.selloCertificadas'))}>
      <Cifra icono={<Icono icono={Landmark} />}
        etiqueta={tr('contador.inicioContador.ivaAcreditableDeTus', { etiqueta: periodoFiscal.etiqueta })}
        info="contador.iva_liquidaciones"
        valor={acred.iva} formato="mxn"
        nota={tr('contador.inicioContador.livaArt5Lo')} />
      {/* La condición va en el rótulo, no solo en la nota — el
          criterio de `liquidacion/acreditable.ts`: "Estímulo de
          peaje 50%" a secas se lee como un derecho ya ganado. */}
      <Cifra icono={<Icono icono={RouteIcon} />}
        etiqueta={tr('contador.inicioContador.estimuloDePeaje50', { etiqueta: periodoFiscal.etiqueta })}
        info="contador.estimulo_peaje"
        valor={acred.peaje} formato="mxn"
        nota={tr('contador.inicioContador.lif2026Art20')} />
      {resumenPerdidas ? (
        <Cifra icono={<Icono icono={ReceiptText} />}
          etiqueta={`Recuperable pidiendo factura — ${periodoFiscal.etiqueta}`}
          info="contador.recuperable"
          valor={resumenPerdidas.montoRecuperable} formato="mxn"
          nota={tr('contador.inicioContador.gastoCuyaFacturaAun')} />
      ) : (
        <Cifra icono={<Icono icono={ReceiptText} />}
          etiqueta={`Recuperable pidiendo factura — ${periodoFiscal.etiqueta}`}
          info="contador.recuperable"
          valor={null} estado="error" mensaje={tr('contador.inicioContador.noSePudoCalcular')} reintentar />
      )}
      {/* En LITROS, nunca en pesos — regla de producto: el
          estímulo es cuota DOF (semanal) × litros, y la cuota no
          vive aquí (decisión D2; `guion_demo.test.ts` la ata). */}
      <Cifra icono={<Icono icono={Fuel} />}
        etiqueta={tr('contador.inicioContador.dieselElegibleParaEl')}
        info="contador.diesel_elegible"
        valor={acred.litrosDiesel} formato="litros"
        nota={tr('contador.inicioContador.lif2026Art202')} />
    </TiraCifras>
  );
}

async function BloqueFiscal({ pResumenPerdidas, pResumenPerdidasSeries, periodoFiscal }: {
  pResumenPerdidas: Promise<ResumenPerdidas | null>;
  pResumenPerdidasSeries: Promise<Record<'semanal' | 'mensual' | 'historico', ResumenPerdidas> | null>;
  periodoFiscal: Periodo;
}) {
  const [resumenPerdidas, resumenPerdidasSeries] = await Promise.all([pResumenPerdidas, pResumenPerdidasSeries]);
  return (
    <Tarjeta titulo={`Tu motor fiscal — ${periodoFiscal.etiqueta}`}>
      <div className="rv-cont__motor">
        <MotorFiscalPeriodo series={resumenPerdidasSeries} />
      </div>
      <MotorFiscal resumen={resumenPerdidas} />
    </Tarjeta>
  );
}

async function BloqueDesglose({ pResumenFiscal, periodoFiscal }: {
  pResumenFiscal: Promise<ResumenFiscal | null>;
  periodoFiscal: Periodo;
}) {
  const { t: tr } = await getT('dinero');
  const resumenFiscal = await pResumenFiscal;
  return (
    <Tarjeta titulo={tr('contador.inicioContador.elGastoDelPeriodo', { etiqueta: periodoFiscal.etiqueta })}>
      {resumenFiscal === null ? (
        <Aviso tono="error">{tr('contador.inicioContador.noSePudoLeer2')}</Aviso>
      ) : resumenFiscal.n === 0 ? (
        <EstadoVacio titulo={tr('contador.inicioContador.sinComprobantesLeidos')} icono={FileSearch} contenido>
          {tr('contador.inicioContador.todaviaNoHayComprobantes')}
        </EstadoVacio>
      ) : (
        <>
          <TiraCifras sello={selloHoy(tr('contador.inicioContador.selloLiquidaciones'))}>
            <Cifra icono={<Icono icono={Wallet} />}
              etiqueta={tr('contador.inicioContador.gastoComprobadoLeido')} info="contador.gasto_leido" valor={resumenFiscal.gastoTotal} formato="mxn"
              nota={tr('contador.inicioContador.comprobanteConCfdiSin', { n: resumenFiscal.n, v: resumenFiscal.n === 1 ? '' : 's', conCfdi: resumenFiscal.conCfdi, sinCfdi: resumenFiscal.sinCfdi })} />
            <Cifra icono={<Icono icono={Landmark} />}
              etiqueta={tr('contador.inicioContador.ivaAcreditableDocumentado')} info="contador.iva_documentado" valor={resumenFiscal.ivaAcreditable} formato="mxn"
              nota={resumenFiscal.combustible15SujetoADeriva
                // RE-AUDITORÍA 25, FIS-REAUD-3 (ALTO): incluye combustible en
                // efectivo prorrateado al 15% con el acumulado del ejercicio
                // A HOY — un PDF ya firmado fijó su reparto contra el
                // acumulado que tenía al cerrar, así que esta cifra puede no
                // coincidir con liquidaciones antiguas. La cifra que SÍ
                // coincide con cada PDF es "IVA acreditable de tus
                // liquidaciones", arriba.
                //
                // AUDITORÍA 28, ARQ-A4 (ALTO, rótulo): esto solo avisaba de
                // la deriva TEMPORAL (el acumulado sigue creciendo). Hay una
                // segunda razón, presente incluso comparando el mismo día: el
                // motor reparte el IVA POR COMPROBANTE y su tasa no es
                // uniforme (16%/8% frontera), mientras esta cifra aplica UNA
                // proporción agregada a todos por igual (ver el doc-comment
                // de `proporcionCombustible15` en fiscal.ts). Es una
                // ESTIMACIÓN, no una reproducción exacta del PDF.
                ? tr('contador.inicioContador.livaArt5Incluye')
                : tr('contador.inicioContador.livaArt5Solo')} />
            <Cifra icono={<Icono icono={FileX2} />}
              etiqueta={tr('contador.inicioContador.ivaDesglosadoQueNo')} info="contador.iva_no_acreditable" valor={resumenFiscal.ivaNoAcreditable} formato="mxn"
              nota={tr('contador.inicioContador.lasDosCubetasSuman')} />
          </TiraCifras>
          <p className="rv-cont__nota">
            {tr(resumenFiscal.vigentes === 1 ? 'contador.inicioContador.estadoSatUnVigente' : 'contador.inicioContador.estadoSatVigentes', { conCfdi: resumenFiscal.conCfdi, vigentes: resumenFiscal.vigentes, porValidar: resumenFiscal.porValidar, cancelados: resumenFiscal.cancelados, canceladosEtiqueta: resumenFiscal.cancelados === 1 ? tr('contador.inicioContador.cancelado') : tr('contador.inicioContador.cancelados') })}
            {/* "Por validar" no es "inválido": es "no comprobado" —
                la distinción viene del propio tipo ResumenFiscal. */}
            {resumenFiscal.conCfdiSinDesglose > 0 && (
              ' ' + tr('contador.inicioContador.traenCfdiPeroSin', { conCfdiSinDesglose: resumenFiscal.conCfdiSinDesglose })
            )}
          </p>
        </>
      )}
    </Tarjeta>
  );
}
