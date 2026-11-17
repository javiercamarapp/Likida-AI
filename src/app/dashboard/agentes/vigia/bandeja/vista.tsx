import Link from 'next/link';
import { ArrowLeft, Inbox, MessageSquare } from 'lucide-react';
import './bandeja.css';
import { fechaHoraMx, numero } from '@/lib/formato';
import type { DatosTablero, MensajeHilo } from '@/lib/likida/vigia/repo';
import { TOPE_CONVERSACIONES_TABLERO, TOPE_MENSAJES_HILO } from '@/lib/likida/vigia/repo';
import {
  cifrasDeBandeja, filasDeBandeja, filtrarBandeja, ordenarBandeja, responsablesPorNivel, ESTADOS_ATENCION, PRIORIDADES_BANDEJA,
  type FilaBandeja, type FiltrosBandeja, type PrioridadBandeja,
} from '@/lib/likida/vigia/bandeja_atencion';
import { Bloque } from '../../../bloque';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { AvisoCompacto, BarraFiltros, Chip, EsqTablaV2, FiltroOpciones, Icono, MarcoPagina, Tarjeta, type TonoChip } from '@/app/ui-v2/componentes';
import { VacioAgente } from '../../vacio-agente';
import { selloHoyTr, type TrAgentes, type TAgentes } from '../../i18n-agentes';
import { BotonConversacion, FormaBorrador, FormaResponder, type AccionVigia } from '../controles';
import { duracion } from '../vista';

export interface AccionesBandeja { decidir: AccionVigia; conversacion: AccionVigia }

const RUTA = '/dashboard/agentes/vigia/bandeja';
const RUTA_SIN_ATENDER = '/dashboard/agentes/vigia/sin-atender';
const TONO_PRIORIDAD: Record<PrioridadBandeja, TonoChip> = { urgente: 'bad', alta: 'warn', normal: 'neutral' };

/** El enlace a una conversación (o a la lista) conservando los filtros y la flota que se está viendo. PURA. */
export function hrefBandeja(f: FiltrosBandeja, extra: { chat?: string | null; sufijo?: string; ocultos?: ReadonlyArray<readonly [string, string]> }): string {
  const q = new URLSearchParams();
  for (const [k, v] of extra.ocultos ?? []) q.set(k, v);
  if (f.estado) q.set('estado', f.estado);
  if (f.prioridad) q.set('prioridad', f.prioridad);
  if (f.clienteId) q.set('cliente', f.clienteId);
  if (extra.chat) q.set('chat', extra.chat);
  const s = q.toString();
  return s ? `${RUTA}?${s}` : RUTA;
}

function conParams(ruta: string, ocultos: ReadonlyArray<readonly [string, string]>): string {
  const q = new URLSearchParams([...ocultos]).toString();
  return q ? ruta + '?' + q : ruta;
}

export function VistaBandeja({ tr, datos, hilo, chat, filtros, ahoraMs, puedeDecidir, acciones, ocultos }: {
  tr: TrAgentes;
  datos: Promise<DatosTablero>;
  /** El hilo de la conversación abierta: null si no hay ninguna, 'error' si no se pudo leer. */
  hilo: Promise<MensajeHilo[] | 'error' | null>;
  chat: string | null;
  filtros: FiltrosBandeja;
  ahoraMs: number;
  puedeDecidir: boolean;
  acciones: AccionesBandeja;
  ocultos: ReadonlyArray<readonly [string, string]>;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('bj.titulo')} apoyo={tx('bj.apoyo')}>
      <Bloque mensaje={tx('bj.error')} esqueleto={<EsqTablaV2 />}>
        <ContenidoBandeja tr={tr} datos={datos} hilo={hilo} chat={chat} filtros={filtros} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} ocultos={ocultos} />
      </Bloque>
    </MarcoPagina>
  );
}

