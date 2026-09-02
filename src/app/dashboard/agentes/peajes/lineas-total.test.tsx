import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAgentePeajes } from './vista';
import type { ColaPorConciliar, LineaPorConciliar } from '@/lib/likida/analytics';

// `SubirDesglose` llama `useRouter()` (refresh tras subir) — el render
// estático de prueba no monta el App Router. Mismo doble que
// `agentes/proveedores/vista.test.tsx`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ═══════════════════════════════════════════════════════════════════════════
// FE-10 (auditoría 24): "Esperan a un humano" pintaba `lineas.length` (tope
// 200, `LINEAS_POR_CONCILIAR_TOPE`) como si fuera el total pendiente,
// ignorando el `.total` MEDIDO que `getLineasPorConciliar` ya trae en la
// misma respuesta. A un TAG de 800 tractos con decenas de miles de
// cruces/mes, "y 194 más" siempre decía lo mismo sin importar cuántas
// hubiera de verdad.
// ═══════════════════════════════════════════════════════════════════════════

function linea(n: number): LineaPorConciliar {
  return {
    id: `l${n}`, cfdiUuid: null, indice: n, fuente: 'concepto_base',
    fecha: '2026-08-20', monto: 100, descripcion: `Línea ${n}`,
    estacionRfc: null, folioOperacion: null, candidatos: [],
  };
}

const accionOk = async () => null;

function pintar(lineas: ColaPorConciliar) {
  return renderToStaticMarkup(
    <VistaAgentePeajes
      conciliacion={null}
      lineas={lineas}
      desgloses={null}
      peajeAcreditable={null}
      sufijo=""
      subirDesglose={accionOk}
      ejecutarAhora={accionOk}
      desglosesProveedor={null}
      desgloseSeleccionado={null}
      detalleSeleccionado={null}
      evidenciaGps={null}
      importarDesglose={accionOk}
      conciliarDesglose={accionOk}
    />,
  );
}

describe('Peajes — "Esperan a un humano" con el total MEDIDO (FE-10)', () => {
  it('con 200 líneas topadas pero 1,340 en total, declara el total real', () => {
    const lineas = Object.assign(Array.from({ length: 200 }, (_, i) => linea(i)), { total: 1_340 }) as ColaPorConciliar;
    const html = pintar(lineas);
    // "y N más en la mesa" con N = total - 6 filas mostradas (1,340 - 6).
    expect(html).toContain('1,334');
    // El bug era `lineas.length - 6` (200 - 6 = 194): no debe reaparecer.
    expect(html).not.toContain('194 más');
  });
});
