'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, X, Hand, Send, Save, UserPlus, RotateCcw, Archive, Trash2, UserX } from 'lucide-react';
import './vigia.css';
import { AvisoResultado as AvisoV2, Boton as BotonV2, CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Casilla, Icono } from '@/app/ui-v2/componentes';
import type { Director, ModoAprobacion } from '@/lib/likida/vigia/tipos';
import type { ContactoServicio, FestivoFlota } from '@/lib/likida/vigia/repo';
import { TURNOS_DIRECTOR, type TurnoDirector, type FestivoSugerido } from '@/lib/likida/vigia/turnos';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="id" value={id} />
      <CampoTextarea id={`b-${id}`} etiqueta={tx('rest.respuesta_propuesta_puedes_editarla_antes_de')} name="texto" defaultValue={texto} rows={4} maxLength={1000} />
      <div className="rv-vg__linea">
        <Boton name="accion" value="aprobar" tono="marca" Icono={Send}>{tx('rest.enviar')}</Boton>
        <Boton name="accion" value="rechazar" Icono={X}>{tx('rest.no_enviar')}</Boton>
        <Boton name="accion" value="tomar" Icono={Hand}>{tx('vigia.vista.yo_me_encargo')}</Boton>
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="id" value={id} />
      <CampoTextarea id={`r-${id}`} etiqueta={tx('rest.responder_al_cliente')} name="texto" rows={2} maxLength={1000} required
        ayuda={tx('rest.dentro_de_las_24_h_del')} />
      <div><Boton name="accion" value="responder" tono="marca" Icono={Send}>{tx('rest.enviar_respuesta')}</Boton></div>
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <Casilla name="habilitado" defaultChecked={valores.habilitado}
        etiqueta={<>{ricoT(tx('rest.strong_vigia_encendido_strong_apagado_ningun'), { strong: (c) => <strong>{c}</strong> })}</>} />
      <div className="rv-vg__cuad">
        <CampoSelect id="cfg-modo" etiqueta={tx('rest.modo_de_aprobacion')} name="modoAprobacion" defaultValue={standby ? 'siempre' : valores.modoAprobacion}
          ayuda={standby
            ? tx('rest.el_vigia_solo_avisa_y_propone')
            : tx('rest.aun_en_autoenvio_una_queja_un')}>
          <option value="siempre">{tx('rest.siempre_aprobar_recomendado_al_empezar')}</option>
          {!standby && <option value="autoenviar_bajo_riesgo">{tx('rest.autoenviar_solo_preguntas_de_bajo_riesgo')}</option>}
        </CampoSelect>
        {standby ? (
          <input type="hidden" name="autoenviarMinAprobaciones" value={valores.autoenviarMinAprobaciones} />
        ) : (
          <CampoTexto id="cfg-min" etiqueta={tx('rest.aprobaciones_sin_editar_para_validar_una')} name="autoenviarMinAprobaciones" inputMode="numeric" defaultValue={valores.autoenviarMinAprobaciones}
            ayuda={tx('rest.entre_1_y_100_por_tipo')} />
        )}
        <CampoTexto id="cfg-sla" etiqueta={tx('rest.minutos_sin_respuesta_antes_de_avisar')} name="slaRespuestaMin" inputMode="numeric" defaultValue={valores.slaRespuestaMin}
          ayuda={tx('rest.entre_5_y_1_440_10')} />
        <CampoTexto id="cfg-n2" etiqueta={tx('rest.minutos_adicionales_antes_de_avisar_al')} name="escalarNivel2Min" inputMode="numeric" defaultValue={valores.escalarNivel2Min} ayuda={tx('rest.entre_5_y_2_880')} />
        <CampoTexto id="cfg-crit" etiqueta={tx('rest.minutos_sin_respuesta_en_clientes_criticos')} name="slaCriticoMin" inputMode="numeric" defaultValue={valores.slaCriticoMin}
          ayuda={tx('rest.entre_2_y_1_440_10')} />
        <CampoSelect id="cfg-mol" etiqueta={tx('rest.avisar_al_responsable_desde_la_molestia')} name="molestiaAvisoNivel" defaultValue={String(valores.molestiaAvisoNivel)}
          ayuda={tx('rest.la_molestia_critica_nivel_3_siempre')}>
          <option value="2">{tx('rest.2_cliente_molesto_recomendado')}</option>
          <option value="3">{tx('rest.3_solo_molestia_critica')}</option>
        </CampoSelect>
        <CampoTexto id="cfg-ret" etiqueta={tx('rest.dias_que_se_conservan_los_mensajes')} name="retencionDias" inputMode="numeric" defaultValue={valores.retencionDias} ayuda={tx('rest.entre_30_y_730_pasado_ese')} />
        <CampoTexto id="cfg-aviso" etiqueta={tx('rest.liga_de_tu_aviso_de_privacidad')} name="avisoPrivacidadUrl" tipo="url" defaultValue={valores.avisoPrivacidadUrl ?? ''}
          placeholder="https://tu-empresa.mx/privacidad" ayuda={tx('rest.va_en_el_primer_mensaje_que')} />
      </div>
      <Casilla name="respaldoCorreo" defaultChecked={valores.respaldoCorreo}
        etiqueta={<>{ricoT(tx('rest.strong_respaldo_por_correo_strong_si'), { strong: (c) => <strong>{c}</strong> })}</>} />
      <div><Boton tono="marca" Icono={Save}>{tx('rest.guardar')}</Boton></div>
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * Un director de la lista (nivel 1 gerente, nivel 2 director o dueño): se corrige o se quita. Sin `director`, es el alta de uno nuevo.
 * El botón «Quitar» no pide confirmar: quitar no borra ningún dato de clientes y se puede volver a agregar.
 */
