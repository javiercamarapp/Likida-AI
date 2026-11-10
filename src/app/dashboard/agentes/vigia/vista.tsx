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
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { AvisoCompacto, Chip as ChipV2, Disclosure, EsqCifrasV2, EsqTablaV2, FilaTarjetas, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';

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
  const n = pendientes ? await pendientes.catch(() => null) : null;
  return (
    <Link href={`/dashboard/agentes/vigia/avisos${sufijo}`} className={ENLACE}>
      Avisos de viaje{typeof n === 'number' && n > 0 ? ` (${n} por revisar)` : ''}
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
export function motivosDeExcepcion(c: ConversacionTablero, slaMin: number, ahoraMs: number): string[] {
  const m: string[] = [];
  const espera = minutosDeEspera(c.sinRespuestaDesde, ahoraMs);
  if (c.molestiaNivel >= 2) m.push(c.molestiaNivel >= 3 ? 'Muy molesto' : 'Molesto');
  if (c.sinRespuestaDesde && espera >= slaMin) m.push(`Sin respuesta ${duracion(espera)}`);
  if (c.escalamientoNivel > 0) m.push(`Escalada a nivel ${c.escalamientoNivel}`);
  return m;
}

const NOMBRE_INTENCION: Record<string, string> = {
  ubicacion: 'Dónde va su viaje', eta: 'A qué hora llega', documentos: 'Documentos pendientes', factura_pod: 'Factura / comprobante de entrega',
  queja: 'Queja', pide_humano: 'Pide hablar con una persona', saludo: 'Saludo', otro: 'Otro / no se entendió',
};

const NOMBRE_EVENTO: Record<string, string> = {
  entrante: 'Llegó un mensaje', borrador: 'El Vigía redactó una respuesta', aprobado: 'Un gerente aprobó una respuesta', rechazado: 'Un gerente descartó una respuesta',
  enviado: 'Se envió una respuesta', autoenviado: 'Se envió una respuesta sola (bajo riesgo validado)', fallo_envio: 'Falló un envío', tomada: 'Un gerente tomó el hilo',
  devuelta: 'El hilo volvió al Vigía', cerrada: 'Se cerró una conversación', molestia: 'Se detectó molestia', sin_respuesta: 'Cliente sin respuesta',
  escalada: 'Escalamiento', sin_destinatario: 'No había a quién avisar', optout: 'Un cliente pidió su baja', alta: 'Se autorizó un contacto',
  baja_manual: 'Se dio de baja un contacto', suprimido: 'Se suprimieron los datos de un contacto (ARCO)', spam: 'Se detectó spam',
  sin_dato: 'Faltaba un dato real: se consultó', inyeccion: 'Mensaje con instrucciones sospechosas', otro_cliente: 'Preguntó por un folio que no es suyo',
  adjunto_enviado: 'Se envió el archivo adjunto (POD)', adjunto_pendiente: 'El archivo no salió: la ventana de 24 h del cliente está cerrada; mándaselo tú',
  adjunto_fallo: 'No se pudo mandar el archivo adjunto: revísalo y mándaselo tú',
  correo_enviado: 'Se mandó el aviso de escalamiento por correo (respaldo del WhatsApp)',
  correo_fallo: 'No se pudo mandar el aviso por correo: revisa la configuración del correo',
};

/** El estado de un correo de respaldo, en palabras de la flota (la falta de configuración se dice tal cual: nada falla en silencio). */
export const TEXTO_ESTADO_CORREO: Record<string, string> = {
  enviando: 'En curso',
  enviado: 'Enviado',
  sin_configurar: 'No se pudo mandar por correo: falta configuración',
  rechazado: 'El proveedor de correo lo rechazó',
  red: 'No se pudo mandar por correo: falla de red o sin confirmar',
};

export function VistaAgenteVigia({ datos, ahoraMs, puedeDecidir, puedeAdministrar, acciones, sufijo = '', avisosPendientes, standby = false }: {
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
  acciones: AccionesVigia;
}) {
  return (
    <MarcoPagina titulo="Servicio al cliente" apoyo="Atiende a los clientes de tu flota: clasifica, responde con datos reales y escala a una persona lo que lo requiere.">
      {/* La navegación entre las secciones del agente son las pestañas del marco; aquí solo queda el aviso con número cuando algo espera. */}
      <Suspense fallback={null}><AvisosPorRevisar sufijo={sufijo} pendientes={avisosPendientes} /></Suspense>
      <Bloque mensaje="No se pudo leer el tablero del Vigía." esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueEstadoYKpis datos={datos} ahoraMs={ahoraMs} />
      </Bloque>

      <Bloque mensaje="No se pudo leer la cola de aprobación." esqueleto={<EsqTablaV2 />}>
        <BloqueAprobacion datos={datos} puedeDecidir={puedeDecidir} acciones={acciones} standby={standby} />
      </Bloque>

      <Bloque mensaje="No se pudieron leer las excepciones." esqueleto={<EsqTablaV2 />}>
        <BloqueExcepciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
      </Bloque>

      <Bloque mensaje="No se pudieron leer las conversaciones." esqueleto={<EsqTablaV2 />}>
        <BloqueConversaciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
      </Bloque>

      <FilaTarjetas variante="6-6">
        <Bloque mensaje="No se pudo leer la configuración." esqueleto={<EsqTablaV2 />}>
          <BloqueConfiguracion datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} standby={standby} />
        </Bloque>
        <Bloque mensaje="No se pudo leer la bitácora." esqueleto={<EsqTablaV2 />}>
          <BloqueBitacora datos={datos} />
        </Bloque>
      </FilaTarjetas>

      <Bloque mensaje="No se pudo leer la lista de directores." esqueleto={<EsqTablaV2 />}>
        <BloqueDirectores datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
      </Bloque>

      <Bloque mensaje="No se pudo leer la lista de servicio al cliente." esqueleto={<EsqTablaV2 />}>
        <BloqueServicio datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
      </Bloque>

      <Bloque mensaje="No se pudieron leer los correos de respaldo." esqueleto={<EsqTablaV2 />}>
        <BloqueCorreos datos={datos} />
      </Bloque>

      <Bloque mensaje="No se pudieron leer los contactos autorizados." esqueleto={<EsqTablaV2 />}>
        <BloqueContactos datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
      </Bloque>

      <Tarjeta titulo="Los límites del Vigía" info="vigia.limites">
        <ul className="rv-vg__bullets">
          <li>Solo contesta a clientes que la flota autorizó aquí, con constancia de su consentimiento. Cualquier otro número recibe la respuesta de siempre.</li>
          <li>Cada cifra de una respuesta sale de un dato real del viaje de ESE cliente. Si el dato no existe (por ejemplo la hora estimada de llegada, que Likida aún no guarda), dice que lo consulta y te avisa.</li>
          <li>Un cliente jamás ve datos de otro cliente ni de otra flota. Si pregunta por un folio que no es suyo, no se confirma ni se niega nada.</li>
          <li>Fuera de las 24 h de su último mensaje, WhatsApp solo permite plantillas aprobadas; el Vigía no manda texto libre fuera de esa ventana.</li>
          <li>«BAJA» corta los mensajes de inmediato. Los chats se borran solos pasado el plazo de retención, y puedes suprimir los de un contacto (derechos ARCO) desde su fila.</li>
        </ul>
      </Tarjeta>
    </MarcoPagina>
  );
}

function Chip({ children, tono }: { children: React.ReactNode; tono?: 'warn' | 'bad' | 'ok' }) {
  return <ChipV2 tono={tono ?? 'neutral'} tamano="estado">{children}</ChipV2>;
}

export async function BloqueEstadoYKpis({ datos: p, ahoraMs }: { datos: Promise<DatosTablero>; ahoraMs: number }) {
  const d = await p;
  const sla = d.config.slaRespuestaMin;
  const vencidas = d.conversaciones.filter((c) => c.sinRespuestaDesde && minutosDeEspera(c.sinRespuestaDesde, ahoraMs) >= sla).length;
  const molestasOEscaladas = d.conversaciones.filter((c) => c.molestiaNivel >= 2 || c.escalamientoNivel > 0).length;
  return (
    <div className="rv-vg__pila">
      {!d.config.habilitado && (
        <AvisoCompacto tono="warn" resumen="El Vigía está apagado para tu flota: ningún cliente recibe respuesta. Autoriza a tus clientes y enciéndelo en «Configuración»." />
      )}
      <TiraCifras sello={selloHoy('Avisos de viaje')}>
        <Cifra etiqueta="Conversaciones activas" info="vigia.conversaciones_activas" valor={numero(d.conversaciones.length)} nota="clientes con un hilo abierto" />
        <Cifra etiqueta="Por aprobar" info="vigia.por_aprobar" valor={numero(d.pendientes.length)} nota="respuestas que esperan tu toque" tono={d.pendientes.length > 0 ? 'warn' : undefined} />
        <Cifra etiqueta={`Sin respuesta (SLA ${numero(sla)} min)`} info="vigia.sin_respuesta" valor={numero(vencidas)} nota="esperan más de lo permitido" tono={vencidas > 0 ? 'bad' : undefined} />
        <Cifra etiqueta="Molestos o escalados" info="vigia.molestos_escalados" valor={numero(molestasOEscaladas)} nota="requieren a una persona" tono={molestasOEscaladas > 0 ? 'bad' : undefined} />
      </TiraCifras>
      <p className="rv-vg__nota">
        Tiempo de primera respuesta:{' '}
        {d.respuesta.muestra === 0
          ? 'sin datos todavía — aún no se ha enviado ninguna respuesta en los últimos 7 días.'
          : `mediana ${duracion(d.respuesta.medianaMin ?? 0)} y promedio ${duracion(d.respuesta.promedioMin ?? 0)}, medido sobre las últimas ${numero(d.respuesta.muestra)} respuestas enviadas (7 días).`}
      </p>
    </div>
  );
}

export async function BloqueAprobacion({ datos: p, puedeDecidir, acciones, standby = false }: { datos: Promise<DatosTablero>; puedeDecidir: boolean; acciones: AccionesVigia; standby?: boolean }) {
  const d = await p;
  return (
    <Tarjeta titulo="Cola de aprobación" info="vigia.cola_aprobacion" estado={d.pendientes.length === 0 ? 'vacio' : 'ok'} iconoVacio={Inbox}
      mensaje="Nada por aprobar" detalle="Nada por aprobar. Cada respuesta que el Vigía redacte aparecerá aquí.">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Las respuestas que redactó el Vigía y esperan tu toque. También te llegan por WhatsApp con botones.
        </p>
        {d.pendientes.map((m) => (
          <article key={m.id} className="rv-vg__bloque">
            <div className="rv-vg__linea">
              <strong>{m.clienteNombre ?? 'Cliente'}</strong>
              {m.intencion && <Chip>{NOMBRE_INTENCION[m.intencion] ?? m.intencion}</Chip>}
              {m.riesgo && <Chip tono={m.riesgo === 'alto' ? 'bad' : m.riesgo === 'medio' ? 'warn' : 'ok'}>Riesgo {m.riesgo}</Chip>}
              {m.senales.includes('inyeccion') && <Chip tono="bad">Mensaje con instrucciones raras</Chip>}
              {m.senales.includes('folio_ajeno') && <Chip tono="warn">Preguntó por un folio que no es suyo</Chip>}
              {!standby && m.adjuntos.length > 0 && <Chip>Adjuntará: {m.adjuntos.join(', ')}</Chip>}
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(m.creadoEn)}</span>
            </div>
            <blockquote className="rv-vg__cita">
              {m.mensajeCliente ?? '(archivo o mensaje sin texto)'}
            </blockquote>
            {puedeDecidir
              ? <FormaBorrador accion={acciones.decidir} id={m.id} texto={m.borrador} />
              : <p className="rv-vg__nota rv-vg__texto-libre">{m.borrador}</p>}
          </article>
        ))}
      </div>
    </Tarjeta>
  );
}

