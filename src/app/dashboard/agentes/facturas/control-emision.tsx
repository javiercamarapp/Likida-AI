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

const VERIF: Record<PortalControlPantalla['verificacion'], string> = {
  verificado: 'Verificado contra el portal real', no_verificado: 'Sin corrida supervisada (no emite)',
  obsoleto: 'El mapeo cambió: hay que volver a verificarlo', exento: 'Adaptador propio (CAPUFE)',
};

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
  const [rEn, encender, pEn] = useActionState(accionEncenderEmision, null);
  const [rAp, apagar, pAp] = useActionState(accionApagarEmision, null);
  useRespuesta(rEn); useRespuesta(rAp);
  return encendida ? (
    <form action={apagar}><CampoFlota valor={flota} /><Boton pendiente={pAp} peligro><Icono icono={ShieldOff} tam={14} /> Apagar la emisión real</Boton></form>
  ) : esDueno ? (
    <form action={encender}><CampoFlota valor={flota} /><Boton pendiente={pEn}><Icono icono={ShieldCheck} tam={14} /> Encender la emisión real</Boton></form>
  ) : (
    <p className="rv-fact__nota" data-tono="faint">La emisión real la enciende el dueño de la flota.</p>
  );
}

function Limites({ c, esDueno, flota }: { c: ControlPantalla | 'sin_fila'; esDueno: boolean; flota: string | null }) {
  const [r, guardar, p] = useActionState(accionCambiarLimites, null);
  useRespuesta(r);
  const v = c === 'sin_fila' ? { maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 } : c;
  const campo = (name: string, rotulo: string, valor: number) => (
    <CampoTexto etiqueta={rotulo} name={name} defaultValue={valor} inputMode="decimal" />
  );
  if (!esDueno) {
    return (
      <p className="rv-fact__nota">
        Límites: {mxn(v.maxMontoTicket)} por ticket · {v.maxTicketsLote} tickets por lote · {v.maxTicketsDia} por día · {mxn(v.maxMontoDia)} por día. Los cambia el dueño de la flota.
      </p>
    );
  }
  return (
    <form action={guardar} className="rv-fact__tres">
      <CampoFlota valor={flota} />
      {campo('maxMontoTicket', 'Monto máx. por ticket', v.maxMontoTicket)}
      {campo('maxTicketsLote', 'Tickets por lote', v.maxTicketsLote)}
      {campo('maxTicketsDia', 'Tickets por día', v.maxTicketsDia)}
      {campo('maxMontoDia', 'Monto máx. por día', v.maxMontoDia)}
      <Boton pendiente={p}>Guardar límites</Boton>
    </form>
  );
}

function FilaLote({ l, flota }: { l: LotePantalla; flota: string | null }) {
  const [r, decidir, p] = useActionState(accionDecidirLote, null);
  useRespuesta(r);
  return (
    <li className="rv-fact__reglon">
      <span className="rv-fact__nota">
        <strong>{l.nombre}</strong> · {l.tickets} ticket{l.tickets === 1 ? '' : 's'} · {mxn(l.montoTotal)}
        <span className="rv-fact__sub">
          {l.estado === 'confirmado' ? 'Confirmado: sale en la próxima corrida' : 'Esperando tu confirmación'} · propuesto {fechaCorta(l.propuestoEn)} · vence {fechaCorta(l.expiraEn)}
        </span>
      </span>
      <form action={decidir} className="rv-fact__linea">
        <CampoFlota valor={flota} />
        <input type="hidden" name="loteId" value={l.id} />
        {/* A37-S29-06: lo que se está viendo; confirmar se rechaza si el lote cambió desde que se pintó */}
        <input type="hidden" name="vistoTickets" value={l.tickets} />
        <input type="hidden" name="vistoMonto" value={l.montoTotal} />
        {l.estado === 'propuesto' && <BotonV2 type="submit" tamano="sm" variante="primary" name="decision" value="confirmar" disabled={p}>Confirmar lote</BotonV2>}
        <BotonV2 type="submit" tamano="sm" name="decision" value="rechazar" disabled={p}>Rechazar</BotonV2>
      </form>
    </li>
  );
}

const TONO_VERIF: Record<PortalControlPantalla['verificacion'], TonoEstado> = { verificado: 'ok', exento: 'ok', no_verificado: 'warn', obsoleto: 'warn' };

