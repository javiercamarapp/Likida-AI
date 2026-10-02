import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./acciones-vinculacion', () => ({
  accionIniciarVinculacion: vi.fn(), accionCancelarVinculacion: vi.fn(), accionEstadoVinculacion: vi.fn(),
}));

const { SeccionPortales } = await import('./portales-vinculo');
const { VincularAsistida } = await import('./vincular-asistida');

// La pantalla del paso humano (0540): cada portal ofrece «Vincular con código» (no un enlace
// muerto que promete una vinculación que no existe), tanto sin vincular como vinculado
// (re-vincular), y el texto dice qué hace Likida y qué NO (no teclea, no resuelve retos).

const noop = (async () => null);
const fila = (estado: 'vinculado' | 'sin_vincular' | 'caducada') => ({
  clave: 'la_gas', nombre: 'La Gas', portal: 'https://portal.lagas.example/', estado,
  vinculadaEn: estado === 'sin_vincular' ? null : '2026-10-01T10:00:00Z', caducadaEn: estado === 'caducada' ? '2026-10-02T10:00:00Z' : null,
  motivo: null, relogin: null,
});

describe('SeccionPortales con la vinculación asistida', () => {
  for (const estado of ['sin_vincular', 'caducada', 'vinculado'] as const) {
    it(`${estado}: ofrece «Vincular con código»`, () => {
      const html = renderToStaticMarkup(<SeccionPortales filas={[fila(estado)]} vinculos autorizarRelogin={noop} revocarRelogin={noop} />);
      expect(html).toContain('Vincular con código');
      expect(html).not.toContain('Vincular ahora');
    });
  }
  it('la leyenda dice lo que Likida NO hace y no promete un botón mágico', () => {
    const html = renderToStaticMarkup(<SeccionPortales filas={[fila('sin_vincular')]} vinculos autorizarRelogin={noop} revocarRelogin={noop} />);
    expect(html).toMatch(/nunca tu\s+contraseña/);
    expect(html).toContain('un solo uso');
  });
  it('una sesión caducada se grita arriba de la lista', () => {
    const html = renderToStaticMarkup(<SeccionPortales filas={[fila('caducada')]} vinculos autorizarRelogin={noop} revocarRelogin={noop} />);
    expect(html).toContain('Se cayó la sesión de La Gas');
  });
  it('con la lectura caída dice que está ciega y NO enseña botones de vincular', () => {
    const html = renderToStaticMarkup(<SeccionPortales filas={[fila('sin_vincular')]} vinculos={false} autorizarRelogin={noop} revocarRelogin={noop} />);
    expect(html).toContain('esta pantalla está ciega');
    expect(html).not.toContain('Vincular con código');
  });
});

describe('VincularAsistida', () => {
  it('antes de pedir el código solo muestra el botón: ningún código ni comando a la vista', () => {
    const html = renderToStaticMarkup(<VincularAsistida clave="la_gas" nombre="La Gas" />);
    expect(html).toContain('Vincular con código');
    expect(html).not.toContain('--codigo');
  });
});
