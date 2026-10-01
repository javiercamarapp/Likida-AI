'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, X, Hand, Send, Save, UserPlus, TriangleAlert, CheckCircle2, RotateCcw, Archive, Trash2, UserX } from 'lucide-react';
import type { ModoAprobacion } from '@/lib/likida/vigia/tipos';

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

export function FormaConfig({ accion, valores }: {
  accion: AccionVigia;
  valores: {
    habilitado: boolean; modoAprobacion: ModoAprobacion; autoenviarMinAprobaciones: number; slaRespuestaMin: number;
    escalarNivel2Min: number; retencionDias: number; avisoPrivacidadUrl: string | null;
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
          <select id="cfg-modo" name="modoAprobacion" defaultValue={valores.modoAprobacion} className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="siempre">Siempre aprobar (recomendado al empezar)</option>
            <option value="autoenviar_bajo_riesgo">Autoenviar solo preguntas de bajo riesgo ya validadas</option>
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Aun en autoenvío, una queja, un cliente molesto, un dato faltante o un mensaje raro SIEMPRE esperan tu toque.
          </p>
        </div>
        <div>
          <label htmlFor="cfg-min" className={ETIQUETA}>Aprobaciones sin editar para validar una pregunta</label>
          <input id="cfg-min" name="autoenviarMinAprobaciones" type="text" inputMode="numeric" defaultValue={valores.autoenviarMinAprobaciones} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 1 y 100, por tipo de pregunta (ubicación, documentos…).</p>
        </div>
        <div>
          <label htmlFor="cfg-sla" className={ETIQUETA}>Minutos sin respuesta antes de avisar al responsable</label>
          <input id="cfg-sla" name="slaRespuestaMin" type="text" inputMode="numeric" defaultValue={valores.slaRespuestaMin} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 5 y 1,440. El barrido corre cada 5 minutos.</p>
        </div>
        <div>
          <label htmlFor="cfg-n2" className={ETIQUETA}>Minutos adicionales antes de avisar al dueño</label>
          <input id="cfg-n2" name="escalarNivel2Min" type="text" inputMode="numeric" defaultValue={valores.escalarNivel2Min} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 5 y 2,880.</p>
        </div>
        <div>
          <label htmlFor="cfg-ret" className={ETIQUETA}>Días que se conservan los mensajes</label>
          <input id="cfg-ret" name="retencionDias" type="text" inputMode="numeric" defaultValue={valores.retencionDias} className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Entre 30 y 730. Pasado ese plazo se borran solos.</p>
        </div>
        <div>
          <label htmlFor="cfg-aviso" className={ETIQUETA}>Liga de tu aviso de privacidad para clientes (https)</label>
          <input id="cfg-aviso" name="avisoPrivacidadUrl" type="url" defaultValue={valores.avisoPrivacidadUrl ?? ''} placeholder="https://tu-empresa.mx/privacidad" className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>Va en el primer mensaje que recibe cada cliente. Sin liga, se manda la de Likida.</p>
        </div>
      </div>
      <Boton tono="marca" Icono={Save}>Guardar</Boton>
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
