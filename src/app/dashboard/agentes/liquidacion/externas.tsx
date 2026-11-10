import Link from 'next/link';
import {
  AvisoCompacto, BarraFiltros, Boton, CampoArchivo, EstadoVacio, FiltroFecha, FiltroOpciones, Icono, StatusChip, TablaBase, Tarjeta,
  type TonoEstado,
} from '@/app/ui-v2/componentes';
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
export const ROTULO_AVISO: Record<EstadoAvisoDiscrepancia | 'sin_registro', { rotulo: string; ayuda: string; tono: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  enviado: { rotulo: 'Oficina avisada', ayuda: 'El aviso por WhatsApp ya salió hacia la persona responsable.', tono: 'ok' },
  pendiente: { rotulo: 'Aviso pendiente', ayuda: 'El aviso todavía no llega a la oficina; se reintenta solo con espera creciente. Puedes reavisar ya.', tono: 'warn' },
  enviando: { rotulo: 'Avisando…', ayuda: 'El aviso se está mandando en este momento.', tono: 'warn' },
  fallido: { rotulo: 'El aviso no llegó', ayuda: 'Se agotaron los intentos: avisa tú o pulsa Reavisar. La tarea para una persona ya está abierta en el asistente.', tono: 'bad' },
  sin_registro: { rotulo: 'Aviso sin registrar', ayuda: 'No hay registro del aviso a la oficina (el acuse es anterior a esta función). Puedes reavisar.', tono: 'muted' },
};

const ROTULO_ESTADO: Record<EstadoLiquidacionExterna, { rotulo: string; ayuda: string; tono: TonoEstado }> = {
  pendiente: { rotulo: 'Pendiente', ayuda: 'Recibida; todavía no entra a la cola de WhatsApp.', tono: 'muted' },
  en_cola: { rotulo: 'En cola', ayuda: 'En la cola de WhatsApp; se reintenta sola.', tono: 'warn' },
  enviada: { rotulo: 'Enviada', ayuda: 'WhatsApp aceptó el mensaje; el chofer todavía no responde.', tono: 'ok' },
  acusada: { rotulo: 'Con respuesta', ayuda: 'El chofer apretó un botón.', tono: 'ok' },
  fallida: { rotulo: 'Falló', ayuda: 'No se pudo entregar. Se puede reintentar.', tono: 'bad' },
};

export type MensajeExterno = 'reintentada' | 'no_aplica' | 'no_encontrada' | 'error' | 'copia_enviada' | 'copia_ya' | 'copia_fallo' | 'copia_sin_jefe' | 'importada' | 'importacion_error'
  | 'reaviso_ok' | 'reaviso_parcial' | 'reaviso_pendiente' | 'reaviso_ya' | 'reaviso_en_curso' | 'canal_correo';

const MENSAJES: Record<MensajeExterno, { texto: string; tono: 'ok' | 'bad' }> = {
  reaviso_ok: { texto: 'Listo: el aviso salió hacia la persona responsable.', tono: 'ok' },
  reaviso_parcial: { texto: 'El aviso salió a una parte de los designados; el resto se reintenta solo.', tono: 'ok' },
  reaviso_pendiente: { texto: 'WhatsApp no aceptó el aviso (¿la plantilla de avisos sigue sin aprobar?). Se reintenta solo; la tarea para una persona ya está abierta en el asistente.', tono: 'bad' },
  reaviso_ya: { texto: 'Ese aviso ya había salido: no se mandó otra vez.', tono: 'ok' },
  reaviso_en_curso: { texto: 'Otra persona o el envío automático lo está mandando en este momento. Revisa en un minuto.', tono: 'ok' },
  canal_correo: { texto: 'Esta flota recibe las liquidaciones por correo: no se manda nada por WhatsApp desde aquí.', tono: 'bad' },
  copia_enviada: { texto: 'Listo: la copia salió hacia el jefe de flota.', tono: 'ok' },
  copia_ya: { texto: 'La copia ya se había enviado: no se mandó otra vez.', tono: 'ok' },
  copia_fallo: { texto: 'WhatsApp no aceptó la copia (¿la plantilla de avisos sigue sin aprobar?). La entrega al operador no se afectó. Vuelve a intentarlo más tarde.', tono: 'bad' },
  copia_sin_jefe: { texto: 'No hay jefe de flota designado: agrégalo en «Formato de las liquidaciones».', tono: 'bad' },
  importada: { texto: 'Archivo procesado.', tono: 'ok' },
  importacion_error: { texto: 'No se pudo leer el archivo.', tono: 'bad' },
  reintentada: { texto: 'Listo: la entrega se reintentó. Si WhatsApp la acepta, pasa a «Enviada».', tono: 'ok' },
  no_aplica: { texto: 'Esa liquidación ya no está fallida (alguien más la reintentó, o ya salió): no se mandó otra vez.', tono: 'bad' },
  no_encontrada: { texto: 'No encontré esa liquidación en tu flota.', tono: 'bad' },
  error: { texto: 'No se pudo reintentar ahorita. Vuelve a intentarlo en un momento.', tono: 'bad' },
};