export async function BloqueExcepciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const d = await p;
  const filas = ordenarPorPrioridad(d.conversaciones, ahoraMs)
    .map((c) => ({ c, motivos: motivosDeExcepcion(c, d.config.slaRespuestaMin, ahoraMs) }))
    .filter((x) => x.motivos.length > 0);
  const vacio = filas.length === 0 && d.fallidos.length === 0;
  return (
    <Tarjeta titulo="Excepciones" info="vigia.excepciones" estado={vacio ? 'vacio' : 'ok'} iconoVacio={Flame}
      mensaje="Sin excepciones" detalle="Sin excepciones: nadie espera de más ni está molesto.">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Clientes molestos, sin respuesta pasado el SLA o ya escalados, y envíos que fallaron en las últimas 24 h.
        </p>
        <ul className="rv-vg__lista">
          {filas.map(({ c, motivos }) => (
            <li key={c.id} className="rv-vg__linea rv-vg__nota">
              <strong>{c.clienteNombre ?? 'Cliente'}</strong>
              <span>{c.contactoNombre ?? ''}</span>
              {motivos.map((m) => <Chip key={m} tono="bad">{m}</Chip>)}
              {c.atendida && <Chip tono="ok">Atendida</Chip>}
              {puedeDecidir && c.control === 'agente' && (
                <span className="rv-vg__fin"><BotonConversacion accion={acciones.conversacion} id={c.id} que="tomar" etiqueta="Yo me encargo" /></span>
              )}
            </li>
          ))}
          {d.fallidos.map((f) => (
            <li key={f.id} className="rv-vg__linea rv-vg__nota">
              <strong>{f.clienteNombre ?? 'Cliente'}</strong>
              <Chip tono="warn">Falló un envío</Chip>
              <span>{f.error ?? 'sin detalle'}</span>
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(f.creadoEn)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Tarjeta>
  );
}

export async function BloqueConversaciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const d = await p;
  return (
    <Tarjeta titulo="Conversaciones activas" info="vigia.conversaciones" estado={d.conversaciones.length === 0 ? 'vacio' : 'ok'} iconoVacio={Hand}
      mensaje="Sin hilos abiertos" detalle="Ningún cliente tiene un hilo abierto.">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Al tomar un hilo, el Vigía deja de redactar en él y contestas tú desde aquí.
        </p>
        {ordenarPorPrioridad(d.conversaciones, ahoraMs).map((c) => {
          const espera = minutosDeEspera(c.sinRespuestaDesde, ahoraMs);
          return (
            <article key={c.id} className="rv-vg__bloque">
              <div className="rv-vg__linea">
                <strong>{c.clienteNombre ?? 'Cliente'}</strong>
                <span className="rv-vg__muted">{c.contactoNombre ?? ''}</span>
                {(c.prioridad ?? 0) >= 2 && <Chip tono="bad">Prioridad alta</Chip>}
                <Chip tono={c.control === 'humano' ? 'ok' : undefined}>{c.control === 'humano' ? 'Lo lleva una persona' : 'Lo lleva el Vigía'}</Chip>
                {c.sinRespuestaDesde
                  ? <Chip tono={espera >= d.config.slaRespuestaMin ? 'bad' : 'warn'}>Espera {duracion(espera)}</Chip>
                  : <Chip tono="ok">Al día</Chip>}
                {c.molestiaNivel >= 2 && <Chip tono="bad">{c.molestiaNivel >= 3 ? 'Muy molesto' : 'Molesto'}</Chip>}
              </div>
              {c.ultimoMensajeCliente && (
                <p className="rv-vg__nota">Último mensaje: «{c.ultimoMensajeCliente}»</p>
              )}
              {puedeDecidir && (
                <div className="rv-vg__linea">
                  {c.control === 'agente'
                    ? <BotonConversacion accion={acciones.conversacion} id={c.id} que="tomar" etiqueta="Yo me encargo" />
                    : <BotonConversacion accion={acciones.conversacion} id={c.id} que="devolver" etiqueta="Devolver al Vigía" />}
                  <BotonConversacion accion={acciones.conversacion} id={c.id} que="cerrar" etiqueta="Cerrar" />
                </div>
              )}
              {puedeDecidir && c.control === 'humano' && <FormaResponder accion={acciones.conversacion} id={c.id} />}
            </article>
          );
        })}
      </div>
    </Tarjeta>
  );
}

export async function BloqueConfiguracion({ datos: p, puedeAdministrar, acciones, standby = false }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia; standby?: boolean }) {
  const { config } = await p;
  return (
    <Tarjeta titulo="Configuración y SLA" info="vigia.configuracion">
      {puedeAdministrar ? (
        <FormaConfig accion={acciones.config} valores={config} standby={standby} />
      ) : (
        <ul className="rv-vg__ul">
          <li>Vigía: {config.habilitado ? 'encendido' : 'apagado'}</li>
          {!standby && <li>Modo: {config.modoAprobacion === 'siempre' ? 'siempre aprobar' : 'autoenviar solo bajo riesgo ya validado'}</li>}
          <li>SLA de respuesta: {numero(config.slaRespuestaMin)} min · dueño a los {numero(config.slaRespuestaMin + config.escalarNivel2Min)} min · clientes críticos: {numero(Math.min(config.slaRespuestaMin, config.slaCriticoMin))} min</li>
          <li>Retención: {numero(config.retencionDias)} días</li>
          <li className="rv-vg__faint">Solo el dueño de la flota cambia esto.</li>
        </ul>
      )}
    </Tarjeta>
  );
}

