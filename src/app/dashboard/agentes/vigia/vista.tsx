import { Suspense } from 'react';
import Link from 'next/link';
import { Hand, Clock, Flame, Inbox, History, Mail } from 'lucide-react';
import './vigia.css';
import { numero, fechaHoraMx } from '@/lib/formato';
import type { DatosTablero, ConversacionTablero } from '@/lib/likida/vigia/repo';
import { tarjetasInsights, type InsightsEntrada } from '@/lib/likida/vigia/insights';
import { Bloque } from '../../bloque';
import {
  FormaBorrador, BotonConversacion, FormaResponder, FormaConfig, FormaAlta, FormaDirector, FormaServicio, AccionesContacto, type AccionVigia,
} from './controles';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { VacioAgente } from '../vacio-agente';
import { conFilete } from '../cifras-filete';
import { AvisoCompacto, Chip as ChipV2, Disclosure, EsqCifrasV2, EsqTablaV2, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import { TR_ES, type TrAgentes, type TAgentes, selloHoyTr } from '../i18n-agentes';
import { getT } from '@/lib/i18n/servidor';

export interface AccionesVigia {
  decidir: AccionVigia;
  conversacion: AccionVigia;
  config: AccionVigia;
  alta: AccionVigia;
  contacto: AccionVigia;
  /** 0673: alta, corrección y baja de un director de la lista de avisos (solo el dueño). */
  director: AccionVigia;
  /** 0798: alta, corrección y baja de una persona de «servicio al cliente» (solo el dueño). */
  servicio?: AccionVigia;
}

const ENLACE = 'rv-vg__enlace';

/** T-A4-22: el acceso a la bandeja de avisos de viaje, con cuántos esperan a una persona. Si no se pudo contar, el enlace va sin número. */
export async function EnlaceAvisos({ sufijo, pendientes }: { sufijo: string; pendientes?: Promise<number | null> }) {
  const { t: tx } = await getT('agentes');
  const n = pendientes ? await pendientes.catch(() => null) : null;
  return (
    <Link href={`/dashboard/agentes/vigia/avisos${sufijo}`} className={ENLACE}>
      {tx('vigia.vista.avisos_de_viaje', { v0: typeof n === 'number' && n > 0 ? tx('vigia.vista.n_por_revisar', { n }) : '' })}
    </Link>
  );
}

/** Solo si hay avisos de viaje esperando a una persona; sin número o en cero no pinta nada (las pestañas ya llevan a Avisos). */
async function AvisosPorRevisar({ sufijo, pendientes }: { sufijo: string; pendientes?: Promise<number | null> }) {
  const n = pendientes ? await pendientes.catch(() => null) : null;
  if (typeof n !== 'number' || n <= 0) return null;
  return <div className="rv-vg__herr"><EnlaceAvisos sufijo={sufijo} pendientes={Promise.resolve(n)} /></div>;
}

/** Minutos enteros que lleva esperando una conversación (0 si nadie espera). */
export function minutosDeEspera(sinRespuestaDesde: string | null, ahoraMs: number): number {
  if (!sinRespuestaDesde) return 0;
  const t = Date.parse(sinRespuestaDesde);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((ahoraMs - t) / 60_000));
}

export function duracion(min: number): string {
  if (min < 60) return `${numero(min)} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${numero(h)} h` : `${numero(h)} h ${numero(r)} min`;
}

/**
 * Orden del tablero (0798): primero la prioridad alta, luego quien lleva más tiempo esperando, y por último el id para que sea
 * estable. PURA; no muta la lista. Solo ordena: no cambia ningún umbral de aviso.
 */
