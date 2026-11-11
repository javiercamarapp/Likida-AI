import Link from 'next/link';
import {
  AvisoCompacto, BarraFiltros, Boton, CampoArchivo, EstadoVacio, FiltroFecha, FiltroOpciones, Icono, StatusChip, TablaBase, Tarjeta,
  type TonoEstado, Tooltip } from '@/app/ui-v2/componentes';
import { Truck, Download, RefreshCw, FileText, FileSpreadsheet, Send, Settings2 } from 'lucide-react';
import { fechaCorta, numero, hoyMx, fechaHoraMx } from '@/lib/formato';
import './liquidacion.css';
import { Ficha } from './desgloses';
import { dinero } from '@/lib/likida/liquidacion_externa/presentacion';
import { motivoDeFallo } from '@/lib/likida/liquidacion_externa/api';
import {
  ESTADOS, type EstadoLiquidacionExterna, type LiquidacionExterna, type EstadoAvisoDiscrepancia,
} from '@/lib/likida/liquidacion_externa/repo';
import { EnlacePagina, NavPaginas } from '../../paginador';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// «LIQUIDACIONES EXTERNAS» — el tablero del modo «solo entrega».
//
// Estas liquidaciones NO las calculó Likida: las calculó el SAP/TMS de la flota
// y Likida solo las entrega al chofer por WhatsApp. Por eso:
//
//   · viven en su propia sección y NO se mezclan con la cola de revisión ni con
//     los KPIs del agente (cuyas cifras sí salen del motor de cuadre);
//   · el rótulo de las cifras dice «calculada por tu sistema»: el contralor no
//     debe creer que Likida verificó un cálculo que no hizo;
//   · cada conteo es un conteo EXACTO de la base, y `null` se pinta «—» con su
//     leyenda: un cero que nadie midió afirmaría «nada falló» estando ciego.
//
// Lo primero que tiene que ver la oficina: las que el chofer marcó «No
// coincide», y las que fallaron — son las dos que piden una persona.
// ═══════════════════════════════════════════════════════════════════════════

export interface FichasExternas {
  porEstado: Record<EstadoLiquidacionExterna, number | null>;
  noCoincide: number | null;
}

export interface PaginaExternas {
  filas: LiquidacionExterna[];
  hayMas: boolean;
  siguiente: string | null;
  total: number | null;
}

export interface ExternasProps {
  fichas: Promise<FichasExternas>;
  pagina: Promise<PaginaExternas>;
  filtroEstado: FiltroExterno | null;
  /** Los campos de la query a conservar (`tenant`, `vista`, `rol`). */
  contexto: Array<[string, string]>;
  /** Mensaje de la última acción (`ext_msg`), ya validado contra la lista. */
  mensaje: MensajeExterno | null;
  puedeReintentar: boolean;
  /** Server action del host: reintenta UNA entrega fallida. */
  reintentar: (fd: FormData) => Promise<void>;
  /** El formato de la flota (0564): `null` = no se pudo leer; `{…false}` = no tiene. */
  formato?: Promise<{ excel: boolean; copia: boolean } | null>;
  /** Server action del host: reenvía la copia al jefe de flota de UNA liquidación. */
  reenviarCopia?: (fd: FormData) => Promise<void>;
  /** Server action del host: sube el CSV/Excel de liquidaciones de la flota. Solo si el rol puede administrar. */
  subirArchivo?: (fd: FormData) => Promise<void>;
  /** Lo que dejó la última carga (de la URL: se valida aquí, no se confía). */
  importacion?: { conteo?: string; detalle?: string };
  /** El estado del aviso a la oficina de cada liquidación en «No coincide» (0643). `null` = la base aún no lo guarda o no se pudo leer:
   *  no se pinta rótulo (jamás se inventa uno). Una liquidación sin entrada aquí no tiene aviso registrado. */
  avisos?: Promise<Record<string, { estado: EstadoAvisoDiscrepancia }> | null>;
  /** Server action del host: vuelve a avisar a la oficina de UNA discrepancia (rearma el aviso fallido o pendiente). */
  reavisar?: (fd: FormData) => Promise<void>;
}

