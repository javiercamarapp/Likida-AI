import { CheckCircle2 } from 'lucide-react';
import '../agentes.css';
import './facturas.css';
import '../proveedores/proveedores.css';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { enrutar, type Ruta } from '@/lib/likida/facturacion/enrutar';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { ColaJefe, type FilaJefe, type AccionMarcarFacturada } from './cola-jefe';
import { SeccionPortales, type FilaPortal } from './portales-vinculo';
import type { AccionRelogin } from './relogin-controles';
import { SeccionControlEmision, type DatosControl } from './control-emision';
import { BarList, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { AvisoCompacto, BarraPeriodo, FilaTarjetas, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { TR_ES, rico, type TrAgentes, selloHoyTr } from '../i18n-agentes';

/** Topes de las listas — declarados en pantalla cuando recortan, nunca en
 *  silencio (los encabezados suman la lista COMPLETA). */
const MAX_TE_TOCA = 12;
const MAX_MINI = 5;

export interface ExtraAgenteFacturas {
  /** Gastos con CFDI ya amarrado (histórico). null = no se pudo contar. */
  conCfdi: number | null;
  /** ¿La emisión automática de verdad emite hoy (modo + mandato)? */
  emite: boolean;
}

/**
 * El render del Agente de Facturas (v2, 13-ago-2026: "que se entienda TODO
 * lo que hace el agente" + "¿qué tiene que hacer el jefe de flota?"). La
 * página se organiza con la MISMA regla que el código (`enrutar.ts`):
 *
 *   · TE TOCA A TI — cuenta del portal o bloqueo (CAPTCHA…): tu cola.
 *   · LA MÁQUINA SE ENCARGA — sin cuenta y con todo leído: monitoreo.
 *   · INCOMPLETOS — falta un dato o ya venció: se dice QUÉ falta.
 *
 * Nada se pinta que no salga de un ticket real; el modo de emisión se
 * declara (en ensayo no se promete emisión).
 */
export function VistaAgenteFacturas({ tickets, extra, marcarFacturada, notificaciones, portalesConAdaptador, portales, vinculosLeidos, autorizarRelogin, revocarRelogin, control, tr = TR_ES }: {
  tickets: TicketPorFacturar[];
  extra: ExtraAgenteFacturas;
  /**
   * El estado del vínculo por portal, ya resuelto en la página. Llega como
   * datos y no se calcula aquí por lo mismo que `portalesConAdaptador`: el
   * catálogo y el repositorio viven en el servidor.
   */
  portales: FilaPortal[];
  /** `false` = no se pudo leer el estado. NO es «ninguno vinculado». */
  vinculosLeidos: boolean;
  /**
   * Las server actions del permiso de re-login (0233). Igual que
   * `marcarFacturada`: viven en el servidor y re-verifican sesión, rol y
   * flota adentro — esta vista solo las pasa hacia abajo.
   */
  autorizarRelogin: AccionRelogin;
  revocarRelogin: AccionRelogin;
  /** El control de la emisión real (0542), ya leído en la página. */
  control: DatosControl;
  /** Server action de la puerta: escribe el CFDI capturado y re-verifica
   *  sesión/rol/tenant ADENTRO — la vista solo la pasa a la cola. */
  marcarFacturada: AccionMarcarFacturada;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /**
   * Los portales para los que HAY adaptador escrito (`PORTALES_CONOCIDOS`).
   *
   * Llega como prop y no por import por la misma razón que `notificaciones`:
   * ese registro arrastra los adaptadores de Playwright, y esta vista corre en
   * el cliente. Lo resuelve la página, que sí es servidor.
   */
  portalesConAdaptador: readonly string[]; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  // Orden por VENCIMIENTO real (no por fecha del ticket): vencidos arriba,
  // desconocidos al final. Cotas finitas — Infinity-Infinity da NaN.
  const orden = (t: TicketPorFacturar) =>
    t.caducidad.desconocido ? 1e9 : t.caducidad.vencido ? -1e9 : t.caducidad.diasRestantes;
  const ordenados = [...tickets].sort((a, b) => orden(a) - orden(b));

  // El reparto del código, tal cual: quién factura cada ticket.
  const rutas = ordenados.map((t) => ({
    t, r: enrutar(t, t.comercio ? portalesConAdaptador.includes(t.comercio.clave) : false),
  }));
  const teToca = rutas.filter((x) => x.r.via === 'mensaje');
  const maquina = rutas.filter((x) => x.r.via === 'automatico');
  const incompletos = rutas.filter((x) => x.r.via === 'incompleto');
  const monto = (xs: typeof rutas) => xs.reduce((s, x) => s + x.t.monto, 0);

  const vencidos = ordenados.filter((t) => t.caducidad.vencido);
  const urgentes = ordenados.filter((t) => t.caducidad.urgente && !t.caducidad.vencido);
  const montoSinFactura = ordenados.reduce((s, t) => s + t.monto, 0);

  // Dónde se concentra el dinero sin factura (top 4 comercios + el resto).
  const porComercio = new Map<string, number>();
  for (const t of ordenados) {
    const k = t.comercio?.nombre ?? tx('facturas.vista.sin_identificar');
    porComercio.set(k, (porComercio.get(k) ?? 0) + t.monto);
  }
  const comerciosTop = [...porComercio.entries()].sort((a, b) => b[1] - a[1]);
  const donaComercios = comerciosTop.slice(0, 4).map(([etiqueta, valor]) => ({ etiqueta, valor }));
  const restoComercios = comerciosTop.slice(4).reduce((s, [, v]) => s + v, 0);
  if (restoComercios > 0) donaComercios.push({ etiqueta: tx('facturas.vista.otros_c'), valor: restoComercios });

  // Qué les falta a los incompletos, agregado (la primera falta de cada uno).
  const faltas = new Map<string, number>();
  for (const x of incompletos) {
    const f = (x.r as Extract<Ruta, { via: 'incompleto' }>).falta[0] ?? tx('facturas.vista.dato_ilegible');
    faltas.set(f, (faltas.get(f) ?? 0) + 1);
  }
  const faltasTop = [...faltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Los bloqueos son la parte de "lo que hizo solo" que habla: la máquina se
  // rindió A PROPÓSITO (captcha, emisión sin confirmar) y dejó el porqué.
  const bloqueados = teToca.filter((x) => (x.r as Extract<Ruta, { via: 'mensaje' }>).motivo === 'bloqueado');

  const cifras: PropsCifra[] = ([
    { info: 'facturas.por_facturar', etiqueta: tx('facturas.vista.por_facturar'), valor: numero(ordenados.length), nota: tx('facturas.vista.tickets_sin_cfdi_hoy'),
      // Barra de 6 px (Rovaq pc-kpis): vencidos, urgentes y el resto de la cola; conjuntos disjuntos, suman el total.
      segmentos: ordenados.length > 0 ? [
        { etiqueta: tx('facturas.vista.vencidos'), valor: vencidos.length },
        { etiqueta: tx('facturas.vista.urgentes_2_dias'), valor: urgentes.length },
        { etiqueta: tx('facturas.vista.por_facturar'), valor: ordenados.length - vencidos.length - urgentes.length },
      ] : undefined },
    { info: 'facturas.monto_sin_factura', etiqueta: tx('facturas.vista.monto_sin_factura'), valor: mxn(montoSinFactura, tr.idioma) },
    { info: 'facturas.urgentes', etiqueta: tx('facturas.vista.urgentes_2_dias'), valor: numero(urgentes.length), tono: urgentes.length > 0 ? 'warn' : undefined },
    { info: 'facturas.vencidos', etiqueta: tx('facturas.vista.vencidos'), valor: numero(vencidos.length), tono: vencidos.length > 0 ? 'bad' : undefined },
  ] as PropsCifra[]).map((c) => ({ ...c, matiz: c.matiz ?? 8 }));

  return (
    <EsqueletoTablaMaestra
      titulo={tx('facturas.vista.facturas_en_automatico')}
      apoyo={tx('facturas.vista.tickets_sin_cfdi_lo_que')}
      filtros={<BarraPeriodo etiqueta={tx('facturas.vista.sello_tickets_sin_cfdi')} chips={[{ id: 'alcance', etiqueta: tx('facturas.vista.tickets_sin_cfdi_hoy') }]} />}
      cifras={cifras}
      etiquetaCifras={tx('facturas.vista.sello_tickets_sin_cfdi')}
      selloCifras={selloHoyTr(tr, tx('facturas.vista.sello_tickets_sin_cfdi'))}
      // En ensayo no se promete emisión: el aviso va arriba, a la vista, no escondido en un párrafo.
      avisos={!extra.emite ? (
        <AvisoCompacto tono="warn" resumen={tx('facturas.vista.la_emision_automatica_hoy_esta')}
          mas={tx('facturas.vista.si_tu_empresa_aun_no')} />
      ) : undefined}
    >
      <div className="rv-ag-pila rv-ag-compacto">
      <FilaTarjetas variante="8-4">
        {/* ── TU COLA: lo único de esta página que espera una acción tuya ── */}
        <Tarjeta titulo={tx('facturas.vista.te_toca_a_ti')} info="facturas.te_toca"
          estado={teToca.length === 0 ? 'vacio' : 'ok'} iconoVacio={CheckCircle2}
          mensaje={tx('facturas.vista.hoy_no_te_toca_capturar')}
          detalle={tx('facturas.vista.lo_demas_lo_trae_la')}>
          <p className="rv-fact__nota">
            {rico(tx('facturas.vista.portales_que_piden_tu_cuenta'), { monto: monto(teToca) > 0 && <> · <span className="cifra-mono">{mxn(monto(teToca), tr.idioma)}</span></> })}
          </p>
          <ColaJefe
            filas={teToca.slice(0, MAX_TE_TOCA).map(({ t, r }): FilaJefe => {
              const m = r as Extract<Ruta, { via: 'mensaje' }>;
              return {
                gastoId: t.gastoId,
                fecha: t.fecha,
                comercio: t.comercio?.nombre ?? tx('facturas.vista.sin_identificar'),
                portal: m.portal,
                urlTicket: t.urlTicket,
                concepto: etiquetaConcepto(t.concepto),
                monto: t.monto,
                caducidad: t.caducidad,
                motivo: m.motivo,
                detalle: m.detalle ?? t.bloqueo?.motivo,
                campos: m.campos.map((c) => ({ etiqueta: c.etiqueta, valor: c.valor, requerido: c.requerido })),
              };
            })}
            marcarFacturada={marcarFacturada}
            maxFilas={MAX_TE_TOCA}
            totalFilas={teToca.length}
          />
        </Tarjeta>

        {/* ── Lo que hizo solo ── */}
        <Tarjeta titulo={tx('facturas.vista.lo_que_hizo_solo')} info="facturas.hizo_solo"
          estado={extra.conCfdi === null && bloqueados.length === 0 ? 'error' : 'ok'}
          mensaje={tx('facturas.vista.no_se_pudo_leer_el')}>
          {extra.conCfdi !== null && (
            <p className="rv-fact__nota">
              {rico(tx('facturas.vista.tickets_con_factura_ya_amarrada'), { span: <span className="cifra-mono rv-fact__grande">{numero(extra.conCfdi)}</span> })}
            </p>
          )}
          {bloqueados.slice(0, MAX_MINI).map(({ t, r }) => (
            <p key={t.gastoId} className="rv-fact__nota">
              {rico(tx('facturas.vista.con_y_te_lo_dejo'), { chip: <StatusChip tono="warn">{tx('facturas.vista.se_rindio_a_proposito')}</StatusChip>, comercio: <strong>{t.comercio?.nombre}</strong>, detalle: (r as Extract<Ruta, { via: 'mensaje' }>).detalle ?? tx('facturas.vista.muro_del_portal'), fecha: t.bloqueo && <> · {fechaCorta(t.bloqueo.desde, tr.idioma)}</> })}
            </p>
          ))}
          {extra.conCfdi === 0 && bloqueados.length === 0 && (
            <p className="rv-fact__nota">{tx('facturas.vista.aun_no_amarra_su_primera')}</p>
          )}
        </Tarjeta>
      </FilaTarjetas>

      {/* ── El VÍNCULO por portal: lo que decide si esta cola crece sola ── */}
      <SeccionPortales tr={tr} filas={portales} vinculos={vinculosLeidos}
        autorizarRelogin={autorizarRelogin} revocarRelogin={revocarRelogin} flota={control.flotaPintada} />

      {/* ── La emisión real: encender, límites, lotes por confirmar, fase por portal (0542) ── */}
      <SeccionControlEmision datos={control} />

      <FilaTarjetas variante="4-4-4">
        {/* ── Monitoreo: lo que NO tienes que hacer ── */}
        <Tarjeta titulo={tx('facturas.vista.la_maquina_se_encarga')} info="facturas.maquina"
          estado={maquina.length === 0 ? 'vacio' : 'ok'} mensaje={tx('facturas.vista.nada_en_la_cola_automatica')} detalle={tx('facturas.vista.no_hay_tickets_que_la')}>
          <p className="rv-fact__nota">
            {extra.emite
              ? tx('facturas.vista.sin_cuenta_y_con_todo')
              : tx('facturas.vista.hoy_en_ensayo_puedes_capturarlos')}
          </p>
          <p className="rv-fact__nota"><span className="cifra-mono rv-fact__grande">{numero(maquina.length)} · {mxn(monto(maquina), tr.idioma)}</span></p>
          <ul className="rv-fact__lista">
            {maquina.slice(0, MAX_MINI).map(({ t }) => (
              <li key={t.gastoId}>
                <span>{t.comercio?.nombre} · {etiquetaConcepto(t.concepto)}</span>
                <span className="cifra-mono">{mxn(t.monto, tr.idioma)}</span>
              </li>
            ))}
          </ul>
          {maquina.length > MAX_MINI && (
            <p className="rv-fact__nota">{tx('facturas.vista.y_mas_el_total_de', { n: numero(maquina.length - MAX_MINI) })}</p>
          )}
        </Tarjeta>

        {/* ── Incompletos: se dice QUÉ falta ── */}
        <Tarjeta titulo={tx('facturas.vista.incompletos')} info="facturas.incompletos"
          estado={incompletos.length === 0 ? 'vacio' : 'ok'} mensaje={tx('facturas.vista.ninguno_incompleto')} detalle={tx('facturas.vista.todo_ticket_sin_factura_tiene')}>
          <p className="rv-fact__nota">{tx('facturas.vista.ni_tu_ni_la_maquina')}</p>
          <p className="rv-fact__nota"><span className="cifra-mono rv-fact__grande">{numero(incompletos.length)} · {mxn(monto(incompletos), tr.idioma)}</span></p>
          <ul className="rv-fact__lista">
            {faltasTop.map(([f, n]) => (
              <li key={f}><span>{f}</span><span className="cifra-mono">{numero(n)}</span></li>
            ))}
          </ul>
        </Tarjeta>

        {/* ── Dónde está el dinero sin factura ── */}
        <Tarjeta titulo={tx('facturas.vista.sin_factura_por_comercio')} info="facturas.por_comercio"
          estado={donaComercios.length === 0 ? 'vacio' : 'ok'} mensaje={tx('facturas.vista.ningun_gasto_sin_factura')} detalle={tx('facturas.vista.cuando_entre_un_comprobante_sin')}>
          <p className="rv-fact__nota">{tx('facturas.vista.donde_se_concentra_el_monto')}</p>
          <BarList etiqueta={tx('facturas.vista.monto_sin_factura_por_comercio')} formato={mxn}
            items={donaComercios.map((c) => ({ clave: c.etiqueta, etiqueta: c.etiqueta, valor: c.valor, texto: mxn(c.valor, tr.idioma) }))} />
        </Tarjeta>
      </FilaTarjetas>

      {notificaciones}
      </div>
    </EsqueletoTablaMaestra>
  );
}
