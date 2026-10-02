import { describe, it, expect } from 'vitest';
import { huellaDeGuion, estadoVerificacion, guionConVerificacion, validarRegistro, aplicarEntrada, sha256Texto, type EntradaVerificacion } from './verificacion';
import { GUIONES } from '../facturacion/adaptadores/portales';
import { REGISTRO_VERIFICACIONES } from './registro_verificaciones';
import type { GuionPortal } from '../facturacion/adaptadores/guion';

// El estado «verificado» se CALCULA desde el registro con evidencia, no se escribe a mano:
// una entrada vale solo para la tabla de selectores que midió (huella), y sin evidencia no entra.

const G: GuionPortal = {
  comercio: 'prueba', portal: 'https://portal.example/', verificado: null,
  campos: { numeroTicket: { selector: ['#t'] } },
  receptor: { rfc: { selector: '#rfc' } },
  botonEmitir: ['button'], uuid: '.uuid',
};
const entrada = (g: GuionPortal, extra: Partial<EntradaVerificacion> = {}): EntradaVerificacion => ({
  fecha: '2026-10-02', nivel: 'prevuelo', huellaGuion: huellaDeGuion(g), arnes: 'scripts/verificar-portal.mjs',
  resueltos: ['campo del ticket · numeroTicket'], confirmadoPor: 'Javier',
  evidencia: { reporte: 'pruebas-manuales/verificacion-portales/prueba/2026-10-02/reporte.txt', sha256: sha256Texto('reporte') }, ...extra,
});

describe('la huella de un guion', () => {
  it('es estable, ignora el orden de llaves y los metadatos (verificado, lecturaDeCampo)', () => {
    const reordenado: GuionPortal = { botonEmitir: ['button'], uuid: '.uuid', receptor: { rfc: { selector: '#rfc' } }, campos: { numeroTicket: { selector: ['#t'] } }, portal: 'https://portal.example/', verificado: null, comercio: 'prueba' };
    expect(huellaDeGuion(reordenado)).toBe(huellaDeGuion(G));
    expect(huellaDeGuion({ ...G, lecturaDeCampo: { fecha: '2026-01-01', acta: 'x' }, verificado: { fecha: 'x', arnes: 'x', resueltos: [] } })).toBe(huellaDeGuion(G));
  });
  it('cambia con CUALQUIER selector, botón, URL o campo', () => {
    const h = huellaDeGuion(G);
    expect(huellaDeGuion({ ...G, portal: 'https://otro.example/' })).not.toBe(h);
    expect(huellaDeGuion({ ...G, botonEmitir: ['button.nuevo'] })).not.toBe(h);
    expect(huellaDeGuion({ ...G, campos: { numeroTicket: { selector: ['#t2'] } } })).not.toBe(h);
    expect(huellaDeGuion({ ...G, uuid: '.otro' })).not.toBe(h);
    expect(huellaDeGuion({ ...G, requiereSesion: true })).not.toBe(h);
  });
});

describe('estado y derivación', () => {
  it('sin entrada: no verificado; con la huella vigente: verificado; con otra tabla: obsoleto', () => {
    expect(estadoVerificacion(G, {}).estado).toBe('no_verificado');
    expect(estadoVerificacion(G, { prueba: entrada(G) }).estado).toBe('verificado');
    const cambiado = { ...G, botonEmitir: ['button.nuevo'] };
    expect(estadoVerificacion(cambiado, { prueba: entrada(G) }).estado).toBe('obsoleto');
  });
  it('el motor lee `verificado` DERIVADO del registro: uno obsoleto o ausente vuelve a null', () => {
    expect(guionConVerificacion(G, {}).verificado).toBeNull();
    expect(guionConVerificacion(G, { prueba: entrada(G) }).verificado).toMatchObject({ fecha: '2026-10-02', arnes: 'scripts/verificar-portal.mjs' });
    expect(guionConVerificacion({ ...G, uuid: '.otro' }, { prueba: entrada(G) }).verificado).toBeNull();
  });
  it('un `verificado` escrito a mano en el guion NO cuenta: solo el registro con evidencia gradúa', () => {
    const aMano: GuionPortal = { ...G, verificado: { fecha: '2026-10-02', arnes: 'a mano', resueltos: ['x'] } };
    expect(guionConVerificacion(aMano, {}).verificado).toBeNull();
  });
});

describe('validarRegistro: no se pega una entrada sin visita', () => {
  const sha = sha256Texto('reporte');
  const leerBien = (r: string) => (r.endsWith('reporte.txt') ? sha : null);
  it('una entrada completa y con evidencia que coincide es válida', () => {
    expect(validarRegistro({ prueba: entrada(G) }, [G], leerBien)).toEqual([]);
  });
  it('sin quién confirmó, sin evidencia, con evidencia inexistente o ALTERADA, o de un guion que no existe: se rechaza', () => {
    expect(validarRegistro({ prueba: entrada(G, { confirmadoPor: '' }) }, [G], leerBien).join()).toMatch(/confirm/);
    expect(validarRegistro({ prueba: entrada(G, { evidencia: { reporte: '', sha256: '' } }) }, [G], leerBien).join()).toMatch(/sin evidencia/);
    expect(validarRegistro({ prueba: entrada(G) }, [G], () => null).join()).toMatch(/no existe en el repo/);
    expect(validarRegistro({ prueba: entrada(G) }, [G], () => sha256Texto('editado después')).join()).toMatch(/cambió después/);
    expect(validarRegistro({ fantasma: entrada(G) }, [G], leerBien).join()).toMatch(/no existe un guion/);
    expect(validarRegistro({ prueba: entrada(G, { resueltos: [] }) }, [G], leerBien).join()).toMatch(/ningún chequeo/);
    expect(validarRegistro({ prueba: entrada(G, { fecha: 'ayer' }) }, [G], leerBien).join()).toMatch(/fecha inválida/);
  });
});

describe('aplicarEntrada', () => {
  it('pone o reemplaza SOLO la entrada de ese comercio, ordenado, y conserva el resto', () => {
    const base = JSON.stringify({ _formato: 'x', verificaciones: { zeta: entrada({ ...G, comercio: 'zeta' }) } });
    const nuevo = JSON.parse(aplicarEntrada(base, 'prueba', entrada(G)));
    expect(Object.keys(nuevo.verificaciones)).toEqual(['prueba', 'zeta']);
    expect(nuevo._formato).toBe('x');
    const otra = JSON.parse(aplicarEntrada(JSON.stringify(nuevo), 'prueba', entrada(G, { fecha: '2026-11-01' })));
    expect(otra.verificaciones.prueba.fecha).toBe('2026-11-01');
    expect(Object.keys(otra.verificaciones)).toHaveLength(2);
  });
});

describe('el registro REAL del repo', () => {
  it('hoy está vacío: ningún portal se ha corrido contra el portal real, y ningún guion lo afirma por su cuenta', () => {
    expect(Object.keys(REGISTRO_VERIFICACIONES)).toEqual([]);
    for (const g of GUIONES) {
      expect(g.verificado, `${g.comercio} dice estar verificado en portales.ts sin una corrida supervisada`).toBeNull();
      expect(estadoVerificacion(g, REGISTRO_VERIFICACIONES).estado).toBe('no_verificado');
    }
  });
  it('es válido contra las evidencias que existan en disco (si algún día hay entradas)', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const leer = (r: string) => { const p = join(process.cwd(), r); return existsSync(p) ? sha256Texto(readFileSync(p, 'utf8')) : null; };
    expect(validarRegistro(REGISTRO_VERIFICACIONES, GUIONES, leer)).toEqual([]);
  });
});
