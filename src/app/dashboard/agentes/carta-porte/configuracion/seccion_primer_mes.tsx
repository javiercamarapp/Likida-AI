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
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }

export function SeccionPrimerMes({ primerMes, ver, accion }: { primerMes: PrimerMesFila | 'no_disponible'; ver: VerComo; accion: AccionDoc }) {
  const { t: tx } = useT('agentes', agentesEs);
  if (primerMes === 'no_disponible') {
    return <Aviso tono="warn">{tx('rest.el_modo_primer_mes_todavia_no')}</Aviso>;
  }
  return (
    <Tarjeta titulo={tx('rest.primer_mes_copia_a_los_revisores')}>
      <FormaAccion accion={accion} className="rv-cp__pila">
        {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
        {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
        {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
        {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
        <p className="rv-cp__nota">{tx('rest.hasta_la_fecha_que_elijas_cada')}</p>
        <CampoFecha id="primer-mes-hasta" etiqueta={tx('rest.hasta_el_dia_inclusive')} name="hasta" defaultValue={primerMes.hasta ?? ''} />
        <CampoTextarea id="primer-mes-revisores" etiqueta={tx('rest.revisores_uno_por_renglon_departamento_correo')} name="revisores" rows={4}
          defaultValue={textoDeRevisores(primerMes.revisores)} placeholder={tx('rest.captura_de_carta_porte_revisor_empresa')} />
        <BotonEnvio variante="secundario" etiqueta={tx('rest.guardar_primer_mes')} pendiente={tx('cobranza.formagasto.guardando')} />
      </FormaAccion>
    </Tarjeta>
  );
}
