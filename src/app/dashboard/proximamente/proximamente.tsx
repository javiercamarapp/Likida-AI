import Link from 'next/link';
import { Clock } from 'lucide-react';
import { BarraPagina } from '../resumen-visual';

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
    <>
      <BarraPagina icono={<Clock width={14} height={14} strokeWidth={1.75} aria-hidden="true" />} titulo={contenido.nombre} />
      <main className="px-5 py-8 max-w-2xl" aria-labelledby="proximamente-titulo">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
          style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
          <Clock width={12} height={12} strokeWidth={2} aria-hidden="true" /> Próximamente
        </p>
        <h1 id="proximamente-titulo" className="mt-3 text-xl font-semibold">{contenido.nombre}</h1>
        <p className="mt-2 text-[14px]" style={{ color: 'var(--muted)' }}>{contenido.queHara}</p>
        <h2 className="mt-6 text-[13px] font-semibold">Qué hará por tu operación</h2>
        <ul className="mt-2 space-y-1.5 text-[14px] list-disc pl-5">
          {contenido.puntos.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="mt-6 text-[13px]" style={{ color: 'var(--muted)' }}>
          Todavía no está activo en tu cuenta: no muestra datos ni envía mensajes. Te avisaremos cuando esté listo.
        </p>
        <Link href={hrefResumen} className="hairline inline-block mt-6 rounded-lg px-3 py-1.5 text-[13px] transition-colors hover:bg-[var(--canvas)]">
          Volver al Resumen
        </Link>
      </main>
    </>
  );
}
