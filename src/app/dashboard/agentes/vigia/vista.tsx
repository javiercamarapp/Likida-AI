import Link from 'next/link';
import { UsersRound, Hand, Clock, Flame, Inbox, ShieldCheck, History, Settings2, AlertTriangle, Mail } from 'lucide-react';
import { numero, fechaHoraMx } from '@/lib/formato';
import type { DatosTablero, ConversacionTablero } from '@/lib/likida/vigia/repo';
import { BarraPagina } from '../../resumen-visual';
import { Bloque, Barra, EsqTabla } from '../../bloque';
import {
  FormaBorrador, BotonConversacion, FormaResponder, FormaConfig, FormaAlta, FormaDirector, AccionesContacto, type AccionVigia,
} from './controles';

export interface AccionesVigia {
  decidir: AccionVigia;
  conversacion: AccionVigia;
  config: AccionVigia;
  alta: AccionVigia;
  contacto: AccionVigia;
  /** 0673: alta, corrección y baja de un director de la lista de avisos (solo el dueño). */
  director: AccionVigia;
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

export function VistaAgenteVigia({ datos, ahoraMs, puedeDecidir, puedeAdministrar, acciones, sufijo = '' }: {
  datos: Promise<DatosTablero>;
  sufijo?: string;
  ahoraMs: number;
  /** flota_admin y encargado deciden por los clientes; el resto solo mira. */
  puedeDecidir: boolean;
  /** Solo el dueño configura, autoriza contactos y ejerce ARCO. */
  puedeAdministrar: boolean;
  acciones: AccionesVigia;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<UsersRound width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Servicio al cliente (Vigía)"
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          <nav aria-label="Herramientas del agente" className="flex flex-wrap gap-2 text-[12.5px]">
            <Link href={`/dashboard/agentes/vigia/historial${sufijo}`} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">Grupos críticos e histórico (FAQs y tendencias)</Link>
          </nav>
          <Bloque mensaje="No se pudo leer el tablero del Vigía." esqueleto={<EsqKpis />}>
            <BloqueEstadoYKpis datos={datos} ahoraMs={ahoraMs} />
          </Bloque>

          <Bloque mensaje="No se pudo leer la cola de aprobación." esqueleto={<EsqTabla filas={3} />}>
            <BloqueAprobacion datos={datos} puedeDecidir={puedeDecidir} acciones={acciones} />
          </Bloque>

          <Bloque mensaje="No se pudieron leer las excepciones." esqueleto={<EsqTabla filas={3} />}>
            <BloqueExcepciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
          </Bloque>

          <Bloque mensaje="No se pudieron leer las conversaciones." esqueleto={<EsqTabla filas={5} />}>
            <BloqueConversaciones datos={datos} ahoraMs={ahoraMs} puedeDecidir={puedeDecidir} acciones={acciones} />
          </Bloque>

          <div className="grid lg:grid-cols-2 gap-4">
            <Bloque mensaje="No se pudo leer la configuración." esqueleto={<EsqTabla filas={4} />}>
              <BloqueConfiguracion datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
            </Bloque>
            <Bloque mensaje="No se pudo leer la bitácora." esqueleto={<EsqTabla filas={4} />}>
              <BloqueBitacora datos={datos} />
            </Bloque>
          </div>

          <Bloque mensaje="No se pudo leer la lista de directores." esqueleto={<EsqTabla filas={3} />}>
            <BloqueDirectores datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
          </Bloque>

          <Bloque mensaje="No se pudieron leer los correos de respaldo." esqueleto={<EsqTabla filas={3} />}>
            <BloqueCorreos datos={datos} />
          </Bloque>

          <Bloque mensaje="No se pudieron leer los contactos autorizados." esqueleto={<EsqTabla filas={4} />}>
            <BloqueContactos datos={datos} puedeAdministrar={puedeAdministrar} acciones={acciones} />
          </Bloque>

          <section className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              <h2 className="font-display text-[15px] font-semibold">Los límites del Vigía</h2>
            </div>
            <ul className="text-[12.5px] space-y-1.5 list-disc pl-5" style={{ color: 'var(--muted)' }}>
              <li>Solo contesta a clientes que la flota autorizó aquí, con constancia de su consentimiento. Cualquier otro número recibe la respuesta de siempre.</li>
              <li>Cada cifra de una respuesta sale de un dato real del viaje de ESE cliente. Si el dato no existe (por ejemplo la hora estimada de llegada, que Likida aún no guarda), dice que lo consulta y te avisa.</li>
              <li>Un cliente jamás ve datos de otro cliente ni de otra flota. Si pregunta por un folio que no es suyo, no se confirma ni se niega nada.</li>
              <li>Fuera de las 24 h de su último mensaje, WhatsApp solo permite plantillas aprobadas; el Vigía no manda texto libre fuera de esa ventana.</li>
              <li>«BAJA» corta los mensajes de inmediato. Los chats se borran solos pasado el plazo de retención, y puedes suprimir los de un contacto (derechos ARCO) desde su fila.</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function EsqKpis() {
  return (
    <div role="status" aria-label="Cargando" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card p-3.5"><Barra alto={10} ancho="55%" /><div className="mt-1.5"><Barra alto={20} ancho="60%" /></div></div>
      ))}
    </div>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1" style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}

function Leyenda({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[80px] flex items-center justify-center">
      <p className="text-[12.5px] text-center max-w-[48ch]" style={{ color: 'var(--muted)' }}>{children}</p>
    </div>
  );
}

function Chip({ children, tono }: { children: React.ReactNode; tono?: 'warn' | 'bad' | 'ok' }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium"
      style={{ color: tono ? `var(--${tono})` : 'var(--muted)', background: tono ? `var(--${tono === 'ok' ? 'ok' : tono}bg)` : 'var(--canvas)' }}>
      {children}
    </span>
  );
}

export async function BloqueEstadoYKpis({ datos: p, ahoraMs }: { datos: Promise<DatosTablero>; ahoraMs: number }) {
  const d = await p;
  const sla = d.config.slaRespuestaMin;
  const vencidas = d.conversaciones.filter((c) => c.sinRespuestaDesde && minutosDeEspera(c.sinRespuestaDesde, ahoraMs) >= sla).length;
  const molestasOEscaladas = d.conversaciones.filter((c) => c.molestiaNivel >= 2 || c.escalamientoNivel > 0).length;
  return (
    <div className="space-y-3">
      {!d.config.habilitado && (
        <div role="status" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
          <AlertTriangle width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          El Vigía está apagado para tu flota: ningún cliente recibe respuesta. Autoriza a tus clientes y enciéndelo en «Configuración».
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi titulo="Conversaciones activas" valor={numero(d.conversaciones.length)} nota="clientes con un hilo abierto" />
        <Kpi titulo="Por aprobar" valor={numero(d.pendientes.length)} nota="respuestas que esperan tu toque" tono={d.pendientes.length > 0 ? 'warn' : undefined} />
        <Kpi titulo={`Sin respuesta (SLA ${numero(sla)} min)`} valor={numero(vencidas)} nota="esperan más de lo permitido" tono={vencidas > 0 ? 'bad' : undefined} />
        <Kpi titulo="Molestos o escalados" valor={numero(molestasOEscaladas)} nota="requieren a una persona" tono={molestasOEscaladas > 0 ? 'bad' : undefined} />
      </div>
      <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Tiempo de primera respuesta:{' '}
        {d.respuesta.muestra === 0
          ? 'sin datos todavía — aún no se ha enviado ninguna respuesta en los últimos 7 días.'
          : `mediana ${duracion(d.respuesta.medianaMin ?? 0)} y promedio ${duracion(d.respuesta.promedioMin ?? 0)}, medido sobre las últimas ${numero(d.respuesta.muestra)} respuestas enviadas (7 días).`}
      </p>
    </div>
  );
}

export async function BloqueAprobacion({ datos: p, puedeDecidir, acciones }: { datos: Promise<DatosTablero>; puedeDecidir: boolean; acciones: AccionesVigia }) {
  const d = await p;
  return (
    <section className="card p-4" aria-labelledby="h-aprob">
      <div className="flex items-center gap-2 mb-1">
        <Inbox width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-aprob" className="font-display text-[15px] font-semibold">Cola de aprobación</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Las respuestas que redactó el Vigía y esperan tu toque. También te llegan por WhatsApp con botones.
      </p>
      {d.pendientes.length === 0 ? (
        <Leyenda>Nada por aprobar. Cada respuesta que el Vigía redacte aparecerá aquí.</Leyenda>
      ) : (
        <div className="space-y-4">
          {d.pendientes.map((m) => (
            <article key={m.id} className="hairline rounded-xl p-3.5 space-y-2.5" style={{ background: 'var(--surface)' }}>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <strong>{m.clienteNombre ?? 'Cliente'}</strong>
                {m.intencion && <Chip>{NOMBRE_INTENCION[m.intencion] ?? m.intencion}</Chip>}
                {m.riesgo && <Chip tono={m.riesgo === 'alto' ? 'bad' : m.riesgo === 'medio' ? 'warn' : 'ok'}>Riesgo {m.riesgo}</Chip>}
                {m.senales.includes('inyeccion') && <Chip tono="bad">Mensaje con instrucciones raras</Chip>}
                {m.senales.includes('folio_ajeno') && <Chip tono="warn">Preguntó por un folio que no es suyo</Chip>}
                {m.adjuntos.length > 0 && <Chip>Adjuntará: {m.adjuntos.join(', ')}</Chip>}
                <span className="ml-auto text-[11px]" style={{ color: 'var(--faint)' }}>{fechaHoraMx(m.creadoEn)}</span>
              </div>
              <blockquote className="text-[12.5px] pl-3 border-l-2" style={{ borderColor: 'var(--line2)', color: 'var(--muted)' }}>
                {m.mensajeCliente ?? '(archivo o mensaje sin texto)'}
              </blockquote>
              {puedeDecidir
                ? <FormaBorrador accion={acciones.decidir} id={m.id} texto={m.borrador} />
                : <p className="text-[12.5px] whitespace-pre-wrap">{m.borrador}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export async function BloqueExcepciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const d = await p;
  const filas = d.conversaciones
    .map((c) => ({ c, motivos: motivosDeExcepcion(c, d.config.slaRespuestaMin, ahoraMs) }))
    .filter((x) => x.motivos.length > 0);
  return (
    <section className="card p-4" aria-labelledby="h-exc">
      <div className="flex items-center gap-2 mb-1">
        <Flame width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
        <h2 id="h-exc" className="font-display text-[15px] font-semibold">Excepciones</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Clientes molestos, sin respuesta pasado el SLA o ya escalados, y envíos que fallaron en las últimas 24 h.
      </p>
      {filas.length === 0 && d.fallidos.length === 0 ? (
        <Leyenda>Sin excepciones: nadie espera de más ni está molesto.</Leyenda>
      ) : (
        <div className="space-y-2.5">
          {filas.map(({ c, motivos }) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <strong>{c.clienteNombre ?? 'Cliente'}</strong>
              <span style={{ color: 'var(--muted)' }}>{c.contactoNombre ?? ''}</span>
              {motivos.map((m) => <Chip key={m} tono="bad">{m}</Chip>)}
              {c.atendida && <Chip tono="ok">Atendida</Chip>}
              {puedeDecidir && c.control === 'agente' && (
                <span className="ml-auto"><BotonConversacion accion={acciones.conversacion} id={c.id} que="tomar" etiqueta="Yo me encargo" /></span>
              )}
            </div>
          ))}
          {d.fallidos.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <strong>{f.clienteNombre ?? 'Cliente'}</strong>
              <Chip tono="warn">Falló un envío</Chip>
              <span style={{ color: 'var(--muted)' }}>{f.error ?? 'sin detalle'}</span>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--faint)' }}>{fechaHoraMx(f.creadoEn)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export async function BloqueConversaciones({ datos: p, ahoraMs, puedeDecidir, acciones }: {
  datos: Promise<DatosTablero>; ahoraMs: number; puedeDecidir: boolean; acciones: AccionesVigia;
}) {
  const d = await p;
  return (
    <section className="card p-4" aria-labelledby="h-conv">
      <div className="flex items-center gap-2 mb-1">
        <Hand width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-conv" className="font-display text-[15px] font-semibold">Conversaciones activas</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Al tomar un hilo, el Vigía deja de redactar en él y contestas tú desde aquí.
      </p>
      {d.conversaciones.length === 0 ? (
        <Leyenda>Ningún cliente tiene un hilo abierto.</Leyenda>
      ) : (
        <div className="space-y-3">
          {d.conversaciones.map((c) => {
            const espera = minutosDeEspera(c.sinRespuestaDesde, ahoraMs);
            return (
              <article key={c.id} className="hairline rounded-xl p-3.5 space-y-2" style={{ background: 'var(--surface)' }}>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <strong>{c.clienteNombre ?? 'Cliente'}</strong>
                  <span style={{ color: 'var(--muted)' }}>{c.contactoNombre ?? ''}</span>
                  <Chip tono={c.control === 'humano' ? 'ok' : undefined}>{c.control === 'humano' ? 'Lo lleva una persona' : 'Lo lleva el Vigía'}</Chip>
                  {c.sinRespuestaDesde
                    ? <Chip tono={espera >= d.config.slaRespuestaMin ? 'bad' : 'warn'}>Espera {duracion(espera)}</Chip>
                    : <Chip tono="ok">Al día</Chip>}
                  {c.molestiaNivel >= 2 && <Chip tono="bad">{c.molestiaNivel >= 3 ? 'Muy molesto' : 'Molesto'}</Chip>}
                </div>
                {c.ultimoMensajeCliente && (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Último mensaje: «{c.ultimoMensajeCliente}»</p>
                )}
                {puedeDecidir && (
                  <div className="flex flex-wrap items-start gap-3">
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
      )}
    </section>
  );
}

export async function BloqueConfiguracion({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const { config } = await p;
  return (
    <section className="card p-4" aria-labelledby="h-cfg">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-cfg" className="font-display text-[15px] font-semibold">Configuración y SLA</h2>
      </div>
      {puedeAdministrar ? (
        <FormaConfig accion={acciones.config} valores={config} />
      ) : (
        <ul className="text-[12.5px] space-y-1" style={{ color: 'var(--muted)' }}>
          <li>Vigía: {config.habilitado ? 'encendido' : 'apagado'}</li>
          <li>Modo: {config.modoAprobacion === 'siempre' ? 'siempre aprobar' : 'autoenviar solo bajo riesgo ya validado'}</li>
          <li>SLA de respuesta: {numero(config.slaRespuestaMin)} min · dueño a los {numero(config.slaRespuestaMin + config.escalarNivel2Min)} min · clientes críticos: {numero(Math.min(config.slaRespuestaMin, config.slaCriticoMin))} min</li>
          <li>Retención: {numero(config.retencionDias)} días</li>
          <li className="pt-1" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota cambia esto.</li>
        </ul>
      )}
    </section>
  );
}

export async function BloqueBitacora({ datos: p }: { datos: Promise<DatosTablero> }) {
  const { eventos } = await p;
  return (
    <section className="card p-4" aria-labelledby="h-bit">
      <div className="flex items-center gap-2 mb-1">
        <History width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-bit" className="font-display text-[15px] font-semibold">Bitácora</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Lo último que hizo el Vigía y quienes lo atienden. No guarda el texto de los clientes ni sus teléfonos.</p>
      {eventos.length === 0 ? (
        <Leyenda>Aún sin actividad.</Leyenda>
      ) : (
        <div className="space-y-2 text-[12.5px]">
          {eventos.map((e) => (
            <div key={e.id} className="flex items-start gap-2">
              <Clock width={12} height={12} strokeWidth={1.75} className="mt-1 shrink-0" style={{ color: 'var(--faint)' }} />
              <div className="min-w-0">
                <span>{NOMBRE_EVENTO[e.tipo] ?? e.tipo}{e.nivel ? ` (nivel ${e.nivel})` : ''}</span>
                <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{fechaHoraMx(e.creadoEn)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export async function BloqueContactos({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const d = await p;
  return (
    <section className="card p-4" aria-labelledby="h-ct">
      <div className="flex items-center gap-2 mb-1">
        <UsersRound width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-ct" className="font-display text-[15px] font-semibold">Clientes autorizados</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Solo estos números reciben atención del Vigía. Por privacidad, aquí solo se ven las últimas 4 cifras.
      </p>
      {d.contactos.length === 0 ? (
        <Leyenda>Todavía no autorizas a ningún cliente.</Leyenda>
      ) : (
        <div className="space-y-2.5 mb-4">
          {d.contactos.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <strong>{c.clienteNombre ?? 'Cliente'}</strong>
              <span style={{ color: 'var(--muted)' }}>{c.nombre ?? 'Sin nombre'} · …{c.telefonoTerminacion}</span>
              <Chip tono={c.estado === 'activo' ? 'ok' : 'warn'}>{c.estado === 'activo' ? 'Activo' : 'Dado de baja'}</Chip>
              {c.consentimientoEn && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Consentimiento: {fechaHoraMx(c.consentimientoEn)}</span>}
              {puedeAdministrar && <span className="ml-auto"><AccionesContacto accion={acciones.contacto} id={c.id} activo={c.estado === 'activo'} /></span>}
            </div>
          ))}
        </div>
      )}
      {puedeAdministrar ? (
        <div className="pt-3 border-t" style={{ borderColor: 'var(--line2)' }}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Autorizar a un cliente</h3>
          {d.clientes.length === 0
            ? <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Primero da de alta al cliente en «Clientes».</p>
            : <FormaAlta accion={acciones.alta} clientes={d.clientes} gerentes={d.gerentes} />}
        </div>
      ) : (
        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota autoriza o da de baja contactos.</p>
      )}
    </section>
  );
}

const NOMBRE_NIVEL: Record<number, string> = { 1: 'Nivel 1 — gerente de servicio', 2: 'Nivel 2 — director o dueño' };

/** 0673: a quién avisa el Vigía en cada nivel. Solo el dueño la edita; el resto la ve. */
export async function BloqueDirectores({ datos: p, puedeAdministrar, acciones }: { datos: Promise<DatosTablero>; puedeAdministrar: boolean; acciones: AccionesVigia }) {
  const d = await p;
  return (
    <section className="card p-4" aria-labelledby="h-dir">
      <div className="flex items-center gap-2 mb-1">
        <UsersRound width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-dir" className="font-display text-[15px] font-semibold">A quién avisa el Vigía</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Cuando un cliente espera de más o se molesta, el Vigía avisa al nivel 1 y, si nadie atiende, al nivel 2. Cada persona puede tener WhatsApp, correo o ambos.
        {' '}{d.config.respaldoCorreo
          ? 'El respaldo por correo está encendido: si el WhatsApp no sale, se manda por correo.'
          : 'El respaldo por correo está apagado: solo se avisa por WhatsApp (enciéndelo en «Configuración y SLA»).'}
        {' '}Sin lista, se avisa como siempre: al responsable del cliente o al jefe de la flota (nivel 1) y al dueño (nivel 2).
      </p>
      {[1, 2].map((nivel) => {
        const lista = (d.directores ?? []).filter((x) => x.nivel === nivel);
        return (
          <div key={nivel} className="mb-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>{NOMBRE_NIVEL[nivel]}</h3>
            {lista.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Nadie en la lista: se avisa como siempre.</p>
            ) : (
              <div className="space-y-3">
                {lista.map((x) => (
                  <div key={x.id} className="hairline rounded-xl p-3" style={{ background: 'var(--surface)' }}>
                    {puedeAdministrar ? (
                      <FormaDirector accion={acciones.director} director={x} />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <strong>{x.nombre}</strong>
                        {x.telefono && <Chip>WhatsApp …{x.telefono.slice(-4)}</Chip>}
                        {x.correo && <Chip>Correo</Chip>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {puedeAdministrar ? (
        <div className="pt-3 border-t" style={{ borderColor: 'var(--line2)' }}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Agregar a la lista</h3>
          <FormaDirector accion={acciones.director} />
        </div>
      ) : (
        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota cambia esta lista.</p>
      )}
    </section>
  );
}

/** 0674: los últimos avisos mandados por correo como respaldo y su resultado. */
export async function BloqueCorreos({ datos: p }: { datos: Promise<DatosTablero> }) {
  const { correos = [] } = await p;
  return (
    <section className="card p-4" aria-labelledby="h-cor">
      <div className="flex items-center gap-2 mb-1">
        <Mail width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 id="h-cor" className="font-display text-[15px] font-semibold">Avisos por correo (respaldo)</h2>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Los últimos avisos que se intentaron por correo porque el WhatsApp no salió. Si dice «falta configuración», el correo de Likida aún no está encendido para tu flota: avísanos.
      </p>
      {correos.length === 0 ? (
        <Leyenda>Ningún aviso ha necesitado el respaldo por correo.</Leyenda>
      ) : (
        <div className="space-y-2 text-[12.5px]">
          {correos.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <Chip tono={c.estado === 'enviado' ? 'ok' : c.estado === 'enviando' ? undefined : 'bad'}>{TEXTO_ESTADO_CORREO[c.estado] ?? c.estado}</Chip>
              <span style={{ color: 'var(--muted)' }}>Nivel {c.nivel}</span>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--faint)' }}>{fechaHoraMx(c.creadoEn)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
