'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Boton, BotonEnlace } from './boton';
import { Campo } from './campos';
import { ChipFuente, type MarcaId } from './marca-integracion';
import { Drawer } from './overlay';

// ═══════════════════════════════════════════════════════════════════════════
// CAJÓN DE FILTROS (R8): botón «Filtros N» (32 px) que abre SIEMPRE el Drawer de 420. Cuerpo = <form method="get"> (funciona sin JS: el
// navegador manda los campos y la URL conserva el estado). «Aplicar» es el botón de envío del pie (atributo `form`). Todas las props son
// SERIALIZABLES (texto, números, listas, ReactNode ya armado): este módulo es 'use client' y lo importan componentes de servidor.
// Las opciones de moneda/fuentes las pasa la pantalla desde datos reales; aquí no se inventa ninguna.
// ═══════════════════════════════════════════════════════════════════════════

export interface SelectorCajon { nombre: string; etiqueta: string; valor: string; opciones: ReadonlyArray<{ valor: string; rotulo: string }> }
/** Criterio genérico del cajón: un select (con sus opciones reales) o un texto corto. */
export type CampoCajon =
  | ({ tipo: 'select' } & SelectorCajon)
  | { tipo: 'texto'; nombre: string; etiqueta: string; valor: string; maxLength?: number };
export interface FuenteCajon { valor: string; etiqueta: string; marca: MarcaId }

export interface PropsCajonFiltros {
  /** Ruta del GET («/dashboard/cfo»). */
  accion: string;
  /** Parámetros que el GET conserva (un <form> reemplaza el query entero). No incluyas `pagina`: reiniciarla es el comportamiento. */
  ocultos?: ReadonlyArray<readonly [string, string]>;
  /** A dónde vuelve «Limpiar». */
  limpiarHref: string;
  /** Filtros activos (contador del botón y del resumen). */
  nActivos: number;
  /** Texto del resumen tras «N filtros activos ·» («1 ago – 20 sep 2026 · USD»). */
  resumen?: string;
  titulo?: string;
  descripcion?: string;
  periodo?: {
    desde: string | null; hasta: string | null; etiquetaDesde?: string; etiquetaHasta?: string; min?: string; max?: string;
    nombreDesde?: string; nombreHasta?: string;
    /** El parámetro de periodo (`periodo`): `actual` viaja si no hay fechas; con alguna fecha viaja `personalizado`. */
    modo?: { nombre: string; actual: string; personalizado: string };
  };
  /** Otros criterios reales de la pantalla (estado, patio, cliente, unidad…), bajo el título `tituloCampos` («Criterios» por omisión). */
  campos?: { titulo?: string; items: readonly CampoCajon[] };
  monedaBase?: { moneda?: SelectorCajon; base?: SelectorCajon };
  fuentes?: { nombre: string; titulo?: string; opciones: readonly FuenteCajon[]; seleccionadas: readonly string[] };
  texto?: { nombre: string; titulo: string; etiqueta: string; valor: string; ayuda?: string; placeholder?: string; filas?: number };
  /** Bloque plegable «Avanzado» (ReactNode ya armado, con campos de la misma forma). */
  avanzado?: ReactNode;
  nota?: string;
  /** Nace abierto (pruebas de servidor, que no pueden hacer clic; o un enlace profundo). Por omisión, cerrado. */
  abiertoInicial?: boolean;
}

const SECCION = 'rv-cajon__sec';

