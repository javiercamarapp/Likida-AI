'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, X, Hand, Send, Save, UserPlus, TriangleAlert, CheckCircle2, RotateCcw, Archive, Trash2, UserX } from 'lucide-react';
import type { Director, ModoAprobacion } from '@/lib/likida/vigia/tipos';
import type { ContactoServicio, FestivoFlota } from '@/lib/likida/vigia/repo';
import { TURNOS_DIRECTOR, type TurnoDirector, type FestivoSugerido } from '@/lib/likida/vigia/turnos';

export type ResultadoVigia = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionVigia = (previo: ResultadoVigia, fd: FormData) => Promise<ResultadoVigia>;

const CAMPO = 'w-full hairline rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Aviso({ estado }: { estado: ResultadoVigia }) {
  if (!estado) return null;
  return estado.ok ? (
    <div role="status" className="flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={14} height={14} strokeWidth={1.75} />{estado.mensaje}
    </div>
  ) : (
    <div role="alert" className="flex items-start gap-2 text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />{estado.error}
    </div>
  );
}

type Tono = 'marca' | 'neutro' | 'peligro';
function Boton({ children, name, value, tono = 'neutro', Icono }: {
  children: React.ReactNode; name?: string; value?: string; tono?: Tono; Icono?: typeof Check;
}) {
  const { pending } = useFormStatus();
  const estilo = tono === 'marca'
    ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
    : tono === 'peligro' ? { background: 'var(--badbg)', color: 'var(--bad)' } : { background: 'var(--canvas)', color: 'var(--ink)' };
  return (
    <button type="submit" name={name} value={value} disabled={pending}
      className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50 hairline"
      style={estilo}>
      {Icono && <Icono width={13} height={13} strokeWidth={1.75} />}{children}
    </button>
  );
}