/** El rótulo del aviso a la oficina de una discrepancia: lo que la persona necesita saber para no suponer que alguien ya lo sabe. */
export const rotuloAviso = (tx: TAgentes = TR_ES.t): Record<EstadoAvisoDiscrepancia | 'sin_registro', { rotulo: string; ayuda: string; tono: 'ok' | 'warn' | 'bad' | 'muted' }> => ({
  enviado: { rotulo: tx('rest.oficina_avisada'), ayuda: tx('rest.el_aviso_por_whatsapp_ya_salio'), tono: 'ok' },
  pendiente: { rotulo: tx('rest.aviso_pendiente'), ayuda: tx('rest.el_aviso_todavia_no_llega_a'), tono: 'warn' },
  enviando: { rotulo: tx('rest.avisando'), ayuda: tx('rest.el_aviso_se_esta_mandando_en'), tono: 'warn' },
  fallido: { rotulo: tx('rest.el_aviso_no_llego'), ayuda: tx('rest.se_agotaron_los_intentos_avisa_tu'), tono: 'bad' },
  sin_registro: { rotulo: tx('rest.aviso_sin_registrar'), ayuda: tx('rest.no_hay_registro_del_aviso_a'), tono: 'muted' },
});
export const ROTULO_AVISO = rotuloAviso();

const rotuloEstado = (tx: TAgentes = TR_ES.t): Record<EstadoLiquidacionExterna, { rotulo: string; ayuda: string; tono: TonoEstado }> => ({
  pendiente: { rotulo: tx('proveedores.vista.est_pendiente'), ayuda: tx('rest.recibida_todavia_no_entra_a_la'), tono: 'muted' },
  en_cola: { rotulo: tx('rest.en_cola'), ayuda: tx('rest.en_la_cola_de_whatsapp_se'), tono: 'warn' },
  enviada: { rotulo: tx('rest.enviada'), ayuda: tx('rest.whatsapp_acepto_el_mensaje_el_chofer'), tono: 'ok' },
  acusada: { rotulo: tx('rest.con_respuesta'), ayuda: tx('rest.el_chofer_apreto_un_boton'), tono: 'ok' },
  fallida: { rotulo: tx('rest.fallo'), ayuda: tx('rest.no_se_pudo_entregar_se_puede'), tono: 'bad' },
});

export type MensajeExterno = 'reintentada' | 'no_aplica' | 'no_encontrada' | 'error' | 'copia_enviada' | 'copia_ya' | 'copia_fallo' | 'copia_sin_jefe' | 'importada' | 'importacion_error'
  | 'reaviso_ok' | 'reaviso_parcial' | 'reaviso_pendiente' | 'reaviso_ya' | 'reaviso_en_curso' | 'canal_correo';

const mensajes = (tx: TAgentes = TR_ES.t): Record<MensajeExterno, { texto: string; tono: 'ok' | 'bad' }> => ({
  reaviso_ok: { texto: tx('rest.listo_el_aviso_salio_hacia_la'), tono: 'ok' },
  reaviso_parcial: { texto: tx('rest.el_aviso_salio_a_una_parte'), tono: 'ok' },
  reaviso_pendiente: { texto: tx('rest.whatsapp_no_acepto_el_aviso_la'), tono: 'bad' },
  reaviso_ya: { texto: tx('rest.ese_aviso_ya_habia_salido_no'), tono: 'ok' },
  reaviso_en_curso: { texto: tx('rest.otra_persona_o_el_envio_automatico'), tono: 'ok' },
  canal_correo: { texto: tx('rest.esta_flota_recibe_las_liquidaciones_por'), tono: 'bad' },
  copia_enviada: { texto: tx('rest.listo_la_copia_salio_hacia_el'), tono: 'ok' },
  copia_ya: { texto: tx('rest.la_copia_ya_se_habia_enviado'), tono: 'ok' },
  copia_fallo: { texto: tx('rest.whatsapp_no_acepto_la_copia_la'), tono: 'bad' },
  copia_sin_jefe: { texto: tx('rest.no_hay_jefe_de_flota_designado'), tono: 'bad' },
  importada: { texto: tx('rest.archivo_procesado'), tono: 'ok' },
  importacion_error: { texto: tx('rest.no_se_pudo_leer_el_archivo'), tono: 'bad' },
  reintentada: { texto: tx('rest.listo_la_entrega_se_reintento_si'), tono: 'ok' },
  no_aplica: { texto: tx('rest.esa_liquidacion_ya_no_esta_fallida'), tono: 'bad' },
  no_encontrada: { texto: tx('rest.no_encontre_esa_liquidacion_en_tu'), tono: 'bad' },
  error: { texto: tx('rest.no_se_pudo_reintentar_ahorita_vuelve'), tono: 'bad' },
});

export function leerMensajeExterno(v: string | undefined): ExternasProps['mensaje'] {
  return v && Object.prototype.hasOwnProperty.call(mensajes(), v) ? (v as MensajeExterno) : null;
}

