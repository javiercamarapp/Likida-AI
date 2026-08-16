import { describe, it, expect } from 'vitest';
import { areasDe, puedeVerArea, puedeVerRuta, areaDeRuta, inicioDe, rolEfectivo } from './visibilidad';
import { AGENTES, OPERACION, DINERO_FISCAL, SISTEMA, ABAJO } from '@/app/dashboard/rutas';

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
  // El panel del contador se borró el 10-ago-2026 junto con las 17 de dueño
  // de flota; su RAÍZ volvió el 14-ago (`/dashboard/contador`, área `dinero`)
  // y por eso entra a esta lista — el margen y los acreditables de la flota
  // son exactamente lo que el jefe de tráfico no ve.
  const PROHIBIDAS = [
    '/dashboard/contador',
    '/dashboard/combustible-casetas',
    // La bandeja de huérfanos (F2) enseña montos — dinero, no operación.
    '/dashboard/huerfanos',
    // Conexiones (F7) es administración de la cuenta — solo el dueño.
    '/dashboard/conexiones',
    // Rentabilidad y cobranza (F7): el margen de la flota es exactamente lo
    // que este archivo existe para no enseñarle al jefe de tráfico.
    '/dashboard/rentabilidad',
    '/dashboard/usuarios', '/dashboard/configuracion', '/dashboard/politicas',
  ];
  it.each(PROHIBIDAS)('%s le está negada al encargado', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(false);
  });

  // El Registro de F2 (14-ago-2026) le devolvió al encargado sus pantallas
  // de operación: Viajes y Operadores se reconstruyeron SIN pesos (la fuga
  // del 4-ago fue anticipos y % por chofer a su vista; `dinero_por_area`
  // escanea las dos).
  const SUYAS = ['/dashboard', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/mapa'];
  it.each(SUYAS)('%s sí es suya', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(true);
  });
});