export async function BloqueBitacora({ datos: p }: { datos: Promise<DatosTablero> }) {
  const { eventos } = await p;
  return (
    <Tarjeta titulo="Bitácora" info="vigia.bitacora" estado={eventos.length === 0 ? 'vacio' : 'ok'} iconoVacio={History}
      mensaje="Aún sin actividad" detalle="Aún sin actividad.">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">Lo último que hizo el Vigía y quienes lo atienden. No guarda el texto de los clientes ni sus teléfonos.</p>
        <ul className="rv-vg__lista">
          {eventos.map((e) => (
            <li key={e.id} className="rv-vg__linea rv-vg__nota">
              <Icono icono={Clock} tam={14} />
              <div>
                <span>{NOMBRE_EVENTO[e.tipo] ?? e.tipo}{e.nivel ? ` (nivel ${e.nivel})` : ''}</span>
                <span className="rv-vg__micro rv-vg__bloquear">{fechaHoraMx(e.creadoEn)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Tarjeta>
  );
}

export async function BloqueContactos({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const d = await p;
  return (
    <Tarjeta titulo="Clientes autorizados" info="vigia.clientes_autorizados">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Solo estos números reciben atención del Vigía. Por privacidad, aquí solo se ven las últimas 4 cifras.
        </p>
        {d.contactos.length === 0 ? (
          <p className="rv-vg__nota">Todavía no autorizas a ningún cliente.</p>
        ) : (
          <ul className="rv-vg__lista">
            {d.contactos.map((c) => (
              <li key={c.id} className="rv-vg__linea rv-vg__nota">
                <strong>{c.clienteNombre ?? 'Cliente'}</strong>
                <span>{c.nombre ?? 'Sin nombre'} · …{c.telefonoTerminacion}</span>
                <Chip tono={c.estado === 'activo' ? 'ok' : 'warn'}>{c.estado === 'activo' ? 'Activo' : 'Dado de baja'}</Chip>
                {c.consentimientoEn && <span className="rv-vg__micro">Consentimiento: {fechaHoraMx(c.consentimientoEn)}</span>}
                {puedeAdministrar && <span className="rv-vg__fin"><AccionesContacto accion={acciones.contacto} id={c.id} activo={c.estado === 'activo'} /></span>}
              </li>
            ))}
          </ul>
        )}
        {puedeAdministrar ? (
          <Disclosure titulo="Autorizar a un cliente" variante="linea" abierto={d.contactos.length === 0}>
            {d.clientes.length === 0
              ? <p className="rv-vg__nota">Primero da de alta al cliente en «Clientes».</p>
              : <FormaAlta accion={acciones.alta} clientes={d.clientes} gerentes={d.gerentes} />}
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">Solo el dueño de la flota autoriza o da de baja contactos.</p>
        )}
      </div>
    </Tarjeta>
  );
}

const NOMBRE_NIVEL: Record<number, string> = { 1: 'Nivel 1 — gerente de servicio', 2: 'Nivel 2 — director o dueño' };

/** 0673: a quién avisa el Vigía en cada nivel. Solo el dueño la edita; el resto la ve. */
export async function BloqueDirectores({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const d = await p;
  return (
    <Tarjeta titulo="A quién avisa el Vigía" info="vigia.directores">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Cuando un cliente espera de más o se molesta, el Vigía avisa al nivel 1 y, si nadie atiende, al nivel 2. Cada persona puede tener WhatsApp, correo o ambos.
          {' '}{d.config.respaldoCorreo
            ? 'El respaldo por correo está encendido: si el WhatsApp no sale, se manda por correo.'
            : 'El respaldo por correo está apagado: solo se avisa por WhatsApp (enciéndelo en «Configuración y SLA»).'}
          {' '}Sin lista, se avisa como siempre: al responsable del cliente o al jefe de la flota (nivel 1) y al dueño (nivel 2).
        </p>
        {[1, 2].map((nivel) => {
          const lista = (d.directores ?? []).filter((x) => x.nivel === nivel);
          return (
            <div key={nivel} className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">{NOMBRE_NIVEL[nivel]}</p>
              {lista.length === 0 ? (
                <p className="rv-vg__nota">Nadie en la lista: se avisa como siempre.</p>
              ) : (
                <ul className="rv-vg__lista">
                  {lista.map((x) => (
                    <li key={x.id} className="rv-vg__bloque">
                      {!d.config.respaldoCorreo && !x.telefono && x.correo && (
                        <p role="alert" className="rv-vg__nota" data-tono="bad">
                          {x.nombre} solo tiene correo y el respaldo por correo está apagado: no recibirá ningún aviso. Agrega su WhatsApp o enciende el respaldo en «Configuración y SLA».
                        </p>
                      )}
                      {puedeAdministrar ? (
                        <FormaDirector accion={acciones.director} director={x} />
                      ) : (
                        <div className="rv-vg__linea">
                          <strong>{x.nombre}</strong>
                          {x.telefono && <Chip>WhatsApp …{x.telefono.slice(-4)}</Chip>}
                          {x.correo && <Chip>Correo</Chip>}
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
          <Disclosure titulo="Agregar a la lista" variante="linea">
            <FormaDirector accion={acciones.director} />
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">Solo el dueño de la flota cambia esta lista.</p>
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
  const d = await p;
  const lista = d.servicio ?? [];
  const nombreCliente = new Map(d.clientes.map((c) => [c.id, c.nombre]));
  const accion = acciones.servicio;
  return (
    <Tarjeta titulo="A quién avisa cuando no hay dato" info="vigia.servicio">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Cuando un cliente pregunta algo que el sistema no tiene (por ejemplo, la caja de una unidad), el Vigía avisa en privado a estas personas de servicio al cliente.
          {' '}Sin lista, se avisa como siempre: al responsable del cliente o al jefe de la flota. Hasta 10 personas.
        </p>
        {lista.length === 0 ? (
          <p className="rv-vg__nota">Nadie en la lista: se avisa como siempre.</p>
        ) : (
          <ul className="rv-vg__lista">
            {lista.map((x) => (
              <li key={x.id} className="rv-vg__bloque">
                {puedeAdministrar && accion ? (
                  <FormaServicio accion={accion} contacto={x} clientes={d.clientes} />
                ) : (
                  <div className="rv-vg__linea">
                    <strong>{x.nombre}</strong>
                    <Chip>{x.clienteId ? (nombreCliente.get(x.clienteId) ?? 'Un cliente') : 'Todos los clientes'}</Chip>
                    {x.telefono && <Chip>WhatsApp …{x.telefono.slice(-4)}</Chip>}
                    {x.correo && <Chip>Correo</Chip>}
                    {!x.activo && <Chip>Pausado</Chip>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {puedeAdministrar && accion ? (
          <Disclosure titulo="Agregar a servicio al cliente" variante="linea">
            <FormaServicio accion={accion} clientes={d.clientes} />
          </Disclosure>
        ) : (
          <p className="rv-vg__micro">Solo el dueño de la flota cambia esta lista.</p>
        )}
      </div>
    </Tarjeta>
  );
}

/** 0674: los últimos avisos mandados por correo como respaldo y su resultado. */
export async function BloqueCorreos({ datos: p }: { datos: Promise<DatosTablero> }) {
  const { correos = [] } = await p;
  return (
    <Tarjeta titulo="Avisos por correo (respaldo)" info="vigia.correos" estado={correos.length === 0 ? 'vacio' : 'ok'} iconoVacio={Mail}
      mensaje="Ningún aviso por correo" detalle="Ningún aviso ha necesitado el respaldo por correo.">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Los últimos avisos que se intentaron por correo porque el WhatsApp no salió. Si dice «falta configuración», el correo de Likida aún no está encendido para tu flota: avísanos.
        </p>
        <ul className="rv-vg__lista">
          {correos.map((c) => (
            <li key={c.id} className="rv-vg__linea rv-vg__nota">
              <Chip tono={c.estado === 'enviado' ? 'ok' : c.estado === 'enviando' ? undefined : 'bad'}>{TEXTO_ESTADO_CORREO[c.estado] ?? c.estado}</Chip>
              <span>Nivel {c.nivel}</span>
              <span className="rv-vg__micro rv-vg__fin">{fechaHoraMx(c.creadoEn)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Tarjeta>
  );
}

/**
 * T-A4-41: insights del agente. Cada tarjeta dice qué pasó, qué significa y qué hacer, con su fuente; el ahorro de tiempo sale
 * siempre rotulado como supuesto (no hay línea base real, B13) y nunca como porcentaje.
 */
export async function BloqueInsights({ datos: p }: { datos: Promise<InsightsEntrada> }) {
  const tarjetas = tarjetasInsights(await p);
  return (
    <Tarjeta titulo="Resultados del agente" info="vigia.resultados">
      <div className="rv-vg__pila">
        <p className="rv-vg__nota">
          Cada número dice de dónde sale. Donde depende de un supuesto o de reglas sin validar con datos reales, va marcado.
        </p>
        <div className="rv-vg__tarjetas">
          {tarjetas.map((t) => (
            <article key={t.id} className="rv-vg__tarjeta" data-tarjeta={t.id}>
              <p className="rv-vg__rotulo">{t.titulo}</p>
              <div className="rv-vg__cifra cifra-mono">{t.valor}</div>
              {t.rotulo && <div><Chip tono="warn">{t.rotulo}</Chip></div>}
              <dl className="rv-vg__pila--s">
                <div><dt className="rv-vg__medio">Qué pasó: </dt><dd className="rv-vg__nota">{t.quePaso}</dd></div>
                <div><dt className="rv-vg__medio">Qué significa: </dt><dd className="rv-vg__nota">{t.queSignifica}</dd></div>
                <div><dt className="rv-vg__medio">Qué hacer: </dt><dd className="rv-vg__nota">{t.queHacer}</dd></div>
              </dl>
              <p className="rv-vg__micro">Fuente: {t.fuente}</p>
            </article>
          ))}
        </div>
      </div>
    </Tarjeta>
  );
}
