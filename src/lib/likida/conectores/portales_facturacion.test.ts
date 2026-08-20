import { describe, it, expect } from 'vitest';
import { COMERCIOS } from '../facturacion/comercios';
import {
  CONECTORES_PORTALES_FACTURACION, conectorDePortal, comercioDeConector,
} from './portales_facturacion';
import { CONECTORES, conectorPorId } from './registro';
import { esSecreto } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DERIVADO: un conector por comercio con cuenta, ni uno más.
//
// La regla que estas pruebas fijan es la de todo el archivo: NADA escrito a
// mano que se pueda derivar de `comercios.ts`. El día que un portal nuevo
// entre al registro con `requiereCuenta: true`, su conector aparece solo — y
// si alguien lo escribe aparte, la primera prueba lo caza.
// ═══════════════════════════════════════════════════════════════════════════

describe('conectores de portal de facturación', () => {
  const conCuenta = COMERCIOS.filter((c) => c.requiereCuenta);

  it('hay EXACTAMENTE uno por comercio que exige cuenta', () => {
    expect(CONECTORES_PORTALES_FACTURACION.map((c) => c.id).sort())
      .toEqual(conCuenta.map((c) => conectorDePortal(c.clave)).sort());
  });

  it('el id viaja de ida y vuelta: es lo que enruta la credencial al comercio', () => {
    for (const c of conCuenta) {
      expect(comercioDeConector(conectorDePortal(c.clave))).toBe(c.clave);
    }
    // Y un conector que NO es de portal no se confunde con uno que sí.
    expect(comercioDeConector('samsara')).toBeNull();
  });

  it('están en el catálogo general — sin eso la pantalla de conexiones no los enseña', () => {
    for (const c of CONECTORES_PORTALES_FACTURACION) {
      expect(conectorPorId(c.id), c.id).not.toBeNull();
    }
    // Y ningún id choca con los de ERP/GPS/peaje.
    expect(new Set(CONECTORES.map((c) => c.id)).size).toBe(CONECTORES.length);
  });

  it('la contraseña es SECRETO en todos: no vuelve al panel ni entra a un log', () => {
    for (const c of CONECTORES_PORTALES_FACTURACION) {
      const secretos = c.credenciales.filter(esSecreto);
      expect(secretos.length, `${c.id} sin campo secreto`).toBeGreaterThanOrEqual(1);
    }
  });

  it('ninguno afirma API ni fuente: son formularios web y se dice', () => {
    for (const c of CONECTORES_PORTALES_FACTURACION) {
      expect(c.formaDeConectar).toBe('requiere_piloto');
      expect(c.fuente).toBeNull();
    }
  });

  it('probar() no llama a nadie y lo dice: la prueba real es el navegador del agente', async () => {
    const uno = CONECTORES_PORTALES_FACTURACION[0];
    const sinRed = async () => { throw new Error('esta prueba no debe tocar la red'); };
    // Con los campos llenos: no hay API que llamar, y se dice a dónde sí mirar.
    const r = await uno.probar({ usuario: 'flota', contrasena: 'x' }, sinRed);
    expect(r.ok).toBe(false);
    expect(r.verificadoContra).toBeNull();
    expect(r.detalle).toMatch(/navegador|Agente/i);
    // Y con los campos vacíos, la guarda de siempre: qué falta, sin tocar red.
    const vacio = await uno.probar({}, sinRed);
    expect((vacio.falta ?? []).length).toBeGreaterThan(0);
  });

  it('La Gas pide correo — el único login LEÍDO en el portal real (29-jul-2026)', () => {
    const laGas = conectorPorId(conectorDePortal('la_gas'));
    expect(laGas).not.toBeNull();
    expect(laGas!.credenciales.find((c) => c.clave === 'usuario')?.forma).toBe('correo');
  });
});
