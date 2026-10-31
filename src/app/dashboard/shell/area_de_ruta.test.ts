import { describe, it, expect } from 'vitest';
import { areaDeRuta, AREA_PIE, AREA_RESUMEN } from './area-de-ruta';
import { menuPorPerfil } from './menu-por-perfil';

// La etiqueta de área sobre el título sale del MISMO menú que pinta el sidebar para ese rol y perfil: nunca diverge.
describe('areaDeRuta', () => {
  const dueno = menuPorPerfil('flota_admin');
  const cinco = menuPorPerfil('flota_admin', 'cinco_agentes');

  it('el Resumen es «Resumen» y el pie es «Cuenta»', () => {
    expect(areaDeRuta('/dashboard', dueno)).toBe(AREA_RESUMEN);
    expect(areaDeRuta('/dashboard/notificaciones', dueno)).toBe(AREA_PIE);
  });

  it('una pantalla toma el título del grupo del menú que la contiene', () => {
    expect(areaDeRuta('/dashboard/viajes', dueno)).toBe('Operación');
    expect(areaDeRuta('/dashboard/facturacion', dueno)).toBe('Dinero y fiscal');
    expect(areaDeRuta('/dashboard/agentes/liquidacion', dueno)).toBe('Automatizaciones');
  });

  it('el MISMO destino cambia de área con el perfil cinco_agentes (como cambia el menú)', () => {
    expect(areaDeRuta('/dashboard/agentes/liquidacion', cinco)).toBe('Agentes');
    expect(areaDeRuta('/dashboard/llaves-api', cinco)).toBe('Cuenta y conexiones');
  });

  it('una subpágina hereda el área de su entrada de menú (prefijo más largo)', () => {
    expect(areaDeRuta('/dashboard/agentes/liquidacion/formato', dueno)).toBe('Automatizaciones');
    expect(areaDeRuta('/dashboard/carta-porte/documentos/abc', dueno)).toBe('Operación');
  });

  it('una ruta que no está en el menú del rol no inventa área (la pantalla pasa la suya)', () => {
    expect(areaDeRuta('/dashboard/ruta-que-no-existe', dueno)).toBeNull();
  });
});
