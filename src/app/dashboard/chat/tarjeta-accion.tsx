'use client';

import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Boton } from '../../ui-v2/componentes/boton';
import type { AccionPropuesta } from './respuestas';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

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
  const { t } = useT('resto', restoEs);
  const [motivo, setMotivo] = useState(a.motivoSugerido ?? '');
  const [estado, setEstado] = useState<Estado>('lista');
  const [error, setError] = useState<string | null>(null);
  const apagar = a.accion === 'apagar_agente';
  const encender = a.accion === 'encender_agente';

  if (!a.implementada) {
    return (
      <section className="rv-tarjeta rv-chat__bloque rv-accion" data-estado="no-implementada" aria-label={t('ch.accion_no_disponible')}>
        <p className="rv-accion__titulo"><ShieldAlert width={14} height={14} strokeWidth={1.75} aria-hidden="true" />{a.accion}{' '}{t('ch.todavia_no_esta_implementada_desde_el')}</p>
        <p className="rv-accion__linea">{a.efecto}</p>
        <p className="rv-chat__nota">{t('ch.hoy_se_hace_desde_su_pantalla')}</p>
      </section>
    );
  }
  // Sin intent no hay botón (defensa: una propuesta vieja re-pintada sin su llave no puede fingir que ejecuta).
  if (!a.intentId) {
    return (
      <section className="rv-tarjeta rv-chat__bloque rv-accion" data-estado="sin-llave">
        <p className="rv-accion__linea">{t('ch.esta_propuesta_ya_no_trae_su')}</p>
      </section>
    );
  }
  if (estado === 'hecha' || estado === 'cancelada') {
    return (
      <section className="rv-tarjeta rv-chat__bloque rv-accion" data-estado={estado} role="status">
        <p className="rv-accion__linea">{estado === 'hecha' ? t('ch.accion_ejecutada_el_resultado_quedo_abajo') : t('ch.accion_cancelada_nada_se_movio')}</p>
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
        setError(typeof d?.error === 'string' ? d.error : t('ch.no_se_pudo_ejecutar_intentalo_de'));
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
    <section className="rv-tarjeta rv-chat__bloque rv-accion" data-estado={estado} aria-label={t('ch.confirmar_accion')}>
      <p className="rv-accion__titulo">{t('ch.voy_a')}{' '}{apagar ? 'apagar' : encender ? 'encender' : 'ejecutar'} <span className="rv-accion__objetivo">{a.objetivo}</span></p>
      <label className="rv-accion__campo">{rico(t('ch.e0_motivo_obligatorio_e0'), { e0: (c) => <span>{c}</span> })}<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={encender ? t('ch.por_que_se_enciende_queda_en') : t('ch.por_que_se_apaga_queda_en')} />
      </label>
      <p className="rv-accion__linea">{rico(t('ch.b_efecto_b'), { b: (c) => <b>{c}</b> })}{' '}{a.efecto}</p>
      <p className="rv-accion__linea">{rico(t('ch.b_revertir_b'), { b: (c) => <b>{c}</b> })}{' '}{a.revertir}</p>
      {estado === 'armada' && (
        <p className="rv-accion__aviso" role="status">{t('ch.primera_confirmacion_registrada_esta_accion_exige')}</p>
      )}
      {error && <p className="rv-chat__error-linea" role="alert">{error}</p>}
      <div className="rv-accion__botones">
        <Boton tamano="sm" onClick={() => setEstado('cancelada')}>{t('op.cancelar')}</Boton>
        <Boton variante="primary" tamano="sm" disabled={estado === 'ejecutando'} onClick={() => void ejecutar()}>
          {estado === 'ejecutando' ? (apagar ? 'Apagando…' : encender ? 'Encendiendo…' : 'Ejecutando…') : estado === 'armada' ? t('ch.confirmar_de_nuevo') : (apagar ? t('ch.apagar') : encender ? 'Encender' : 'Ejecutar')}
        </Boton>
      </div>
    </section>
  );
}