export async function ContenidoBandeja({ tr, datos, hilo, chat, filtros, ahoraMs, puedeDecidir, acciones, ocultos }: {
  tr: TrAgentes; datos: Promise<DatosTablero>; hilo: Promise<MensajeHilo[] | 'error' | null>; chat: string | null; filtros: FiltrosBandeja;
  ahoraMs: number; puedeDecidir: boolean; acciones: AccionesBandeja; ocultos: ReadonlyArray<readonly [string, string]>;
}) {
  const { t: tx } = tr;
  const d = await datos;
  const todas = filasDeBandeja(d, ahoraMs);
  const cifras = cifrasDeBandeja(todas);
  const visibles = ordenarBandeja(filtrarBandeja(todas, filtros));
  const sla = d.config.slaRespuestaMin;
  const seleccionada = chat ? todas.find((f) => f.id === chat) ?? null : null;
  const hayFiltros = Boolean(filtros.estado || filtros.prioridad || filtros.clienteId);
  const sinFiltros: FiltrosBandeja = { estado: '', prioridad: '', clienteId: '' };

  return (
    <div className="rv-bj__raiz">
      {!d.config.habilitado && <AvisoCompacto tono="warn" resumen={tx('bj.apagado')} />}
      <div className="rv-bj__entra">
        <TiraCifras sello={selloHoyTr(tr, tx('bj.cifras.etiqueta'))} items={[
          { etiqueta: tx('bj.cifra.urgentes'), valor: numero(cifras.porPrioridad.urgente), nota: tx('bj.cifra.urgentes_nota'), tono: cifras.porPrioridad.urgente > 0 ? 'bad' : undefined },
          { etiqueta: tx('bj.cifra.altas'), valor: numero(cifras.porPrioridad.alta), nota: tx('bj.cifra.altas_nota'), tono: cifras.porPrioridad.alta > 0 ? 'warn' : undefined },
          { etiqueta: tx('bj.cifra.sin_responder'), valor: numero(cifras.sinResponder), nota: tx('bj.cifra.sin_responder_nota', { n: numero(cifras.fueraDePlazo), sla: numero(sla) }), tono: cifras.fueraDePlazo > 0 ? 'bad' : undefined },
          { etiqueta: tx('bj.cifra.por_aprobar'), valor: numero(cifras.porAprobar), nota: tx('bj.cifra.por_aprobar_nota'), tono: cifras.porAprobar > 0 ? 'warn' : undefined },
        ]} />
      </div>
      {cifras.masAntiguaMin !== null && <p className="rv-vg__nota">{tx('bj.mas_antigua', { dur: duracion(cifras.masAntiguaMin) })}</p>}
      {d.conversaciones.length >= TOPE_CONVERSACIONES_TABLERO && <p className="rv-vg__nota" data-tono="warn">{tx('bj.tope', { n: numero(TOPE_CONVERSACIONES_TABLERO) })}</p>}

      <BarraFiltros accion={RUTA} ocultos={ocultos} etiqueta={tx('bj.filtros')} limpiarHref={hayFiltros ? hrefBandeja(sinFiltros, { ocultos }) : undefined} nActivos={[filtros.estado, filtros.prioridad, filtros.clienteId].filter(Boolean).length}>
        <FiltroOpciones etiqueta={tx('bj.filtro.estado')} nombre="estado" valor={filtros.estado}
          opciones={[{ valor: '', rotulo: tx('bj.filtro.todos') }, ...ESTADOS_ATENCION.map((e) => ({ valor: e, rotulo: tx(`bj.estado.${e}`) }))]} />
        <FiltroOpciones etiqueta={tx('bj.filtro.prioridad')} nombre="prioridad" valor={filtros.prioridad}
          opciones={[{ valor: '', rotulo: tx('bj.filtro.todas') }, ...PRIORIDADES_BANDEJA.map((p) => ({ valor: p, rotulo: tx(`bj.prio.${p}`) }))]} />
        <FiltroOpciones etiqueta={tx('bj.filtro.cliente')} nombre="cliente" valor={filtros.clienteId}
          opciones={[{ valor: '', rotulo: tx('bj.filtro.todos') }, ...d.clientes.map((c) => ({ valor: c.id, rotulo: c.nombre }))]} />
      </BarraFiltros>

      <div className="rv-bj" data-detalle={chat ? '1' : '0'}>
        <section className="rv-bj__lista" aria-label={tx('bj.lista.etiqueta')}>
          {todas.length === 0 ? (
            <VacioAgente icono={Inbox} titulo={tx('bj.vacio.titulo')}>{tx('bj.vacio.detalle')}</VacioAgente>
          ) : visibles.length === 0 ? (
            <VacioAgente icono={Inbox} titulo={tx('bj.vacio_filtro.titulo')}
              accion={<Link href={hrefBandeja(sinFiltros, { ocultos })} className="rv-vg__enlace">{tx('bj.limpiar')}</Link>}>
              {tx('bj.vacio_filtro.detalle')}
            </VacioAgente>
          ) : (
            PRIORIDADES_BANDEJA.map((p) => {
              const grupo = visibles.filter((f) => f.prioridad === p);
              if (grupo.length === 0) return null;
              return (
                <div key={p} className="rv-bj__grupo">
                  <p role="heading" aria-level={2} className="rv-bj__grupo-titulo" data-prio={p}>{tx('bj.grupo', { prioridad: tx(`bj.prio.${p}`), n: numero(grupo.length) })}</p>
                  <ul className="rv-bj__items">
                    {grupo.map((f, i) => <FilaLista key={f.id} f={f} i={i} activa={f.id === chat} filtros={filtros} ocultos={ocultos} tr={tr} />)}
                  </ul>
                </div>
              );
            })
          )}
          <p className="rv-vg__micro">{tx('bj.como_urgente')} {tx('bj.como_alta')} {tx('bj.como_normal', { sla: numero(sla) })}</p>
          <Link href={conParams(RUTA_SIN_ATENDER, ocultos)} className="rv-vg__enlace">{tx('bj.sin_atender_enlace')}</Link>
        </section>

        <section className="rv-bj__detalle" aria-live="polite">
          {chat && !seleccionada ? (
            <>
              <Link href={hrefBandeja(filtros, { ocultos })} className="rv-bj__volver rv-vg__enlace"><Icono icono={ArrowLeft} tam={14} />{tx('bj.detalle.volver')}</Link>
              <VacioAgente icono={MessageSquare} titulo={tx('bj.detalle.no_encontrada')} />
            </>
          ) : seleccionada ? (
            <Detalle tr={tr} d={d} f={seleccionada} hilo={hilo} filtros={filtros} ocultos={ocultos} puedeDecidir={puedeDecidir} acciones={acciones} />
          ) : (
            <VacioAgente icono={MessageSquare} titulo={tx('bj.detalle.vacio_titulo')}>{tx('bj.detalle.vacio_detalle')}</VacioAgente>
          )}
        </section>
      </div>
    </div>
  );
}