export function leerMensajeExterno(v: string | undefined): ExternasProps['mensaje'] {
  return v && Object.prototype.hasOwnProperty.call(MENSAJES, v) ? (v as MensajeExterno) : null;
}

/** El filtro de la URL: un estado de entrega, o `no_coincide` (la respuesta del
 *  chofer que más pide a una persona, que vive dentro de `acusada`). */
export type FiltroExterno = EstadoLiquidacionExterna | 'no_coincide';

export function leerFiltroExterno(v: string | undefined): FiltroExterno | null {
  if (v === 'no_coincide') return 'no_coincide';
  return v && (ESTADOS as readonly string[]).includes(v) ? (v as EstadoLiquidacionExterna) : null;
}

function textoImportacion(m: 'importada' | 'importacion_error', imp: ExternasProps['importacion']): string {
  const det = (imp?.detalle ?? '').slice(0, 700);
  if (m === 'importacion_error') return det || MENSAJES.importacion_error.texto;
  const n = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(imp?.conteo ?? '');
  if (!n) return MENSAJES.importada.texto;
  const base = `Archivo procesado: ${n[1]} liquidación(es) recibida(s) y puestas a entregar, ${n[2]} ya estaban (no se repitieron), ${n[3]} con problemas.`;
  return det ? `${base} ${det}` : base;
}

function query(contexto: Array<[string, string]>, extra: Array<[string, string]> = []): string {
  return `?${new URLSearchParams([...contexto, ...extra]).toString()}`;
}

