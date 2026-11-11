'use client';

import { useState, useTransition } from 'react';
import { Aviso, Boton, DialogoConfirmar, StatusChip, TablaBase, type TonoEstado } from '../../ui-v2/componentes';
import { numero, fechaCorta, usd } from '@/lib/formato';
import { cplAgregado } from './cpl';
import type { Campana } from '@/lib/admin/campanas';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTROL DE CAMPAÑAS (0123, §4) — la parte interactiva: pausar y refrescar el gasto. TODO LO QUE DECIDE VIVE EN EL SERVIDOR (server
// actions re-gateadas, con su paso extra de superadmin): aquí solo botones y la verdad en pantalla — el CPL real solo se calcula con gasto
// MEDIDO y leads reales, jamás proyectado. Pausar tiene efecto externo (la campaña deja de gastar en Meta): pide confirmación que lo dice.
// ═══════════════════════════════════════════════════════════════════════════

const TONO: Record<string, TonoEstado> = { activa: 'ok', pausada: 'neutral', terminada: 'muted' };

export type AccionCampana = { ok: true; mensaje: string } | { ok: false; error: string };

export function ControlCampanas({ campanas, integracion, leadsAds, pausar, refrescar }: {
  campanas: Campana[];
  integracion: { metaConfigurada: boolean };
  /** Leads con fuente `ads` — el denominador REAL del CPL. */
  leadsAds: number;
  pausar: (id: string) => Promise<AccionCampana>;
  refrescar: () => Promise<AccionCampana>;
}) {
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [porPausar, setPorPausar] = useState<Campana | null>(null);

  const correr = (fn: () => Promise<AccionCampana>) => {
    setAviso(null);
    empezar(async () => {
      const r = await fn();
      setAviso(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
    });
  };
  const agg = cplAgregado(campanas, leadsAds);

  return (
    <div>
      <p className="adm-din-nota">
        {integracion.metaConfigurada
          ? 'Meta conectada: se lee el gasto y se puede pausar desde aquí. Google Ads todavía no está conectado.'
          : 'Sin conexión con Meta Ads: no se lee el gasto real ni se puede pausar desde aquí. Google Ads tampoco está conectado.'}
      </p>

      <TablaBase
        etiqueta="Campañas" idFila={(c) => c.id} tarjetaMovil densa filas={campanas}
        vacio={{ titulo: 'Cero campañas registradas', texto: 'Activar una exige aprobación firmada (el candado es de base: sin aprobador no puede estar activa); el agente de campañas solo propone.' }}
        columnas={[
          {
            id: 'campana', titulo: 'Campaña', principal: true,
            celda: (c) => (
              <>
                {c.nombre}
                <span className="adm-din-sub">{c.canal}{c.aprobadoPorEmail ? ` · aprobada por ${c.aprobadoPorEmail}` : ''}</span>
              </>
            ),
          },
          { id: 'presupuesto', titulo: 'Presupuesto', alinear: 'der', celda: (c) => usd(c.presupuestoAprobadoUsd) },
          {
            id: 'gasto', titulo: 'Gasto real', alinear: 'der',
            celda: (c) => (c.gastoRealUsd !== null
              ? <>{usd(c.gastoRealUsd)}<span className="adm-din-sub">medido {c.gastoMedidoEn ? fechaCorta(c.gastoMedidoEn) : ''}</span></>
              : 'sin medir'),
          },
          {
            // A37-S06-04: los leads no se atribuyen por campaña; el CPL solo existe agregado (abajo).
            id: 'cpl', titulo: 'CPL real vs objetivo', alinear: 'der',
            celda: (c) => `${c.gastoRealUsd === null ? 'sin gasto medido' : 'ver CPL agregado'}${c.cplObjetivoUsd !== null ? ` · objetivo ${usd(c.cplObjetivoUsd)}` : ''}`,
          },
          {
            id: 'estado', titulo: 'Estado', alinear: 'der',
            celda: (c) => (
              <span className="adm-din-acciones">
                <StatusChip tono={TONO[c.estado] ?? 'neutral'}>{c.estado}</StatusChip>
                {c.estado === 'activa' ? <Boton variante="danger" tamano="sm" disabled={pendiente} onClick={() => setPorPausar(c)}>Pausar</Boton> : null}
              </span>
            ),
          },
        ]}
      />

      {campanas.length > 0 ? (
        <p className="adm-din-nota">
          {agg
            ? `CPL agregado: ${usd(agg.cplUsd)} (${usd(agg.gastoUsd)} medidos de ${agg.medidas} de ${agg.total} campañas ÷ ${numero(leadsAds)} leads de ads). Los leads no se atribuyen por campaña.`
            : leadsAds > 0 ? 'CPL agregado: sin gasto medido.' : 'CPL agregado: cero leads de ads.'}
        </p>
      ) : null}

      <div className="adm-din-acciones">
        {integracion.metaConfigurada && campanas.some((c) => c.canal === 'meta' && c.idExterno) ? (
          <Boton variante="secondary" tamano="sm" loading={pendiente} onClick={() => correr(refrescar)}>{pendiente ? 'Midiendo…' : 'Actualizar gasto desde Meta'}</Boton>
        ) : null}
      </div>
      {aviso ? <Aviso tono={aviso.ok ? 'ok' : 'error'}>{aviso.texto}</Aviso> : null}

      <DialogoConfirmar
        abierto={porPausar !== null}
        titulo="Pausar la campaña"
        descripcion={porPausar ? `«${porPausar.nombre}» (${porPausar.canal}) deja de gastar${integracion.metaConfigurada && porPausar.idExterno ? ' también en Meta' : ' aquí; sin conexión con la plataforma, hay que apagarla además en su administrador de anuncios o seguirá gastando'}. Para reactivarla hace falta una aprobación nueva.` : ''}
        etiquetaConfirmar="Sí, pausar"
        tono="peligro"
        pendiente={pendiente}
        onCancelar={() => setPorPausar(null)}
        onConfirmar={() => { const c = porPausar; setPorPausar(null); if (c) correr(() => pausar(c.id)); }}
      />
    </div>
  );
}