export function ordenarPorPrioridad<T extends Pick<ConversacionTablero, 'id' | 'prioridad' | 'sinRespuestaDesde'>>(lista: readonly T[], ahoraMs: number): T[] {
  return [...lista].sort((a, b) => (b.prioridad ?? 0) - (a.prioridad ?? 0)
    || minutosDeEspera(b.sinRespuestaDesde, ahoraMs) - minutosDeEspera(a.sinRespuestaDesde, ahoraMs)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Por qué una conversación es una EXCEPCIÓN (vacío = no lo es). PURA. */
export function motivosDeExcepcion(c: ConversacionTablero, slaMin: number, ahoraMs: number, tr: TrAgentes = TR_ES): string[] {
  const { t: tx } = tr;
  const m: string[] = [];
  const espera = minutosDeEspera(c.sinRespuestaDesde, ahoraMs);
  if (c.molestiaNivel >= 2) m.push(c.molestiaNivel >= 3 ? tx('vigia.vista.muy_molesto') : tx('vigia.vista.molesto'));
  if (c.sinRespuestaDesde && espera >= slaMin) m.push(tx('vigia.vista.sin_respuesta_dur', { dur: duracion(espera) }));
  if (c.escalamientoNivel > 0) m.push(tx('vigia.vista.escalada_nivel', { nivel: c.escalamientoNivel }));
  return m;
}

const NOMBRE_INTENCION = (tx: TAgentes): Record<string, string> => ({
  ubicacion: tx('vigia.vista.donde_va_su_viaje'), eta: tx('vigia.vista.a_que_hora_llega'), documentos: tx('vigia.vista.ni_documentos'), factura_pod: tx('vigia.vista.ni_factura_pod'),
  queja: tx('vigia.vista.ni_queja'), pide_humano: tx('vigia.vista.pide_hablar_con_una_persona'), saludo: tx('vigia.vista.ni_saludo'), otro: tx('vigia.vista.otro_no_se_entendio'),
});

const NOMBRE_EVENTO = (tx: TAgentes): Record<string, string> => ({
  entrante: tx('vigia.vista.llego_un_mensaje'), borrador: tx('vigia.vista.el_vigia_redacto_una_respuesta'), aprobado: tx('vigia.vista.un_gerente_aprobo_una_respuesta'), rechazado: tx('vigia.vista.un_gerente_descarto_una_respuesta'),
  enviado: tx('vigia.vista.se_envio_una_respuesta'), autoenviado: tx('vigia.vista.se_envio_una_respuesta_sola'), fallo_envio: tx('vigia.vista.fallo_un_envio'), tomada: tx('vigia.vista.un_gerente_tomo_el_hilo'),
  devuelta: tx('vigia.vista.el_hilo_volvio_al_vigia'), cerrada: tx('vigia.vista.se_cerro_una_conversacion'), molestia: tx('vigia.vista.se_detecto_molestia'), sin_respuesta: tx('vigia.vista.ev_sin_respuesta'),
  escalada: tx('vigia.vista.ev_escalada'), sin_destinatario: tx('vigia.vista.no_habia_a_quien_avisar'), optout: tx('vigia.vista.un_cliente_pidio_su_baja'), alta: tx('vigia.vista.se_autorizo_un_contacto'),
  baja_manual: tx('vigia.vista.se_dio_de_baja_un'), suprimido: tx('vigia.vista.se_suprimieron_los_datos_de'), spam: tx('vigia.vista.se_detecto_spam'),
  sin_dato: tx('vigia.vista.faltaba_un_dato_real_se'), inyeccion: tx('vigia.vista.ev_inyeccion'), otro_cliente: tx('vigia.vista.pregunto_por_un_folio_que'),
  adjunto_enviado: tx('vigia.vista.se_envio_el_archivo_adjunto'), adjunto_pendiente: tx('vigia.vista.el_archivo_no_salio_la'),
  adjunto_fallo: tx('vigia.vista.no_se_pudo_mandar_el'),
  correo_enviado: tx('vigia.vista.se_mando_el_aviso_de'),
  correo_fallo: tx('vigia.vista.no_se_pudo_mandar_el_2'),
});

/** El estado de un correo de respaldo, en palabras de la flota (la falta de configuración se dice tal cual: nada falla en silencio). */
export const TEXTO_ESTADO_CORREO = (tx: TAgentes): Record<string, string> => ({
  enviando: tx('vigia.vista.est_enviando'),
  enviado: tx('vigia.vista.est_enviado'),
  sin_configurar: tx('vigia.vista.no_se_pudo_mandar_por'),
  rechazado: tx('vigia.vista.el_proveedor_de_correo_lo'),
  red: tx('vigia.vista.no_se_pudo_mandar_por_2'),
});

export function VistaAgenteVigia({ datos, ahoraMs, puedeDecidir, puedeAdministrar, acciones, sufijo = '', avisosPendientes, standby = false, tr = TR_ES }: {
  datos: Promise<DatosTablero>;
  /** T-A4-32: perfil cinco_agentes → se ocultan los controles stand-by (autoenvío, POD adjunto). Sin perfil: idéntico a hoy. */
  standby?: boolean;
  sufijo?: string;
  /** T-A4-22: cuántos avisos de viaje esperan a una persona (`null` = no se pudo contar). Opcional: sin él el enlace va sin número. */
  avisosPendientes?: Promise<number | null>;
  ahoraMs: number;
  /** flota_admin y encargado deciden por los clientes; el resto solo mira. */
  puedeDecidir: boolean;
  /** Solo el dueño configura, autoriza contactos y ejerce ARCO. */
  puedeAdministrar: boolean;
  acciones: AccionesVigia; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('vigia.vista.servicio_al_cliente')} apoyo={tx('vigia.vista.atiende_a_los_clientes_de')}>
      {/* La navegación entre las secciones del agente son las pestañas del marco; aquí solo queda el aviso con número cuando algo espera. */}
      <Suspense fallback={null}><AvisosPorRevisar sufijo={sufijo} pendientes={avisosPendientes} /></Suspense>
      <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_el')} esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueEstadoYKpis datos={datos} ahoraMs={ahoraMs} />
      </Bloque>

      <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_la')} esqueleto={<EsqTablaV2 />}>
        <BloqueAprobacion datos={datos} puedeDecidir={puedeDecidir} acciones={acciones} standby={standby} />
      </Bloque>

      <Bloque mensaje={tx('vigia.vista.no_se_pudieron_leer_las')} esqueleto={<EsqTablaV2 />}>
        <BloqueExcepciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
      </Bloque>

      <Bloque mensaje={tx('vigia.vista.no_se_pudieron_leer_las_2')} esqueleto={<EsqTablaV2 />}>
        <BloqueConversaciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
      </Bloque>

      <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_la_3')} esqueleto={<EsqTablaV2 />}>
        <BloqueBitacora datos={datos} />
      </Bloque>

      {/* A quién avisa, correos de respaldo, clientes autorizados y límites: se configuran una vez, así que van plegados y la página no pasa
          de dos pantallas de lo que se atiende cada día. Todo sigue en la página (no se quita nada, solo se pliega). */}
      <Disclosure titulo={tx('f26d2.vigia.avisos_y_limites')} resumen={tx('f26d2.vigia.avisos_y_limites_resumen')}>
        <div className="rv-vg__pila">
          {/* El formulario de Configuración y SLA (≈900 px) vive aquí, no en una fila 6/6 con la bitácora: se llena una vez y no deja huecos. */}
          <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_la_2')} esqueleto={<EsqTablaV2 />}>
            <BloqueConfiguracion datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} standby={standby} />
          </Bloque>

          <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_la_4')} esqueleto={<EsqTablaV2 />}>
            <BloqueDirectores datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
          </Bloque>

          <Bloque mensaje={tx('vigia.vista.no_se_pudo_leer_la_5')} esqueleto={<EsqTablaV2 />}>
            <BloqueServicio datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
          </Bloque>

          <Bloque mensaje={tx('vigia.vista.no_se_pudieron_leer_los')} esqueleto={<EsqTablaV2 />}>
            <BloqueCorreos datos={datos} />
          </Bloque>

          <Bloque mensaje={tx('vigia.vista.no_se_pudieron_leer_los_2')} esqueleto={<EsqTablaV2 />}>
            <BloqueContactos datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
          </Bloque>

          <Tarjeta titulo={tx('vigia.vista.los_limites_del_vigia')} info="vigia.limites">
            <ul className="rv-vg__bullets">
              <li>{tx('vigia.vista.solo_contesta_a_clientes_que')}</li>
              <li>{tx('vigia.vista.cada_cifra_de_una_respuesta')}</li>
              <li>{tx('vigia.vista.un_cliente_jamas_ve_datos')}</li>
              <li>{tx('vigia.vista.fuera_de_las_24_h')}</li>
              <li>{tx('vigia.vista.baja_corta_los_mensajes_de')}</li>
            </ul>
          </Tarjeta>
        </div>
      </Disclosure>
    </MarcoPagina>
  );
}