export function CajonFiltros(p: PropsCajonFiltros) {
  const [abierto, setAbierto] = useState(p.abiertoInicial ?? false);
  const idForma = useId();
  const nombreDesde = p.periodo?.nombreDesde ?? 'desde';
  const nombreHasta = p.periodo?.nombreHasta ?? 'hasta';

  // Antes de enviar: sin fechas, selects ni textos vacíos en la URL; con alguna fecha, el modo pasa a «personalizado».
  const alEnviar = (e: FormEvent<HTMLFormElement>) => {
    const f = e.currentTarget;
    const campos = [...f.elements].filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'text')) || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement);
    const hayFechas = campos.some((c) => (c.name === nombreDesde || c.name === nombreHasta) && c.value !== '');
    const modo = p.periodo?.modo;
    const oculto = modo ? f.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(modo.nombre)}"]`) : null;
    if (modo && oculto) oculto.value = hayFechas ? modo.personalizado : modo.actual;
    const apagados = campos.filter((c) => c.value === '' && !c.disabled);
    for (const c of apagados) c.disabled = true;
    setTimeout(() => { for (const c of apagados) c.disabled = false; }, 0);
  };

  const selector = (s: SelectorCajon) => (
    <Campo etiqueta={s.etiqueta}>
      <select name={s.nombre} defaultValue={s.valor}>
        {s.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </Campo>
  );

  return (
    <>
      <button type="button" className="rv-bp__filtros" data-activo={p.nActivos > 0 ? '' : undefined} aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto(true)}>
        <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} />
        <span>Filtros</span>
        {p.nActivos > 0 ? <span className="rv-bp__n" aria-label={`${p.nActivos} activos`}>{p.nActivos}</span> : null}
      </button>
      {abierto ? (
        <Drawer
          abierto
          onCerrar={() => setAbierto(false)}
          titulo={p.titulo ?? 'Filtros'}
          descripcion={p.descripcion}
          pie={<>
            <BotonEnlace href={p.limpiarHref} variante="secondary">Limpiar</BotonEnlace>
            <Boton type="submit" form={idForma} variante="suave">Aplicar</Boton>
          </>}
        >
          <form id={idForma} method="get" action={p.accion} className="rv-cajon" onSubmit={alEnviar}>
            {p.periodo?.modo ? <input type="hidden" name={p.periodo.modo.nombre} value={p.periodo.modo.actual} readOnly /> : null}
            {(p.ocultos ?? []).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

            <p className="rv-cajon__resumen" role="status">
              <strong>{p.nActivos === 0 ? 'Sin filtros activos' : `${p.nActivos} ${p.nActivos === 1 ? 'filtro activo' : 'filtros activos'}`}</strong>
              {p.resumen ? <> · {p.resumen}</> : null}
            </p>

            {p.periodo ? (
              <section className={SECCION} aria-labelledby={`${idForma}-per`}>
                <h3 id={`${idForma}-per`} className="rv-cajon__tit">Periodo</h3>
                <div className="rv-cajon__par">
                  <Campo etiqueta={p.periodo.etiquetaDesde ?? 'Desde'}><input type="date" name={nombreDesde} defaultValue={p.periodo.desde ?? ''} min={p.periodo.min} max={p.periodo.max} /></Campo>
                  <Campo etiqueta={p.periodo.etiquetaHasta ?? 'Hasta'}><input type="date" name={nombreHasta} defaultValue={p.periodo.hasta ?? ''} min={p.periodo.min} max={p.periodo.max} /></Campo>
                </div>
              </section>
            ) : null}

            {p.monedaBase && (p.monedaBase.moneda || p.monedaBase.base) ? (
              <section className={SECCION} aria-labelledby={`${idForma}-mon`}>
                <h3 id={`${idForma}-mon`} className="rv-cajon__tit">Moneda y base</h3>
                <div className="rv-cajon__par">
                  {p.monedaBase.moneda ? selector(p.monedaBase.moneda) : null}
                  {p.monedaBase.base ? selector(p.monedaBase.base) : null}
                </div>
              </section>
            ) : null}

            {p.campos && p.campos.items.length > 0 ? (
              <section className={SECCION} aria-labelledby={`${idForma}-cri`}>
                <h3 id={`${idForma}-cri`} className="rv-cajon__tit">{p.campos.titulo ?? 'Criterios'}</h3>
                <div className="rv-cajon__par">
                  {p.campos.items.map((c) => c.tipo === 'select' ? <div key={c.nombre}>{selector(c)}</div> : (
                    <Campo key={c.nombre} etiqueta={c.etiqueta}><input type="text" name={c.nombre} defaultValue={c.valor} maxLength={c.maxLength ?? 60} /></Campo>
                  ))}
                </div>
              </section>
            ) : null}

            {p.fuentes && p.fuentes.opciones.length > 0 ? (
              <section className={SECCION} aria-labelledby={`${idForma}-fue`}>
                <h3 id={`${idForma}-fue`} className="rv-cajon__tit">{p.fuentes.titulo ?? 'Fuentes'}</h3>
                <div className="rv-cajon__fuentes">
                  {p.fuentes.opciones.map((o) => (
                    <ChipFuente key={o.valor} id={o.marca} etiqueta={o.etiqueta} name={p.fuentes!.nombre} value={o.valor} activo={p.fuentes!.seleccionadas.includes(o.valor)} />
                  ))}
                </div>
                <p className="rv-cajon__ayuda">Sin selección se incluyen todas.</p>
              </section>
            ) : null}

            {p.texto ? (
              <section className={SECCION} aria-labelledby={`${idForma}-txt`}>
                <h3 id={`${idForma}-txt`} className="rv-cajon__tit">{p.texto.titulo}</h3>
                <Campo etiqueta={p.texto.etiqueta} ayuda={p.texto.ayuda}>
                  <textarea name={p.texto.nombre} defaultValue={p.texto.valor} rows={p.texto.filas ?? 4} placeholder={p.texto.placeholder} />
                </Campo>
              </section>
            ) : null}

            {p.avanzado ? (
              <section className={SECCION} aria-labelledby={`${idForma}-ava`}>
                <h3 id={`${idForma}-ava`} className="rv-cajon__tit">Avanzado</h3>
                <details className="rv-cajon__avanzado">
                  <summary>Mostrar opciones avanzadas</summary>
                  <div className="rv-cajon__avanzado-cuerpo">{p.avanzado}</div>
                </details>
              </section>
            ) : null}

            <p className="rv-cajon__nota">{p.nota ?? 'Cambiar filtros reinicia la paginación.'}</p>
            <button type="submit" className="rv-sr" tabIndex={-1} aria-hidden="true">Aplicar</button>
          </form>
        </Drawer>
      ) : null}
    </>
  );
}

