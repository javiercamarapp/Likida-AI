'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react';
import { mxn, fechaCorta } from '@/lib/formato';
import { useNotificar } from '../../../admin/ui/notificaciones';
import {
  accionEncenderEmision, accionApagarEmision, accionCambiarLimites, accionDecidirLote, accionPromoverPortal, accionDevolverPortal,
  type RespuestaControl,
} from './acciones-control';

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

function Boton({ children, pendiente, peligro }: { children: React.ReactNode; pendiente: boolean; peligro?: boolean }) {
  return (
    <button type="submit" disabled={pendiente} className="text-[12px] px-3 py-1.5 rounded-md border disabled:opacity-50"
      style={{ borderColor: peligro ? 'var(--bad)' : 'var(--line2)', color: peligro ? 'var(--bad)' : undefined }}>
      {pendiente ? 'Un momento…' : children}
    </button>
  );
}

function Interruptor({ encendida }: { encendida: boolean }) {
  const [rEn, encender, pEn] = useActionState(accionEncenderEmision, null);
  const [rAp, apagar, pAp] = useActionState(accionApagarEmision, null);
  useRespuesta(rEn); useRespuesta(rAp);
  return encendida ? (
    <form action={apagar}><Boton pendiente={pAp} peligro><ShieldOff width={12} height={12} className="inline mr-1 -mt-0.5" />Apagar la emisión real</Boton></form>
  ) : (
    <form action={encender}><Boton pendiente={pEn}><ShieldCheck width={12} height={12} className="inline mr-1 -mt-0.5" />Encender la emisión real</Boton></form>
  );
}

function Limites({ c }: { c: ControlPantalla | 'sin_fila' }) {
  const [r, guardar, p] = useActionState(accionCambiarLimites, null);
  useRespuesta(r);
  const v = c === 'sin_fila' ? { maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 } : c;
  const campo = (name: string, rotulo: string, valor: number) => (
    <label className="text-[11.5px] flex flex-col gap-0.5" style={{ color: 'var(--muted)' }}>{rotulo}
      <input name={name} defaultValue={valor} inputMode="decimal" className="rounded border px-2 py-1 text-[12px] w-28" style={{ borderColor: 'var(--line2)', color: 'var(--ink)' }} />
    </label>
  );
  return (
    <form action={guardar} className="flex flex-wrap items-end gap-3 mt-3">
      {campo('maxMontoTicket', 'Monto máx. por ticket', v.maxMontoTicket)}
      {campo('maxTicketsLote', 'Tickets por lote', v.maxTicketsLote)}
      {campo('maxTicketsDia', 'Tickets por día', v.maxTicketsDia)}
      {campo('maxMontoDia', 'Monto máx. por día', v.maxMontoDia)}
      <Boton pendiente={p}>Guardar límites</Boton>
    </form>
  );
}

function FilaLote({ l }: { l: LotePantalla }) {
  const [r, decidir, p] = useActionState(accionDecidirLote, null);
  useRespuesta(r);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--line2)' }}>
      <span className="text-[12.5px]">
        <strong>{l.nombre}</strong> · {l.tickets} ticket{l.tickets === 1 ? '' : 's'} · {mxn(l.montoTotal)}
        <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
          {l.estado === 'confirmado' ? 'Confirmado: sale en la próxima corrida' : 'Esperando tu confirmación'} · propuesto {fechaCorta(l.propuestoEn)} · vence {fechaCorta(l.expiraEn)}
        </span>
      </span>
      <form action={decidir} className="flex items-center gap-2">
        <input type="hidden" name="loteId" value={l.id} />
        {l.estado === 'propuesto' && <button type="submit" name="decision" value="confirmar" disabled={p} className="text-[12px] px-3 py-1.5 rounded-md border disabled:opacity-50" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>Confirmar lote</button>}
        <button type="submit" name="decision" value="rechazar" disabled={p} className="text-[12px] px-3 py-1.5 rounded-md border disabled:opacity-50" style={{ borderColor: 'var(--line2)' }}>Rechazar</button>
      </form>
    </li>
  );
}