function Chip({ children, tono }: { children: React.ReactNode; tono?: 'warn' | 'bad' | 'ok' }) {
  return <ChipV2 tono={tono ?? 'neutral'} tamano="estado">{children}</ChipV2>;
}

export async function BloqueEstadoYKpis({ datos: p, ahoraMs }: { datos: Promise<DatosTablero>; ahoraMs: number }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  const sla = d.config.slaRespuestaMin;
  const vencidas = d.conversaciones.filter((c) => c.sinRespuestaDesde && minutosDeEspera(c.sinRespuestaDesde, ahoraMs) >= sla).length;
  const molestasOEscaladas = d.conversaciones.filter((c) => c.molestiaNivel >= 2 || c.escalamientoNivel > 0).length;
  return (
    <div className="rv-vg__pila">
      {!d.config.habilitado && (
        <AvisoCompacto tono="warn" resumen={<>{tx('vigia.vista.el_vigia_esta_apagado_para')}{' '}<a href="#vg-config" className="rv-vg__enlace">{tx('f26d2.vigia.ir_a_configuracion')}</a></>} />
      )}
      <TiraCifras sello={selloHoyTr(tr, tx('vigia.vista.sello_avisos_de_viaje'))} items={conFilete([
        { etiqueta: tx('vigia.vista.conversaciones_activas'), info: 'vigia.conversaciones_activas', valor: numero(d.conversaciones.length), nota: tx('vigia.vista.clientes_con_un_hilo_abierto') },
        { etiqueta: tx('vigia.vista.por_aprobar'), info: 'vigia.por_aprobar', valor: numero(d.pendientes.length), nota: tx('vigia.vista.respuestas_que_esperan_tu_toque'), tono: d.pendientes.length > 0 ? 'warn' : undefined },
        { etiqueta: tx('vigia.vista.sin_respuesta_sla_min', { sla: numero(sla) }), info: 'vigia.sin_respuesta', valor: numero(vencidas), nota: tx('vigia.vista.esperan_mas_de_lo_permitido'), tono: vencidas > 0 ? 'bad' : undefined },
        { etiqueta: tx('vigia.vista.molestos_o_escalados'), info: 'vigia.molestos_escalados', valor: numero(molestasOEscaladas), nota: tx('vigia.vista.requieren_a_una_persona'), tono: molestasOEscaladas > 0 ? 'bad' : undefined },
      ])} />
      <p className="rv-vg__nota">
        {tx('vigia.vista.tiempo_de_primera_respuesta', { v0: ' ', v1: d.respuesta.muestra === 0
          ? tx('vigia.vista.sin_datos_todavia_aun_no')
          : tx('vigia.vista.mediana_y_promedio_medido_sobre', { v0: duracion(d.respuesta.medianaMin ?? 0), v1: duracion(d.respuesta.promedioMin ?? 0), muestra: numero(d.respuesta.muestra) }) })}
      </p>
    </div>
  );
}