/** La respuesta que redactó el agente: el gerente la lee, la edita si quiere y decide con un toque. */
export function FormaBorrador({ accion, id, texto }: { accion: AccionVigia; id: string; texto: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`b-${id}`} className={ETIQUETA}>Respuesta propuesta (puedes editarla antes de enviar)</label>
      <textarea id={`b-${id}`} name="texto" defaultValue={texto} rows={4} maxLength={1000} className={CAMPO} style={{ background: 'var(--surface)' }} />
      <div className="flex flex-wrap gap-2">
        <Boton name="accion" value="aprobar" tono="marca" Icono={Send}>Enviar</Boton>
        <Boton name="accion" value="rechazar" Icono={X}>No enviar</Boton>
        <Boton name="accion" value="tomar" Icono={Hand}>Yo me encargo</Boton>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Una acción de un solo botón sobre una conversación (tomar, devolver, cerrar). */
export function BotonConversacion({ accion, id, que, etiqueta }: {
  accion: AccionVigia; id: string; que: 'tomar' | 'devolver' | 'cerrar'; etiqueta: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const Icono = que === 'tomar' ? Hand : que === 'devolver' ? RotateCcw : Archive;
  return (
    <form action={despachar} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Boton name="accion" value={que} Icono={Icono}>{etiqueta}</Boton>
      {estado && !estado.ok && <span className="text-[11px]" style={{ color: 'var(--bad)' }}>{estado.error}</span>}
    </form>
  );
}

/** El gerente contesta él mismo (el hilo ya es suyo). Sale por los mismos límites que todo envío al cliente. */
export function FormaResponder({ accion, id }: { accion: AccionVigia; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`r-${id}`} className={ETIQUETA}>Responder al cliente</label>
      <textarea id={`r-${id}`} name="texto" rows={2} maxLength={1000} required className={CAMPO} style={{ background: 'var(--surface)' }} />
      <Boton name="accion" value="responder" tono="marca" Icono={Send}>Enviar respuesta</Boton>
      <p className={AYUDA} style={{ color: 'var(--faint)' }}>
        Dentro de las 24 h del último mensaje del cliente sale como texto; fuera de esa ventana sale solo con la plantilla aprobada de Meta.
      </p>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaConfig({ accion, valores, standby = false }: {
  accion: AccionVigia;
  /** T-A4-32: bajo el perfil cinco_agentes el autoenvío es stand-by: ni la opción ni su umbral se muestran (el código sigue intacto). */
  standby?: boolean;
  valores: {
    habilitado: boolean; modoAprobacion: ModoAprobacion; autoenviarMinAprobaciones: number; slaRespuestaMin: number;
    escalarNivel2Min: number; slaCriticoMin: number; molestiaAvisoNivel: number; retencionDias: number; avisoPrivacidadUrl: string | null; respaldoCorreo: boolean;
  };
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="habilitado" defaultChecked={valores.habilitado} className="mt-0.5" />
        <span><strong>Vigía encendido.</strong> Apagado, ningún cliente recibe respuesta de este agente (queda silencio, no «no te tengo registrado»).</span>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="cfg-modo" className={ETIQUETA}>Modo de aprobación</label>
          <select id="cfg-modo" name="modoAprobacion" defaultValue={standby ? 'siempre' : valores.modoAprobacion} className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="siempre">Siempre aprobar (recomendado al empezar)</option>
            {!standby && <option value="autoenviar_bajo_riesgo">Autoenviar solo preguntas de bajo riesgo ya validadas</option>}
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {standby
              ? 'El Vigía solo avisa y propone: cada respuesta espera tu toque antes de salir.'
              : 'Aun en autoenvío, una queja, un cliente molesto, un dato faltante o un mensaje raro SIEMPRE esperan tu toque.'}
          </p>
        </div>
        {standby ? (
          <input type="hidden" name="autoenviarMinAprobaciones" value={valores.autoenviarMinAprobaciones} />
        ) : (
          <div>
            <label htmlFor="cfg-min" className={ETIQUETA}>Aprobaciones sin editar para validar una pregunta</label>
            <input id="cfg-min" name="autoenviarMinAprobaciones" type="text" inputMode="numeric" defaultValue={valores.autoenviarMinAprobaciones} className={CAMPO} style={{ background: 'var(--surface)' }} />
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 1 y 100, por tipo de pregunta (ubicación, documentos…).</p>
          </div>
        )}
        <div>
          <label htmlFor="cfg-sla" className={ETIQUETA}>Minutos sin respuesta antes de avisar al responsable</label>
          <input id="cfg-sla" name="slaRespuestaMin" type="text" inputMode="numeric" defaultValue={valores.slaRespuestaMin} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 5 y 1,440 (10 por omisión; tú fijas el plazo de tu flota). Si el cliente tiene un grupo crítico, rige el menor entre este y el de clientes críticos.</p>
        </div>
        <div>
          <label htmlFor="cfg-n2" className={ETIQUETA}>Minutos adicionales antes de avisar al dueño</label>
          <input id="cfg-n2" name="escalarNivel2Min" type="text" inputMode="numeric" defaultValue={valores.escalarNivel2Min} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 5 y 2,880.</p>
        </div>
        <div>
          <label htmlFor="cfg-crit" className={ETIQUETA}>Minutos sin respuesta en clientes CRÍTICOS</label>
          <input id="cfg-crit" name="slaCriticoMin" type="text" inputMode="numeric" defaultValue={valores.slaCriticoMin} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 2 y 1,440 (10 por omisión; 5 y 10 son solo ejemplos, tú fijas el plazo). Rige para los clientes con un grupo marcado como crítico; se aplica el menor entre este y el general.</p>
        </div>
        <div>
          <label htmlFor="cfg-mol" className={ETIQUETA}>Avisar al responsable desde la molestia nivel</label>
          <select id="cfg-mol" name="molestiaAvisoNivel" defaultValue={String(valores.molestiaAvisoNivel)} className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="2">2 — cliente molesto (recomendado)</option>
            <option value="3">3 — solo molestia crítica</option>
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>La molestia crítica (nivel 3) siempre avisa también al dueño.</p>
        </div>
        <div>
          <label htmlFor="cfg-ret" className={ETIQUETA}>Días que se conservan los mensajes</label>
          <input id="cfg-ret" name="retencionDias" type="text" inputMode="numeric" defaultValue={valores.retencionDias} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 30 y 730. Pasado ese plazo se borran solos.</p>
        </div>
        <div>
          <label htmlFor="cfg-aviso" className={ETIQUETA}>Liga de tu aviso de privacidad para clientes (https)</label>
          <input id="cfg-aviso" name="avisoPrivacidadUrl" type="url" defaultValue={valores.avisoPrivacidadUrl ?? ''} placeholder="https://tu-empresa.mx/privacidad" className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Va en el primer mensaje que recibe cada cliente. Sin liga, ese mensaje sale sin aviso: la de Likida es de otro responsable y no cubre a tus clientes.</p>
        </div>
      </div>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="respaldoCorreo" defaultChecked={valores.respaldoCorreo} className="mt-0.5" />
        <span>
          <strong>Respaldo por correo.</strong> Si el aviso de escalamiento por WhatsApp no sale (plantilla sin aprobar o ventana de 24 h cerrada), se manda por correo a quien
          tenga correo en la lista de directores. Apagado, el aviso solo sale por WhatsApp.
        </span>
      </label>
      <Boton tono="marca" Icono={Save}>Guardar</Boton>
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * Un director de la lista (nivel 1 gerente, nivel 2 director o dueño): se corrige o se quita. Sin `director`, es el alta de uno nuevo.
 * El botón «Quitar» no pide confirmar: quitar no borra ningún dato de clientes y se puede volver a agregar.
 */
export function FormaDirector({ accion, director }: { accion: AccionVigia; director?: Director }) {
  const [estado, despachar] = useActionState(accion, null);
  const k = director?.id ?? 'nuevo';
  return (
    <form action={despachar} className="space-y-2">
      {director && <input type="hidden" name="id" value={director.id} />}
      <div className="grid sm:grid-cols-4 gap-2">
        <div>
          <label htmlFor={`dir-nombre-${k}`} className={ETIQUETA}>Nombre</label>
          <input id={`dir-nombre-${k}`} name="nombre" type="text" required maxLength={120} defaultValue={director?.nombre ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={`dir-nivel-${k}`} className={ETIQUETA}>Nivel</label>
          <select id={`dir-nivel-${k}`} name="nivel" defaultValue={String(director?.nivel ?? 1)} className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="1">1 — Gerente de servicio</option>
            <option value="2">2 — Director o dueño</option>
          </select>
        </div>
        <div>
          <label htmlFor={`dir-tel-${k}`} className={ETIQUETA}>WhatsApp (10 dígitos)</label>
          <input id={`dir-tel-${k}`} name="telefono" type="tel" inputMode="tel" defaultValue={director?.telefono ? director.telefono.replace(/^52/, '') : ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={`dir-correo-${k}`} className={ETIQUETA}>Correo</label>
          <input id={`dir-correo-${k}`} name="correo" type="email" maxLength={254} defaultValue={director?.correo ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Boton name="accion" value="guardar" tono="marca" Icono={director ? Save : UserPlus}>{director ? 'Guardar cambios' : 'Agregar a la lista'}</Boton>
        {director && <Boton name="accion" value="quitar" tono="peligro" Icono={Trash2}>Quitar</Boton>}
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * 0798: una persona de «servicio al cliente» (a quien se avisa cuando el Vigía no tiene el dato). Se corrige o se quita; sin `contacto`,
 * es el alta de una nueva. «Todos los clientes» = vale para cualquier cliente de la flota.
 */
export function FormaServicio({ accion, contacto, clientes }: { accion: AccionVigia; contacto?: ContactoServicio; clientes: Array<{ id: string; nombre: string }> }) {
  const [estado, despachar] = useActionState(accion, null);
  const k = contacto?.id ?? 'nuevo';
  return (
    <form action={despachar} className="space-y-2">
      {contacto && <input type="hidden" name="id" value={contacto.id} />}
      <div className="grid sm:grid-cols-4 gap-2">
        <div>
          <label htmlFor={`srv-nombre-${k}`} className={ETIQUETA}>Nombre</label>
          <input id={`srv-nombre-${k}`} name="nombre" type="text" required maxLength={120} defaultValue={contacto?.nombre ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={`srv-cliente-${k}`} className={ETIQUETA}>Para</label>
          <select id={`srv-cliente-${k}`} name="clienteId" defaultValue={contacto?.clienteId ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Todos los clientes</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`srv-tel-${k}`} className={ETIQUETA}>WhatsApp (10 dígitos)</label>
          <input id={`srv-tel-${k}`} name="telefono" type="tel" inputMode="tel" defaultValue={contacto?.telefono ? contacto.telefono.replace(/^52/, '') : ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor={`srv-correo-${k}`} className={ETIQUETA}>Correo</label>
          <input id={`srv-correo-${k}`} name="correo" type="email" maxLength={254} defaultValue={contacto?.correo ?? ''} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" name="activo" defaultChecked={contacto?.activo ?? true} /> Recibe avisos
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Boton name="accion" value="guardar" tono="marca" Icono={contacto ? Save : UserPlus}>{contacto ? 'Guardar cambios' : 'Agregar a servicio al cliente'}</Boton>
        {contacto && <Boton name="accion" value="quitar" tono="peligro" Icono={Trash2}>Quitar</Boton>}
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormaAlta({ accion, clientes, gerentes }: {
  accion: AccionVigia;
  clientes: Array<{ id: string; nombre: string }>;
  gerentes: Array<{ id: string; nombre: string | null; rol: string }>;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="alta-cliente" className={ETIQUETA}>Cliente de la flota</label>
          <select id="alta-cliente" name="clienteId" required className={CAMPO} style={{ background: 'var(--surface)' }} defaultValue="">
            <option value="" disabled>Elige un cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="alta-nombre" className={ETIQUETA}>Nombre de la persona</label>
          <input id="alta-nombre" name="nombre" type="text" maxLength={120} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="alta-tel" className={ETIQUETA}>WhatsApp (10 dígitos)</label>
          <input id="alta-tel" name="telefono" type="tel" inputMode="tel" required className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="alta-ger" className={ETIQUETA}>Responsable que lo atiende</label>
          <select id="alta-ger" name="gerenteUserId" className={CAMPO} style={{ background: 'var(--surface)' }} defaultValue="">
            <option value="">El jefe de la flota</option>
            {gerentes.map((g) => <option key={g.id} value={g.id}>{g.nombre ?? 'Sin nombre'} ({g.rol === 'flota_admin' ? 'dueño' : 'encargado'})</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="consentimiento" required className="mt-0.5" />
        <span>Confirmo que este cliente <strong>autorizó recibir mensajes por WhatsApp</strong> de mi empresa. Queda constancia con fecha. Puede pedir su baja escribiendo BAJA.</span>
      </label>
      <Boton tono="marca" Icono={UserPlus}>Autorizar contacto</Boton>
      <Aviso estado={estado} />
    </form>
  );
}

/** Baja manual y supresión ARCO de un contacto. La supresión borra sus chats y exige confirmar. */
export function AccionesContacto({ accion, id, activo }: { accion: AccionVigia; id: string; activo: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {activo && <Boton name="accion" value="baja" Icono={UserX}>Dar de baja</Boton>}
      <label className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        <input type="checkbox" name="confirmo" /> Entiendo que borra sus chats
      </label>
      <Boton name="accion" value="suprimir" tono="peligro" Icono={Trash2}>Suprimir sus datos (ARCO)</Boton>
      {estado && <span className="text-[11px]" style={{ color: estado.ok ? 'var(--ok)' : 'var(--bad)' }}>{estado.ok ? estado.mensaje : estado.error}</span>}
    </form>
  );
}

/** T-A4-31: las etiquetas de cada turno, en el lenguaje de la flota. Una por valor de `TURNOS_DIRECTOR` (una prueba lo exige). */
export const ETIQUETA_TURNO: Record<TurnoDirector, string> = {
  siempre: 'Siempre (como hasta hoy)',
  noche: 'Solo de noche (20:00 a 07:00)',
  festivos_y_fin_de_semana: 'Solo festivos y fin de semana',
};

/**
 * T-A4-31: cuándo recibe la alerta una persona de la lista. Si en un momento nadie del nivel tiene ese turno, el aviso llega
 * a todo el nivel: un cliente crítico nunca se queda sin aviso.
 */
export function FormaTurnoDirector({ accion, directorId, turno }: { accion: AccionVigia; directorId: string; turno: TurnoDirector }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={directorId} />
      <div>
        <label htmlFor={`dir-turno-${directorId}`} className={ETIQUETA}>Recibe la alerta</label>
        <select id={`dir-turno-${directorId}`} name="turno" defaultValue={turno} className={CAMPO} style={{ background: 'var(--surface)' }}>
          {TURNOS_DIRECTOR.map((t) => <option key={t} value={t}>{ETIQUETA_TURNO[t]}</option>)}
        </select>
      </div>
      <Boton name="accion" value="turno" tono="marca" Icono={Save}>Guardar turno</Boton>
      <div className="basis-full"><Aviso estado={estado} /></div>
    </form>
  );
}

/**
 * T-A4-31: el calendario de festivos de la flota. Los oficiales de México se ofrecen como SUGERENCIA (un botón los agrega);
 * nada se guarda solo y cada fecha se puede quitar o cambiar.
 */
export function FormaFestivos({ accion, festivos, sugeridos }: { accion: AccionVigia; festivos: FestivoFlota[]; sugeridos: FestivoSugerido[] }) {
  const [estado, despachar] = useActionState(accion, null);
  const propios = new Set(festivos.map((f) => f.fecha));
  const faltan = sugeridos.filter((s) => !propios.has(s.fecha));
  return (
    <form action={despachar} className="space-y-3">
      <ul className="space-y-1.5">
        {festivos.length === 0 && <li className="text-[12px]" style={{ color: 'var(--muted)' }}>Aún no hay festivos: solo cuentan los sábados y domingos.</li>}
        {festivos.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>{f.fecha} · {f.nombre}</span>
            <Boton name="quitar" value={f.id} tono="peligro" Icono={Trash2}>Quitar</Boton>
          </li>
        ))}
      </ul>
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <label htmlFor="festivo-fecha" className={ETIQUETA}>Fecha</label>
          <input id="festivo-fecha" name="fecha" type="date" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="festivo-nombre" className={ETIQUETA}>Nombre</label>
          <input id="festivo-nombre" name="nombre" type="text" maxLength={120} className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Boton name="accion" value="festivo" tono="marca" Icono={Save}>Agregar festivo</Boton>
        {faltan.length > 0 && <Boton name="accion" value="sugeridos" Icono={Archive}>Agregar los {faltan.length} oficiales que faltan</Boton>}
      </div>
      <p className={AYUDA} style={{ color: 'var(--muted)' }}>Los oficiales son una sugerencia: revísalos y quita o agrega los de tu flota.</p>
      <Aviso estado={estado} />
    </form>
  );
}
