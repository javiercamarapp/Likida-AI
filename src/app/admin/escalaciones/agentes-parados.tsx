import { Aviso, BotonEnlace, EstadoVacio, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import type { AgenteParado, AgentesParados } from '@/lib/admin/agentes-parados';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';
import { fechaHoraMx, numero } from '@/lib/formato';
import '../bandeja.css';

/** Cuántas filas se listan; el conteo de arriba es de TODOS los parados y se dice. */
export const TOPE_PARADOS = 50;

/** La causa estable del runner (`CausaSalto`) en palabras. Una causa desconocida se muestra tal cual, nunca se suaviza. */
const CAUSA: Record<string, string> = {
  contrapresion_bandeja: 'Frenado por la bandeja de aprobación',
  reloj: 'Cortado por el reloj de la vuelta',
  apagado: 'Apagado (palanca)',
  sin_presupuesto: 'Sin presupuesto diario declarado',
  techo_diario: 'Llegó a su techo diario',
  costo_no_medido: 'Costo no medido',
  pausa_por_fallos: 'En pausa por fallos seguidos',
  lectura_fallida: 'No se pudo leer su estado',
  experimental: 'Experimental',
  sin_motor: 'Sin motor despachable',
  otra: 'Otra causa',
};
export const etiquetaCausa = (c: string | null): string | null => (c === null ? null : (CAUSA[c] ?? c));

function haceHoras(h: number | null): string {
  if (h === null) return 'nunca ha corrido';
  if (h < 48) return `hace ${numero(h)} h`;
  return `hace ${numero(Math.floor(h / 24))} d`;
}

/** Pura. Cuántos parados hay por causa (los sin motivo cuentan aparte: «sin dato», no una causa inventada). */
export function contarPorCausa(parados: ReadonlyArray<AgenteParado>): { causa: string | null; n: number }[] {
  const m = new Map<string | null, number>();
  for (const p of parados) m.set(p.causa, (m.get(p.causa) ?? 0) + 1);
  return [...m.entries()].map(([causa, n]) => ({ causa, n })).sort((a, b) => b.n - a.n);
}

/**
 * «Agentes que no corrieron y por qué» (auditoría admin, P0 de visibilidad). Lee `getAgentesParados` (catálogo + última corrida +
 * saltados del último latido del runner). Lectura caída = se dice, NO «ningún agente parado». NO toca `LIKIDA_RUNNER_TOPE_BANDEJA_GLOBAL`:
 * la contrapresión es un freno correcto y aquí solo se hace visible, con la salida legítima (resolver la bandeja) enlazada.
 */
export function BloqueAgentesParados({ datos, cola }: { datos: AgentesParados | null; cola: ResumenBandejaCola | null }) {
  const titulo = <h2 className="bj-titulo" id="agentes-parados">Agentes que no corrieron y por qué</h2>;
  if (datos === null) {
    return (
      <section className="bj-bloque" aria-labelledby="agentes-parados">
        {titulo}
        <Aviso tono="warn">
          No se pudo leer el catálogo de agentes o sus corridas. No es que no haya agentes parados: esta lectura falló y puede haber agentes sin correr que aquí no se ven.
        </Aviso>
      </section>
    );
  }
  const { parados, habilitados, umbralHoras } = datos;
  if (parados.length === 0) {
    return (
      <section className="bj-bloque" aria-labelledby="agentes-parados">
        {titulo}
        <EstadoVacio titulo="Ningún agente parado">
          {habilitados === 0
            ? 'No hay agentes vivos con runner habilitado en el catálogo.'
            : `Los ${numero(habilitados)} agentes habilitados corrieron en las últimas ${numero(umbralHoras)} h.`}
        </EstadoVacio>
      </section>
    );
  }
  const filas = parados.slice(0, TOPE_PARADOS);
  const columnas: ColumnaBase<AgenteParado>[] = [
    { id: 'agente', titulo: 'Agente', principal: true, celda: (p) => p.nombre ?? p.agente },
    {
      id: 'ultima', titulo: 'Última corrida',
      celda: (p) => (p.ultimaCorrida ? `${fechaHoraMx(p.ultimaCorrida)} · ${haceHoras(p.horasSinCorrer)}` : 'Nunca ha corrido'),
    },
    {
      id: 'motivo', titulo: 'Por qué',
      celda: (p) => (p.causa === null && p.motivo === null
        ? (datos.latidoDelRunner === null
          ? 'Sin dato: no se pudo leer el latido del runner.'
          : 'Sin dato: no figura entre los saltados de la última vuelta del runner.')
        : <>{etiquetaCausa(p.causa)}{p.motivo ? <span className="bj-nota"> {p.motivo}</span> : null}</>),
    },
  ];
  const porCausa = contarPorCausa(parados);
  return (
    <section className="bj-bloque" aria-labelledby="agentes-parados">
      {titulo}
      <Aviso tono="warn">
        {numero(parados.length)} de {numero(habilitados)} agentes habilitados llevan más de {numero(umbralHoras)} h sin correr.{' '}
        Por causa: {porCausa.map((c) => `${etiquetaCausa(c.causa) ?? 'sin dato del motivo'} (${numero(c.n)})`).join(' · ')}.
      </Aviso>
      {cola?.frenaAlRunner && (
        <Aviso
          tono="error"
          titulo="La bandeja de aprobación está frenando a los agentes."
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">Ir a Aprobaciones</BotonEnlace>}
        >
          {numero(cola.pendientes)} piezas pendientes
          {cola.diasMasVieja !== null ? `; la más vieja lleva ${numero(Math.floor(cola.diasMasVieja))} días` : ''}.
          El tope del runner no se toca: lo que lo destraba es resolver la bandeja (hay un vaciado por lotes en Aprobaciones).
        </Aviso>
      )}
      <TablaBase etiqueta="Agentes que no corrieron" columnas={columnas} filas={filas} idFila={(p) => p.agente} densa />
      <p className="bj-nota">
        {parados.length > TOPE_PARADOS
          ? `Se listan los ${numero(TOPE_PARADOS)} que más llevan de ${numero(parados.length)}. `
          : ''}
        El motivo es el de la última vuelta del runner{datos.latidoDelRunner ? ` (${fechaHoraMx(datos.latidoDelRunner)})` : ''}; los nunca corridos van primero.
      </p>
    </section>
  );
}