export async function BloqueAprobacion({ datos: p, puedeDecidir, acciones, standby = false }: { datos: Promise<DatosTablero>; puedeDecidir: boolean; acciones: AccionesVigia; standby?: boolean }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.cola_de_aprobacion')} info="vigia.cola_aprobacion">
      {d.pendientes.length === 0 ? (
        <VacioAgente icono={Inbox} titulo={tx('vigia.vista.nada_por_aprobar')}>{tx('vigia.vista.nada_por_aprobar_cada_respuesta')}</VacioAgente>
      ) : (
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.las_respuestas_que_redacto_el')}
        </p>
        {d.pendientes.map((m) => (
          <article key={m.id} className="rv-vg__bloque">
            <div className="rv-vg__linea">
              <strong>{m.clienteNombre ?? tx('vigia.vista.cliente')}</strong>
              {m.intencion && <Chip>{NOMBRE_INTENCION(tx)[m.intencion] ?? m.intencion}</Chip>}
              {m.riesgo && <Chip tono={m.riesgo === 'alto' ? 'bad' : m.riesgo === 'medio' ? 'warn' : 'ok'}>{tx('vigia.vista.riesgo', { riesgo: m.riesgo })}</Chip>}
              {m.senales.includes('inyeccion') && <Chip tono="bad">{tx('vigia.vista.mensaje_con_instrucciones_raras')}</Chip>}
              {m.senales.includes('folio_ajeno') && <Chip tono="warn">{tx('vigia.vista.pregunto_por_un_folio_que')}</Chip>}
              {!standby && m.adjuntos.length > 0 && <Chip>{tx('vigia.vista.adjuntara', { v0: m.adjuntos.join(', ') })}</Chip>}
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(m.creadoEn, tr.idioma)}</span>
            </div>
            <blockquote className="rv-vg__cita">
              {m.mensajeCliente ?? tx('vigia.vista.archivo_o_mensaje_sin_texto')}
            </blockquote>
            {puedeDecidir
              ? <FormaBorrador accion={acciones.decidir} id={m.id} texto={m.borrador} />
              : <p className="rv-vg__nota rv-vg__texto-libre">{m.borrador}</p>}
          </article>
        ))}
      </div>
      )}
    </Tarjeta>
  );
}