export function FormaDirector({ accion, director }: { accion: AccionVigia; director?: Director }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  const k = director?.id ?? 'nuevo';
  return (
    <form action={despachar} className="rv-vg__pila">
      {director && <input type="hidden" name="id" value={director.id} />}
      <div className="rv-vg__cuad">
        <CampoTexto id={`dir-nombre-${k}`} etiqueta={tx('conductores.forma.nombre')} name="nombre" required maxLength={120} defaultValue={director?.nombre ?? ''} />
        <CampoSelect id={`dir-nivel-${k}`} etiqueta={tx('rest.nivel')} name="nivel" defaultValue={String(director?.nivel ?? 1)}>
          <option value="1">{tx('rest.1_gerente_de_servicio')}</option>
          <option value="2">{tx('rest.2_director_o_dueno')}</option>
        </CampoSelect>
        <CampoTexto id={`dir-tel-${k}`} etiqueta={tx('rest.whatsapp_10_digitos')} name="telefono" tipo="tel" inputMode="tel" defaultValue={director?.telefono ? director.telefono.replace(/^52/, '') : ''} />
        <CampoTexto id={`dir-correo-${k}`} etiqueta={tx('vigia.vista.correo')} name="correo" tipo="email" maxLength={254} defaultValue={director?.correo ?? ''} />
      </div>
      <div className="rv-vg__linea">
        <Boton name="accion" value="guardar" tono="marca" Icono={director ? Save : UserPlus}>{director ? tx('rest.guardar_cambios') : tx('vigia.vista.agregar_a_la_lista')}</Boton>
        {director && <Boton name="accion" value="quitar" tono="peligro" Icono={Trash2}>{tx('rest.quitar')}</Boton>}
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  const k = contacto?.id ?? 'nuevo';
  return (
    <form action={despachar} className="rv-vg__pila">
      {contacto && <input type="hidden" name="id" value={contacto.id} />}
      <div className="rv-vg__cuad">
        <CampoTexto id={`srv-nombre-${k}`} etiqueta={tx('conductores.forma.nombre')} name="nombre" required maxLength={120} defaultValue={contacto?.nombre ?? ''} />
        <CampoSelect id={`srv-cliente-${k}`} etiqueta={tx('rest.para')} name="clienteId" defaultValue={contacto?.clienteId ?? ''}>
          <option value="">{tx('vigia.vista.todos_los_clientes')}</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto id={`srv-tel-${k}`} etiqueta={tx('rest.whatsapp_10_digitos')} name="telefono" tipo="tel" inputMode="tel" defaultValue={contacto?.telefono ? contacto.telefono.replace(/^52/, '') : ''} />
        <CampoTexto id={`srv-correo-${k}`} etiqueta={tx('vigia.vista.correo')} name="correo" tipo="email" maxLength={254} defaultValue={contacto?.correo ?? ''} />
      </div>
      <Casilla name="activo" defaultChecked={contacto?.activo ?? true} etiqueta={tx('rest.recibe_avisos')} />
      <div className="rv-vg__linea">
        <Boton name="accion" value="guardar" tono="marca" Icono={contacto ? Save : UserPlus}>{contacto ? tx('rest.guardar_cambios') : tx('vigia.vista.agregar_a_servicio_al_cliente')}</Boton>
        {contacto && <Boton name="accion" value="quitar" tono="peligro" Icono={Trash2}>{tx('rest.quitar')}</Boton>}
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <div className="rv-vg__cuad">
        <CampoSelect id="alta-cliente" etiqueta={tx('rest.cliente_de_la_flota')} name="clienteId" required defaultValue="">
          <option value="" disabled>{tx('rest.elige_un_cliente')}</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto id="alta-nombre" etiqueta={tx('rest.nombre_de_la_persona')} name="nombre" maxLength={120} />
        <CampoTexto id="alta-tel" etiqueta={tx('rest.whatsapp_10_digitos')} name="telefono" tipo="tel" inputMode="tel" required />
        <CampoSelect id="alta-ger" etiqueta={tx('rest.responsable_que_lo_atiende')} name="gerenteUserId" defaultValue="">
          <option value="">{tx('rest.el_jefe_de_la_flota')}</option>
          {gerentes.map((g) => <option key={g.id} value={g.id}>{g.nombre ?? tx('vigia.vista.sin_nombre')} ({g.rol === 'flota_admin' ? tx('rest.dueno') : 'encargado'})</option>)}
        </CampoSelect>
      </div>
      <Casilla name="consentimiento" required
        etiqueta={<>{ricoT(tx('rest.confirmo_que_este_cliente_strong_autorizo'), { strong: (c) => <strong>{c}</strong> })}</>} />
      <div><Boton tono="marca" Icono={UserPlus}>{tx('rest.autorizar_contacto')}</Boton></div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Baja manual y supresión ARCO de un contacto. La supresión borra sus chats y exige confirmar. */
export function AccionesContacto({ accion, id, activo }: { accion: AccionVigia; id: string; activo: boolean }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="id" value={id} />
      {activo && <Boton name="accion" value="baja" Icono={UserX}>{tx('rest.dar_de_baja')}</Boton>}
      <Casilla name="confirmo" etiqueta={tx('rest.entiendo_que_borra_sus_chats')} />
      <Boton name="accion" value="suprimir" tono="peligro" Icono={Trash2}>{tx('rest.suprimir_sus_datos_arco')}</Boton>
      {estado && <span className="rv-vg__micro" data-tono={estado.ok ? 'ok' : 'bad'}>{estado.ok ? estado.mensaje : estado.error}</span>}
    </form>
  );
}

/** T-A4-31: las etiquetas de cada turno, en el lenguaje de la flota. Una por valor de `TURNOS_DIRECTOR` (una prueba lo exige). */
export const etiquetaTurno = (tx: TAgentes = TR_ES.t): Record<TurnoDirector, string> => ({
  siempre: 'Siempre (como hasta hoy)',
  noche: 'Solo de noche (20:00 a 07:00)',
  festivos_y_fin_de_semana: tx('rest.solo_festivos_y_fin_de_semana'),
});
export const ETIQUETA_TURNO = etiquetaTurno();

/**
 * T-A4-31: cuándo recibe la alerta una persona de la lista. Si en un momento nadie del nivel tiene ese turno, el aviso llega
 * a todo el nivel: un cliente crítico nunca se queda sin aviso.
 */
export function FormaTurnoDirector({ accion, directorId, turno }: { accion: AccionVigia; directorId: string; turno: TurnoDirector }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="id" value={directorId} />
      <CampoSelect id={`dir-turno-${directorId}`} etiqueta={tx('rest.recibe_la_alerta')} name="turno" defaultValue={turno}>
        {TURNOS_DIRECTOR.map((t) => <option key={t} value={t}>{etiquetaTurno(tx)[t]}</option>)}
      </CampoSelect>
      <Boton name="accion" value="turno" tono="marca" Icono={Save}>{tx('rest.guardar_turno')}</Boton>
      <div className="rv-vg__ancho"><Aviso estado={estado} /></div>
    </form>
  );
}

/**
 * T-A4-31: el calendario de festivos de la flota. Los oficiales de México se ofrecen como SUGERENCIA (un botón los agrega);
 * nada se guarda solo y cada fecha se puede quitar o cambiar.
 */
export function FormaFestivos({ accion, festivos, sugeridos }: { accion: AccionVigia; festivos: FestivoFlota[]; sugeridos: FestivoSugerido[] }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  const propios = new Set(festivos.map((f) => f.fecha));
  const faltan = sugeridos.filter((s) => !propios.has(s.fecha));
  return (
    <form action={despachar} className="rv-vg__pila">
      <ul className="rv-vg__lista">
        {festivos.length === 0 && <li className="rv-vg__nota">{tx('rest.aun_no_hay_festivos_solo_cuentan')}</li>}
        {festivos.map((f) => (
          <li key={f.id} className="rv-vg__linea rv-vg__nota">
            <span>{f.fecha} · {f.nombre}</span>
            <span className="rv-vg__fin"><Boton name="quitar" value={f.id} tono="peligro" Icono={Trash2}>{tx('rest.quitar')}</Boton></span>
          </li>
        ))}
      </ul>
      <div className="rv-vg__cuad">
        <CampoFecha id="festivo-fecha" etiqueta={tx('proveedores.vista.fecha')} name="fecha" />
        <CampoTexto id="festivo-nombre" etiqueta={tx('conductores.forma.nombre')} name="nombre" maxLength={120} />
      </div>
      <div className="rv-vg__linea">
        <Boton name="accion" value="festivo" tono="marca" Icono={Save}>{tx('rest.agregar_festivo')}</Boton>
        {faltan.length > 0 && <Boton name="accion" value="sugeridos" Icono={Archive}>{tx('rest.agregar_los_oficiales_que_faltan', { length: faltan.length })}</Boton>}
      </div>
      <p className="rv-vg__nota">{tx('rest.los_oficiales_son_una_sugerencia_revisalos')}</p>
      <Aviso estado={estado} />
    </form>
  );
}
