'use client';

import { MailCheck } from 'lucide-react';
import type { PrimerMesFila } from '@/lib/likida/carta_porte_docs/repo';
import { textoDeRevisores } from '@/lib/likida/carta_porte_docs/primer_mes_texto';
import { BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';

/**
 * «Primer mes» (OLA1-A3): hasta la fecha elegida, cada movimiento de un documento de Carta Porte se copia por correo a un
 * revisor por departamento. Un revisor por renglón: «Departamento: correo». Vacío = apagado. El correo no lleva campos del
 * documento: solo qué pasó, un código y la liga al visor.
 */

export interface VerComo { tenant?: string; rol?: string; vista?: string }

export function SeccionPrimerMes({ primerMes, ver, accion }: { primerMes: PrimerMesFila | 'no_disponible'; ver: VerComo; accion: AccionDoc }) {
  if (primerMes === 'no_disponible') {
    return <p role="note" className="text-[12px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>El modo primer mes todavía no está habilitado en la base (falta aplicar la migración 0938).</p>;
  }
  return (
    <FormaAccion accion={accion} className="space-y-3 card p-3.5">
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      <h2 className="text-[13px] font-medium flex items-center gap-1.5"><MailCheck width={15} height={15} strokeWidth={1.75} />Primer mes: copia a los revisores</h2>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        Hasta la fecha que elijas, cada movimiento de un documento (leído, aprobado, rechazado, listo para subir, subido a mano) se copia por correo a los revisores.
        Déjalo vacío para apagarlo.
      </p>
      <div>
        <label className={ETIQUETA} htmlFor="primer-mes-hasta">Hasta el día (inclusive)</label>
        <input id="primer-mes-hasta" name="hasta" type="date" defaultValue={primerMes.hasta ?? ''} className={`${CAMPO} !w-auto`} style={{ background: 'var(--surface)' }} />
      </div>
      <div>
        <label className={ETIQUETA} htmlFor="primer-mes-revisores">Revisores (uno por renglón: «Departamento: correo»)</label>
        <textarea id="primer-mes-revisores" name="revisores" rows={4} defaultValue={textoDeRevisores(primerMes.revisores)} className={`${CAMPO} !h-auto py-2`} style={{ background: 'var(--surface)' }} placeholder="Captura de Carta Porte: revisor@empresa.com" />
      </div>
      <BotonEnvio variante="secundario" etiqueta="Guardar primer mes" pendiente="Guardando…" />
    </FormaAccion>
  );
}