export async function BloqueExcepciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  const filas = ordenarPorPrioridad(d.conversaciones, ahoraMs)
    .map((c) => ({ c, motivos: motivosDeExcepcion(c, d.config.slaRespuestaMin, ahoraMs, tr) }))
    .filter((x) => x.motivos.length > 0);
  const vacio = filas.length === 0 && d.fallidos.length === 0;
  return (
    <Tarjeta titulo={tx('vigia.vista.excepciones')} info="vigia.excepciones">
      {vacio ? (
        <VacioAgente icono={Flame} titulo={tx('vigia.vista.sin_excepciones')}>{tx('vigia.vista.sin_excepciones_nadie_espera_de')}</VacioAgente>
      ) : (
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.clientes_molestos_sin_respuesta_pasa')}
        </p>
        <ul className="rv-vg__lista">
          {filas.map(({ c, motivos }) => (
            <li key={c.id} className="rv-vg__linea rv-vg__nota">
              <strong>{c.clienteNombre ?? tx('vigia.vista.cliente')}</strong>
              <span>{c.contactoNombre ?? ''}</span>
              {motivos.map((m) => <Chip key={m} tono="bad">{m}</Chip>)}
              {c.atendida && <Chip tono="ok">{tx('vigia.vista.atendida')}</Chip>}
              {puedeDecidir && c.control === 'agente' && (
                <span className="rv-vg__fin"><BotonConversacion accion={acciones.conversacion} id={c.id} que="tomar" etiqueta={tx('vigia.vista.yo_me_encargo')} /></span>
              )}
            </li>
          ))}
          {d.fallidos.map((f) => (
            <li key={f.id} className="rv-vg__linea rv-vg__nota">
              <strong>{f.clienteNombre ?? tx('vigia.vista.cliente')}</strong>
              <Chip tono="warn">{tx('vigia.vista.fallo_un_envio')}</Chip>
              <span>{f.error ?? tx('vigia.vista.sin_detalle')}</span>
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(f.creadoEn, tr.idioma)}</span>
            </li>
          ))}
        </ul>
      </div>
      )}
    </Tarjeta>
  );
}

export async function BloqueConversaciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.conversaciones_activas')} info="vigia.conversaciones">
      {d.conversaciones.length === 0 ? (
        <VacioAgente icono={Hand} titulo={tx('vigia.vista.sin_hilos_abiertos')}>{tx('vigia.vista.ningun_cliente_tiene_un_hilo')}</VacioAgente>
      ) : (
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.al_tomar_un_hilo_el')}
        </p>
        {ordenarPorPrioridad(d.conversaciones, ahoraMs).map((c) => {
          const espera = minutosDeEspera(c.sinRespuestaDesde, ahoraMs);
          return (
            <article key={c.id} className="rv-vg__bloque">
              <div className="rv-vg__linea">
                <strong>{c.clienteNombre ?? tx('vigia.vista.cliente')}</strong>
                <span className="rv-vg__muted">{c.contactoNombre ?? ''}</span>
                {(c.prioridad ?? 0) >= 2 && <Chip tono="bad">{tx('vigia.vista.prioridad_alta')}</Chip>}
                <Chip tono={c.control === 'humano' ? 'ok' : undefined}>{c.control === 'humano' ? tx('vigia.vista.lo_lleva_una_persona') : tx('vigia.vista.lo_lleva_el_vigia')}</Chip>
                {c.sinRespuestaDesde
                  ? <Chip tono={espera >= d.config.slaRespuestaMin ? 'bad' : 'warn'}>{tx('vigia.vista.espera', { espera: duracion(espera) })}</Chip>
                  : <Chip tono="ok">{tx('vigia.vista.al_dia')}</Chip>}
                {c.molestiaNivel >= 2 && <Chip tono="bad">{c.molestiaNivel >= 3 ? tx('vigia.vista.muy_molesto') : tx('vigia.vista.molesto')}</Chip>}
              </div>
              {c.ultimoMensajeCliente && (
                <p className="rv-vg__nota">{tx('vigia.vista.ultimo_mensaje', { ultimoMensajeCliente: c.ultimoMensajeCliente })}</p>
              )}
              {puedeDecidir && (
                <div className="rv-vg__linea">
                  {c.control === 'agente'
                    ? <BotonConversacion accion={acciones.conversacion} id={c.id} que="tomar" etiqueta={tx('vigia.vista.yo_me_encargo')} />
                    : <BotonConversacion accion={acciones.conversacion} id={c.id} que="devolver" etiqueta={tx('vigia.vista.devolver_al_vigia')} />}
                  <BotonConversacion accion={acciones.conversacion} id={c.id} que="cerrar" etiqueta={tx('vigia.vista.cerrar')} />
                </div>
              )}
              {puedeDecidir && c.control === 'humano' && <FormaResponder accion={acciones.conversacion} id={c.id} />}
            </article>
          );
        })}
      </div>
      )}
    </Tarjeta>
  );
}

