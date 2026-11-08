import type { InfoTexto } from '../info-catalogo';
import { KindBadge } from '../graficas/kind-badge';

/**
 * Contenido del cajón ⓘ, en bloques al estilo Rovaq (`rv-ov-bloque`: padding 10x12, radio 8, borde 1 px `--line`, fondo blanco).
 * Pieza pura (sin estado ni funciones como props): sirve igual en servidor y en cliente.
 *
 * Bloques, en orden: Qué es · Cómo se calcula (texto en recuadro gris) · pares clave/valor `rv-ov-kv` (Fuente, Periodo, Cobertura) ·
 * Lo que no sabemos (lista) · Qué hacer con esto · Estado (solo «por confirmar») · sello «Clase de dato».
 * Todo campo opcional vacío o ausente se omite: nunca se pinta un hueco ni se inventa texto.
 */
export function ContenidoInfo({ texto }: { texto: InfoTexto }) {
  const limites = (texto.loQueNoSabemos ?? []).filter((x) => x.trim() !== '');
  const pares: Array<[string, string]> = [['Fuente', texto.fuente]];
  if (texto.periodo?.trim()) pares.push(['Periodo', texto.periodo]);
  if (texto.cobertura?.trim()) pares.push(['Cobertura', texto.cobertura]);
  return (
    <div className="rv-ov-info">
      <section className="rv-ov-bloque">
        <h3 className="rv-ov-bloque__tit">Qué es</h3>
        <p className="rv-ov-bloque__txt">{texto.queEs}</p>
      </section>
      <section className="rv-ov-bloque">
        <h3 className="rv-ov-bloque__tit">Cómo se calcula</h3>
        <p className="rv-ov-calculo">{texto.comoSeCalcula}</p>
      </section>
      <section className="rv-ov-bloque" aria-label="Procedencia">
        <dl className="rv-ov-kv">
          {pares.map(([k, v]) => (<div key={k} className="rv-ov-kv__fila"><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>
      {limites.length > 0 ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">Lo que no sabemos</h3>
          <ul className="rv-ov-lista">{limites.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      ) : null}
      {texto.queHacer ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">Qué hacer con esto</h3>
          <p className="rv-ov-bloque__txt">{texto.queHacer}</p>
        </section>
      ) : null}
      {texto.estado === 'por_confirmar' ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">Estado</h3>
          <p className="rv-ov-bloque__txt">Por confirmar: descripción provisional, aún sin lector verificado.</p>
        </section>
      ) : null}
      {texto.clase ? (
        <section className="rv-ov-bloque rv-ov-bloque--sello">
          <h3 className="rv-ov-bloque__tit">Clase de dato</h3>
          <KindBadge tipo={texto.clase} />
        </section>
      ) : null}
    </div>
  );
}
