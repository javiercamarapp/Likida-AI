'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import './facturas.css';
import { mxn, fechaCorta } from '@/lib/formato';
import { Boton as BotonV2, CampoTexto, Icono, StatusChip, Tarjeta, useNotificar, type TonoEstado } from '@/app/ui-v2/componentes';
import {
  accionEncenderEmision, accionApagarEmision, accionCambiarLimites, accionDecidirLote, accionPromoverPortal, accionDevolverPortal,
  type RespuestaControl,
} from './acciones-control';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ════════════════════════════════════════════════════════════════════════════
// LA EMISIÓN REAL, CON LAS MANOS DE UNA PERSONA (0542).
//
// Emitir un CFDI es irreversible. Por eso la emisión real no se enciende con una variable: la enciende el dueño de
// la flota aquí, con el mandato otorgado, y cada portal arranca en fase SUPERVISADA — el agente propone el lote y
// una persona lo confirma. Solo tras varias emisiones reales con UUID el dueño puede soltarlo a autónomo, y aun
// así los límites (monto por ticket, tickets por lote, cupo del día) siguen mandando.
//
// `control === null` / `lotes === null` = la base no contestó: se dice, nunca se pinta «apagada» o «sin lotes» a ciegas.
// ════════════════════════════════════════════════════════════════════════════

export interface ControlPantalla { emisionReal: boolean; maxMontoTicket: number; maxTicketsLote: number; maxTicketsDia: number; maxMontoDia: number }
export interface LotePantalla { id: string; comercio: string; nombre: string; tickets: number; montoTotal: number; estado: string; propuestoEn: string; expiraEn: string }
export interface PortalControlPantalla {
  clave: string; nombre: string; verificacion: 'verificado' | 'no_verificado' | 'obsoleto' | 'exento';
  fase: 'supervisada' | 'autonoma'; emisionesConfirmadas: number;
}
export interface DatosControl {
  /** `null` = no se pudo leer. `'sin_fila'` = nunca se ha tocado: apagada con los límites por omisión. */
  control: ControlPantalla | null | 'sin_fila';
  lotes: LotePantalla[] | null;
  portales: PortalControlPantalla[];
  minimoParaAutonoma: number;
  /** A37-S13-09: encender, cambiar límites y promover son del dueño; sin esto (contador) esos controles no se pintan. */
  esDueno: boolean;
  /** MX-002: la flota que esta pantalla pinta, firmada para el usuario; viaja en cada formulario y la acción la cruza con la sesión. `null` = no hay llave de firma (la acción se niega para un superadmin). */
  flotaPintada: string | null;
}

const verif = (tx: TAgentes = TR_ES.t): Record<PortalControlPantalla['verificacion'], string> => ({
  verificado: tx('rest.verificado_contra_el_portal_real'), no_verificado: tx('rest.sin_corrida_supervisada_no_emite'),
  obsoleto: tx('rest.el_mapeo_cambio_hay_que_volver'), exento: 'Adaptador propio (CAPUFE)',
});

function useRespuesta(r: RespuestaControl | null) {
  const { notificar } = useNotificar();
  useEffect(() => {
    if (!r) return;
    notificar(r.error ? { tono: 'error', mensaje: r.error } : { tono: 'ok', mensaje: r.ok ?? 'Listo.' });
  }, [r, notificar]);
}

/** El campo oculto con la flota pintada firmada (MX-002). */
function CampoFlota({ valor }: { valor: string | null }) {
  return valor ? <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={valor} /> : null;
}

function Boton({ children, pendiente, peligro }: { children: React.ReactNode; pendiente: boolean; peligro?: boolean }) {
  return (
    <BotonV2 type="submit" tamano="sm" variante={peligro ? 'danger' : 'secondary'} loading={pendiente}>
      {pendiente ? 'Un momento…' : children}
    </BotonV2>
  );
}

function Interruptor({ encendida, esDueno, flota }: { encendida: boolean; esDueno: boolean; flota: string | null }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [rEn, encender, pEn] = useActionState(accionEncenderEmision, null);
  const [rAp, apagar, pAp] = useActionState(accionApagarEmision, null);
  useRespuesta(rEn); useRespuesta(rAp);
  return encendida ? (
    <form action={apagar}><CampoFlota valor={flota} /><Boton pendiente={pAp} peligro><Icono icono={ShieldOff} tam={14} />{' '}{tx('rest.apagar_la_emision_real')}</Boton></form>
  ) : esDueno ? (
    <form action={encender}><CampoFlota valor={flota} /><Boton pendiente={pEn}><Icono icono={ShieldCheck} tam={14} />{' '}{tx('rest.encender_la_emision_real')}</Boton></form>
  ) : (
    <p className="rv-fact__nota" data-tono="faint">{tx('rest.la_emision_real_la_enciende_el')}</p>
  );
}

