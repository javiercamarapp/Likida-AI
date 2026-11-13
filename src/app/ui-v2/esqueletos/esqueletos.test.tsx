import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Aviso, Boton, Chip, Tarjeta } from '../componentes';
import {
  CajonVistaRapida, EsqueletoConfiguracion, EsqueletoFicha, EsqueletoPanelCifras, EsqueletoPortada, EsqueletoTablaMaestra, FilaConfig,
} from './index';

const reemplazar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, replace: reemplazar }) }));

const CIFRAS = [
  { etiqueta: 'Viajes del periodo', valor: 128 },
  { etiqueta: 'Liquidados', valor: 97 },
  { etiqueta: 'En cuadre', valor: null },
  { etiqueta: 'Abiertos', valor: 12 },
];
const orden = (html: string, ...marcas: string[]) => marcas.map((m) => html.indexOf(m));
const tieneGlifos = (t: string) => [...t].some((c) => { const n = c.codePointAt(0)!; return (n >= 0x1f000 && n <= 0x1faff) || (n >= 0x2600 && n <= 0x27bf); });
const crece = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

const TODOS = {
  portada: () => <EsqueletoPortada titulo="Resumen" apoyo="Lo que pasó." idTitulo="t" />,
  tabla: () => <EsqueletoTablaMaestra titulo="Viajes" idTitulo="t" />,
  panel: () => <EsqueletoPanelCifras titulo="Contador" idTitulo="t" />,
  ficha: () => <EsqueletoFicha titulo="Viaje V-1042" idTitulo="t" volver={{ href: '/dashboard/viajes', etiqueta: 'Volver a viajes' }} />,
  config: () => <EsqueletoConfiguracion titulo="Configuración" idTitulo="t" secciones={[]} />,
};

describe.each(Object.entries(TODOS))('esqueleto %s: estructura y accesibilidad', (_n, Esq) => {
  const html = renderToStaticMarkup(<Esq />);
  it('UN solo h1, dentro de UN solo <main> nombrado por él', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="t"');
    expect(html).toContain('aria-labelledby="t"');
  });
  it('sin estilos en línea, sin colores sueltos y sin emojis', () => {
    expect(html).not.toContain('style=');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(tieneGlifos(html)).toBe(false);
  });
});

