'use client';

import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { AccionPropuesta } from './respuestas';

type Estado = 'lista' | 'ejecutando' | 'armada' | 'hecha' | 'cancelada';

/**
 * La previsualización de una acción gateada del copiloto de superadmin: efecto, cómo se revierte, motivo OBLIGATORIO y dos botones.
 * NUNCA ejecuta sin confirmar: EJECUTAR presenta el `intentId` que el SERVIDOR creó al proponer (AdminActionIntent) y un booleano del
 * cliente no es una autoridad. Para `gateo: 'doble'` son DOS POSTs con el mismo intent: el primero lo arma (`armado: true`), el
 * segundo ejecuta. Un intent expirado o usado vuelve como error con la instrucción de pedir la acción de nuevo. Sin intent no hay
 * botón; una acción no implementada se dice, sin botón. `endpoint` es serializable (viene de la configuración del modo).
 */
export default function TarjetaAccion({ a, endpoint, onEjecutada }: {
  a: AccionPropuesta;
  endpoint: string;
  onEjecutada: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState(a.motivoSugerido ?? '');
  const [estado, setEstado] = useState<Estado>('lista');
  const [error, setError] = useState<string | null>(null);
  const apagar = a.accion === 'apagar_agente';
  const encender = a.accion === 'encender_agente';

  if (!a.implementada) {
    return (
      <section className="card rv-chat__bloque rv-accion" data-estado="no-implementada" aria-label="Acción no disponible">
        <p className="rv-accion__titulo"><ShieldAlert width={14} height={14} strokeWidth={1.75} aria-hidden="true" />{a.accion} — todavía no está implementada desde el copiloto</p>
        <p className="rv-accion__linea">{a.efecto}</p>
        <p className="rv-chat__nota">Hoy se hace desde su pantalla del panel.</p>
      </section>
    );
  }
  // Sin intent no hay botón (defensa: una propuesta vieja re-pintada sin su llave no puede fingir que ejecuta).
  if (!a.intentId) {
    return (
      <section className="card rv-chat__bloque rv-accion" data-estado="sin-llave">
        <p className="rv-accion__linea">Esta propuesta ya no trae su llave de ejecución. Pídela de nuevo — el copiloto la re-propone con el estado de hoy.</p>
      </section>
    );
  }
  if (estado === 'hecha' || estado === 'cancelada') {
    return (
      <section className="card rv-chat__bloque rv-accion" data-estado={estado} role="status">
        <p className="rv-accion__linea">{estado === 'hecha' ? 'Acción ejecutada — el resultado quedó abajo.' : 'Acción cancelada. Nada se movió.'}</p>
      </section>
    );
  }

  async function ejecutar() {
    if (!motivo.trim()) { setError('El motivo es obligatorio: sin nota, en tres semanas nadie sabe si ya se puede encender.'); return; }
    const veniaArmada = estado === 'armada';
    setEstado('ejecutando');
    setError(null);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: a.intentId, accion: { id: a.accion, objetivo: a.objetivo, motivo: motivo.trim() } }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d?.ok) {
        setEstado(veniaArmada ? 'armada' : 'lista');
        setError(typeof d?.error === 'string' ? d.error : 'No se pudo ejecutar. Inténtalo de nuevo.');
        return;
      }
      if (d.armado === true) { setEstado('armada'); return; } // 'doble': falta la segunda confirmación
      setEstado('hecha');
      onEjecutada(String(d.mensaje ?? 'Hecho.'));
    } catch {
      setEstado(veniaArmada ? 'armada' : 'lista');
      setError('No se pudo ejecutar. Inténtalo de nuevo.');
    }
  }

  return (
    <section className="card rv-chat__bloque rv-accion" data-estado={estado} aria-label="Confirmar acción">
      <p className="rv-accion__titulo">Voy a {apagar ? 'apagar' : encender ? 'encender' : 'ejecutar'} <span className="rv-accion__objetivo">{a.objetivo}</span></p>
      <label className="rv-accion__campo">
        <span>Motivo (obligatorio)</span>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={encender ? 'Por qué se enciende — queda en la bitácora' : 'Por qué se apaga — queda en la bitácora'} />
      </label>
      <p className="rv-accion__linea"><b>Efecto:</b> {a.efecto}</p>
      <p className="rv-accion__linea"><b>Revertir:</b> {a.revertir}</p>
      {estado === 'armada' && (
        <p className="rv-accion__aviso" role="status">Primera confirmación registrada — esta acción exige doble confirmación. Aprieta de nuevo para ejecutar.</p>
      )}
      {error && <p className="rv-chat__error-linea" role="alert">{error}</p>}
      <div className="rv-accion__botones">
        <button type="button" className="rv-btn rv-btn--secondary rv-btn--sm" onClick={() => setEstado('cancelada')}>Cancelar</button>
        <button type="button" className="rv-btn rv-btn--primary rv-btn--sm" disabled={estado === 'ejecutando'} onClick={() => void ejecutar()}>
          {estado === 'ejecutando' ? (apagar ? 'Apagando…' : encender ? 'Encendiendo…' : 'Ejecutando…') : estado === 'armada' ? 'Confirmar de nuevo' : (apagar ? 'Apagar' : encender ? 'Encender' : 'Ejecutar')}
        </button>
      </div>
    </section>
  );
}
