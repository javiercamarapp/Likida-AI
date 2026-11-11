'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, Search } from 'lucide-react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import '../vigia.css';
import { AvisoResultado, Boton as BotonV2, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import type { EstadoRevisionUI, ResultadoEnvioUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { TablaSinAtender } from './tabla';

export type AccionRevisar = (previo: EstadoRevisionUI, fd: FormData) => Promise<EstadoRevisionUI>;
export type AccionEnviar = (previo: ResultadoEnvioUI | null, fd: FormData) => Promise<ResultadoEnvioUI>;

function Boton({ children, Ic, secundario, formAction }: { children: React.ReactNode; Ic: typeof Search; secundario?: boolean; formAction?: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" formAction={formAction} loading={pending} variante={secundario ? 'secondary' : 'primary'} icono={<Icono icono={Ic} tam={14} />}>
      {pending ? 'Un momento…' : children}
    </BotonV2>
  );
}

/** Los ajustes de esta revisión y, debajo, su resultado. Lo que se escribe aquí es una PRUEBA: vale para esta revisión y para el resumen que se mande desde aquí, y se suma a lo guardado en la configuración de la flota. */
export function FormaRevision({ revisar, enviar, flota, puedeEnviar, inicial }: {
  revisar: AccionRevisar; enviar: AccionEnviar; flota?: string; puedeEnviar: boolean; inicial: React.ReactNode;
}) {
  const [revision, despacharRevision] = useActionState(revisar, null);
  const [envio, despacharEnvio] = useActionState(enviar, null);
  return (
    <div className="rv-vg__pila">
      <form action={despacharRevision} className="rv-vg__pila" aria-describedby="sin-atender-aviso-prueba">
        {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
        <p id="sin-atender-aviso-prueba" className="rv-vg__nota">Lo que escribas aquí es solo una prueba y no se guarda: vale para esta revisión. Los campos vacíos usan lo que dejó guardado tu flota o, si no hay nada, sus plazos.</p>
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta="Plazo normal (min)" name="umbralMin" inputMode="numeric" />
          <CampoTexto etiqueta="Plazo de clientes críticos (min)" name="umbralCriticoMin" inputMode="numeric" />
          <CampoTexto etiqueta="Plazo de lo urgente (min)" name="umbralUrgenteMin" inputMode="numeric" />
          <CampoTexto etiqueta="Mensajes seguidos sin respuesta que cuentan como insistencia" name="insistenciaMin" inputMode="numeric" />
          <CampoTexto etiqueta="Ventana de insistencia (min)" name="insistenciaVentanaMin" inputMode="numeric" />
        </div>
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta="Palabras que marcan urgencia (separadas por coma)" name="palabrasUrgentes" />
          <CampoTexto etiqueta="Palabras de temas importantes (separadas por coma)" name="palabrasClave" placeholder="embarque" />
        </div>
        <CampoTexto etiqueta="Nombres de tu equipo, como salen en el chat (separados por coma)" name="equipo"
          ayuda="Se suman a los nombres que tu flota ya guardó. Sirve para corregir quién es del equipo sin volver a subir el chat." />
        {puedeEnviar && (
          <CampoTexto etiqueta="Fecha de corte para el resumen por correo (AAAA-MM-DD)" name="fechaCorte" inputMode="numeric" placeholder="AAAA-MM-DD"
            ayuda="No se avisa de conversaciones anteriores a este día." />
        )}
        <div className="rv-vg__linea">
          <Boton Ic={Search} secundario>Revisar con estos ajustes</Boton>
          {puedeEnviar && <Boton Ic={Mail} formAction={despacharEnvio}>Enviar resumen por correo</Boton>}
        </div>
        <div aria-live="polite">{envio && <AvisoResultado estado={envio} />}</div>
      </form>
      {revision === null ? inicial : revision.ok ? (
        <div className="rv-vg__pila" aria-live="polite">
          {revision.notas.map((n) => <p key={n} className="rv-vg__nota" data-tono="warn">{n}</p>)}
          <p className="rv-vg__nota">Resultado de esta revisión (no se guardó).</p>
          <TablaSinAtender alertas={revision.resultado.alertas} />
        </div>
      ) : <AvisoResultado estado={revision} />}
    </div>
  );
}