function FilaPortalControl({ f, minimo, esDueno, flota }: { f: PortalControlPantalla; minimo: number; esDueno: boolean; flota: string | null }) {
  const [rP, promover, pP] = useActionState(accionPromoverPortal, null);
  const [rD, devolver, pD] = useActionState(accionDevolverPortal, null);
  useRespuesta(rP); useRespuesta(rD);
  const puede = f.emisionesConfirmadas >= minimo;
  return (
    <li className="rv-fact__reglon">
      <span className="rv-fact__nota">
        <strong>{f.nombre}</strong> · {f.fase === 'autonoma' ? 'Autónomo' : 'Supervisado'} · {f.emisionesConfirmadas} emisión{f.emisionesConfirmadas === 1 ? '' : 'es'} con UUID
        <span className="rv-fact__sub"><StatusChip tono={TONO_VERIF[f.verificacion]}>{VERIF[f.verificacion]}</StatusChip></span>
      </span>
      {f.fase === 'autonoma' ? (
        <form action={devolver}><CampoFlota valor={flota} /><input type="hidden" name="comercio" value={f.clave} /><Boton pendiente={pD}>Volver a supervisado</Boton></form>
      ) : !esDueno ? (
        <span className="rv-fact__nota" data-tono="faint">Un portal lo pasa a autónomo el dueño de la flota.</span>
      ) : (
        <form action={promover} className="rv-fact__linea">
          <CampoFlota valor={flota} />
          <input type="hidden" name="comercio" value={f.clave} />
          <Boton pendiente={pP}>Pasar a autónomo</Boton>
          {!puede && <span className="rv-fact__nota" data-tono="faint">Faltan {minimo - f.emisionesConfirmadas} emisión(es) confirmadas</span>}
        </form>
      )}
    </li>
  );
}

export function SeccionControlEmision({ datos }: { datos: DatosControl }) {
  const { control, lotes, portales, minimoParaAutonoma, esDueno, flotaPintada } = datos;
  const encendida = control !== null && control !== 'sin_fila' && control.emisionReal;
  return (
    <Tarjeta titulo="Emisión real de facturas">
      <div className="rv-fact__pila">
        <p className="rv-fact__nota">
          Un CFDI emitido no se deshace. Por eso la emisión real es una decisión del dueño de la flota, requiere el mandato otorgado en
          {' '}<Link className="rv-fact__enlace" href="/dashboard/legal">Términos y mandato</Link>, y cada portal arranca supervisado: el agente propone el lote y tú lo confirmas.
        </p>
        {control === null ? (
          <p role="alert" className="rv-fact__nota" data-tono="bad">No se pudo leer el control de emisión: esta sección está ciega y el agente sigue en ensayo. Recarga en un momento.</p>
        ) : (
          <>
            <p className="rv-fact__nota">
              Estado: <strong>{encendida ? 'Emisión real ENCENDIDA' : 'Ensayo (llena el portal y no emite)'}</strong>
            </p>
            <Interruptor encendida={encendida} esDueno={esDueno} flota={flotaPintada} />
            <Limites c={control} esDueno={esDueno} flota={flotaPintada} />
          </>
        )}
        <p className="rv-fact__rotulo">Lotes por confirmar</p>
        {lotes === null ? (
          <p className="rv-fact__nota" data-tono="bad">No se pudieron leer los lotes.</p>
        ) : lotes.length === 0 ? (
          <p className="rv-fact__nota">Ninguno. Cuando el agente tenga tickets listos en un portal supervisado, el lote aparece aquí.</p>
        ) : (
          <ul className="rv-fact__reglones">{lotes.map((l) => <FilaLote key={l.id} l={l} flota={flotaPintada} />)}</ul>
        )}
        <p className="rv-fact__rotulo">Portales</p>
        {portales.length === 0 ? (
          <p className="rv-fact__nota">Ningún portal ha emitido todavía.</p>
        ) : (
          <ul className="rv-fact__reglones">{portales.map((f) => <FilaPortalControl key={f.clave} f={f} minimo={minimoParaAutonoma} esDueno={esDueno} flota={flotaPintada} />)}</ul>
        )}
      </div>
    </Tarjeta>
  );
}
