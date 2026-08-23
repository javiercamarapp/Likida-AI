'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OpcionCatalogo, TipoCatalogo } from '@/lib/likida/repo';
import { numero } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO QUE NO VIAJA (FE-2, 22-ago-2026)
//
// Un `<select>` con el catálogo completo tiene dos modos de falla que crecen
// juntos: a 7,500 choferes PostgREST recortaba la lista a 1,000 EN SILENCIO
// (el chofer 1,001 no existía para el despacho) y ese mismo catálogo se
// pintaba UNA VEZ POR FILA — doce filas × 7,500 `<option>` = ~1.5-2 MB de
// HTML por carga, para elegir UNO.
//
// Aquí no viaja ningún catálogo. Viaja un BUSCADOR: una server action que el
// host pasa como prop (el tenant va por closure del render, nunca desde el
// cliente — el mismo patrón que las acciones de Despacho) y que devuelve a lo
// más 20 opciones. La lista se pide al enfocar y al escribir, con freno de
// 200 ms; el `<datalist>` de cada combo tiene 20 `<option>` como máximo, así
// que doce filas cuestan 240 opciones en el peor caso y CERO al cargar.
//
// EL VALOR QUE SE MANDA ES EL id, NO EL TEXTO. El `<input>` visible es el
// buscador; el `name` del formulario lo lleva un `<input type="hidden">` que
// solo se llena cuando lo tecleado coincide EXACTAMENTE con una opción
// ofrecida. Un texto que no coincide manda id vacío a propósito: la acción
// del servidor ya rechaza eso con su mensaje ("Elige un operador…"), y
// adivinar a quién se refería un nombre a medias es justo la clase de
// suposición que este panel no hace. La pista de abajo lo dice en pantalla
// antes de que el usuario apriete el botón.
// ═══════════════════════════════════════════════════════════════════════════

/** La búsqueda del servidor, tal como la reciben los formularios. El host la
 *  define como server action y la pasa a todas las filas: una sola referencia
 *  para N combos. */
export type BuscarCatalogo = (tipo: TipoCatalogo, q: string) => Promise<OpcionCatalogo[]>;

/** Milisegundos de quietud antes de preguntarle al servidor. Suficiente para
 *  que teclear "Hernández" sea UNA consulta y no nueve. */
const FRENO_MS = 200;

export function ComboCatalogo({
  tipo, name, buscar, etiquetaVacia, requerido = false, valorInicial = null,
  textoInicial = '', total = null, className, estilo, autoComplete = 'off', 'aria-label': ariaLabel,
  campoId,
}: {
  tipo: TipoCatalogo;
  /** El `name` del campo del formulario — lo lleva el hidden con el id. */
  name: string;
  buscar: BuscarCatalogo;
  /** Qué dice el placeholder cuando no hay nada elegido. */
  etiquetaVacia: string;
  requerido?: boolean;
  /** id ya elegido (una fila que YA trae unidad, por ejemplo). */
  valorInicial?: string | null;
  /** El texto que corresponde a `valorInicial` — se pinta sin pedir nada. */
  textoInicial?: string;
  /** Cuántos hay en total, si el host lo contó. Se enseña como pista: "20 de
   *  7,500" es la diferencia entre una lista y una muestra. `null` = no se
   *  pudo contar, y entonces no se afirma ninguna cifra. */
  total?: number | null;
  className?: string;
  /** El `style` del input visible — los campos del panel pintan su fondo con
   *  variables de marca (`var(--surface)`), no con clases. */
  estilo?: React.CSSProperties;
  autoComplete?: string;
  'aria-label'?: string;
  /** `id` del input VISIBLE, para que el `<label htmlFor>` del host siga
   *  apuntando a algo enfocable — el hidden que lleva el `name` no lo es. */
  campoId?: string;
}) {
  const listaId = useId();
  const [texto, setTexto] = useState(textoInicial);
  const [id, setId] = useState<string | null>(valorInicial);
  const [opciones, setOpciones] = useState<OpcionCatalogo[]>([]);
  const [fallo, setFallo] = useState(false);
  // El número de la petición en vuelo: una respuesta vieja que llega tarde no
  // puede pisar a una nueva (la carrera clásica del autocompletado).
  const vuelo = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pedir = useCallback((q: string) => {
    const mio = ++vuelo.current;
    buscar(tipo, q)
      .then((r) => { if (vuelo.current === mio) { setOpciones(r); setFallo(false); } })
      // Fallar CERRADO: sin sugerencias se dice que no se pudo buscar, en vez
      // de dejar un combo mudo que se lee como "no hay ninguno".
      .catch(() => { if (vuelo.current === mio) { setOpciones([]); setFallo(true); } });
  }, [buscar, tipo]);

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  const alEscribir = (v: string) => {
    setTexto(v);
    // El id se resuelve contra lo que el SERVIDOR ofreció, nunca contra lo
    // tecleado: así el formulario no puede mandar un id que el usuario no vio.
    const coincide = opciones.find((o) => o.etiqueta.toLowerCase() === v.trim().toLowerCase());
    setId(coincide ? coincide.id : null);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => pedir(v), FRENO_MS);
  };

  const sinResolver = texto.trim() !== '' && id === null;

  return (
    <div>
      <input type="hidden" name={name} value={id ?? ''} />
      <input
        id={campoId}
        type="text"
        role="combobox"
        aria-controls={listaId}
        aria-expanded={opciones.length > 0}
        aria-label={ariaLabel}
        list={listaId}
        value={texto}
        required={requerido}
        autoComplete={autoComplete}
        placeholder={etiquetaVacia}
        onFocus={() => { if (opciones.length === 0) pedir(texto); }}
        onChange={(e) => alEscribir(e.target.value)}
        className={className}
        style={estilo}
      />
      <datalist id={listaId}>
        {opciones.map((o) => <option key={o.id} value={o.etiqueta} />)}
      </datalist>
      {fallo ? (
        <p className="text-[11px] mt-1" style={{ color: 'var(--bad)' }}>
          No se pudo buscar en el catálogo — vuelve a escribir en un momento.
        </p>
      ) : sinResolver ? (
        <p className="text-[11px] mt-1" style={{ color: 'var(--warn)' }}>
          Elige uno de la lista: se guarda el registro, no el texto.
        </p>
      ) : total !== null && total > opciones.length && opciones.length > 0 ? (
        <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
          {numero(opciones.length)} sugerencia{opciones.length === 1 ? '' : 's'} de {numero(total)} — escribe para acotar.
        </p>
      ) : null}
    </div>
  );
}