/** El filtro de la URL: un estado de entrega, o `no_coincide` (la respuesta del
 *  chofer que más pide a una persona, que vive dentro de `acusada`). */
export type FiltroExterno = EstadoLiquidacionExterna | 'no_coincide';

export function leerFiltroExterno(v: string | undefined): FiltroExterno | null {
  if (v === 'no_coincide') return 'no_coincide';
  return v && (ESTADOS as readonly string[]).includes(v) ? (v as EstadoLiquidacionExterna) : null;
}

function textoImportacion(m: 'importada' | 'importacion_error', imp: ExternasProps['importacion'], tx: TAgentes = TR_ES.t): string {
  const det = (imp?.detalle ?? '').slice(0, 700);
  if (m === 'importacion_error') return det || mensajes(tx).importacion_error.texto;
  const n = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(imp?.conteo ?? '');
  if (!n) return mensajes(tx).importada.texto;
  const base = tx('rest.archivo_procesado_liquidacion_es_recibida_s', { n: n[1], n2: n[2], n3: n[3] });
  return det ? `${base} ${det}` : base;
}

function query(contexto: Array<[string, string]>, extra: Array<[string, string]> = []): string {
  return `?${new URLSearchParams([...contexto, ...extra]).toString()}`;
}

/** El hijo más sencillo posible de la sección: la que llega por su cuenta. */
export async function SeccionExternas(p: ExternasProps) {
  const { t: tx } = await getT('agentes');
  const [fichas, pagina, formato, avisos] = await Promise.all([p.fichas, p.pagina, p.formato ?? null, p.avisos ?? null]);
  const hoy = hoyMx();
  const hace30 = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
  const sinNada = pagina.filas.length === 0 && !p.filtroEstado;

  const textoMensaje = p.mensaje
    ? (p.mensaje === 'importada' || p.mensaje === 'importacion_error' ? textoImportacion(p.mensaje, p.importacion) : mensajes(tx)[p.mensaje].texto)
    : null;

  return (
    <div id="liquidaciones-externas">
    <Tarjeta
      titulo={tx('rest.liquidaciones_externas')}
      acciones={<span className="rv-liq-sub">{pagina.total !== null ? `${numero(pagina.total)} en total` : tx('rest.total_no_disponible')}</span>}
    >
      <p className="rv-liq-sub">
        <Link href={`/dashboard/agentes/liquidacion/formato${query(p.contexto)}`} className="rv-liq-enlace">
          <Icono icono={Settings2} tam={14} />{' '}{tx('rest.formato_de_las_liquidaciones')}</Link>{' '}{tx('rest.calculadas_por_el_sistema_de_tu')}</p>

      {textoMensaje && p.mensaje && <AvisoCompacto tono={mensajes(tx)[p.mensaje].tono === 'ok' ? 'ok' : 'error'} resumen={textoMensaje} />}

      {p.subirArchivo && (
        <form action={p.subirArchivo} className="rv-liq-acciones rv-liq-acciones--forma">
          <CampoArchivo etiqueta={tx('rest.subir_liquidaciones_csv_o_excel_de')} name="archivo" accept=".csv,.txt,.xlsx,.xls,.ods" required />
          <Boton type="submit" variante="primary">{tx('rest.subir_y_entregar')}</Boton>
        </form>
      )}

      {/* ── Las fichas: lo que pide a una persona, primero ── */}
      <div className="rv-liq-fichas">
        <Ficha etiqueta={tx('rest.no_coincide')} valor={fichas.noCoincide} tono="bad" ayuda={tx('rest.el_chofer_dice_que_su_liquidacion')}
          href={query(p.contexto, [['ext_estado', 'no_coincide']])} />
        <Ficha etiqueta={tx('rest.fallaron')} valor={fichas.porEstado.fallida} tono="bad" ayuda={rotuloEstado(tx).fallida.ayuda}
          href={query(p.contexto, [['ext_estado', 'fallida']])} />
        <Ficha etiqueta={tx('rest.pendientes')} valor={fichas.porEstado.pendiente} ayuda={rotuloEstado(tx).pendiente.ayuda}
          href={query(p.contexto, [['ext_estado', 'pendiente']])} />
        <Ficha etiqueta={tx('rest.en_cola')} valor={fichas.porEstado.en_cola} ayuda={rotuloEstado(tx).en_cola.ayuda}
          href={query(p.contexto, [['ext_estado', 'en_cola']])} />
        <Ficha etiqueta={tx('rest.enviadas')} valor={fichas.porEstado.enviada} ayuda={rotuloEstado(tx).enviada.ayuda}
          href={query(p.contexto, [['ext_estado', 'enviada']])} />
        <Ficha etiqueta={tx('rest.con_respuesta')} valor={fichas.porEstado.acusada} ayuda={rotuloEstado(tx).acusada.ayuda}
          href={query(p.contexto, [['ext_estado', 'acusada']])} />
      </div>

      <div className="rv-liq-barras">
        <BarraFiltros accion="?" enLinea ocultos={p.contexto} etiqueta={tx('rest.filtros_de_liquidaciones_externas')} nActivos={p.filtroEstado ? 1 : 0} limpiarHref={query(p.contexto)}>
          <FiltroOpciones nombre="ext_estado" etiqueta={tx('proveedores.vista.estado')} valor={p.filtroEstado ?? ''}
            opciones={[{ valor: '', rotulo: tx('rest.todos') }, ...ESTADOS.map((e) => ({ valor: e, rotulo: rotuloEstado(tx)[e].rotulo })), { valor: 'no_coincide', rotulo: tx('rest.no_coincide_respuesta_del_chofer') }]} />
        </BarraFiltros>

        {/* El CSV es de un PERIODO (máximo 3 meses): el rótulo lo dice. GET a la
            ruta de export, que re-gatea sesión, área y rol. Aquí elegir una fecha NO
            envía: exportar es una acción, no un filtro. */}
        <BarraFiltros accion="/api/export/liquidaciones-externas" enLinea etiqueta={tx('rest.exportar_csv_por_periodo')}
          ocultos={[
            ...p.contexto.filter(([k]) => k === 'tenant'),
            ...(p.filtroEstado && p.filtroEstado !== 'no_coincide' ? [['estado', p.filtroEstado] as const] : []),
            ...(p.filtroEstado === 'no_coincide' ? [['respuestaChofer', 'no_coincide'] as const] : []),
          ]}>
          <FiltroFecha nombre="desde" etiqueta={tx('cobranza.estrategia.desde')} valor={hace30} autoEnvio={false} />
          <FiltroFecha nombre="hasta" etiqueta={tx('cobranza.estrategia.hasta')} valor={hoy} autoEnvio={false} />
          <Boton type="submit" tamano="sm" icono={<Icono icono={Download} />}>{tx('rest.exportar_csv')}</Boton>
        </BarraFiltros>
      </div>

      {pagina.filas.length === 0 ? (
        <EstadoVacio icono={Truck} titulo={sinNada ? tx('rest.aun_sin_liquidaciones_externas') : tx('rest.ninguna_con_ese_estado')}>
          {sinNada
            ? tx('rest.todavia_no_ha_llegado_ninguna_liquidacion')
            : tx('rest.ninguna_liquidacion_cae_en_ese_estado')}
        </EstadoVacio>
      ) : (
        <>
          <TablaBase<LiquidacionExterna>
            etiqueta={tx('rest.liquidaciones_externas')}
            filas={pagina.filas}
            idFila={(l) => l.id}
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              {
                id: 'folio', titulo: tx('rest.folio'), principal: true,
                celda: (l) => (
                  <>
                    <strong>{l.claveExterna}</strong>
                    {l.sistemaOrigen && <span className="rv-liq-nota">{l.sistemaOrigen}</span>}
                  </>
                ),
              },
              { id: 'operador', titulo: tx('conductores.forma.operador'), celda: (l) => <span className="rv-liq-apagado">{l.operadorNombre ?? '—'}</span> },
              { id: 'periodo', titulo: tx('rest.periodo'), celda: (l) => <span className="rv-liq-apagado">{fechaCorta(l.periodoDesde)} – {fechaCorta(l.periodoHasta)}</span> },
              { id: 'total', titulo: tx('rest.total_de_tu_sistema'), alinear: 'der', celda: (l) => <span className="cifra-mono">{dinero(l.total, l.moneda)}</span> },
              {
                id: 'estado', titulo: tx('proveedores.vista.estado'),
                celda: (l) => {
                  const e = rotuloEstado(tx)[l.estado] ?? { rotulo: l.estado, ayuda: '', tono: 'muted' as const };
                  const fallo = motivoDeFallo(l.ultimoError);
                  return (
                    <>
                      <StatusChip tono={e.tono} title={e.ayuda}>{e.rotulo}</StatusChip>
                      {l.via === 'plantilla' && <span className="rv-liq-nota">{tx('rest.por_plantilla_fuera_de_las_24')}</span>}
                      {/* El porqué, en frase: jamás el cuerpo crudo del error de Meta. */}
                      {fallo && l.estado !== 'acusada' && <span className="rv-liq-nota" data-tono="bad">{fallo.texto}</span>}
                    </>
                  );
                },
              },
              {
                id: 'respuesta', titulo: tx('rest.respuesta_del_chofer'),
                celda: (l) => {
                  const disputa = l.acuseTipo === 'no_coincide';
                  // El aviso a la oficina solo existe para una discrepancia, y solo se pinta si la base lo guarda (`avisos` no nulo).
                  const aviso = disputa && avisos ? rotuloAviso(tx)[avisos[l.id]?.estado ?? 'sin_registro'] : null;
                  return (
                    <span data-disputa={disputa || undefined}>
                      {l.acuseTipo === 'recibida' && <span className="rv-liq-ok">{tx('rest.recibida')}</span>}
                      {disputa && <strong className="rv-liq-malo">{tx('rest.no_coincide')}</strong>}
                      {l.acuseTipo === null && <span className="rv-liq-apagado">{tx('rest.sin_respuesta')}</span>}
                      {l.acuseEn && <span className="rv-liq-nota">{fechaHoraMx(l.acuseEn)}</span>}
                      {aviso && <span className="rv-liq-nota" data-tono={aviso.tono} title={aviso.ayuda}>{aviso.rotulo}</span>}
                    </span>
                  );
                },
              },
              { id: 'enviada', titulo: tx('rest.enviada'), celda: (l) => <span className="rv-liq-apagado">{l.enviadaEn ? fechaHoraMx(l.enviadaEn) : '—'}</span> },
              { id: 'acciones', titulo: tx('rest.acciones'), alinear: 'der', celda: (l) => <AccionesFila l={l} p={p} formato={formato} avisos={avisos} /> },
            ]}
          />
          <div className="rv-liq-pagina">
            <p className="rv-liq-sub">{tx('rest.de_la_mas_nueva_a_la')}</p>
            {pagina.siguiente && (
              <NavPaginas>
                <EnlacePagina
                  href={query(p.contexto, [...(p.filtroEstado ? [['ext_estado', p.filtroEstado] as [string, string]] : []), ['ext_cursor', pagina.siguiente]])}
                  direccion="siguiente"
                />
              </NavPaginas>
            )}
          </div>
        </>
      )}
    </Tarjeta>
    </div>
  );
}

