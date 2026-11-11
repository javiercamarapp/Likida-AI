'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, X, Hand, Send, Save, UserPlus, RotateCcw, Archive, Trash2, UserX } from 'lucide-react';
import './vigia.css';
import { AvisoResultado as AvisoV2, Boton as BotonV2, CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Casilla, Icono } from '@/app/ui-v2/componentes';
import type { Director, ModoAprobacion } from '@/lib/likida/vigia/tipos';
import type { ContactoServicio, FestivoFlota } from '@/lib/likida/vigia/repo';
import { TURNOS_DIRECTOR, type TurnoDirector, type FestivoSugerido } from '@/lib/likida/vigia/turnos';

export type ResultadoVigia = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionVigia = (previo: ResultadoVigia, fd: FormData) => Promise<ResultadoVigia>;

function Aviso({ estado }: { estado: ResultadoVigia }) {
  if (!estado) return null;
  return <AvisoV2 estado={estado} />;
}

type Tono = 'marca' | 'neutro' | 'peligro';
function Boton({ children, name, value, tono = 'neutro', Icono: Ic }: {
  children: React.ReactNode; name?: string; value?: string; tono?: Tono; Icono?: typeof Check;
}) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" name={name} value={value} loading={pending} tamano="sm"
      variante={tono === 'marca' ? 'primary' : tono === 'peligro' ? 'danger' : 'secondary'}
      icono={Ic ? <Icono icono={Ic} tam={14} /> : undefined}>
      {children}
    </BotonV2>
  );
}

