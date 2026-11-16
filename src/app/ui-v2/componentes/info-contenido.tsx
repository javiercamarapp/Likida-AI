import type { InfoTexto } from '../info-catalogo';
import { KindBadge } from '../graficas/kind-badge';
import type { Idioma } from '@/lib/i18n/idioma';
import { idiomaUi } from './texto-ui';

/** Rótulos fijos del cajón por idioma (el texto de cada entrada viene del catálogo, ya en su idioma). */
const ROTULOS = {
  es: { queEs: 'Qué es', como: 'Cómo se calcula', procedencia: 'Procedencia', fuente: 'Fuente', periodo: 'Periodo', cobertura: 'Cobertura', noSabemos: 'Lo que no sabemos', queHacer: 'Qué hacer con esto', estado: 'Estado', provisional: 'Por confirmar: descripción provisional, aún sin lector verificado.', clase: 'Clase de dato' },
  en: { queEs: 'What it is', como: 'How it is calculated', procedencia: 'Provenance', fuente: 'Source', periodo: 'Period', cobertura: 'Coverage', noSabemos: 'What we don’t know', queHacer: 'What to do with this', estado: 'Status', provisional: 'To be confirmed: provisional description, no verified reader yet.', clase: 'Data type' },
} as const;

/**
 * Contenido del cajón ⓘ, en bloques al estilo Rovaq (`rv-ov-bloque`: padding 10x12, radio 8, borde 1 px `--line`, fondo blanco).
 * Pieza pura (sin estado ni funciones como props): sirve igual en servidor y en cliente.
 *
 * Bloques, en orden: Qué es · Cómo se calcula (texto en recuadro gris) · pares clave/valor `rv-ov-kv` (Fuente, Periodo, Cobertura) ·
 * Lo que no sabemos (lista) · Qué hacer con esto · Estado (solo «por confirmar») · sello «Clase de dato».
 * Todo campo opcional vacío o ausente se omite: nunca se pinta un hueco ni se inventa texto.
 */
export function ContenidoInfo({ texto, idioma: idiomaProp }: { texto: InfoTexto; idioma?: Idioma }) {
  const idioma = idiomaUi(idiomaProp);
  const r = ROTULOS[idioma];
  const limites = (texto.loQueNoSabemos ?? []).filter((x) => x.trim() !== '');
  const pares: Array<[string, string]> = [[r.fuente, texto.fuente]];
  if (texto.periodo?.trim()) pares.push([r.periodo, texto.periodo]);
  if (texto.cobertura?.trim()) pares.push([r.cobertura, texto.cobertura]);
  return (
    <div className="rv-ov-info">
      <section className="rv-ov-bloque">
        <h3 className="rv-ov-bloque__tit">{r.queEs}</h3>
        <p className="rv-ov-bloque__txt">{texto.queEs}</p>
      </section>
      <section className="rv-ov-bloque">
        <h3 className="rv-ov-bloque__tit">{r.como}</h3>
        <p className="rv-ov-calculo">{texto.comoSeCalcula}</p>
      </section>
      <section className="rv-ov-bloque" aria-label={r.procedencia}>
        <dl className="rv-ov-kv">
          {pares.map(([k, v]) => (<div key={k} className="rv-ov-kv__fila"><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>
      {limites.length > 0 ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">{r.noSabemos}</h3>
          <ul className="rv-ov-lista">{limites.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      ) : null}
      {texto.queHacer ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">{r.queHacer}</h3>
          <p className="rv-ov-bloque__txt">{texto.queHacer}</p>
        </section>
      ) : null}
      {texto.estado === 'por_confirmar' ? (
        <section className="rv-ov-bloque">
          <h3 className="rv-ov-bloque__tit">{r.estado}</h3>
          <p className="rv-ov-bloque__txt">{r.provisional}</p>
        </section>
      ) : null}
      {texto.clase ? (
        <section className="rv-ov-bloque rv-ov-bloque--sello">
          <h3 className="rv-ov-bloque__tit">{r.clase}</h3>
          <KindBadge tipo={texto.clase} idioma={idioma} />
        </section>
      ) : null}
    </div>
  );
}
