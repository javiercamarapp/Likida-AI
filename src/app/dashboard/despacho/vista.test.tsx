import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaDespacho } from './vista';
import type { Pagina, ViajeEnCursoRow } from '@/lib/likida/repo_paginado';

// ═══════════════════════════════════════════════════════════════════════════
// FE-2 (auditoría 24): "En curso" ya no puede ser un recorte de 12 filas
// sacado de "los últimos 100 viajes creados" — a 500 viajes/día eso son
// ~30 minutos de operación y el viaje de ayer sin aceptar desaparecía sin
// dejar dónde reavisarlo. Esta prueba fija lo que reemplaza ese recorte: un
// `count` real (no `filas.length`) y un control para llegar al resto
// (buscador + paginación), no solo una leyenda que confiesa el tope.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async () => null;

function filaViaje(n: number): ViajeEnCursoRow {
  return {
    id: `v${n}`, folio: `F-${1000 + n}`, origen: 'León', destino: 'CDMX', estatus: 'abierto',
    operadorNombre: `Operador ${n}`, unidadId: null, unidadEco: null,
    fechaInicio: '2026-08-20', avisadoEn: null, aceptadoEn: null, escaladoEn: null, avisosEnviados: 0,
  };
}

function pintar(activos: Pagina<ViajeEnCursoRow>) {
  return renderToStaticMarkup(
    <VistaDespacho
      tablero={null}
      sinAsignar={[]}
      activos={activos}
      sufijo=""
      folioPedido=""
      buscarCatalogo={async () => []}
      totalOperadores={5}
      totalClientes={5}
      totalUnidades={5}
      carga={[]}
      crear={accionOk}
      asignarYAvisar={accionOk}
      asignarUnidadViaje={accionOk}
      reenviarAviso={accionOk}
      altaOperador={accionOk}
    />,
  );
}

describe('Despacho — "En curso" con count real y paginación (FE-2)', () => {
  it('con más filas de las que caben en una página, declara el total MEDIDO y ofrece "Siguiente"', () => {
    const activos: Pagina<ViajeEnCursoRow> = {
      filas: Array.from({ length: 25 }, (_, i) => filaViaje(i)),
      pagina: 1, porPagina: 25, total: 140, paginaMax: 200, truncada: false, error: null,
    };
    const html = pintar(activos);
    // El total es el MEDIDO (140), no la cuenta de filas de esta página (25).
    expect(html).toContain('140');
    expect(html).not.toMatch(/Se muestran 12/);
    expect(html).toContain('Siguiente');
  });

  it('sin más páginas, no ofrece "Siguiente" y sí "Anterior" desde la página 2', () => {
    const activos: Pagina<ViajeEnCursoRow> = {
      filas: [filaViaje(0)],
      pagina: 2, porPagina: 25, total: 26, paginaMax: 200, truncada: false, error: null,
    };
    const html = pintar(activos);
    expect(html).toContain('Anterior');
    expect(html).not.toContain('Siguiente');
  });

  it('trae el buscador por folio, no un catálogo completo', () => {
    const activos: Pagina<ViajeEnCursoRow> = {
      filas: [], pagina: 1, porPagina: 25, total: 0, paginaMax: 200, truncada: false, error: null,
    };
    const html = pintar(activos);
    expect(html).toContain('Buscar viaje en curso por folio');
  });

  it('lectura caída: dice que no se pudo leer, no pinta "ningún viaje en curso"', () => {
    const activos: Pagina<ViajeEnCursoRow> = {
      filas: [], pagina: 1, porPagina: 25, total: null, paginaMax: 200, truncada: false, error: 'timeout',
    };
    const html = pintar(activos);
    expect(html).toContain('No se pudo leer');
    expect(html).toContain('En curso');
    expect(html).not.toContain('Ningún viaje en curso ahora mismo');
  });
});
