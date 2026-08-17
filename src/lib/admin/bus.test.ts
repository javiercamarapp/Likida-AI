// EL BUS DE MANDO (0127) — lo puro: qué órdenes puede encolar la UI y qué
// las invalida ANTES de tocar la base (el error debe ser una frase para el
// teléfono de Javier, no un 23514 de Postgres).
import { describe, expect, it } from 'vitest';
import { ORDENES_UI, esOrdenUi, validarOrden } from './bus';

describe('bus de mando — órdenes de la UI', () => {
  it('el subconjunto de la UI existe dentro del dominio del CHECK de la 0127', () => {
    // El dominio completo de bus_orden_tipo_dominio. Si la migración cambia,
    // esta lista se actualiza CON ella — la prueba fija que la UI nunca
    // ofrece un tipo que la base va a rebotar.
    const dominio = ['correr_ahora', 'kill_switch_on', 'kill_switch_off', 'editar_encargo', 'nota'];
    for (const tipo of ORDENES_UI) expect(dominio).toContain(tipo);
  });

  it('editar_encargo NO es ofertable desde la bandeja (llega con el editor de rutinas)', () => {
    expect(esOrdenUi('editar_encargo')).toBe(false);
  });

  it('correr_ahora sin rutina se rechaza con una frase, no con un error de base', () => {
    expect(validarOrden('correr_ahora', null)).toMatch(/rutina/);
    expect(validarOrden('correr_ahora', 'dof-diario')).toBeNull();
  });

  it('la forma del nombre de rutina espeja el CHECK bus_corrida_rutina_forma', () => {
    expect(validarOrden('correr_ahora', 'DOF Diario')).not.toBeNull(); // mayúsculas y espacio
    expect(validarOrden('correr_ahora', 'x')).not.toBeNull();          // muy corto
    expect(validarOrden('kill_switch_on', null)).toBeNull();           // global: sin rutina es válido
  });
});
