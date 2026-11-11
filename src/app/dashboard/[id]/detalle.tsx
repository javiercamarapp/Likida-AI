import { Download, MessageCircle } from 'lucide-react';
import {
  Aviso, BotonEnlace, CamposSistema, Casilla, EstadoVacio, FormaConAviso, Icono, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type ResultadoAccion, type TonoEstado,
} from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoFicha } from '@/app/ui-v2/esqueletos';
import type { LiquidacionDetalle } from '@/lib/likida/analytics';
import type { ResumenLaboral } from '@/lib/likida/laboral/pagadero';
import { filasDeducibilidad } from '@/lib/likida/liquidacion/deducibilidad';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { mxn, litros, fechaMx, fechaCorta } from '@/lib/formato';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import type { BuscarCatalogo } from '../combo-catalogo';
import { PanelRevision, type GastoAjustable } from './revision-panel';
import { FormaReasignar } from './reasignar-forma';
import type { RevisionDetalle } from '@/lib/likida/revision';
import {
  Diferencia, LineaDeTiempo, PillRenglon, estadoRenglon, etiquetaFormaPago, plural, TIPOS_TOPE, type Hito,
} from './vista';
import './liquidacion.css';

// ═══════════════════════════════════════════════════════════════════════════
// EL DETALLE DE LIQUIDACIÓN, EN PANTALLA (sistema ui-v2).
//
// Pura props: la sesión, el tenant, los permisos y las acciones las decide
// `page.tsx`; aquí se pinta. Así se puede mirar con fixtures bajo un preview
// temporal (CLAUDE.md §Cómo se verifica) sin montar un login — y lo que se
// mira es el componente REAL, no una copia.
//
// Orden de lectura (CONTRATO-VISUAL P5): encabezado → avisos que ponen en duda
// lo demás → ficha → tira de cifras → tarjetas (acreditable y línea de tiempo,
// diferencias) → comprobantes → firma → reabrir → leyenda.
// ═══════════════════════════════════════════════════════════════════════════