describe('EsqueletoPortada', () => {
  const html = renderToStaticMarkup(
    <EsqueletoPortada
      etiquetaProcedencia="Procedencia" area="Resumen" titulo="Hoy" apoyo="Cuánto se movió." titular="Se liquidaron 97 de 128 viajes."
      filtros={<div id="f">filtros</div>}
      procedencia={<li>Fuentes 6 de 7</li>}
      avisos={<Aviso tono="info">Lectura parcial</Aviso>}
      cifras={CIFRAS}
      metodo="Mes parcial: no comparable."
    ><section id="bloques">bloques</section></EsqueletoPortada>,
  );
  it('el orden es el de Rovaq: cabecera, titular, filtros, procedencia, avisos, cifras, bloques, método', () => {
    expect(crece(orden(html, '<h1', 'rv-esq__titular', 'id="f"', 'rv-esq__procedencia', 'rv-esq__avisos', 'rv-kpis', 'id="bloques"', 'rv-esq__metodo'))).toBe(true);
  });
  it('la tira de cifras es una región con nombre y una celda sin dato dice «—», nunca 0', () => {
    expect(html).toContain('aria-label="Indicadores"'); // el nombre accesible por omisión es el de TiraCifras
    expect(html).toContain('—');
  });
  it('sin cifras no se pinta una tira vacía', () => {
    expect(renderToStaticMarkup(<EsqueletoPortada titulo="Hoy" />)).not.toContain('rv-kpis');
  });
  it('formaCifras="tarjetas" pinta una tarjeta suelta por cifra', () => {
    const t = renderToStaticMarkup(<EsqueletoPortada titulo="Plataforma" cifras={CIFRAS} formaCifras="tarjetas" />);
    expect(t).toContain('rv-esq__cifras-sueltas');
    expect(t.match(/class="rv-kpis/g)).toHaveLength(4);
  });
});

describe('EsqueletoTablaMaestra', () => {
  const html = renderToStaticMarkup(
    <EsqueletoTablaMaestra titulo="Viajes" filtros={<div id="f" />} avisos={<Aviso tono="warn">Revisión</Aviso>} cifras={CIFRAS} agrupacion={<div id="ag" />} pie="25 de 394" vistaRapida={<div id="vr" />}>
      <table id="t"><tbody /></table>
    </EsqueletoTablaMaestra>,
  );
  it('orden: filtros, avisos, cifras, agrupación, tabla, pie y, al final, el cajón', () => {
    expect(crece(orden(html, 'id="f"', 'rv-esq__avisos', 'rv-kpis', 'id="ag"', 'id="t"', 'rv-esq__tabla-pie', 'id="vr"'))).toBe(true);
  });
  it('el pie declara cuántas filas se ven («25 de 394»)', () => { expect(html).toContain('25 de 394'); });
  it('sin vistaRapida es una lista sin cajón', () => {
    expect(renderToStaticMarkup(<EsqueletoTablaMaestra titulo="Avisos" />)).not.toContain('dialog');
  });
});

describe('CajonVistaRapida', () => {
  const html = renderToStaticMarkup(
    <CajonVistaRapida titulo="Grupo 1" subtitulo="Grupo 1 de 12" hrefCerrar="/dashboard/viajes" aviso={<Aviso tono="info">La evidencia se verifica al abrir.</Aviso>} pie={<Boton variante="suave">Abrir viaje</Boton>}
      cifras={[{ etiqueta: 'Conversaciones', valor: '57' }, { etiqueta: 'Importe', valor: '—' }, { etiqueta: 'Severidad', valor: 'Media' }, { etiqueta: 'Cobertura', valor: '82 %' }]} />,
  );
  it('es un diálogo modal de 420 (tamaño m) nombrado por su título y descrito por el subtítulo', () => {
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-tamano="m"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain('Grupo 1 de 12');
  });
  it('2×2 de cifras: cuatro pares dt/dd; el dato que falta es «—», no 0', () => {
    expect(html.match(/<dt>/g)).toHaveLength(4);
    expect(html).toContain('<dd>—</dd>');
  });
  it('lleva la acción primaria en el pie, el aviso y el logo al pie del cajón', () => {
    expect(html).toContain('rv-esq__vr-pie');
    expect(html).toContain('Abrir viaje');
    expect(html).toContain('La evidencia se verifica al abrir.');
    expect(html).toContain('rv-ov__marca');
  });
});

describe('EsqueletoPanelCifras', () => {
  const g = (t: string) => <Tarjeta key={t} titulo={t}>x</Tarjeta>;
  it('reparte las gráficas en filas de 2 (6-6) y deja la última sola a lo ancho (12)', () => {
    const html = renderToStaticMarkup(<EsqueletoPanelCifras titulo="CFO" cifras={CIFRAS} graficas={[g('Ventas'), g('Reembolsos'), g('Por canal')]} />);
    expect(html.match(/data-variante="6-6"/g)).toHaveLength(1);
    expect(html.match(/data-variante="12"/g)).toHaveLength(1);
  });
  it('«Qué no se sabe» es una caja aparte, marcada para el borde punteado, con título propio', () => {
    const html = renderToStaticMarkup(<EsqueletoPanelCifras titulo="CFO" saberes={{ seSabe: { titulo: 'Qué se sabe', items: ['Viajes liquidados'] }, noSeSabe: { titulo: 'Qué no se sabe', items: ['Costo de casetas sin ticket'] } }} />);
    expect(html).toContain('data-no-sabe');
    expect(html).toContain('Qué no se sabe');
    expect(html.match(/<h3/g)).toHaveLength(2);
    expect(crece(orden(html, 'Qué se sabe', 'Qué no se sabe'))).toBe(true);
  });
  it('titular, filtros y cifras salen en su orden', () => {
    const html = renderToStaticMarkup(<EsqueletoPanelCifras titulo="CFO" titular="Se vendió más." filtros={<div id="f" />} cifras={CIFRAS} metodo="Método" />);
    expect(crece(orden(html, 'rv-esq__titular', 'id="f"', 'rv-kpis', 'rv-esq__metodo'))).toBe(true);
  });
});

describe('EsqueletoFicha', () => {
  const html = renderToStaticMarkup(
    <EsqueletoFicha etiquetaChips="Estado de la ficha" etiquetaResumen="Resumen" area="Ficha del viaje" titulo="V-1042" volver={{ href: '/dashboard/viajes', etiqueta: 'Volver a viajes' }} chips={<li><Chip tono="ok">Liquidado</Chip></li>} descripcion="Viaje de ejemplo." cifras={CIFRAS}
      bloques={[<Tarjeta key="a" titulo="Causa">x</Tarjeta>, <Tarjeta key="b" titulo="Por qué importa">x</Tarjeta>]}>
      <div id="rel" />
    </EsqueletoFicha>,
  );
  it('«Volver» es un enlace real a la lista de origen, a la derecha del encabezado', () => {
    expect(html).toMatch(/<a [^>]*href="\/dashboard\/viajes"[^>]*>Volver a viajes<\/a>/);
    expect(html.indexOf('rv-encabezado__acciones')).toBeLessThan(html.indexOf('Volver a viajes'));
  });
  it('orden: chips, cifras, bloques narrativos 6-6, relacionado', () => {
    expect(crece(orden(html, 'Estado de la ficha', 'rv-kpis', 'data-variante="6-6"', 'id="rel"'))).toBe(true);
  });
});

describe('EsqueletoConfiguracion', () => {
  const secciones = [
    { id: 'a', titulo: 'Datos de la flota', estado: { texto: 'Hecho', tono: 'ok' as const }, contenido: <FilaConfig rotulo="Razón social" ayuda="Como en tu constancia fiscal."><input aria-label="Razón social" /></FilaConfig>, pie: <Boton variante="suave">Guardar</Boton> },
    { id: 'b', titulo: 'Avisos', actual: true, quien: 'Solo el dueño', contenido: <FilaConfig rotulo="Correo"><input aria-label="Correo" /></FilaConfig> },
  ];
  it('secciones: cada una es una tarjeta con su h2, sus filas rótulo-control y su única acción en el pie', () => {
    const html = renderToStaticMarkup(<EsqueletoConfiguracion titulo="Configuración" secciones={secciones} progreso={{ hechos: 1, total: 2, etiqueta: '1 de 2 listas' }} contexto={<Aviso tono="info">Vista del dueño</Aviso>} />);
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(html).toContain('rv-esq__fila');
    expect(html).toContain('rv-esq__seccion-pie');
    expect(html).toContain('data-ancho="lectura"');
    expect(html).toMatch(/<progress[^>]*max="2"[^>]*value="1"|<progress[^>]*value="1"[^>]*max="2"/);
    expect(crece(orden(html, 'Vista del dueño', 'rv-esq__progreso', 'Datos de la flota'))).toBe(true);
  });
  it('pasos: el paso actual lleva aria-current="step" y el borde en tinta; los demás no', () => {
    const html = renderToStaticMarkup(<EsqueletoConfiguracion titulo="Puesta en marcha" variante="pasos" secciones={secciones} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/data-actual/g)).toHaveLength(1);
    expect(html).toContain('Solo el dueño');
  });
});