function Limites({ c, esDueno, flota }: { c: ControlPantalla | 'sin_fila'; esDueno: boolean; flota: string | null }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [r, guardar, p] = useActionState(accionCambiarLimites, null);
  useRespuesta(r);
  const v = c === 'sin_fila' ? { maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 } : c;
  // Rovaq FM: fila rótulo-control (rótulo a la izquierda, control a la derecha, filete entre filas); el rótulo accesible es el del campo.
  const campo = (name: string, rotulo: string, valor: number) => (
    <div className="rv-fact__ctl-fila">
      <span className="rv-fact__ctl-etq" aria-hidden="true">{rotulo}</span>
      <CampoTexto etiqueta={rotulo} etiquetaOculta name={name} defaultValue={valor} inputMode="decimal" className="rv-fact__ctl-campo" />
    </div>
  );
  if (!esDueno) {
    return (
      <p className="rv-fact__nota">{tx('rest.limites_por_ticket_tickets_por_lote', { mxn: mxn(v.maxMontoTicket), maxTicketsLote: v.maxTicketsLote, maxTicketsDia: v.maxTicketsDia, mxn2: mxn(v.maxMontoDia) })}</p>
    );
  }
  return (
    <form action={guardar} className="rv-fact__ctl-forma">
      <CampoFlota valor={flota} />
      {campo('maxMontoTicket', tx('rest.monto_max_por_ticket'), v.maxMontoTicket)}
      {campo('maxTicketsLote', 'Tickets por lote', v.maxTicketsLote)}
      {campo('maxTicketsDia', tx('rest.tickets_por_dia'), v.maxTicketsDia)}
      {campo('maxMontoDia', tx('rest.monto_max_por_dia'), v.maxMontoDia)}
      <div className="rv-fact__pie"><Boton pendiente={p}>{tx('rest.guardar_limites')}</Boton></div>
    </form>
  );
}

function FilaLote({ l, flota }: { l: LotePantalla; flota: string | null }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [r, decidir, p] = useActionState(accionDecidirLote, null);
  useRespuesta(r);
  return (
    <li className="rv-fact__reglon">
      <span className="rv-fact__nota">
        <strong>{l.nombre}</strong>{' '}{tx('rest.ticket', { tickets: l.tickets })}{l.tickets === 1 ? '' : 's'} · {mxn(l.montoTotal)}
        <span className="rv-fact__sub">
          {l.estado === 'confirmado' ? tx('rest.confirmado_sale_en_la_proxima_corrida') : tx('rest.esperando_tu_confirmacion')}{' '}{tx('rest.propuesto_vence', { fechaCorta: fechaCorta(l.propuestoEn), fechaCorta2: fechaCorta(l.expiraEn) })}</span>
      </span>
      <form action={decidir} className="rv-fact__linea">
        <CampoFlota valor={flota} />
        <input type="hidden" name="loteId" value={l.id} />
        {/* A37-S29-06: lo que se está viendo; confirmar se rechaza si el lote cambió desde que se pintó */}
        <input type="hidden" name="vistoTickets" value={l.tickets} />
        <input type="hidden" name="vistoMonto" value={l.montoTotal} />
        {l.estado === 'propuesto' && <BotonV2 type="submit" tamano="sm" variante="primary" name="decision" value="confirmar" disabled={p}>{tx('rest.confirmar_lote')}</BotonV2>}
        <BotonV2 type="submit" tamano="sm" name="decision" value="rechazar" disabled={p}>{tx('rest.rechazar')}</BotonV2>
      </form>
    </li>
  );
}

const TONO_VERIF: Record<PortalControlPantalla['verificacion'], TonoEstado> = { verificado: 'ok', exento: 'ok', no_verificado: 'warn', obsoleto: 'warn' };