export async function BloqueConfiguracion({ datos: p, puedeAdministrar, acciones, standby = false }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia; standby?: boolean }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const { config } = await p;
  return (
    <div id="vg-config">
    <Tarjeta titulo={tx('vigia.vista.configuracion_y_sla')} info="vigia.configuracion">
      {puedeAdministrar ? (
        <FormaConfig accion={acciones.config} valores={config} standby={standby} />
      ) : (
        <ul className="rv-vg__ul">
          <li>{tx('vigia.vista.vigia', { v0: config.habilitado ? 'encendido' : 'apagado' })}</li>
          {!standby && <li>{tx('vigia.vista.modo', { v0: config.modoAprobacion === 'siempre' ? 'siempre aprobar' : 'autoenviar solo bajo riesgo ya validado' })}</li>}
          <li>{tx('vigia.vista.sla_de_respuesta_min_dueno', { slaRespuestaMin: numero(config.slaRespuestaMin), v1: numero(config.slaRespuestaMin + config.escalarNivel2Min), v2: numero(Math.min(config.slaRespuestaMin, config.slaCriticoMin)) })}</li>
          <li>{tx('vigia.vista.retencion_dias', { retencionDias: numero(config.retencionDias) })}</li>
          <li className="rv-vg__faint">{tx('vigia.vista.solo_el_dueno_de_la')}</li>
        </ul>
      )}
    </Tarjeta>
    </div>
  );
}

