'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import '../vigia.css';
import { AvisoResultado, Boton, CampoTexto, CampoTextarea, Casilla, Disclosure, Icono } from '@/app/ui-v2/componentes';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import type { ConfigGuardadaSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import type { ResultadoGuardadoUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export type AccionGuardarConfig = (previo: ResultadoGuardadoUI | null, fd: FormData) => Promise<ResultadoGuardadoUI>;

const DIAS = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']] as const;

function BotonGuardar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} tam={14} />}>{pending ? 'Un momento…' : tx('conductores.forma.guardar_configuracion')}</Boton>
  );
}

/**
 * La configuración que la flota deja fija para «sin atender». Solo quien administra la ve. Se manda el estado completo: una casilla sin marcar es «apagado».
 * Los nombres del equipo se guardan tal como se escriben (son del personal de la flota); los mensajes de los chats nunca se guardan aquí.
 */
export function FormaConfiguracion({ guardar, flota, guardada, configLeida }: {
  guardar: AccionGuardarConfig; flota?: string; guardada: ConfigGuardadaSinAtender; configLeida: boolean;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [resultado, despachar] = useActionState(guardar, null);
  const h = guardada.horarioAtencion;
  return (
    <form action={despachar} className="rv-vg__pila" aria-describedby="sin-atender-config-ayuda">
      {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
      <p id="sin-atender-config-ayuda" className="rv-vg__nota">{tx('rest.lo_que_guardes_aqui_se_usa')}</p>
      {!configLeida && (
        <p className="rv-vg__nota" role="note" data-tono="warn">{tx('rest.no_se_pudo_leer_la_configuracion_7')}</p>
      )}
      <Disclosure titulo={tx('rest.horario_de_atencion')} resumen={h !== null ? tx('vigia.vista.activo') : tx('rest.sin_horario')} abierto>
        <div className="rv-vg__pila">
          <Casilla name="horarioActivo" defaultChecked={h !== null} etiqueta={tx('rest.mi_equipo_atiende_solo_en_este')} />
          <div className="rv-vg__cuad">
            <CampoTexto etiqueta={tx('rest.abre_a_las_hora_0_a')} name="desdeHora" inputMode="numeric" defaultValue={h?.desdeHora ?? ''} />
            <CampoTexto etiqueta={tx('rest.cierra_a_las_hora_1_a')} name="hastaHora" inputMode="numeric" defaultValue={h?.hastaHora ?? ''} />
          </div>
          <div role="group" aria-label={tx('rest.dias_habiles')} className="rv-vg__linea">
            {DIAS.map(([v, n]) => (
              <Casilla key={v} name="diaHabil" value={v} defaultChecked={h?.diasHabiles?.includes(Number(v)) ?? false} etiqueta={n} />
            ))}
          </div>
          <p className="rv-vg__nota">{tx('rest.si_no_marcas_ningun_dia_cuentan')}</p>
        </div>
      </Disclosure>
      <Disclosure titulo={tx('rest.plazos_y_noche')}>
        <div className="rv-vg__pila">
          <p className="rv-vg__nota">{tx('rest.si_dejas_un_campo_vacio_se')}</p>
          <div className="rv-vg__cuad">
            <CampoTexto etiqueta={tx('rest.plazo_normal_de_espera_min')} name="umbralMin" inputMode="numeric" defaultValue={guardada.umbralMin ?? ''} />
            <CampoTexto etiqueta={tx('rest.plazo_en_clientes_criticos_min')} ayuda={tx('rest.no_puede_ser_mayor_que_el')} name="umbralCriticoMin" inputMode="numeric" defaultValue={guardada.umbralCriticoMin ?? ''} />
            <CampoTexto etiqueta={tx('rest.la_noche_empieza_a_las_hora')} name="nocheDesdeHora" inputMode="numeric" defaultValue={guardada.nocheDesdeHora ?? ''} />
            <CampoTexto etiqueta={tx('rest.la_noche_termina_a_las_hora')} ayuda={tx('rest.llena_las_dos_horas_de_la')} name="nocheHastaHora" inputMode="numeric" defaultValue={guardada.nocheHastaHora ?? ''} />
          </div>
        </div>
      </Disclosure>
      <Disclosure titulo={tx('rest.urgencia_e_insistencia')}>
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta={tx('rest.mensajes_seguidos_que_cuentan_como_insistencia')} ayuda={tx('rest.0_la_apaga')} name="insistenciaMin" inputMode="numeric" defaultValue={guardada.insistenciaMin} />
          <CampoTexto etiqueta={tx('rest.plazo_de_lo_urgente_min')} name="umbralUrgenteMin" inputMode="numeric" defaultValue={guardada.umbralUrgenteMin} />
          <CampoTexto etiqueta={tx('rest.palabras_que_marcan_urgencia')} ayuda={tx('rest.separadas_por_coma')} name="palabrasUrgentes" defaultValue={guardada.palabrasUrgentes.join(', ')} />
          <CampoTexto etiqueta={tx('rest.palabras_de_temas_importantes')} ayuda={tx('rest.separadas_por_coma_si_las_dejas')} name="palabrasClave" defaultValue={guardada.palabrasClave.join(', ')} placeholder="embarque" />
        </div>
      </Disclosure>
      <Disclosure titulo={tx('rest.equipo_y_resumen_por_correo')}>
        <div className="rv-vg__pila">
          <CampoTextarea etiqueta={tx('rest.nombres_de_tu_equipo_como_salen')} ayuda={tx('rest.separados_por_coma_se_guardan_tal')} name="equipo" rows={2} defaultValue={guardada.equipoNombres.join(', ')} />
          <Casilla name="resumenCorreo" defaultChecked={guardada.resumenCorreoHabilitado} etiqueta={tx('rest.permitir_que_se_mande_el_resumen')} />
        </div>
      </Disclosure>
      <div><BotonGuardar /></div>
      <div aria-live="polite">{resultado && <AvisoResultado estado={resultado} />}</div>
    </form>
  );
}
