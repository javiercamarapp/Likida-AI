import { describe, it, expect } from 'vitest';
import { RUTAS_PERFIL_CINCO_AGENTES, rutaPermitidaEnPerfil, puedeVerRuta } from '@/lib/auth/visibilidad';

// La ruta de la configuración de la salida (T-A3-32) bajo el perfil `cinco_agentes`: clasificada en la lista cerrada y del
// área administración, es decir SOLO dueño/administrador. El rol decide primero; el perfil solo quita.
const RUTA = '/dashboard/agentes/carta-porte/configuracion';

describe('la configuración de la salida: perfil y roles', () => {
  it('está en la lista del perfil, del módulo de Carta Porte, y lo que no está clasificado se niega', () => {
    expect(RUTAS_PERFIL_CINCO_AGENTES[RUTA]).toBe('carta_porte');
    expect(rutaPermitidaEnPerfil('cinco_agentes', RUTA)).toBe(true);
    for (const otra of [`${RUTA}/otra`, `${RUTA}-nueva`]) expect(rutaPermitidaEnPerfil('cinco_agentes', otra), otra).toBe(false);
  });

  it('solo el dueño/administrador la abre: el jefe de tráfico, el contador y el vendedor no', () => {
    expect(puedeVerRuta('flota_admin', RUTA)).toBe(true);
    expect(puedeVerRuta('superadmin', RUTA)).toBe(true);
    for (const rol of ['encargado', 'contador', 'vendedor', 'chofer', 'inventado']) expect(puedeVerRuta(rol, RUTA), rol).toBe(false);
  });
});
