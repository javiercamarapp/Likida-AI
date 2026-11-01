'use client';

import { Boton } from '../../componentes/boton';

// La invitación al recorrido (primer ingreso): Vexa pregunta el modo antes de empezar. Presentacional y sin estado.
// Nunca arranca sola: el recorrido solo empieza cuando la persona elige «corto» o «completo».
export function InvitacionRecorrido({ titulo, asistente, onElegir, onAhoraNo, onNoVolver }: {
  titulo: string;
  /** Nombre del asistente que sigue (Puesta en marcha / Arranque); null si el rol no lo ve. */
  asistente: string | null;
  onElegir: (modo: 'corto' | 'completo') => void;
  onAhoraNo: () => void;
  onNoVolver: () => void;
}) {
  return (
    <section className="rv-onb-inv" role="region" aria-label="Invitación al recorrido">
      <div className="rv-sr" role="status">Invitación: recorrido corto o completo de Likida.</div>
      <h2>Te enseño Likida en pocos minutos</h2>
      <p>
        Es el recorrido de «{titulo}». El corto cubre lo esencial; el completo pasa por cada pantalla de tu menú.
        {asistente ? ` Después te dejo en ${asistente}.` : ''} Puedes salir cuando quieras y volver desde Guía.
      </p>
      <div className="rv-onb-acciones">
        <Boton variante="ghost" onClick={onNoVolver}>No volver a mostrar</Boton>
        <Boton variante="secondary" onClick={onAhoraNo}>Ahora no</Boton>
        <Boton variante="secondary" onClick={() => onElegir('completo')}>Recorrido completo</Boton>
        <Boton variante="primary" onClick={() => onElegir('corto')} data-onb-primario>Recorrido corto</Boton>
      </div>
    </section>
  );
}