/** La respuesta que redactó el agente: el gerente la lee, la edita si quiere y decide con un toque. */
export function FormaBorrador({ accion, id, texto }: { accion: AccionVigia; id: string; texto: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="id" value={id} />
      <CampoTextarea id={`b-${id}`} etiqueta="Respuesta propuesta (puedes editarla antes de enviar)" name="texto" defaultValue={texto} rows={4} maxLength={1000} />
      <div className="rv-vg__linea">
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
  const Ic = que === 'tomar' ? Hand : que === 'devolver' ? RotateCcw : Archive;
  return (
    <form action={despachar} className="rv-vg__pila--s">
      <input type="hidden" name="id" value={id} />
      <Boton name="accion" value={que} Icono={Ic}>{etiqueta}</Boton>
      {estado && !estado.ok && <span className="rv-vg__micro" data-tono="bad">{estado.error}</span>}
    </form>
  );
}

/** El gerente contesta él mismo (el hilo ya es suyo). Sale por los mismos límites que todo envío al cliente. */
export function FormaResponder({ accion, id }: { accion: AccionVigia; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="id" value={id} />
      <CampoTextarea id={`r-${id}`} etiqueta="Responder al cliente" name="texto" rows={2} maxLength={1000} required
        ayuda="Dentro de las 24 h del último mensaje del cliente sale como texto; fuera de esa ventana sale solo con la plantilla aprobada de Meta." />
      <div><Boton name="accion" value="responder" tono="marca" Icono={Send}>Enviar respuesta</Boton></div>
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
    <form action={despachar} className="rv-vg__pila">
      <Casilla name="habilitado" defaultChecked={valores.habilitado}
        etiqueta={<><strong>Vigía encendido.</strong> Apagado, ningún cliente recibe respuesta de este agente (queda silencio, no «no te tengo registrado»).</>} />
      <div className="rv-vg__cuad">
        <CampoSelect id="cfg-modo" etiqueta="Modo de aprobación" name="modoAprobacion" defaultValue={standby ? 'siempre' : valores.modoAprobacion}
          ayuda={standby
            ? 'El Vigía solo avisa y propone: cada respuesta espera tu toque antes de salir.'
            : 'Aun en autoenvío, una queja, un cliente molesto, un dato faltante o un mensaje raro SIEMPRE esperan tu toque.'}>
          <option value="siempre">Siempre aprobar (recomendado al empezar)</option>
          {!standby && <option value="autoenviar_bajo_riesgo">Autoenviar solo preguntas de bajo riesgo ya validadas</option>}
        </CampoSelect>
        {standby ? (
          <input type="hidden" name="autoenviarMinAprobaciones" value={valores.autoenviarMinAprobaciones} />
        ) : (
          <CampoTexto id="cfg-min" etiqueta="Aprobaciones sin editar para validar una pregunta" name="autoenviarMinAprobaciones" inputMode="numeric" defaultValue={valores.autoenviarMinAprobaciones}
            ayuda="Entre 1 y 100, por tipo de pregunta (ubicación, documentos…)." />
        )}
        <CampoTexto id="cfg-sla" etiqueta="Minutos sin respuesta antes de avisar al responsable" name="slaRespuestaMin" inputMode="numeric" defaultValue={valores.slaRespuestaMin}
          ayuda="Entre 5 y 1,440 (10 por omisión; tú fijas el plazo de tu flota). Si el cliente tiene un grupo crítico, rige el menor entre este y el de clientes críticos." />
        <CampoTexto id="cfg-n2" etiqueta="Minutos adicionales antes de avisar al dueño" name="escalarNivel2Min" inputMode="numeric" defaultValue={valores.escalarNivel2Min} ayuda="Entre 5 y 2,880." />
        <CampoTexto id="cfg-crit" etiqueta="Minutos sin respuesta en clientes CRÍTICOS" name="slaCriticoMin" inputMode="numeric" defaultValue={valores.slaCriticoMin}
          ayuda="Entre 2 y 1,440 (10 por omisión; 5 y 10 son solo ejemplos, tú fijas el plazo). Rige para los clientes con un grupo marcado como crítico; se aplica el menor entre este y el general." />
        <CampoSelect id="cfg-mol" etiqueta="Avisar al responsable desde la molestia nivel" name="molestiaAvisoNivel" defaultValue={String(valores.molestiaAvisoNivel)}
          ayuda="La molestia crítica (nivel 3) siempre avisa también al dueño.">
          <option value="2">2 — cliente molesto (recomendado)</option>
          <option value="3">3 — solo molestia crítica</option>
        </CampoSelect>
        <CampoTexto id="cfg-ret" etiqueta="Días que se conservan los mensajes" name="retencionDias" inputMode="numeric" defaultValue={valores.retencionDias} ayuda="Entre 30 y 730. Pasado ese plazo se borran solos." />
        <CampoTexto id="cfg-aviso" etiqueta="Liga de tu aviso de privacidad para clientes (https)" name="avisoPrivacidadUrl" tipo="url" defaultValue={valores.avisoPrivacidadUrl ?? ''}
          placeholder="https://tu-empresa.mx/privacidad" ayuda="Va en el primer mensaje que recibe cada cliente. Sin liga, se manda la de Likida." />
      </div>
      <Casilla name="respaldoCorreo" defaultChecked={valores.respaldoCorreo}
        etiqueta={<><strong>Respaldo por correo.</strong> Si el aviso de escalamiento por WhatsApp no sale (plantilla sin aprobar o ventana de 24 h cerrada), se manda por correo a quien
          tenga correo en la lista de directores. Apagado, el aviso solo sale por WhatsApp.</>} />
      <div><Boton tono="marca" Icono={Save}>Guardar</Boton></div>
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
    <form action={despachar} className="rv-vg__pila">
      {director && <input type="hidden" name="id" value={director.id} />}
      <div className="rv-vg__cuad">
        <CampoTexto id={`dir-nombre-${k}`} etiqueta="Nombre" name="nombre" required maxLength={120} defaultValue={director?.nombre ?? ''} />
        <CampoSelect id={`dir-nivel-${k}`} etiqueta="Nivel" name="nivel" defaultValue={String(director?.nivel ?? 1)}>
          <option value="1">1 — Gerente de servicio</option>
          <option value="2">2 — Director o dueño</option>
        </CampoSelect>
        <CampoTexto id={`dir-tel-${k}`} etiqueta="WhatsApp (10 dígitos)" name="telefono" tipo="tel" inputMode="tel" defaultValue={director?.telefono ? director.telefono.replace(/^52/, '') : ''} />
        <CampoTexto id={`dir-correo-${k}`} etiqueta="Correo" name="correo" tipo="email" maxLength={254} defaultValue={director?.correo ?? ''} />
      </div>
      <div className="rv-vg__linea">
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
    <form action={despachar} className="rv-vg__pila">
      {contacto && <input type="hidden" name="id" value={contacto.id} />}
      <div className="rv-vg__cuad">
        <CampoTexto id={`srv-nombre-${k}`} etiqueta="Nombre" name="nombre" required maxLength={120} defaultValue={contacto?.nombre ?? ''} />
        <CampoSelect id={`srv-cliente-${k}`} etiqueta="Para" name="clienteId" defaultValue={contacto?.clienteId ?? ''}>
          <option value="">Todos los clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto id={`srv-tel-${k}`} etiqueta="WhatsApp (10 dígitos)" name="telefono" tipo="tel" inputMode="tel" defaultValue={contacto?.telefono ? contacto.telefono.replace(/^52/, '') : ''} />
        <CampoTexto id={`srv-correo-${k}`} etiqueta="Correo" name="correo" tipo="email" maxLength={254} defaultValue={contacto?.correo ?? ''} />
      </div>
      <Casilla name="activo" defaultChecked={contacto?.activo ?? true} etiqueta="Recibe avisos" />
      <div className="rv-vg__linea">
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
    <form action={despachar} className="rv-vg__pila">
      <div className="rv-vg__cuad">
        <CampoSelect id="alta-cliente" etiqueta="Cliente de la flota" name="clienteId" required defaultValue="">
          <option value="" disabled>Elige un cliente</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto id="alta-nombre" etiqueta="Nombre de la persona" name="nombre" maxLength={120} />
        <CampoTexto id="alta-tel" etiqueta="WhatsApp (10 dígitos)" name="telefono" tipo="tel" inputMode="tel" required />
        <CampoSelect id="alta-ger" etiqueta="Responsable que lo atiende" name="gerenteUserId" defaultValue="">
          <option value="">El jefe de la flota</option>
          {gerentes.map((g) => <option key={g.id} value={g.id}>{g.nombre ?? 'Sin nombre'} ({g.rol === 'flota_admin' ? 'dueño' : 'encargado'})</option>)}
        </CampoSelect>
      </div>
      <Casilla name="consentimiento" required
        etiqueta={<>Confirmo que este cliente <strong>autorizó recibir mensajes por WhatsApp</strong> de mi empresa. Queda constancia con fecha. Puede pedir su baja escribiendo BAJA.</>} />
      <div><Boton tono="marca" Icono={UserPlus}>Autorizar contacto</Boton></div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Baja manual y supresión ARCO de un contacto. La supresión borra sus chats y exige confirmar. */
export function AccionesContacto({ accion, id, activo }: { accion: AccionVigia; id: string; activo: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="id" value={id} />
      {activo && <Boton name="accion" value="baja" Icono={UserX}>Dar de baja</Boton>}
      <Casilla name="confirmo" etiqueta="Entiendo que borra sus chats" />
      <Boton name="accion" value="suprimir" tono="peligro" Icono={Trash2}>Suprimir sus datos (ARCO)</Boton>
      {estado && <span className="rv-vg__micro" data-tono={estado.ok ? 'ok' : 'bad'}>{estado.ok ? estado.mensaje : estado.error}</span>}
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
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="id" value={directorId} />
      <CampoSelect id={`dir-turno-${directorId}`} etiqueta="Recibe la alerta" name="turno" defaultValue={turno}>
        {TURNOS_DIRECTOR.map((t) => <option key={t} value={t}>{ETIQUETA_TURNO[t]}</option>)}
      </CampoSelect>
      <Boton name="accion" value="turno" tono="marca" Icono={Save}>Guardar turno</Boton>
      <div className="rv-vg__ancho"><Aviso estado={estado} /></div>
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
    <form action={despachar} className="rv-vg__pila">
      <ul className="rv-vg__lista">
        {festivos.length === 0 && <li className="rv-vg__nota">Aún no hay festivos: solo cuentan los sábados y domingos.</li>}
        {festivos.map((f) => (
          <li key={f.id} className="rv-vg__linea rv-vg__nota">
            <span>{f.fecha} · {f.nombre}</span>
            <span className="rv-vg__fin"><Boton name="quitar" value={f.id} tono="peligro" Icono={Trash2}>Quitar</Boton></span>
          </li>
        ))}
      </ul>
      <div className="rv-vg__cuad">
        <CampoFecha id="festivo-fecha" etiqueta="Fecha" name="fecha" />
        <CampoTexto id="festivo-nombre" etiqueta="Nombre" name="nombre" maxLength={120} />
      </div>
      <div className="rv-vg__linea">
        <Boton name="accion" value="festivo" tono="marca" Icono={Save}>Agregar festivo</Boton>
        {faltan.length > 0 && <Boton name="accion" value="sugeridos" Icono={Archive}>Agregar los {faltan.length} oficiales que faltan</Boton>}
      </div>
      <p className="rv-vg__nota">Los oficiales son una sugerencia: revísalos y quita o agrega los de tu flota.</p>
      <Aviso estado={estado} />
    </form>
  );
}