function AccionesFila({ l, p, formato, avisos, tr = TR_ES }: { l: LiquidacionExterna; p: ExternasProps; formato: { excel: boolean; copia: boolean } | null; avisos: Record<string, { estado: EstadoAvisoDiscrepancia }> | null; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const disputa = l.acuseTipo === 'no_coincide';
  const puedeReavisar = disputa && avisos !== null && p.puedeReintentar && !!p.reavisar && (avisos[l.id]?.estado ?? 'sin_registro') !== 'enviado';
  return (
    <span className="rv-liq-acciones">
      {l.pdfRuta && (
        <a href={`/api/export/liquidaciones-externas${query(p.contexto.filter(([k]) => k === 'tenant'), [['pdf', l.id]])}`} className="rv-liq-enlace">
          <Icono icono={FileText} tam={14} /> PDF
        </a>
      )}
      {formato?.excel && l.pdfRuta && l.pdfOrigen === 'generado' && (
        <a href={`/api/export/liquidaciones-externas${query(p.contexto.filter(([k]) => k === 'tenant'), [['excel', l.id]])}`} className="rv-liq-enlace">
          <Icono icono={FileSpreadsheet} tam={14} /> Excel
        </a>
      )}
      {formato?.copia && p.reenviarCopia && l.estado !== 'pendiente' && l.estado !== 'fallida' && (
        <form action={p.reenviarCopia}>
          <input type="hidden" name="id" value={l.id} />
          <Tooltip texto={tx('rest.reenvia_la_copia_al_jefe_de')}><Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={Send} />}>{tx('rest.copia_al_jefe')}</Boton></Tooltip>
        </form>
      )}
      {puedeReavisar && p.reavisar && (
        <form action={p.reavisar}>
          <input type="hidden" name="id" value={l.id} />
          <Tooltip texto={tx('rest.vuelve_a_avisar_a_la_persona')}><Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={Send} />}>{tx('rest.reavisar')}</Boton></Tooltip>
        </form>
      )}
      {l.estado === 'fallida' && p.puedeReintentar && (
        <form action={p.reintentar}>
          <input type="hidden" name="id" value={l.id} />
          <Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={RefreshCw} />}>{tx('rest.reintentar')}</Boton>
        </form>
      )}
    </span>
  );
}
