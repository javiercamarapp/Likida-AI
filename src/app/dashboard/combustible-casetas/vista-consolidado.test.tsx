import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineasPorConciliar, NINGUNO_VALOR } from './vista-consolidado';
import type { LineaPorConciliar } from '@/lib/likida/analytics';

const linea = (n: number): LineaPorConciliar => ({
  id: 'l-1', cfdiUuid: null, indice: 1, fuente: 'ecc12', fecha: '2026-10-01', monto: 500, descripcion: null, estacionRfc: null, folioOperacion: null,
  candidatos: Array.from({ length: n }, (_, i) => ({ gastoId: `g-${i + 1}`, viajeFolio: `V${i + 1}`, monto: 500, fecha: '2026-10-01' })) as LineaPorConciliar['candidatos'],
});
const html = (n: number) => renderToStaticMarkup(<LineasPorConciliar lineas={[linea(n)]} accion={async () => {}} />);

// A37-S17-01: con varios candidatos empatados el sistema no adivina cuál: ningún gasto viene preseleccionado.
describe('LineasPorConciliar: la elección no se adivina', () => {
  it('con dos o más candidatos no preselecciona el primero: hay un «Elige…» vacío y el select es obligatorio', () => {
    const h = html(2);
    expect(h).toMatch(/<select[^>]*required/);
    expect(h).toMatch(/<option[^>]*value=""[^>]*>Elige con qué gasto ligar/);
    expect(/<option[^>]*>Elige con qué gasto ligar/.exec(h)![0]).toContain('selected');
    expect(h).not.toMatch(/<option[^>]*value="g-1"[^>]*selected/);
  });

  it('con un solo candidato sí viene elegido (no hay empate que adivinar)', () => {
    expect(html(1)).toMatch(/<option[^>]*value="g-1"[^>]*selected|<option selected=""[^>]*value="g-1"/);
  });

  it('sin candidatos lo único posible es «Ninguno»', () => {
    expect(html(0)).toContain(`value="${NINGUNO_VALOR}"`);
  });
});