export async function BloqueBitacora({ datos: p }: { datos: Promise<DatosTablero> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const { eventos } = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.bitacora')} info="vigia.bitacora">
      {eventos.length === 0 ? (
        <VacioAgente icono={History} titulo={tx('vigia.vista.aun_sin_actividad')}>{tx('vigia.vista.aun_sin_actividad_2')}</VacioAgente>
      ) : (
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">{tx('vigia.vista.lo_ultimo_que_hizo_el')}</p>
        <ul className="rv-vg__lista">
          {eventos.map((e) => (
            <li key={e.id} className="rv-vg__linea rv-vg__nota">
              <Icono icono={Clock} tam={14} />
              <div>
                <span>{NOMBRE_EVENTO(tx)[e.tipo] ?? e.tipo}{e.nivel ? tx('vigia.vista.nivel_n', { nivel: e.nivel }) : ''}</span>
                <span className="rv-vg__micro rv-vg__bloquear">{fechaHoraMx(e.creadoEn, tr.idioma)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      )}
    </Tarjeta>
  );
}

export async function BloqueContactos({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.clientes_autorizados')} info="vigia.clientes_autorizados">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.solo_estos_numeros_reciben_atencion')}
        </p>
        {d.contactos.length === 0 ? (
          <p className="rv-vg__nota">{tx('vigia.vista.todavia_no_autorizas_a_ningun')}</p>
        ) : (
          <ul className="rv-vg__lista">
            {d.contactos.map((c) => (
              <li key={c.id} className="rv-vg__linea rv-vg__nota">
                <strong>{c.clienteNombre ?? tx('vigia.vista.cliente')}</strong>
                <span>{c.nombre ?? tx('vigia.vista.sin_nombre')} · …{c.telefonoTerminacion}</span>
                <Chip tono={c.estado === 'activo' ? 'ok' : 'warn'}>{c.estado === 'activo' ? tx('vigia.vista.activo') : tx('vigia.vista.dado_de_baja')}</Chip>
                {c.consentimientoEn && <span className="rv-vg__micro">{tx('vigia.vista.consentimiento', { consentimientoEn: fechaHoraMx(c.consentimientoEn, tr.idioma) })}</span>}
                {puedeAdministrar && <span className="rv-vg__fin"><AccionesContacto accion={acciones.contacto} id={c.id} activo={c.estado === 'activo'} /></span>}
              </li>
            ))}
          </ul>
        )}
        {puedeAdministrar ? (
          <Disclosure titulo={tx('vigia.vista.autorizar_a_un_cliente')} variante="linea" abierto={d.contactos.length === 0}>
            {d.clientes.length === 0
              ? <p className="rv-vg__nota">{tx('vigia.vista.primero_da_de_alta_al')}</p>
              : <FormaAlta accion={acciones.alta} clientes={d.clientes} gerentes={d.gerentes} />}
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">{tx('vigia.vista.solo_el_dueno_de_la_2')}</p>
        )}
      </div>
    </Tarjeta>
  );
}

const NOMBRE_NIVEL = (tx: TAgentes): Record<number, string> => ({ 1: tx('vigia.vista.nivel_1'), 2: tx('vigia.vista.nivel_2_director_o_dueno') });

/** 0673: a quién avisa el Vigía en cada nivel. Solo el dueño la edita; el resto la ve. */
export async function BloqueDirectores({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.a_quien_avisa_el_vigia')} info="vigia.directores">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.cuando_un_cliente_espera_de', { v0: ' ', v1: d.config.respaldoCorreo
            ? tx('vigia.vista.el_respaldo_por_correo_esta')
            : tx('vigia.vista.el_respaldo_por_correo_esta_2'), v2: ' ' })}
        </p>
        {[1, 2].map((nivel) => {
          const lista = (d.directores ?? []).filter((x) => x.nivel === nivel);
          return (
            <div key={nivel} className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">{NOMBRE_NIVEL(tx)[nivel]}</p>
              {lista.length === 0 ? (
                <p className="rv-vg__nota">{tx('vigia.vista.nadie_en_la_lista_se')}</p>
              ) : (
                <ul className="rv-vg__lista">
                  {lista.map((x) => (
                    <li key={x.id} className="rv-vg__bloque">
                      {!d.config.respaldoCorreo && !x.telefono && x.correo && (
                        <p role="alert" className="rv-vg__nota" data-tono="bad">
                          {tx('vigia.vista.solo_tiene_correo_y_el', { nombre: x.nombre })}
                        </p>
                      )}
                      {puedeAdministrar ? (
                        <FormaDirector accion={acciones.director} director={x} />
                      ) : (
                        <div className="rv-vg__linea">
                          <strong>{x.nombre}</strong>
                          {x.telefono && <Chip>{tx('vigia.vista.whatsapp', { v0: x.telefono.slice(-4) })}</Chip>}
                          {x.correo && <Chip>{tx('vigia.vista.correo')}</Chip>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {puedeAdministrar ? (
          <Disclosure titulo={tx('vigia.vista.agregar_a_la_lista')} variante="linea">
            <FormaDirector accion={acciones.director} />
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">{tx('vigia.vista.solo_el_dueno_de_la_3')}</p>
        )}
      </div>
    </Tarjeta>
  );
}

/**
 * 0798: «A quién avisa cuando no hay dato». Las personas de servicio al cliente a quienes el Vigía avisa primero cuando no tiene el dato
 * que el cliente pide (p. ej. la caja de una unidad). Solo el dueño la edita; quien solo mira ve el teléfono enmascarado y ningún correo.
 */
export async function BloqueServicio({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const d = await p;
  const lista = d.servicio ?? [];
  const nombreCliente = new Map(d.clientes.map((c) => [c.id, c.nombre]));
  const accion = acciones.servicio;
  return (
    <Tarjeta titulo={tx('vigia.vista.a_quien_avisa_cuando_no')} info="vigia.servicio">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.cuando_un_cliente_pregunta_algo', { v0: ' ' })}
        </p>
        {lista.length === 0 ? (
          <p className="rv-vg__nota">{tx('vigia.vista.nadie_en_la_lista_se')}</p>
        ) : (
          <ul className="rv-vg__lista">
            {lista.map((x) => (
              <li key={x.id} className="rv-vg__bloque">
                {puedeAdministrar && accion ? (
                  <FormaServicio accion={accion} contacto={x} clientes={d.clientes} />
                ) : (
                  <div className="rv-vg__linea">
                    <strong>{x.nombre}</strong>
                    <Chip>{x.clienteId ? (nombreCliente.get(x.clienteId) ?? tx('vigia.vista.un_cliente')) : tx('vigia.vista.todos_los_clientes')}</Chip>
                    {x.telefono && <Chip>{tx('vigia.vista.whatsapp', { v0: x.telefono.slice(-4) })}</Chip>}
                    {x.correo && <Chip>{tx('vigia.vista.correo')}</Chip>}
                    {!x.activo && <Chip>{tx('vigia.vista.pausado')}</Chip>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {puedeAdministrar && accion ? (
          <Disclosure titulo={tx('vigia.vista.agregar_a_servicio_al_cliente')} variante="linea">
            <FormaServicio accion={accion} clientes={d.clientes} />
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">{tx('vigia.vista.solo_el_dueno_de_la_3')}</p>
        )}
      </div>
    </Tarjeta>
  );
}

/** 0674: los últimos avisos mandados por correo como respaldo y su resultado. */
export async function BloqueCorreos({ datos: p }: { datos: Promise<DatosTablero> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const { correos = [] } = await p;
  return (
    <Tarjeta titulo={tx('vigia.vista.avisos_por_correo_respaldo')} info="vigia.correos">
      {correos.length === 0 ? (
        <VacioAgente icono={Mail} titulo={tx('vigia.vista.ningun_aviso_por_correo')}>{tx('vigia.vista.ningun_aviso_ha_necesitado_el')}</VacioAgente>
      ) : (
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.los_ultimos_avisos_que_se')}
        </p>
        <ul className="rv-vg__lista">
          {correos.map((c) => (
            <li key={c.id} className="rv-vg__linea rv-vg__nota">
              <Chip tono={c.estado === 'enviado' ? 'ok' : c.estado === 'enviando' ? undefined : 'bad'}>{TEXTO_ESTADO_CORREO(tx)[c.estado] ?? c.estado}</Chip>
              <span>{tx('vigia.vista.nivel', { nivel: c.nivel })}</span>
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(c.creadoEn, tr.idioma)}</span>
            </li>
          ))}
        </ul>
      </div>
      )}
    </Tarjeta>
  );
}

/**
 * T-A4-41: insights del agente. Cada tarjeta dice qué pasó, qué significa y qué hacer, con su fuente; el ahorro de tiempo sale
 * siempre rotulado como supuesto (no hay línea base real, B13) y nunca como porcentaje.
 */
export async function BloqueInsights({ datos: p }: { datos: Promise<InsightsEntrada> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const tarjetas = tarjetasInsights(await p);
  return (
    <Tarjeta titulo={tx('vigia.vista.resultados_del_agente')} info="vigia.resultados">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          {tx('vigia.vista.cada_numero_dice_de_donde')}
        </p>
        <div className="rv-vg__tarjetas">
          {tarjetas.map((t) => (
            <article key={t.id} className="rv-vg__tarjeta" data-tarjeta={t.id}>
              <p className="rv-vg__rotulo">{t.titulo}</p>
              <div className="rv-vg__cifra rv-ag-num">{t.valor}</div>
              {t.rotulo && <div><Chip tono="warn">{t.rotulo}</Chip></div>}
              <dl className="rv-vg__pila--s">
                <div><dt className="rv-vg__medio">{tx('vigia.vista.que_paso')} </dt><dd className="rv-vg__nota">{t.quePaso}</dd></div>
                <div><dt className="rv-vg__medio">{tx('vigia.vista.que_significa')} </dt><dd className="rv-vg__nota">{t.queSignifica}</dd></div>
                <div><dt className="rv-vg__medio">{tx('vigia.vista.que_hacer')} </dt><dd className="rv-vg__nota">{t.queHacer}</dd></div>
              </dl>
              <p className="rv-vg__micro">{tx('vigia.vista.fuente', { fuente: t.fuente })}</p>
            </article>
          ))}
        </div>
      </div>
    </Tarjeta>
  );
}