function quienContesta(f: FilaBandeja, tx: TAgentes): string {
  if (f.control === 'agente') return tx('bj.contesta_agente');
  return f.responsableNombre ? tx('bj.contesta_persona', { nombre: f.responsableNombre }) : tx('bj.contesta_persona_sin_nombre');
}

function FilaLista({ f, i, activa, filtros, ocultos, tr }: { f: FilaBandeja; i: number; activa: boolean; filtros: FiltrosBandeja; ocultos: ReadonlyArray<readonly [string, string]>; tr: TrAgentes }) {
  const { t: tx } = tr;
  const nombre = f.clienteNombre ?? tx('bj.cliente_sin_nombre');
  const ultimo = f.ultimoMensajeCliente ?? tx('bj.sin_texto');
  return (
    <li className="rv-bj__item" data-activa={activa ? '1' : undefined} data-orden={Math.min(i, 8)}>
      <Link href={hrefBandeja(filtros, { chat: f.id, ocultos })} className="rv-bj__enlace" aria-current={activa ? 'true' : undefined} aria-label={tx('bj.ver_hilo', { cliente: nombre })}>
        <span className="rv-bj__fila1">
          <strong className="rv-bj__nombre" title={nombre}>{nombre}</strong>
          {f.sinRespuestaDesde && <span className="rv-bj__espera" data-tono={f.slaVencido ? 'bad' : 'warn'}>{tx('bj.espera', { dur: duracion(f.esperaMin) })}</span>}
        </span>
        <span className="rv-bj__ultimo" title={ultimo}>{ultimo}</span>
        <span className="rv-bj__fila3">
          <Chip tono={TONO_PRIORIDAD[f.prioridad]} tamano="estado">{tx(`bj.prio.${f.prioridad}`)}</Chip>
          <Chip tamano="estado">{tx(`bj.estado.${f.estado}`)}</Chip>
          <span className="rv-bj__quien" title={quienContesta(f, tx)}>{quienContesta(f, tx)}</span>
        </span>
      </Link>
    </li>
  );
}