/** El hijo más sencillo posible de la sección: la que llega por su cuenta. */
export async function SeccionExternas(p: ExternasProps) {
  const [fichas, pagina, formato, avisos] = await Promise.all([p.fichas, p.pagina, p.formato ?? null, p.avisos ?? null]);
  const hoy = hoyMx();
  const hace30 = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
  const sinNada = pagina.filas.length === 0 && !p.filtroEstado;

  const textoMensaje = p.mensaje
    ? (p.mensaje === 'importada' || p.mensaje === 'importacion_error' ? textoImportacion(p.mensaje, p.importacion) : MENSAJES[p.mensaje].texto)
    : null;

  return (
    <div id="liquidaciones-externas">
    <Tarjeta
      titulo="Liquidaciones externas"
      acciones={<span className="rv-liq-sub">{pagina.total !== null ? `${numero(pagina.total)} en total` : 'Total no disponible'}</span>}
    >
      <p className="rv-liq-sub">
        <Link href={`/dashboard/agentes/liquidacion/formato${query(p.contexto)}`} className="rv-liq-enlace">
          <Icono icono={Settings2} tam={14} /> Formato de las liquidaciones
        </Link>{' '}
        Calculadas por el sistema de tu empresa (SAP/TMS). Likida solo las entrega al chofer por WhatsApp y registra su
        respuesta: no las recalcula ni las mezcla con las del cuadre de arriba.
      </p>

      {textoMensaje && p.mensaje && <AvisoCompacto tono={MENSAJES[p.mensaje].tono === 'ok' ? 'ok' : 'error'} resumen={textoMensaje} />}

      {p.subirArchivo && (
        <form action={p.subirArchivo} className="rv-liq-acciones rv-liq-acciones--forma">
          <CampoArchivo etiqueta="Subir liquidaciones (CSV o Excel de tu sistema; una fila por renglón, agrupadas por la clave de tu sistema)" name="archivo" accept=".csv,.txt,.xlsx,.xls,.ods" required />
          <Boton type="submit" variante="primary">Subir y entregar</Boton>
        </form>
      )}

      {/* ── Las fichas: lo que pide a una persona, primero ── */}
      <div className="rv-liq-fichas">
        <Ficha etiqueta="No coincide" valor={fichas.noCoincide} tono="bad" ayuda="El chofer dice que su liquidación no cuadra. Revísala con él."
          href={query(p.contexto, [['ext_estado', 'no_coincide']])} />
        <Ficha etiqueta="Fallaron" valor={fichas.porEstado.fallida} tono="bad" ayuda={ROTULO_ESTADO.fallida.ayuda}
          href={query(p.contexto, [['ext_estado', 'fallida']])} />
        <Ficha etiqueta="Pendientes" valor={fichas.porEstado.pendiente} ayuda={ROTULO_ESTADO.pendiente.ayuda}
          href={query(p.contexto, [['ext_estado', 'pendiente']])} />
        <Ficha etiqueta="En cola" valor={fichas.porEstado.en_cola} ayuda={ROTULO_ESTADO.en_cola.ayuda}
          href={query(p.contexto, [['ext_estado', 'en_cola']])} />
        <Ficha etiqueta="Enviadas" valor={fichas.porEstado.enviada} ayuda={ROTULO_ESTADO.enviada.ayuda}
          href={query(p.contexto, [['ext_estado', 'enviada']])} />
        <Ficha etiqueta="Con respuesta" valor={fichas.porEstado.acusada} ayuda={ROTULO_ESTADO.acusada.ayuda}
          href={query(p.contexto, [['ext_estado', 'acusada']])} />
      </div>

      <div className="rv-liq-barras">
        <BarraFiltros accion="?" enLinea ocultos={p.contexto} etiqueta="Filtros de liquidaciones externas" nActivos={p.filtroEstado ? 1 : 0} limpiarHref={query(p.contexto)}>
          <FiltroOpciones nombre="ext_estado" etiqueta="Estado" valor={p.filtroEstado ?? ''}
            opciones={[{ valor: '', rotulo: 'Todos' }, ...ESTADOS.map((e) => ({ valor: e, rotulo: ROTULO_ESTADO[e].rotulo })), { valor: 'no_coincide', rotulo: 'No coincide (respuesta del chofer)' }]} />
        </BarraFiltros>

        {/* El CSV es de un PERIODO (máximo 3 meses): el rótulo lo dice. GET a la
            ruta de export, que re-gatea sesión, área y rol. Aquí elegir una fecha NO
            envía: exportar es una acción, no un filtro. */}
        <BarraFiltros accion="/api/export/liquidaciones-externas" enLinea etiqueta="Exportar CSV por periodo"
          ocultos={[
            ...p.contexto.filter(([k]) => k === 'tenant'),
            ...(p.filtroEstado && p.filtroEstado !== 'no_coincide' ? [['estado', p.filtroEstado] as const] : []),
            ...(p.filtroEstado === 'no_coincide' ? [['respuestaChofer', 'no_coincide'] as const] : []),
          ]}>
          <FiltroFecha nombre="desde" etiqueta="Desde" valor={hace30} autoEnvio={false} />
          <FiltroFecha nombre="hasta" etiqueta="Hasta" valor={hoy} autoEnvio={false} />
          <Boton type="submit" tamano="sm" icono={<Icono icono={Download} />}>Exportar CSV</Boton>
        </BarraFiltros>
      </div>

      {pagina.filas.length === 0 ? (
        <EstadoVacio icono={Truck} titulo={sinNada ? 'Aún sin liquidaciones externas' : 'Ninguna con ese estado'}>
          {sinNada
            ? 'Todavía no ha llegado ninguna liquidación de tu sistema. Cuando tu SAP/TMS la mande a Likida (POST /v1/liquidaciones-externas), la vas a ver aquí con su estado de entrega.'
            : 'Ninguna liquidación cae en ese estado.'}
        </EstadoVacio>
      ) : (
        <>
          <TablaBase<LiquidacionExterna>
            etiqueta="Liquidaciones externas"
            filas={pagina.filas}
            idFila={(l) => l.id}
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              {
                id: 'folio', titulo: 'Folio', principal: true,
                celda: (l) => (
                  <>
                    <strong>{l.claveExterna}</strong>
                    {l.sistemaOrigen && <span className="rv-liq-nota">{l.sistemaOrigen}</span>}
                  </>
                ),
              },
              { id: 'operador', titulo: 'Operador', celda: (l) => <span className="rv-liq-apagado">{l.operadorNombre ?? '—'}</span> },
              { id: 'periodo', titulo: 'Periodo', celda: (l) => <span className="rv-liq-apagado">{fechaCorta(l.periodoDesde)} – {fechaCorta(l.periodoHasta)}</span> },
              { id: 'total', titulo: 'Total (de tu sistema)', alinear: 'der', celda: (l) => <span className="cifra-mono">{dinero(l.total, l.moneda)}</span> },
              {
                id: 'estado', titulo: 'Estado',
                celda: (l) => {
                  const e = ROTULO_ESTADO[l.estado] ?? { rotulo: l.estado, ayuda: '', tono: 'muted' as const };
                  const fallo = motivoDeFallo(l.ultimoError);
                  return (
                    <>
                      <StatusChip tono={e.tono} title={e.ayuda}>{e.rotulo}</StatusChip>
                      {l.via === 'plantilla' && <span className="rv-liq-nota">por plantilla (fuera de las 24 h)</span>}
                      {/* El porqué, en frase: jamás el cuerpo crudo del error de Meta. */}
                      {fallo && l.estado !== 'acusada' && <span className="rv-liq-nota" data-tono="bad">{fallo.texto}</span>}
                    </>
                  );
                },
              },
              {
                id: 'respuesta', titulo: 'Respuesta del chofer',
                celda: (l) => {
                  const disputa = l.acuseTipo === 'no_coincide';
                  // El aviso a la oficina solo existe para una discrepancia, y solo se pinta si la base lo guarda (`avisos` no nulo).
                  const aviso = disputa && avisos ? ROTULO_AVISO[avisos[l.id]?.estado ?? 'sin_registro'] : null;
                  return (
                    <span data-disputa={disputa || undefined}>
                      {l.acuseTipo === 'recibida' && <span className="rv-liq-ok">Recibida</span>}
                      {disputa && <strong className="rv-liq-malo">No coincide</strong>}
                      {l.acuseTipo === null && <span className="rv-liq-apagado">Sin respuesta</span>}
                      {l.acuseEn && <span className="rv-liq-nota">{fechaHoraMx(l.acuseEn)}</span>}
                      {aviso && <span className="rv-liq-nota" data-tono={aviso.tono} title={aviso.ayuda}>{aviso.rotulo}</span>}
                    </span>
                  );
                },
              },
              { id: 'enviada', titulo: 'Enviada', celda: (l) => <span className="rv-liq-apagado">{l.enviadaEn ? fechaHoraMx(l.enviadaEn) : '—'}</span> },
              { id: 'acciones', titulo: 'Acciones', alinear: 'der', celda: (l) => <AccionesFila l={l} p={p} formato={formato} avisos={avisos} /> },
            ]}
          />
          <div className="rv-liq-pagina">
            <p className="rv-liq-sub">De la más nueva a la más vieja.</p>
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

function AccionesFila({ l, p, formato, avisos }: { l: LiquidacionExterna; p: ExternasProps; formato: { excel: boolean; copia: boolean } | null; avisos: Record<string, { estado: EstadoAvisoDiscrepancia }> | null }) {
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
          <Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={Send} />} title="Reenvía la copia al jefe de flota (solo se manda si aún no salió)">Copia al jefe</Boton>
        </form>
      )}
      {puedeReavisar && p.reavisar && (
        <form action={p.reavisar}>
          <input type="hidden" name="id" value={l.id} />
          <Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={Send} />} title="Vuelve a avisar a la persona responsable (no repite a quien ya recibió el aviso)">Reavisar</Boton>
        </form>
      )}
      {l.estado === 'fallida' && p.puedeReintentar && (
        <form action={p.reintentar}>
          <input type="hidden" name="id" value={l.id} />
          <Boton type="submit" variante="ghost" tamano="sm" icono={<Icono icono={RefreshCw} />}>Reintentar</Boton>
        </form>
      )}
    </span>
  );
}
