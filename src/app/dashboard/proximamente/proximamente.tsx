import { Clock } from 'lucide-react';
import { Aviso, BotonEnlace, Chip, MarcoPagina } from '@/app/ui-v2/componentes';

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
    <MarcoPagina area="Próximamente" titulo={contenido.nombre} idTitulo="proximamente-titulo" ancho="lectura"
      acciones={<Chip><Clock width={12} height={12} strokeWidth={2} aria-hidden="true" /> Próximamente</Chip>}>
      <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{contenido.queHara}</p>
      <section className="rv-tarjeta">
        <h2 className="rv-tarjeta__titulo">Qué hará por tu operación</h2>
        <ul className="space-y-1.5 text-[14px] list-disc pl-5">
          {contenido.puntos.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>
      <Aviso tono="info">Todavía no está activo en tu cuenta: no muestra datos ni envía mensajes. Te avisaremos cuando esté listo.</Aviso>
      <div>
        <BotonEnlace href={hrefResumen}>Volver al Resumen</BotonEnlace>
      </div>
    </MarcoPagina>
  );
}
