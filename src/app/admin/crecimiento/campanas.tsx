'use client';

import { useState, useTransition } from 'react';
import { Aviso, Boton, DialogoConfirmar, StatusChip, TablaBase, type TonoEstado } from '../../ui-v2/componentes';
import { numero, fechaCorta, usd } from '@/lib/formato';
import { cplAgregado } from './cpl';
import type { Campana } from '@/lib/admin/campanas';
import { useT } from '@/lib/i18n/proveedor';
import { admin_flotas as admin_flotasEs } from '@/lib/i18n/es/admin_flotas';

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
  const { t } = useT('admin_flotas', admin_flotasEs);
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
          ? t('cf6.camp_meta_conectada')
          : t('cf6.camp_meta_sin_conexion')}
      </p>

      <TablaBase
        etiqueta={t('cf6.camp_etiqueta')} idFila={(c) => c.id} tarjetaMovil filas={campanas}
        vacio={{ titulo: t('cf6.camp_vacio_titulo'), texto: t('cf6.camp_vacio_texto') }}
        columnas={[
          {
            id: 'campana', titulo: t('cf6.camp_col_campana'), principal: true,
            celda: (c) => (
              <>
                {c.nombre}
                <span className="adm-din-sub">{c.canal}{c.aprobadoPorEmail ? ` · ${t('cf6.camp_aprobada_por', { email: c.aprobadoPorEmail })}` : ''}</span>
              </>
            ),
          },
          { id: 'presupuesto', titulo: t('cf6.camp_col_presupuesto'), alinear: 'der', celda: (c) => usd(c.presupuestoAprobadoUsd) },
          {
            id: 'gasto', titulo: t('cf6.camp_col_gasto'), alinear: 'der',
            celda: (c) => (c.gastoRealUsd !== null
              ? <>{usd(c.gastoRealUsd)}<span className="adm-din-sub">{t('cf6.camp_medido', { fecha: c.gastoMedidoEn ? fechaCorta(c.gastoMedidoEn) : '' })}</span></>
              : t('cf6.camp_sin_medir')),
          },
          {
            // A37-S06-04: los leads no se atribuyen por campaña; el CPL solo existe agregado (abajo).
            id: 'cpl', titulo: t('cf6.camp_col_cpl'), alinear: 'der',
            celda: (c) => `${c.gastoRealUsd === null ? t('cf6.camp_sin_gasto_medido') : t('cf6.camp_ver_cpl_agregado')}${c.cplObjetivoUsd !== null ? ` · ${t('cf6.camp_objetivo', { usd: usd(c.cplObjetivoUsd) })}` : ''}`,
          },
          {
            id: 'estado', titulo: t('cf6.camp_col_estado'), alinear: 'der',
            celda: (c) => (
              <span className="adm-din-acciones">
                <StatusChip tono={TONO[c.estado] ?? 'neutral'}>{c.estado === 'activa' || c.estado === 'pausada' || c.estado === 'terminada' ? t(`cf6.camp_estado_${c.estado}`) : c.estado}</StatusChip>
                {c.estado === 'activa' ? <Boton variante="danger" tamano="sm" disabled={pendiente} onClick={() => setPorPausar(c)}>{t('cf6.camp_pausar')}</Boton> : null}
              </span>
            ),
          },
        ]}
      />

      {campanas.length > 0 ? (
        <p className="adm-din-nota">
          {agg
            ? t('cf6.camp_cpl_agregado', { cpl: usd(agg.cplUsd), gasto: usd(agg.gastoUsd), medidas: agg.medidas, total: agg.total, leads: numero(leadsAds) })
            : leadsAds > 0 ? t('cf6.camp_cpl_sin_gasto') : t('cf6.camp_cpl_sin_leads')}
        </p>
      ) : null}

      <div className="adm-din-acciones">
        {integracion.metaConfigurada && campanas.some((c) => c.canal === 'meta' && c.idExterno) ? (
          <Boton variante="secondary" tamano="sm" loading={pendiente} onClick={() => correr(refrescar)}>{pendiente ? t('cf6.camp_midiendo') : t('cf6.camp_actualizar')}</Boton>
        ) : null}
      </div>
      {aviso ? <Aviso tono={aviso.ok ? 'ok' : 'error'}>{aviso.texto}</Aviso> : null}

      <DialogoConfirmar
        abierto={porPausar !== null}
        titulo={t('cf6.camp_dlg_titulo')}
        descripcion={porPausar ? t(integracion.metaConfigurada && porPausar.idExterno ? 'cf6.camp_dlg_desc_meta' : 'cf6.camp_dlg_desc_local', { nombre: porPausar.nombre, canal: porPausar.canal }) : ''}
        etiquetaConfirmar={t('cf6.camp_dlg_confirmar')}
        tono="peligro"
        pendiente={pendiente}
        onCancelar={() => setPorPausar(null)}
        onConfirmar={() => { const c = porPausar; setPorPausar(null); if (c) correr(() => pausar(c.id)); }}
      />
    </div>
  );
}
