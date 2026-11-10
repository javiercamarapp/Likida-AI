'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import '../vigia.css';
import { AvisoResultado, Boton, CampoTexto, CampoTextarea, Casilla, Disclosure, Icono } from '@/app/ui-v2/componentes';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import type { ConfigGuardadaSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import type { ResultadoGuardadoUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';

export type AccionGuardarConfig = (previo: ResultadoGuardadoUI | null, fd: FormData) => Promise<ResultadoGuardadoUI>;

const DIAS = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']] as const;

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} tam={14} />}>{pending ? 'Un momento…' : 'Guardar configuración'}</Boton>
  );
}

/**
 * La configuración que la flota deja fija para «sin atender». Solo quien administra la ve. Se manda el estado completo: una casilla sin marcar es «apagado».
 * Los nombres del equipo se guardan tal como se escriben (son del personal de la flota); los mensajes de los chats nunca se guardan aquí.
 */
export function FormaConfiguracion({ guardar, flota, guardada, configLeida }: {
  guardar: AccionGuardarConfig; flota?: string; guardada: ConfigGuardadaSinAtender; configLeida: boolean;
}) {
  const [resultado, despachar] = useActionState(guardar, null);
  const h = guardada.horarioAtencion;
  return (
    <form action={despachar} className="rv-vg__pila" aria-describedby="sin-atender-config-ayuda">
      {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
      <p id="sin-atender-config-ayuda" className="rv-vg__nota">
        Lo que guardes aquí se usa en cada revisión de tu flota, también al subir un chat. Los campos vacíos usan los valores de arranque.
      </p>
      {!configLeida && (
        <p className="rv-vg__nota" role="note" data-tono="warn">
          No se pudo leer la configuración guardada: lo que ves abajo son los valores de arranque y no la que tenías. Recarga la página antes de guardar.
        </p>
      )}
      <Disclosure titulo="Horario de atención" resumen={h !== null ? 'Activo' : 'Sin horario'} abierto>
        <div className="rv-vg__pila">
          <Casilla name="horarioActivo" defaultChecked={h !== null} etiqueta="Mi equipo atiende solo en este horario: la espera fuera de él no cuenta" />
          <div className="rv-vg__cuad">
            <CampoTexto etiqueta="Abre a las (hora, 0 a 23)" name="desdeHora" inputMode="numeric" defaultValue={h?.desdeHora ?? ''} />
            <CampoTexto etiqueta="Cierra a las (hora, 1 a 24)" name="hastaHora" inputMode="numeric" defaultValue={h?.hastaHora ?? ''} />
          </div>
          <div role="group" aria-label="Días hábiles" className="rv-vg__linea">
            {DIAS.map(([v, n]) => (
              <Casilla key={v} name="diaHabil" value={v} defaultChecked={h?.diasHabiles?.includes(Number(v)) ?? false} etiqueta={n} />
            ))}
          </div>
          <p className="rv-vg__nota">Si no marcas ningún día, cuentan todos. Los festivos que ya registraste en el tablero del Vigía tampoco cuentan.</p>
        </div>
      </Disclosure>
      <Disclosure titulo="Urgencia e insistencia">
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta="Mensajes seguidos que cuentan como insistencia" ayuda="0 la apaga." name="insistenciaMin" inputMode="numeric" defaultValue={guardada.insistenciaMin} />
          <CampoTexto etiqueta="Plazo de lo urgente (min)" name="umbralUrgenteMin" inputMode="numeric" defaultValue={guardada.umbralUrgenteMin} />
          <CampoTexto etiqueta="Palabras que marcan urgencia" ayuda="Separadas por coma." name="palabrasUrgentes" defaultValue={guardada.palabrasUrgentes.join(', ')} />
          <CampoTexto etiqueta="Palabras de temas importantes" ayuda="Separadas por coma; si las dejas vacías se usan «embarque» y «embarques»." name="palabrasClave" defaultValue={guardada.palabrasClave.join(', ')} placeholder="embarque" />
        </div>
      </Disclosure>
      <Disclosure titulo="Equipo y resumen por correo">
        <div className="rv-vg__pila">
          <CampoTextarea etiqueta="Nombres de tu equipo, como salen en el chat" ayuda="Separados por coma. Se guardan tal como los escribes, para no teclearlos en cada revisión. Quien no esté en la lista se cuenta como cliente." name="equipo" rows={2} defaultValue={guardada.equipoNombres.join(', ')} />
          <Casilla name="resumenCorreo" defaultChecked={guardada.resumenCorreoHabilitado} etiqueta="Permitir que se mande el resumen por correo desde esta pantalla (sigue saliendo solo por clic)" />
        </div>
      </Disclosure>
      <div><BotonGuardar /></div>
      <div aria-live="polite">{resultado && <AvisoResultado estado={resultado} />}</div>
    </form>
  );
}