function FilaPortalControl({ f, minimo, esDueno, flota }: { f: PortalControlPantalla; minimo: number; esDueno: boolean; flota: string | null }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [rP, promover, pP] = useActionState(accionPromoverPortal, null);
  const [rD, devolver, pD] = useActionState(accionDevolverPortal, null);
  useRespuesta(rP); useRespuesta(rD);
  const puede = f.emisionesConfirmadas >= minimo;
  return (
    <li className="rv-fact__reglon">
      <span className="rv-fact__nota">
        <strong>{f.nombre}</strong> · {f.fase === 'autonoma' ? tx('rest.autonomo') : tx('rest.supervisado')} · {tx(f.emisionesConfirmadas === 1 ? 'rest.n_emision_con_uuid.uno' : 'rest.n_emision_con_uuid.otros', { n: f.emisionesConfirmadas })}<span className="rv-fact__sub"><StatusChip tono={TONO_VERIF[f.verificacion]}>{verif(tx)[f.verificacion]}</StatusChip></span>
      </span>
      {f.fase === 'autonoma' ? (
        <form action={devolver}><CampoFlota valor={flota} /><input type="hidden" name="comercio" value={f.clave} /><Boton pendiente={pD}>{tx('rest.volver_a_supervisado')}</Boton></form>
      ) : !esDueno ? (
        <span className="rv-fact__nota" data-tono="faint">{tx('rest.un_portal_lo_pasa_a_autonomo')}</span>
      ) : (
        <form action={promover} className="rv-fact__linea">
          <CampoFlota valor={flota} />
          <input type="hidden" name="comercio" value={f.clave} />
          <Boton pendiente={pP}>{tx('rest.pasar_a_autonomo')}</Boton>
          {!puede && <span className="rv-fact__nota" data-tono="faint">{tx('rest.faltan_emision_es_confirmadas', { v: minimo - f.emisionesConfirmadas })}</span>}
        </form>
      )}
    </li>
  );
}

export function SeccionControlEmision({ datos }: { datos: DatosControl }) {
  const { t: tx } = useT('agentes', agentesEs);
  const { control, lotes, portales, minimoParaAutonoma, esDueno, flotaPintada } = datos;
  const encendida = control !== null && control !== 'sin_fila' && control.emisionReal;
  return (
    <Tarjeta titulo={tx('rest.emision_real_de_facturas')}>
      <div className="rv-fact__emision">
        <div className="rv-fact__pila rv-fact__emision-col">
        <p className="rv-fact__nota">{ricoT(tx('rest.un_cfdi_emitido_no_se_deshace'), { e0: (c) => <Link className="rv-fact__enlace" href="/dashboard/legal">{c}</Link> })}</p>
        {control === null ? (
          <p role="alert" className="rv-fact__nota" data-tono="bad">{tx('rest.no_se_pudo_leer_el_control')}</p>
        ) : (
          <>
            <div className="rv-fact__ctl-fila">
              <span className="rv-fact__ctl-etq">
                {tx('rest.estado')}{' '}<strong>{encendida ? tx('rest.emision_real_encendida') : tx('rest.ensayo_llena_el_portal_y_no')}</strong>
              </span>
              <Interruptor encendida={encendida} esDueno={esDueno} flota={flotaPintada} />
            </div>
            <Limites c={control} esDueno={esDueno} flota={flotaPintada} />
          </>
        )}
        </div>
        <div className="rv-fact__pila rv-fact__emision-col">
        <p className="rv-fact__sec">{tx('rest.lotes_por_confirmar')}</p>
        {lotes === null ? (
          <p className="rv-fact__nota" data-tono="bad">{tx('rest.no_se_pudieron_leer_los_lotes')}</p>
        ) : lotes.length === 0 ? (
          <p className="rv-fact__nota">{tx('rest.ninguno_cuando_el_agente_tenga_tickets')}</p>
        ) : (
          <ul className="rv-fact__reglones">{lotes.map((l) => <FilaLote key={l.id} l={l} flota={flotaPintada} />)}</ul>
        )}
        <p className="rv-fact__sec">{tx('rest.portales')}</p>
        {portales.length === 0 ? (
          <p className="rv-fact__nota">{tx('rest.ningun_portal_ha_emitido_todavia')}</p>
        ) : (
          <ul className="rv-fact__reglones">{portales.map((f) => <FilaPortalControl key={f.clave} f={f} minimo={minimoParaAutonoma} esDueno={esDueno} flota={flotaPintada} />)}</ul>
        )}
        </div>
      </div>
    </Tarjeta>
  );
}
