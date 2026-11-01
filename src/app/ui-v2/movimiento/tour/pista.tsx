'use client';

import { Boton } from '../../componentes/boton';
import { Ilustracion } from './ilustraciones';

// La pista contextual: una nota breve al abrir una pantalla que no está en el menú (subpantallas y detalles). Una vez por pantalla.
export function PistaContextual({ titulo, texto, ilu, desde, onEntendido, onNoVolver }: {
  titulo: string; texto: string; ilu: string; desde: string; onEntendido: () => void; onNoVolver: () => void;
}) {
  return (
    <section className="rv-onb-pista" role="region" aria-label={`Pista: ${titulo}`}>
      <div className="rv-sr" role="status">{`Pista: ${titulo}. ${texto}`}</div>
      <div className="rv-onb-pista__marco" aria-hidden="true"><Ilustracion nombre={ilu} /></div>
      <p className="rv-onb-pista__desde">Se abre desde {desde}</p>
      <h2>{titulo}</h2>
      <p>{texto}</p>
      <div className="rv-onb-acciones">
        <Boton variante="ghost" onClick={onNoVolver}>No volver a mostrar</Boton>
        <Boton variante="primary" onClick={onEntendido} data-onb-primario>Entendido</Boton>
      </div>
    </section>
  );
}