function FilaPortalControl({ f, minimo }: { f: PortalControlPantalla; minimo: number }) {
  const [rP, promover, pP] = useActionState(accionPromoverPortal, null);
  const [rD, devolver, pD] = useActionState(accionDevolverPortal, null);
  useRespuesta(rP); useRespuesta(rD);
  const puede = f.emisionesConfirmadas >= minimo;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--line2)' }}>
      <span className="text-[12.5px]">
        <strong>{f.nombre}</strong> · {f.fase === 'autonoma' ? 'Autónomo' : 'Supervisado'} · {f.emisionesConfirmadas} emisión{f.emisionesConfirmadas === 1 ? '' : 'es'} con UUID
        <span className="block text-[11px]" style={{ color: f.verificacion === 'verificado' || f.verificacion === 'exento' ? 'var(--muted)' : 'var(--warn)' }}>{VERIF[f.verificacion]}</span>
      </span>
      {f.fase === 'autonoma' ? (
        <form action={devolver}><input type="hidden" name="comercio" value={f.clave} /><Boton pendiente={pD}>Volver a supervisado</Boton></form>
      ) : (
        <form action={promover} className="flex items-center gap-2">
          <input type="hidden" name="comercio" value={f.clave} />
          <Boton pendiente={pP}>Pasar a autónomo</Boton>
          {!puede && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Faltan {minimo - f.emisionesConfirmadas} emisión(es) confirmadas</span>}
        </form>
      )}
    </li>
  );
}

export function SeccionControlEmision({ datos }: { datos: DatosControl }) {
  const { control, lotes, portales, minimoParaAutonoma } = datos;
  const encendida = control !== null && control !== 'sin_fila' && control.emisionReal;
  return (
    <section className="card p-4" aria-label="Control de la emisión real">
      <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5"><ListChecks width={14} height={14} strokeWidth={2} />Emisión real de facturas</h2>
      <p className="text-[11.5px] mt-1" style={{ color: 'var(--muted)' }}>
        Un CFDI emitido no se deshace. Por eso la emisión real es una decisión del dueño de la flota, requiere el mandato otorgado en
        {' '}<Link className="underline" href="/dashboard/legal">Términos y mandato</Link>, y cada portal arranca supervisado: el agente propone el lote y tú lo confirmas.
      </p>
      {control === null ? (
        <p role="alert" className="text-[12.5px] mt-3" style={{ color: 'var(--bad)' }}>No se pudo leer el control de emisión: esta sección está ciega y el agente sigue en ensayo. Recarga en un momento.</p>
      ) : (
        <>
          <p className="text-[13px] mt-3">
            Estado: <strong style={{ color: encendida ? 'var(--ok)' : 'var(--muted)' }}>{encendida ? 'Emisión real ENCENDIDA' : 'Ensayo (llena el portal y no emite)'}</strong>
          </p>
          <div className="mt-2"><Interruptor encendida={encendida} /></div>
          <Limites c={control} />
        </>
      )}
      <h3 className="text-[12.5px] font-medium mt-4">Lotes por confirmar</h3>
      {lotes === null ? (
        <p className="text-[12px]" style={{ color: 'var(--bad)' }}>No se pudieron leer los lotes.</p>
      ) : lotes.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Ninguno. Cuando el agente tenga tickets listos en un portal supervisado, el lote aparece aquí.</p>
      ) : (
        <ul>{lotes.map((l) => <FilaLote key={l.id} l={l} />)}</ul>
      )}
      <h3 className="text-[12.5px] font-medium mt-4">Portales</h3>
      {portales.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Ningún portal ha emitido todavía.</p>
      ) : (
        <ul>{portales.map((f) => <FilaPortalControl key={f.clave} f={f} minimo={minimoParaAutonoma} />)}</ul>
      )}
    </section>
  );
}
