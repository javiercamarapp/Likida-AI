import { Clock } from 'lucide-react';
import { BotonEnlace, Chip, EstadoVacio, MarcoPagina } from '@/app/ui-v2/componentes';
import './proximamente.css';

/** Lo que muestra la pantalla «Próximamente» de un módulo: texto fijo, jamás datos de la flota. */
export interface ContenidoProximamente {
  /** El nombre con el que el módulo aparece en el menú. */
  nombre: string;
  /** Una frase: qué hará el agente por la flota. */
  queHara: string;
  /** Lo concreto que va a hacer (3 a 5 renglones cortos). */
  puntos: readonly string[];
}

/**
 * LA PANTALLA ÚNICA «PRÓXIMAMENTE» (fase 1 del perfil `cinco_agentes`).
 *
 * Un módulo que ya existe en el producto pero todavía no se enciende para esta
 * cuenta enseña QUÉ HARÁ, sin datos, sin botones de acción y sin formularios: es
 * un componente de PRESENTACIÓN. No consulta nada ni recibe nada de la flota; por
 * eso no puede filtrar un dato ni disparar un envío (la prueba
 * `proximamente.test.ts` lo exige sobre el fuente).
 */
export function Proximamente({ contenido, hrefResumen }: { contenido: ContenidoProximamente; hrefResumen: string }) {
  return (
    <MarcoPagina area="Próximamente" titulo={contenido.nombre} idTitulo="proximamente-titulo" apoyo={contenido.queHara}
      acciones={<Chip><Clock width={12} height={12} strokeWidth={2} aria-hidden="true" /> Próximamente</Chip>}>
      {/* Vacío de página (Rovaq): borde sólido de 12, icono, título, qué hará (lista corta) y UNA acción. */}
      <EstadoVacio pantalla icono={Clock} titulo="Qué hará por tu operación"
        accion={<BotonEnlace href={hrefResumen} variante="secondary" tamano="sm">Volver al Resumen</BotonEnlace>}>
        <ul className="rv-prox__puntos">
          {contenido.puntos.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <span className="rv-prox__nota">Todavía no está activo en tu cuenta: no muestra datos ni envía mensajes. Te avisaremos cuando esté listo.</span>
      </EstadoVacio>
    </MarcoPagina>
  );
}
