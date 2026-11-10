'use client';

import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import type { PrimerMesFila } from '@/lib/likida/carta_porte_docs/repo';
import { textoDeRevisores } from '@/lib/likida/carta_porte_docs/primer_mes_texto';
import { BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';

/**
 * «Primer mes» (OLA1-A3): hasta la fecha elegida, cada movimiento de un documento de Carta Porte se copia por correo a un
 * revisor por departamento. Un revisor por renglón: «Departamento: correo». Vacío = apagado. El correo no lleva campos del
 * documento: solo qué pasó, un código y la liga al visor.
 */

import '../carta-porte.css';
import { Aviso, CampoFecha, CampoTextarea, Tarjeta } from '@/app/ui-v2/componentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }

export function SeccionPrimerMes({ primerMes, ver, accion }: { primerMes: PrimerMesFila | 'no_disponible'; ver: VerComo; accion: AccionDoc }) {
  if (primerMes === 'no_disponible') {
    return <Aviso tono="warn">El modo primer mes todavía no está disponible en tu cuenta. Avísale a Likida y lo habilita.</Aviso>;
  }
  return (
    <Tarjeta titulo="Primer mes: copia a los revisores">
      <FormaAccion accion={accion} className="rv-cp__pila">
        {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
        {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
        {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
        {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
        <p className="rv-cp__nota">
          Hasta la fecha que elijas, cada movimiento de un documento (leído, aprobado, rechazado, listo para subir, subido a mano) se copia por correo a los revisores.
          Déjalo vacío para apagarlo.
        </p>
        <CampoFecha id="primer-mes-hasta" etiqueta="Hasta el día (inclusive)" name="hasta" defaultValue={primerMes.hasta ?? ''} />
        <CampoTextarea id="primer-mes-revisores" etiqueta="Revisores (uno por renglón: «Departamento: correo»)" name="revisores" rows={4}
          defaultValue={textoDeRevisores(primerMes.revisores)} placeholder="Captura de Carta Porte: revisor@empresa.com" />
        <BotonEnvio variante="secundario" etiqueta="Guardar primer mes" pendiente="Guardando…" />
      </FormaAccion>
    </Tarjeta>
  );
}
