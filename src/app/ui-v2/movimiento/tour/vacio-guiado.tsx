import type { ReactNode } from 'react';
import type { Ilu } from '@/app/ui-v2/onboarding/tipos';
import { Ilustracion } from './ilustraciones';

// Estado vacío que ENSEÑA: dice qué falta, en cuántos pasos se llena y quién lo hace (SPEC 4). A diferencia del estado vacío
// común, lleva una ilustración chica y los pasos en orden. Texto real, sin cifras inventadas: lo que no se conoce se dice «por conectar».
export function VacioGuiado({ titulo, texto, pasos, ilu = 'lista', accion }: { titulo: string; texto: string; pasos: readonly string[]; ilu?: Ilu; accion?: ReactNode }) {
  return (
    <section className="rv-onb-vacio" role="status" aria-label={titulo}>
      <div className="rv-onb-vacio__marco" aria-hidden="true"><Ilustracion nombre={ilu} /></div>
      <h3 className="rv-onb-vacio__titulo">{titulo}</h3>
      <p className="rv-onb-vacio__texto">{texto}</p>
      {pasos.length > 0 ? (
        <ol className="rv-onb-vacio__pasos" aria-label="Cómo se llena">
          {pasos.map((p, i) => <li key={i}>{p}</li>)}
        </ol>
      ) : null}
      {accion ? <div className="rv-onb-vacio__accion">{accion}</div> : null}
    </section>
  );
}