export interface PropsDetalle {
  d: LiquidacionDetalle;
  /** `?tenant=`/`?vista=`/`?rol=` para los links de vuelta (sufijo.ts). */
  sufijo: string;
  /** Estatus de la liquidación ya resuelto por `dashboard/estatus.ts`. */
  estatus: { label: string; estado: TonoEstado };
  /** La etiqueta del renglón (la del motor, igual que el PDF) — vive en la
   *  página porque `etiquetas_panel.test.ts` la vigila ahí. */
  etiqueta: (g: { concepto: string; ocrExtra?: Record<string, unknown> }) => string;
  /** `/api/export/pdf/<id>` si hay PDF, el rol puede exportar, la revisión
   *  se pudo leer y NO dice 'rechazada'; si no, null (BE-A1/FE-M2). */
  pdfHref: string | null;
  /** true si `leerRevision` LANZÓ (fail-closed) en vez de responder "no hay
   *  revisión". Distinto de `revision === null`: aquí SÍ pudo haber una
   *  revisión —quizás una que dice 'rechazada'— y no se pudo confirmar, así
   *  que la pantalla no puede afirmar que la liquidación está vigente. */
  revisionIlegible?: boolean;
  reintentarPdf?: ((previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>) | null;
  /** `https://wa.me/…` del operador, o null si no hay teléfono. */
  wa: string | null;
  /** El formulario de reasignar, solo si el rol puede asignar. FE-2: ya no
   *  trae el catálogo de choferes (a 7,500, PostgREST lo recortaba a 1,000 en
   *  silencio) sino el buscador del servidor y el conteo real. */
  reasignar: {
    buscar: BuscarCatalogo;
    /** Cuántos choferes activos hay; `null` = no se pudo contar. */
    total: number | null;
    actual: string;
    /** El nombre del chofer ACTUAL — viene con el detalle, así que el control
     *  arranca lleno sin pedirle nada al catálogo. */
    actualNombre: string;
    /** FE-11: devuelve el rechazo en vez de lanzarlo — un chofer dado de baja
     *  no puede tumbar la pantalla entera por `error.tsx`. */
    accion: (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  } | null;
  /** La acción de reabrir, solo si el rol administra. */
  reabrir: ((previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>) | null;
  /** La firma humana (BLOQ-6, mig. 0299). `null` = no se pudo leer el estado
   *  de la revisión; entonces NO se pinta el panel, porque unos botones sin
   *  saber si la liquidación ya está firmada invitan a firmarla dos veces. */
  revision: {
    estado: RevisionDetalle;
    gastos: GastoAjustable[];
    /** `null` = el rol ve la firma pero no la pone. */
    accion: ((previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>) | null;
    /** A37-P-01: corregir el monto de un comprobante disputado por el operador. `null` = sin permiso. */
    corregir?: ((previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>) | null;
  } | null;
  /** El traductor del namespace «dinero» (la página lo obtiene con `getT`); sin él, español. */
  tr?: Tr;
}

type Gasto = LiquidacionDetalle['gastos'][number];

export function DetalleLiquidacion({ d, sufijo, estatus, etiqueta, pdfHref, revisionIlegible, reintentarPdf, wa, reasignar, reabrir, revision, tr = trEs }: PropsDetalle) {
  // LA FOTO DEL TICKET SE GUARDA (CFF art. 30, conservación 5 años) PERO NO SE
  // ENSEÑA AQUÍ. El aviso de privacidad (privacidad.ts:498) le promete al
  // operador que un dato sensible que aparezca por accidente en su ticket "no
  // se usa para nada" — pero ni `subirComprobante` ni nada en este flujo filtra
  // contenido sensible de la IMAGEN (solo del texto que el OCR extrae de ella,
  // ver sanitizar.ts). Enseñarla en un clic desde el panel del contralor sí es
  // "usarla": convertía la promesa en falsa. AUDITORÍA 9, CRÍTICO legal. Por
  // eso la tabla de abajo dice "Foto archivada" y NO pinta miniatura ni link.
  const hayAcred = d.litrosDiesel > 0 || d.ieps > 0 || d.iva > 0 || d.peaje > 0;
  // Las tres cubetas SIEMPRE suman totalComprobado (types/likida.ts). Se le
  // pasa el total PERSISTIDO junto a las cubetas RECONSTRUIDAS a propósito: si
  // los dos no cuadran, `filasDeducibilidad` devuelve null y no se pinta nada.
  // Un desglose que contradice al total que tiene tres centímetros arriba es
  // peor que no tener desglose.
  const deducibilidad = d.deducibilidad
    // FIS-6: sin `gastos`, `filasDeducibilidad` no puede ver la forma de pago
    // de cada comprobante y el pie de "Por confirmar" cae a la razón
    // genérica ("falta timbrar la factura o acreditar el medio de pago") aun
    // cuando el motivo real es un crédito (forma de pago '99') sin
    // complemento de pago — que el PDF SÍ nombra (LEYENDA_PAGO_PENDIENTE). Un
    // mismo comprobante con dos razones distintas en dos papeles es
    // exactamente lo que este producto existe para no hacer.
    ? filasDeducibilidad({
        ...d.deducibilidad, totalComprobado: d.totalComprobado, diferencias: d.diferencias, gastos: d.gastos,
      })
    : null;

  // ── Las diferencias, por comprobante ──
  // El motor cuelga cada diferencia de su `gastoId`; de ahí salen el estado
  // de cada renglón y los dos KPIs "Sin CFDI" / "Sobre tope". Un KPI se
  // calcula SOLO con lo que se puede cruzar: si una diferencia vieja no trae
  // `gastoId`, su monto no se conoce y la cifra se deja en guion con la nota.
  const tiposPorGasto = new Map<string, string[]>();
  for (const df of d.diferencias) {
    if (!df.gastoId) continue;
    tiposPorGasto.set(df.gastoId, [...(tiposPorGasto.get(df.gastoId) ?? []), df.tipo]);
  }
  const montoPorGasto = new Map(d.gastos.filter((g) => g.id).map((g) => [g.id as string, g.monto]));
  const difsSinCfdi = d.diferencias.filter((df) => df.tipo === 'sin_cfdi');
  const idsSinCfdi = new Set(difsSinCfdi.map((df) => df.gastoId).filter((x): x is string => !!x));
  const sinCfdiCruzable = difsSinCfdi.every((df) => df.gastoId && montoPorGasto.has(df.gastoId));
  const montoSinCfdi = [...idsSinCfdi].reduce((s, gid) => s + (montoPorGasto.get(gid) ?? 0), 0);
  const difsTope = d.diferencias.filter((df) => TIPOS_TOPE.has(df.tipo));
  const excedenteTope = difsTope.reduce((s, df) => s + (df.monto > 0 ? df.monto : 0), 0);
  const comprobantes = (n: number) => plural(tr, 'liquidacion.detalle.nComprobantes', n);

  const hitos: Hito[] = [
    { etiqueta: tr('liquidacion.detalle.hitoAvisado'), cuando: d.viaje.avisadoEn, pendiente: tr('liquidacion.detalle.hitoAvisadoVacio') },
    { etiqueta: tr('liquidacion.detalle.hitoAcepto'), cuando: d.viaje.aceptadoEn, pendiente: tr('liquidacion.detalle.hitoAceptoVacio') },
    ...(d.viaje.llegadaEn ? [{ etiqueta: tr('liquidacion.detalle.hitoLlego'), cuando: d.viaje.llegadaEn }] : []),
    ...(d.viaje.descargaEn ? [{ etiqueta: tr('liquidacion.detalle.hitoDescarga'), cuando: d.viaje.descargaEn }] : []),
    ...(d.viaje.regresoEn ? [{ etiqueta: tr('liquidacion.detalle.hitoRegreso'), cuando: d.viaje.regresoEn }] : []),
    {
      etiqueta: tr('liquidacion.detalle.hitoComprobantes'),
      cuando: d.comprobantesEntre.ultimo,
      pendiente: tr('liquidacion.detalle.hitoComprobantesVacio'),
      nota: d.comprobantesEntre.n > 0
        ? (d.comprobantesEntre.n > 1 && d.comprobantesEntre.primero
          ? plural(tr, 'liquidacion.detalle.hitoPrimero', d.comprobantesEntre.n, { fecha: fechaCorta(d.comprobantesEntre.primero) })
          : comprobantes(d.comprobantesEntre.n))
        : undefined,
    },
    { etiqueta: tr('liquidacion.detalle.hitoCuadre'), cuando: d.creadoEn },
    d.pdfPath
      ? { etiqueta: tr('liquidacion.detalle.hitoPdf'), cuando: null, textoSinHora: tr('liquidacion.detalle.hitoPdfListo') }
      : { etiqueta: tr('liquidacion.detalle.hitoPdf'), cuando: null, pendiente: tr('liquidacion.detalle.hitoPdfVacio') },
  ];

  const ruta = d.viaje.origen && d.viaje.destino
    ? `${d.viaje.origen} → ${d.viaje.destino}`
    : d.viaje.origen ?? d.viaje.destino ?? null;
  const sumaRenglones = d.gastos.reduce((s, g) => s + g.monto, 0);
  const montoTotal = d.comprobantesCuadran ? d.totalComprobado : sumaRenglones;

  const columnas: ColumnaBase<Gasto>[] = [
    {
      id: 'concepto', titulo: tr('liquidacion.detalle.colConcepto'), principal: true,
      celda: (g) => (
        <>
          {etiqueta(g)}
          {g.imagenUrl && <span className="rv-liq__sub-celda">{tr('liquidacion.detalle.fotoArchivada')}</span>}
        </>
      ),
    },
    {
      id: 'folio', titulo: tr('liquidacion.detalle.colFolio'),
      celda: (g) => (
        <>
          <span className={g.folio ? 'rv-liq__mono' : 'rv-liq__vacio-celda'}>{g.folio ?? '—'}</span>
          {g.cfdiUuid && <span className="rv-liq__uuid" title={g.cfdiUuid}>{g.cfdiUuid}</span>}
        </>
      ),
    },
    { id: 'fecha', titulo: tr('liquidacion.detalle.colFecha'), celda: (g) => (g.fecha ? fechaMx(g.fecha) : '—') },
    {
      id: 'forma', titulo: tr('liquidacion.detalle.colFormaPago'),
      celda: (g) => (g.formaPago ? etiquetaFormaPago(g.formaPago, tr) : <span className="rv-liq__vacio-celda">—</span>),
    },
    { id: 'monto', titulo: tr('liquidacion.detalle.colMonto'), alinear: 'der', celda: (g) => <span className="rv-liq__mono">{mxn(g.monto)}</span> },
    { id: 'estado', titulo: tr('liquidacion.detalle.colEstado'), celda: (g) => <PillRenglon tr={tr} e={estadoRenglon(g, g.id ? (tiposPorGasto.get(g.id) ?? []) : [])} /> },
  ];

  // Las cifras de la tira: valor en texto ya formateado (`mxn`), «—» cuando no se puede cruzar. Nada se rellena con un cero que nadie midió.
  const cifras: PropsCifra[] = [
    { etiqueta: tr('liquidacion.detalle.anticipo'), valor: mxn(d.totalAnticipo), nota: tr('liquidacion.detalle.anticipoNota'), info: 'liquidacion_detalle.anticipo' },
    {
      etiqueta: tr('liquidacion.detalle.comprobado'), valor: mxn(d.totalComprobado), info: 'liquidacion_detalle.comprobado',
      nota: d.comprobantesCuadran ? plural(tr, 'liquidacion.detalle.comprobadoValidos', d.gastos.length) : tr('liquidacion.detalle.comprobadoPersistido'),
    },
    {
      etiqueta: tr('liquidacion.detalle.diferencia'),
      valor: d.diferencia === 0 ? tr('liquidacion.detalle.cuadraExacto') : mxn(Math.abs(d.diferencia)),
      tono: d.diferencia === 0 ? 'ok' : d.diferencia > 0 ? 'warn' : 'bad',
      nota: d.diferencia === 0 ? tr('liquidacion.detalle.cuadraNota') : d.diferencia > 0 ? tr('liquidacion.detalle.sobranteNota') : tr('liquidacion.detalle.faltanteNota'),
      info: 'liquidacion_detalle.diferencia',
    },
    {
      etiqueta: tr('liquidacion.detalle.sinCfdi'),
      valor: difsSinCfdi.length === 0 ? mxn(0) : sinCfdiCruzable ? mxn(montoSinCfdi) : '—',
      tono: difsSinCfdi.length > 0 ? 'warn' : undefined,
      info: 'liquidacion_detalle.sin_cfdi',
      nota: difsSinCfdi.length === 0 ? tr('liquidacion.detalle.sinCfdiTodoTrae') : sinCfdiCruzable ? plural(tr, 'liquidacion.detalle.sinCfdiNota', idsSinCfdi.size) : plural(tr, 'liquidacion.detalle.sinCfdiNoCruzable', difsSinCfdi.length),
    },
    {
      etiqueta: tr('liquidacion.detalle.sobreTope'),
      valor: mxn(excedenteTope),
      tono: difsTope.length > 0 ? 'warn' : undefined,
      info: 'liquidacion_detalle.sobre_tope',
      nota: difsTope.length === 0 ? tr('liquidacion.detalle.sobreTopeNada') : plural(tr, 'liquidacion.detalle.sobreTopeNota', difsTope.length),
    },
  ];

  return (
    <EsqueletoFicha
      area={tr('liquidacion.detalle.area')}
      titulo={tr('liquidacion.detalle.titulo', { folio: d.folio })}
      apoyo={tr('liquidacion.detalle.apoyo')}
      volver={{ href: `/dashboard/viajes${sufijo}`, etiqueta: tr('liquidacion.detalle.volverViajes') }}
      acciones={(
        <>
          {wa && (
            <BotonEnlace tamano="sm" variante="secondary" href={wa} target="_blank" rel="noopener noreferrer" icono={<Icono icono={MessageCircle} />}>
              {tr('liquidacion.detalle.verWhatsapp')}
            </BotonEnlace>
          )}
          {/* El PDF existía, estaba autenticado y no había forma de llegar a
              él: `pdf_url` ni se seleccionaba (auditoría 5, frontend, MEDIO 5). */}
          {pdfHref && (
            <BotonEnlace tamano="sm" variante="primary" href={pdfHref} icono={<Icono icono={Download} />}>
              {tr('liquidacion.detalle.descargarPdf')}
            </BotonEnlace>
          )}
        </>
      )}
      etiquetaResumen={tr('liquidacion.detalle.fichaTitulo')}
      chips={(
        <>
          <li><StatusChip tono={estatus.estado}>{estatus.label}</StatusChip></li>
          {/* Hora de México, no UTC: `.slice(0,10)` fechaba en agosto una liquidación cerrada el 31 de julio a las 20:00 (ver formato.ts). */}
          <li className="rv-liq__nota">{tr('liquidacion.detalle.cerradaEl', { fecha: fechaMx(d.creadoEn) })}</li>
        </>
      )}
      avisos={(
        <>
          {/* No se pudo leer el estado de revisión (BE-A1/FE-M2): esta pantalla NO puede afirmar que la liquidación está vigente, porque
              podría estar rechazada y no lo sabemos. Va PRIMERO — antes que cualquier otro aviso — porque pone en duda todo lo que sigue. */}
          {revisionIlegible && (
            <Aviso tono="error" titulo={tr('liquidacion.detalle.revisionIlegibleTitulo')}>{tr('liquidacion.detalle.revisionIlegibleCuerpo')}</Aviso>
          )}
        </>
      )}
      cifras={cifras}
      etiquetaCifras={tr('liquidacion.detalle.titulo', { folio: d.folio })}
      variante="6-6"
      bloques={[
        <Tarjeta key="ficha" titulo={tr('liquidacion.detalle.fichaTitulo')}>
          <CamposSistema
            etiqueta={tr('liquidacion.detalle.fichaTitulo')}
            campos={[
              { etiqueta: tr('liquidacion.detalle.inicio'), valor: d.viaje.fechaInicio ? fechaMx(d.viaje.fechaInicio) : '—' },
              { etiqueta: tr('liquidacion.detalle.ruta'), valor: ruta ?? <span className="rv-liq__vacio-celda">{tr('liquidacion.detalle.sinRuta')}</span> },
              { etiqueta: tr('liquidacion.detalle.operador'), valor: d.operadorNombre },
              {
                etiqueta: tr('liquidacion.detalle.unidad'),
                valor: d.viaje.unidadEco
                  ? <>{d.viaje.unidadEco}{d.viaje.unidadPlacas && <span className="rv-liq__sub-celda"> · {d.viaje.unidadPlacas}</span>}</>
                  : <span className="rv-liq__vacio-celda">{tr('liquidacion.detalle.sinUnidad')}</span>,
              },
              { etiqueta: tr('liquidacion.detalle.cliente'), valor: d.viaje.clienteNombre ?? <span className="rv-liq__vacio-celda">{tr('liquidacion.detalle.sinCliente')}</span> },
              { etiqueta: tr('liquidacion.detalle.comprobantes'), valor: d.comprobantesEntre.n > 0 ? comprobantes(d.comprobantesEntre.n) : '—' },
            ]}
          />
          {/* ── Chofer asignado / reasignar ──
              Solo dueño/encargado (permisos.ts: puedeAsignar) — un contador o un superadmin de paso por el tenant demo no mueve viajes de chofer. */}
          {reasignar && (
            <div className="rv-liq__reasignar">
              <FormaReasignar accion={reasignar.accion} buscar={reasignar.buscar}
                actual={reasignar.actual} actualNombre={reasignar.actualNombre} total={reasignar.total} />
            </div>
          )}
        </Tarjeta>,
        /* ── Línea de tiempo ── */
        <Tarjeta key="linea" titulo={tr('liquidacion.detalle.lineaTitulo')} info="liquidacion_detalle.linea_tiempo" contenida>
          <LineaDeTiempo hitos={hitos} tr={tr} />
          <p className="rv-liq__tenue">{tr('liquidacion.detalle.lineaNota')}</p>
        </Tarjeta>,
        /* ── Acreditable / recuperable ──
            Litros, no pesos: el estímulo del LIF 20-A es cuota semanal del DOF × litros y esa cuota no la tenemos. `ieps` solo puede venir de
            filas viejas escritas antes del cambio; se conserva para no ocultarlas. */
        <Tarjeta key="acred" titulo={tr('liquidacion.detalle.acreditableTitulo')} info="liquidacion_detalle.acreditable">
          <CamposSistema
            etiqueta={tr('liquidacion.detalle.acreditableTabla')}
            campos={[
              { etiqueta: tr('liquidacion.detalle.dieselElegible'), valor: d.litrosDiesel > 0 ? litros(d.litrosDiesel) : '—' },
              { etiqueta: tr('liquidacion.detalle.iepsDiesel'), valor: d.ieps > 0 ? mxn(d.ieps) : '—' },
              { etiqueta: tr('liquidacion.detalle.ivaAcreditable'), valor: d.iva > 0 ? mxn(d.iva) : '—' },
              { etiqueta: tr('liquidacion.detalle.peaje50'), valor: d.peaje > 0 ? mxn(d.peaje) : '—' },
            ]}
          />
          {/* AUDITORÍA 12, ALTO (fiscal): el peaje acreditable no es automático — el motor no verifica ninguna de las condiciones de la ficha
              (ingresos < $300M, autopistas de cuota). El PDF ya lo decía; el panel no. */}
          <p className="rv-liq__tenue">{hayAcred ? tr('liquidacion.detalle.acreditableNota') : tr('liquidacion.detalle.acreditableNada')}</p>

          {/* ── De lo comprobado, cuánto sobrevive al SAT ──
              Este reparto es la razón por la que el contralor compra, y hasta hoy solo existía en el PDF (auditoría 5, frontend, ALTO 2). */}
          {deducibilidad && (
            <div className="rv-liq__sub">
              <p className="rv-liq__sub-titulo">{tr('liquidacion.detalle.deducibleTitulo')}</p>
              <ul className="rv-liq__lista">
                {deducibilidad.map((f) => (
                  <li key={f.label} className="rv-liq__fila" data-tono={f.tono === 'malo' ? 'bad' : undefined}>
                    <span className="rv-liq__fila-etq">
                      {f.label}
                      {f.pie && <span className="rv-liq__fila-pie">{f.pie}</span>}
                    </span>
                    <span className="rv-liq__cifra">{mxn(f.monto)}</span>
                  </li>
                ))}
              </ul>
              <p className="rv-liq__tenue">{tr('liquidacion.detalle.deducibleNota')}</p>
            </div>
          )}

          {/* ── DEDUCIBLE ≠ PAGADERO (tableros al día, 28-ago-2026) ──
              El mismo resumen que el PDF imprime desde el 1-ago, con las MISMAS funciones. La decisión se toma aquí; la advertencia (LFT
              110/111/263: «no deducible» NO autoriza descontárselo al operador) va aquí. */}
          {d.laboral && <SeccionLaboral laboral={d.laboral} tr={tr} />}
        </Tarjeta>,
      ]}
    >
      {reintentarPdf && (
        <Tarjeta titulo={tr('liquidacion.detalle.pdfPendienteTitulo')}>
          <p className="rv-liq__nota">{tr('liquidacion.detalle.pdfPendienteTexto')}</p>
          <FormaConAviso accion={reintentarPdf} boton={tr('liquidacion.detalle.reintentarPdf')} columnas="md:grid-cols-1">
            <span className="rv-liq__tenue">{tr('liquidacion.detalle.reintentarPdfNota')}</span>
          </FormaConAviso>
        </Tarjeta>
      )}

      {/* ── Diferencias en lenguaje humano ── */}
      {d.diferencias.length > 0 && (
        <Tarjeta titulo={`${tr('liquidacion.detalle.diferenciasTitulo')} · ${d.diferencias.length}`} info="liquidacion_detalle.diferencias">
          <ul className="rv-liq__lista">
            {d.diferencias.map((df, i) => <Diferencia key={i} nota={df.nota} monto={df.monto} tr={tr} />)}
          </ul>
          <p className="rv-liq__tenue">{tr('liquidacion.detalle.aprobarDescontarRazon')}</p>
        </Tarjeta>
      )}

      {/* ── Comprobantes ──
          Los renglones son los mismos que imprime el PDF (duplicados y
          montos inválidos fuera) y el total va al pie, para que el
          contralor no tenga que sumar la columna con el dedo. */}
      <Tarjeta titulo={tr('liquidacion.detalle.comprobantesTitulo')} info="liquidacion_detalle.comprobantes">
        {d.comprobantesExcluidos > 0 && (
          <p className="rv-liq__nota">{plural(tr, 'liquidacion.detalle.excluidos', d.comprobantesExcluidos)}</p>
        )}
        {d.gastos.length === 0 ? (
          // Pasa de verdad: en el tenant del demo hay liquidaciones con total
          // guardado y cero filas en `gasto`. Una tabla con encabezados y nada
          // debajo se lee como "se perdieron los comprobantes"; esto dice qué
          // pasó y a dónde ir.
          <EstadoVacio titulo={tr('liquidacion.detalle.sinRenglonesTitulo')}>{tr('liquidacion.detalle.sinRenglones', { total: mxn(d.totalComprobado) })}</EstadoVacio>
        ) : (
          <>
            <TablaBase
              etiqueta={tr('liquidacion.detalle.renglonesTabla')}
              columnas={columnas}
              filas={d.gastos}
              idFila={(g) => g.id ?? `${g.concepto}-${g.folio ?? ''}-${g.fecha ?? ''}-${g.monto}`}
              tarjetaMovil
            />
            <div className="rv-liq__total">
              <span className="rv-liq__total-etq">
                {d.comprobantesCuadran ? tr('liquidacion.detalle.totalComprobado') : tr('liquidacion.detalle.sumaRenglones')}
                <span>{comprobantes(d.gastos.length)}</span>
              </span>
              <span className="rv-liq__total-monto">{mxn(montoTotal)}</span>
            </div>
          </>
        )}
        {!d.comprobantesCuadran && d.gastos.length > 0 && (
          <p className="rv-liq__nota">{tr('liquidacion.detalle.noCuadran', { total: mxn(d.totalComprobado) })}</p>
        )}
      </Tarjeta>

      {/* La firma va ANTES de «reabrir»: es lo que se hace todos los
          días; reabrir es lo excepcional y destructivo. */}
      {revision && (
        <PanelRevision estado={revision.estado} gastos={revision.gastos}
          accion={revision.accion} folio={d.folio} corregir={revision.corregir ?? null} />
      )}

      {reabrir && (
        <Tarjeta titulo={tr('liquidacion.detalle.reabrirTitulo')} info="liquidacion_detalle.reabrir">
          <p className="rv-liq__nota">
            {rico(tr('liquidacion.detalle.reabrirTexto'), { strong: (c) => <strong>{c}</strong> })}
          </p>
          <FormaConAviso accion={reabrir} boton={tr('liquidacion.detalle.reabrirBoton')} columnas="md:grid-cols-1">
            <Casilla name="confirmar" etiqueta={tr('liquidacion.detalle.reabrirEntiendo', { folio: d.folio })} />
          </FormaConAviso>
        </Tarjeta>
      )}

      <p className="rv-liq__cierre">{LEYENDA_CORTA}</p>
    </EsqueletoFicha>
  );
}


/** DEDUCIBLE ≠ PAGADERO en pantalla — exportada para probarla sin montar el
 *  detalle entero. El texto es EL MISMO que imprime el PDF (`resumenLaboral`):
 *  dos redacciones de la misma obligación laboral serían dos opiniones
 *  legales, y este producto emite una. */
export function SeccionLaboral({ laboral, tr = trEs }: { laboral: ResumenLaboral; tr?: Tr }) {
  return (
    <div className="rv-liq__sub">
      <p className="rv-liq__sub-titulo">{tr('liquidacion.detalle.laboralTitulo')}</p>
      <div className="rv-liq__fila">
        <span className="rv-liq__fila-etq">{laboral.texto}</span>
        {laboral.montoPagadero > 0 && <span className="rv-liq__cifra">{mxn(laboral.montoPagadero)}</span>}
      </div>
      <p className="rv-liq__tenue">{tr('liquidacion.detalle.laboralNota')}</p>
    </div>
  );
}
