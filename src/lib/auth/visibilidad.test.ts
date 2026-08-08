import { describe, it, expect } from 'vitest';
import { areasDe, puedeVerArea, puedeVerRuta, areaDeRuta, inicioDe, rolEfectivo } from './visibilidad';
import { INICIO, NEGOCIO, OPERACION, FISCAL, DOCUMENTOS_DINERO, GESTION } from '@/app/dashboard/rutas';

// ═══════════════════════════════════════════════════════════════════════════
// El encargado entraba al mismo panel que el dueño y veía TODO: rentabilidad,
// cobranza, facturación, clientes. Estas pruebas fijan que ya no.
// ═══════════════════════════════════════════════════════════════════════════

describe('quién ve qué área', () => {
  it('el dueño y el superadmin ven las tres', () => {
    expect(areasDe('flota_admin')).toEqual(['operacion', 'dinero', 'administracion']);
    expect(areasDe('superadmin')).toEqual(['operacion', 'dinero', 'administracion']);
  });

  it('el encargado ve operación y NADA de dinero', () => {
    expect(puedeVerArea('encargado', 'operacion')).toBe(true);
    expect(puedeVerArea('encargado', 'dinero')).toBe(false);
    expect(puedeVerArea('encargado', 'administracion')).toBe(false);
  });

  it('el contador ve dinero y NO despacha', () => {
    expect(puedeVerArea('contador', 'dinero')).toBe(true);
    expect(puedeVerArea('contador', 'operacion')).toBe(false);
  });

  it('un rol desconocido no ve nada — fail closed, no fail open', () => {
    expect(areasDe('gerente_regional')).toEqual([]);
    expect(puedeVerRuta('gerente_regional', '/dashboard/despacho')).toBe(false);
  });

  it('el chofer no entra a este panel: ya no tiene login, solo WhatsApp', () => {
    expect(areasDe('operador')).toEqual([]);
  });
});

describe('las rutas que el encargado NO puede abrir aunque teclee la URL', () => {
  const PROHIBIDAS = [
    '/dashboard/rentabilidad', '/dashboard/cobranza', '/dashboard/facturacion',
    '/dashboard/clientes', '/dashboard/cotizador', '/dashboard/cuadre',
    '/dashboard/valor-ahorro', '/dashboard/combustible-casetas',
    '/dashboard/usuarios', '/dashboard/configuracion', '/dashboard/politicas',
    // El panel del contador es área `dinero`: al jefe de tráfico se le niega
    // entero, igual que rentabilidad. Enseñarle las deducciones perdidas de la
    // flota es enseñarle sus finanzas por otra puerta.
    '/dashboard/contador', '/dashboard/contador/deducciones', '/dashboard/contador/cfdi',
    '/dashboard/contador/combustible', '/dashboard/contador/retenciones',
    '/dashboard/contador/liquidaciones',
  ];
  it.each(PROHIBIDAS)('%s le está negada al encargado', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(false);
  });

  const SUYAS = [
    '/dashboard', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/pod',
    '/dashboard/incidencias', '/dashboard/unidades', '/dashboard/operadores',
    '/dashboard/mapa', '/dashboard/documentos',
  ];
  it.each(SUYAS)('%s sí es suya', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(true);
  });
});

describe('el contador llega a su panel — y la operación le sigue cerrada', () => {
  const SUYAS = FISCAL.map((i) => i.href);
  it.each(SUYAS)('%s es del contador', (href) => {
    expect(puedeVerRuta('contador', href)).toBe(true);
  });

  it('su aterrizaje es una de esas seis, no el cuadre ni /dashboard', () => {
    expect(SUYAS).toContain(inicioDe('contador'));
  });

  const OPERACION_PROHIBIDA = [
    '/dashboard', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/mapa',
    '/dashboard/pod', '/dashboard/operadores', '/dashboard/unidades',
  ];
  it.each(OPERACION_PROHIBIDA)('%s le sigue negada al contador aunque teclee la URL', (href) => {
    expect(puedeVerRuta('contador', href)).toBe(false);
  });
});