describe('el contador — su panel volvió, y la operación le sigue cerrada', () => {
  // El panel del contador se borró el 10-ago-2026 y su raíz se reconstruyó
  // el 14-ago (`/dashboard/contador`, área `dinero`). Mientras estuvo
  // borrado, `inicioDe` lo mandaba a Suscripción; hoy vuelve a mandarlo a
  // su casa — ver el describe de rebotes, abajo.
  it('AGENTES: liquidación/facturas/cobranza son dinero (el contador los ve); Conductores es operación', () => {
    expect(AGENTES.map((i) => i.href)).toEqual([
      '/dashboard/agentes/liquidacion', '/dashboard/agentes/facturas',
      // Cobranza (0089, 14-ago-2026): sin pesos en pantalla, pero es la cola
      // del cierre contable — el dolor del contador.
      '/dashboard/agentes/cobranza',
      // Conductores (F4): cero pesos y su usuario diario es el jefe de
      // tráfico — el único agente de operación.
      '/dashboard/agentes/conductores',
      // Peajes (F5): el conciliador del estado de cuenta — dinero.
      '/dashboard/agentes/peajes',
      // Proveedores (F6): la bandeja de facturas del taller — dinero.
      '/dashboard/agentes/proveedores',
    ]);
    const DINERO = [
      '/dashboard/agentes/liquidacion', '/dashboard/agentes/facturas',
      '/dashboard/agentes/cobranza', '/dashboard/agentes/peajes', '/dashboard/agentes/proveedores',
    ];
    for (const href of DINERO) expect(puedeVerRuta('contador', href)).toBe(true);
    expect(puedeVerRuta('contador', '/dashboard/agentes/conductores')).toBe(false);
    expect(puedeVerRuta('encargado', '/dashboard/agentes/conductores')).toBe(true);
    for (const href of DINERO) expect(puedeVerRuta('encargado', href)).toBe(false);
  });

  it('aterriza en su panel reconstruido, y su propio rol lo ve — sin bucle', () => {
    expect(inicioDe('contador')).toBe('/dashboard/contador');
    expect(puedeVerRuta('contador', inicioDe('contador'))).toBe(true);
  });

  // ── /dashboard/contador (raíz reconstruida el 14-ago-2026) ──────────────
  //
  // SE PRUEBA EL CAMINO, NO EL RENDER — mismo criterio que Suscripción: una
  // ruta sin área declarada cae a `undefined` y `puedeVerRuta` la niega a
  // TODOS, dueño incluido, sin un solo error. Ya pasó una vez.
  it('/dashboard/contador es dinero: contador, dueño y superadmin SÍ llegan', () => {
    expect(areaDeRuta('/dashboard/contador')).toBe('dinero');
    expect(puedeVerRuta('contador', '/dashboard/contador')).toBe(true);
    expect(puedeVerRuta('flota_admin', '/dashboard/contador')).toBe(true);
    expect(puedeVerRuta('superadmin', '/dashboard/contador')).toBe(true);
  });

  it('/dashboard/contador le está negada al encargado aunque teclee la URL', () => {
    expect(puedeVerRuta('encargado', '/dashboard/contador')).toBe(false);
  });

  // El contador no despacha NI consulta el registro operativo: Viajes y
  // Operadores (F2) son de operación, igual que el Resumen.
  const OPERACION_PROHIBIDA = ['/dashboard', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/mapa'];
  it.each(OPERACION_PROHIBIDA)('%s le sigue negada al contador aunque teclee la URL', (href) => {
    expect(puedeVerRuta('contador', href)).toBe(false);
  });

  it('la bandeja de huérfanos (dinero) SÍ es suya — es la antesala de su cierre', () => {
    expect(puedeVerRuta('contador', '/dashboard/huerfanos')).toBe(true);
  });
});

describe('el mapa de rutas no se queda atrás del sidebar', () => {
  // Es la prueba que importa a futuro: una pantalla nueva que alguien agregue
  // al sidebar y olvide clasificar quedaría SIN área, y `puedeVerRuta` la
  // negaría a todos — incluido el dueño. Falla aquí, no en producción.
  const todas = [...AGENTES, ...OPERACION, ...DINERO_FISCAL, ...SISTEMA, ...ABAJO];
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

  // ── Llaves de API (A6, 14-ago-2026) ──────────────────────────────────────
  //
  // Una llave es CONTROL, no dato: con ella se lee desde fuera, sin sesión,
  // todo lo que su área permita. El área de la RUTA espeja la RLS de la 0093
  // (`administra_flota()`), y esto fija que la pantalla nueva no quedó sin
  // clasificar (negada a todos) ni clasificada de más (a la vista del
  // contador).
  describe('/dashboard/llaves-api', () => {
    it('es administración: solo el dueño y el superadmin', () => {
      expect(areaDeRuta('/dashboard/llaves-api')).toBe('administracion');
      expect(puedeVerRuta('flota_admin', '/dashboard/llaves-api')).toBe(true);
      expect(puedeVerRuta('superadmin', '/dashboard/llaves-api')).toBe(true);
    });

    it('ni el contador ni el encargado, aunque tecleen la URL', () => {
      expect(puedeVerRuta('contador', '/dashboard/llaves-api')).toBe(false);
      expect(puedeVerRuta('encargado', '/dashboard/llaves-api')).toBe(false);
    });

    it('está en el sidebar, no solo en el mapa de áreas', () => {
      expect(todas.some((i) => i.href === '/dashboard/llaves-api')).toBe(true);
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
    // Iba a `/dashboard/contador` hasta el 10-ago-2026 (panel borrado), a
    // Suscripción del 10 al 14, y de vuelta a su panel reconstruido desde el
    // 14-ago. Lo que se prueba no es solo CUÁL es, sino las dos propiedades
    // que hacen que el rebote no sea un bucle: no es `/dashboard`, y su
    // propio rol la ve (o sea: la ruta está declarada en AREA_POR_RUTA).
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
    ...AGENTES, ...OPERACION, ...DINERO_FISCAL, ...SISTEMA, ...ABAJO,
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

// ═══════════════════════════════════════════════════════════════════════════
// EL VENDEDOR (0105): rol de LIKIDA con panel propio. Su trabajo son los
// prospectos del censo, no los datos de ninguna flota — la garantía de que
// no abre NADA de /dashboard es su AUSENCIA de AREAS_POR_ROL (fail closed
// por el `?? []`), y su casa se declara solo en PANEL_PROPIO.
// ═══════════════════════════════════════════════════════════════════════════
describe('el vendedor: panel propio, cero flota', () => {
  it('no tiene ninguna área del panel de flota — fail closed por ausencia', () => {
    expect(areasDe('vendedor')).toEqual([]);
    expect(puedeVerArea('vendedor', 'operacion')).toBe(false);
    expect(puedeVerArea('vendedor', 'dinero')).toBe(false);
    expect(puedeVerArea('vendedor', 'administracion')).toBe(false);
  });

  it('su casa es /vendedor — primero el panel propio, sin bucle posible', () => {
    // Es el primer rol que estrena el orden de `inicioDe` (panel ajeno ANTES
    // que las áreas): si alguien un día le diera un área sin quitarle el
    // panel, seguiría aterrizando en /vendedor y no en /dashboard.
    expect(inicioDe('vendedor')).toBe('/vendedor');
    expect(inicioDe('vendedor').startsWith('/dashboard')).toBe(false);
    // Fuera del mapa de áreas: el gate de /dashboard no lo puede rebotar en
    // círculo porque su destino no está gateado por ese mapa.
    expect(areaDeRuta(inicioDe('vendedor'))).toBeUndefined();
  });

  const TODAS_LAS_RUTAS = [
    ...AGENTES, ...OPERACION, ...DINERO_FISCAL, ...SISTEMA, ...ABAJO,
  ].map((i) => i.href);

  it.each(TODAS_LAS_RUTAS)('%s le está negada al vendedor aunque teclee la URL', (href) => {
    expect(puedeVerRuta('vendedor', href)).toBe(false);
  });

  it('"Ver como" NO lo incluye: previsualizar vendedor no enseña /dashboard', () => {
    // Su panel vive fuera de /dashboard; fingirlo con `?rol=` enseñaría una
    // vista que ese rol no tiene — el mismo criterio que con el chofer.
    expect(rolEfectivo('superadmin', 'vendedor')).toBe('superadmin');
  });
});

describe('las rutas de la cuenta/persona las ve TODO rol conocido (16-ago-2026)', () => {
  const DE_TODOS = ['/dashboard/notificaciones', '/dashboard/mi-perfil', '/dashboard/soporte'];

  it('el contador POR FIN las ve — el comentario viejo lo prometía y el área se lo negaba', () => {
    for (const href of DE_TODOS) expect(puedeVerRuta('contador', href)).toBe(true);
  });

  it('encargado y dueño también, como siempre', () => {
    for (const rol of ['encargado', 'flota_admin', 'superadmin']) {
      for (const href of DE_TODOS) expect(puedeVerRuta(rol, href)).toBe(true);
    }
  });

  it('un rol desconocido NO ve ni su perfil — fail closed, igual que el resto', () => {
    for (const href of DE_TODOS) expect(puedeVerRuta('rol-fantasma', href)).toBe(false);
  });

  it('la excepción no se derrama: el contador sigue sin ver despacho ni el encargado facturación', () => {
    expect(puedeVerRuta('contador', '/dashboard/despacho')).toBe(false);
    expect(puedeVerRuta('encargado', '/dashboard/facturacion')).toBe(false);
  });
});