function Detalle({ tr, d, f, hilo, filtros, ocultos, puedeDecidir, acciones }: {
  tr: TrAgentes; d: DatosTablero; f: FilaBandeja; hilo: Promise<MensajeHilo[] | 'error' | null>; filtros: FiltrosBandeja;
  ocultos: ReadonlyArray<readonly [string, string]>; puedeDecidir: boolean; acciones: AccionesBandeja;
}) {
  const { t: tx } = tr;
  const conv = d.conversaciones.find((c) => c.id === f.id);
  const resp = responsablesPorNivel(d, conv?.contactoId ?? null, f.clienteId);
  const lista = (n: string[]) => (n.length ? n.join(', ') : tx('bj.detalle.sin_definir'));
  const pendientes = d.pendientes.filter((p) => p.conversacionId === f.id);
  const nombre = f.clienteNombre ?? tx('bj.cliente_sin_nombre');
  return (
    <Tarjeta titulo={nombre}>
      <div className="rv-vg__pila">
        <Link href={hrefBandeja(filtros, { ocultos })} className="rv-bj__volver rv-vg__enlace"><Icono icono={ArrowLeft} tam={14} />{tx('bj.detalle.volver')}</Link>
        <div className="rv-vg__linea">
          <Chip tono={TONO_PRIORIDAD[f.prioridad]} tamano="estado">{tx(`bj.prio.${f.prioridad}`)}</Chip>
          <Chip tamano="estado">{tx(`bj.estado.${f.estado}`)}</Chip>
          {f.contactoNombre && <span className="rv-bj__quien" title={f.contactoNombre}>{f.contactoNombre}</span>}
          {f.sinRespuestaDesde && <span className="rv-bj__espera" data-tono={f.slaVencido ? 'bad' : 'warn'}>{tx('bj.espera', { dur: duracion(f.esperaMin) })}</span>}
        </div>
        {f.motivos.length > 0 && (
          <p className="rv-vg__nota"><strong>{tx('bj.detalle.motivos')}:</strong> {f.motivos.map((m) => tx(`bj.motivo.${m}`)).join(' · ')}</p>
        )}
        <dl className="rv-bj__datos">
          <div><dt>{tx('bj.detalle.quien')}</dt><dd>{quienContesta(f, tx)}</dd></div>
          <div><dt>{tx('bj.detalle.nivel')}</dt><dd>{tx(`bj.detalle.nivel_${Math.min(2, f.escalamientoNivel)}`)}</dd></div>
          <div className="rv-bj__ancho"><dt>{tx('bj.detalle.responsables')}</dt>
            <dd>
              {resp.servicio.length > 0 && <span className="rv-bj__resp">{tx('bj.detalle.resp_servicio')}: {lista(resp.servicio)}</span>}
              <span className="rv-bj__resp">{resp.nivel1PorOmision ? tx('bj.detalle.resp_n1_omision') : tx('bj.detalle.resp_n1')}: {lista(resp.nivel1)}</span>
              <span className="rv-bj__resp">{tx('bj.detalle.resp_n2')}: {lista(resp.nivel2)}</span>
            </dd>
          </div>
        </dl>
        <p className="rv-vg__micro">{tx('bj.detalle.asignacion')}</p>

        <p role="heading" aria-level={3} className="rv-vg__titulo">{tx('bj.hilo.titulo')}</p>
        <Bloque mensaje={tx('bj.hilo.error')} esqueleto={<EsqTablaV2 />}>
          <HiloMensajes tr={tr} hilo={hilo} />
        </Bloque>

        <p role="heading" aria-level={3} className="rv-vg__titulo">{tx('bj.acciones.titulo')}</p>
        {!puedeDecidir ? (
          <p className="rv-vg__nota">{tx('bj.acciones.solo_lectura')}</p>
        ) : (
          <div className="rv-vg__pila">
            {pendientes.map((m) => (
              <div key={m.id} className="rv-vg__bloque">
                <FormaBorrador accion={acciones.decidir} id={m.id} texto={m.borrador} />
              </div>
            ))}
            <div className="rv-vg__linea">
              {f.control === 'agente'
                ? <BotonConversacion accion={acciones.conversacion} id={f.id} que="tomar" etiqueta={tr.t('vigia.vista.yo_me_encargo')} />
                : <BotonConversacion accion={acciones.conversacion} id={f.id} que="devolver" etiqueta={tr.t('vigia.vista.devolver_al_vigia')} />}
              <BotonConversacion accion={acciones.conversacion} id={f.id} que="cerrar" etiqueta={tr.t('vigia.vista.cerrar')} />
            </div>
            {f.control === 'humano'
              ? <FormaResponder accion={acciones.conversacion} id={f.id} />
              : <p className="rv-vg__nota">{d.config.soloAvisar ? tx('bj.acciones.solo_avisar') : tx('bj.acciones.tomar_para_responder')}</p>}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

async function HiloMensajes({ tr, hilo }: { tr: TrAgentes; hilo: Promise<MensajeHilo[] | 'error' | null> }) {
  const { t: tx } = tr;
  const h = await hilo;
  if (h === 'error') return <AvisoCompacto tono="warn" resumen={tx('bj.hilo.error')} />;
  if (!h || h.length === 0) return <VacioAgente icono={MessageSquare} titulo={tx('bj.hilo.vacio')} />;
  return (
    <div className="rv-vg__pila">
      {h.length >= TOPE_MENSAJES_HILO && <p className="rv-vg__nota" data-tono="warn">{tx('bj.hilo.tope', { n: numero(TOPE_MENSAJES_HILO) })}</p>}
      <ol className="rv-bj__hilo">
        {h.map((m) => {
          const propuesta = m.direccion === 'saliente' && (m.estado === 'borrador' || m.estado === 'pendiente_aprobacion');
          const salio = m.direccion === 'saliente' && m.estado === 'enviado';
          const rotulo = m.direccion === 'entrante' ? tx('bj.hilo.cliente')
            : propuesta ? tx('bj.hilo.agente_propuesta')
            : salio ? (m.autor === 'humano' ? tx('bj.hilo.persona_enviada') : tx('bj.hilo.agente_enviada'))
            : tx('bj.hilo.no_enviada', { estado: tx(`bj.hilo.estado_${m.estado === 'rechazado' || m.estado === 'descartado' || m.estado === 'fallido' || m.estado === 'aprobado' ? m.estado : 'borrador'}`) });
          return (
            <li key={m.id} className="rv-bj__msg" data-lado={m.direccion === 'entrante' ? 'cliente' : 'nuestro'} data-tipo={propuesta ? 'propuesta' : undefined}>
              <span className="rv-bj__msg-cab">
                <strong>{rotulo}</strong>
                <span className="rv-vg__micro">{fechaHoraMx(m.enviadoEn ?? m.creadoEn, tr.idioma)}</span>
              </span>
              <p className="rv-bj__msg-texto">{m.texto ?? tx('bj.sin_texto')}</p>
              {(m.editado || m.autoenviado) && <span className="rv-vg__micro">{[m.editado ? tx('bj.hilo.editado') : '', m.autoenviado ? tx('bj.hilo.autoenviado') : ''].filter(Boolean).join(' · ')}</span>}
              {m.error && m.estado === 'fallido' && <span className="rv-vg__micro" data-tono="bad" title={m.error}>{m.error}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