describe('el mapa de rutas no se queda atrás del sidebar', () => {
  // Es la prueba que importa a futuro: una pantalla nueva que alguien agregue
  // al sidebar y olvide clasificar quedaría SIN área, y `puedeVerRuta` la
  // negaría a todos — incluido el dueño. Falla aquí, no en producción.
  const todas = [...INICIO, ...NEGOCIO, ...OPERACION, ...FISCAL, ...DOCUMENTOS_DINERO, ...GESTION];
  it('toda ruta del sidebar tiene área declarada', () => {
    const huerfanas = todas.filter((i) => areaDeRuta(i.href) === undefined).map((i) => i.href);
    expect(
      huerfanas,
      `estas rutas están en el sidebar pero no en AREA_POR_RUTA (visibilidad.ts):\n  ${huerfanas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('el dueño ve todas las del sidebar', () => {
    const invisibles = todas.filter((i) => !puedeVerRuta('flota_admin', i.href)).map((i) => i.href);
    expect(invisibles).toEqual([]);
  });

  // ── Plan & Facturación (0052/0055) ───────────────────────────────────────
  //
  // SE PRUEBA EL CAMINO, NO EL RENDER. Que la pantalla se pinte no prueba que
  // alguien pueda llegar a ella: una ruta sin área declarada cae a `undefined`
  // y `puedeVerRuta` la niega a TODOS, dueño incluido, sin un solo error — la
  // página simplemente rebota. Ya pasó una vez.
  describe('/dashboard/suscripcion', () => {
    it('el dueño y el contador SÍ llegan', () => {
      // El contador la necesita: las facturas de Likida son gasto de la flota y
      // van en su contabilidad. Es el mismo criterio que la RLS de la 0052, que
      // las abre a `ve_finanzas()`.
      expect(puedeVerRuta('flota_admin', '/dashboard/suscripcion')).toBe(true);
      expect(puedeVerRuta('contador', '/dashboard/suscripcion')).toBe(true);
      expect(puedeVerRuta('superadmin', '/dashboard/suscripcion')).toBe(true);
    });

    it('el encargado NO — es la mensualidad de la flota, o sea dinero', () => {
      expect(puedeVerRuta('encargado', '/dashboard/suscripcion')).toBe(false);
    });

    it('está en el sidebar, no solo en el mapa de áreas', () => {
      // Sin esto, la página existiría y sería alcanzable solo tecleando la URL.
      expect(todas.some((i) => i.href === '/dashboard/suscripcion')).toBe(true);
    });
  });
});

describe('"Ver como" solo puede QUITAR visibilidad', () => {
  it('un superadmin puede mirarse el panel como encargado', () => {
    expect(rolEfectivo('superadmin', 'encargado')).toBe('encargado');
    expect(puedeVerRuta(rolEfectivo('superadmin', 'encargado'), '/dashboard/cobranza')).toBe(false);
  });

  it('NO es una escalada: a un encargado el parámetro no le da nada', () => {
    // Si esto devolviera 'flota_admin', `?rol=flota_admin` en la barra de
    // direcciones sería subir de privilegio con un teclazo.
    expect(rolEfectivo('encargado', 'flota_admin')).toBe('encargado');
    expect(rolEfectivo('contador', 'superadmin')).toBe('contador');
    expect(rolEfectivo('operador', 'flota_admin')).toBe('operador');
  });

  it('un superadmin no puede previsualizarse como superadmin ni como chofer', () => {
    // 'superadmin' no está en la lista: pedirlo no cambia nada (ya lo es).
    // 'operador' tampoco: ya no tiene panel ninguno, y fingirlo aquí
    // enseñaría una vista que no existe para ese rol.
    expect(rolEfectivo('superadmin', 'superadmin')).toBe('superadmin');
    expect(rolEfectivo('superadmin', 'operador')).toBe('superadmin');
  });

  it('un valor basura se ignora en silencio, no rompe la página', () => {
    expect(rolEfectivo('superadmin', 'gerente')).toBe('superadmin');
    expect(rolEfectivo('superadmin', '')).toBe('superadmin');
    expect(rolEfectivo('superadmin', null)).toBe('superadmin');
    expect(rolEfectivo('superadmin', undefined)).toBe('superadmin');
  });
});

describe('a dónde se rebota a cada quien', () => {
  it('al encargado a /dashboard, que sí es suyo', () => {
    expect(inicioDe('encargado')).toBe('/dashboard');
  });

  it('al contador NO a /dashboard — lo rebotaría otra vez y sería un bucle', () => {
    // Cambió de `/dashboard/cuadre` a `/dashboard/contador` cuando dejó de ser
    // "la primera página de dinero que había" y pasó a existir una hecha para
    // él. Lo que se prueba no es CUÁL es, sino las dos propiedades que hacen
    // que el rebote no sea un bucle: no es `/dashboard`, y su propio rol la ve.
    expect(inicioDe('contador')).not.toBe('/dashboard');
    expect(inicioDe('contador')).toBe('/dashboard/contador');
    expect(puedeVerRuta('contador', inicioDe('contador'))).toBe(true);
  });

  it('un rol sin áreas va a /sin-acceso, no a un bucle', () => {
    expect(inicioDe('desconocido')).toBe('/sin-acceso');
  });

  // ── EL CHOFER YA NO TIENE PANEL, DE VERDAD ──────────────────────────────
  //
  // Retirado el 7-ago-2026 (/chofer, /mis-viajes y su login): `operador` no
  // está en `AREAS_POR_ROL` NI en `PANEL_PROPIO`, así que `inicioDe` cae al
  // `/sin-acceso` del final — y esta vez sí es la verdad, no un texto que le
  // miente a alguien que sí tenía panel.
  it('al chofer a /sin-acceso — ya no tiene panel del que rebotarlo', () => {
    expect(inicioDe('operador')).toBe('/sin-acceso');
  });

  it('operador sin panel propio no abre ninguna pantalla de /dashboard', () => {
    expect(areasDe('operador')).toEqual([]);
    expect(puedeVerArea('operador', 'operacion')).toBe(false);
    expect(puedeVerArea('operador', 'dinero')).toBe(false);
    expect(puedeVerArea('operador', 'administracion')).toBe(false);
  });

  const TODAS_LAS_RUTAS = [
    ...INICIO, ...NEGOCIO, ...OPERACION, ...FISCAL, ...DOCUMENTOS_DINERO, ...GESTION,
  ].map((i) => i.href);

  it.each(TODAS_LAS_RUTAS)('%s le sigue negada al chofer aunque teclee la URL', (href) => {
    expect(puedeVerRuta('operador', href)).toBe(false);
  });

  it('su destino no es una ruta de este panel, así que no puede haber bucle', () => {
    // El bucle del contador se evitó eligiendo una ruta que su rol SÍ ve.
    // Aquí se evita al revés: la salida está fuera de /dashboard, y por lo
    // tanto fuera del gate que lo rebotó.
    expect(inicioDe('operador').startsWith('/dashboard')).toBe(false);
    expect(areaDeRuta(inicioDe('operador'))).toBeUndefined();
  });
});
