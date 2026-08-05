import { describe, it, expect } from 'vitest';
import { confirmacionDeViaje, resumenConfirmacion, transcurrido, type MarcasViaje } from './confirmacion';

// ═══════════════════════════════════════════════════════════════════════════
// DADO UN VIAJE CON CIERTAS COLUMNAS, QUÉ DICE LA PANTALLA.
//
// Lo que estas pruebas defienden no es el color de la píldora: es que ningún
// rótulo afirme algo que la base no diga. Los tres casos que se pueden leer mal
// —y que aquí quedan fijos— son:
//
//   1. `avisado_en` NULL en un viaje ABIERTO es una alarma real (la escalación
//      de 5 h filtra por esa columna, así que ese viaje no está en ninguna cola).
//   2. `avisado_en` NULL en un viaje que YA AVANZÓ no es una alarma: es un dato
//      que no se guardó. Todo viaje anterior al 4-ago-2026 cae aquí, y pintarlos
//      rojos habría llenado la pantalla de alarmas falsas el primer día.
//   3. Escalado y DESPUÉS confirmado se lee "Confirmado" — pero sin esconder que
//      se escaló, porque el jefe ya movió algo por ese aviso.
//
// Todo es puro: no hay base, no hay navegador y el reloj se inyecta.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-08-04T20:00:00.000Z'); // 14:00 en CDMX

function viaje(p: Partial<MarcasViaje> = {}): MarcasViaje {
  return {
    estatus: 'abierto',
    operadorNombre: 'Luis Ramírez',
    avisadoEn: null,
    aceptadoEn: null,
    escaladoEn: null,
    avisosEnviados: 0,
    ...p,
  };
}

describe('SIN AVISAR — el estado que hoy no se veía y nunca escala solo', () => {
  it('un viaje ABIERTO sin `avisado_en` es la alarma roja', () => {
    const c = confirmacionDeViaje(viaje(), AHORA);
    expect(c.clave).toBe('sin_avisar');
    expect(c.label).toBe('Sin avisar');
    expect(c.estado).toBe('bad');
  });

  it('dice la consecuencia comprobable, no una conjetura sobre el chofer', () => {
    // "la escalación no lo ve" se puede verificar leyendo `escalar_viaje.ts`.
    // "el chofer no se enteró" NO: pudo llamarle el jefe por teléfono.
    const c = confirmacionDeViaje(viaje(), AHORA);
    expect(c.detalle).toBe('la escalación no lo ve');
    expect(c.detalle).not.toMatch(/no se enteró|no contestó/i);
  });

  it('un viaje abierto SIN CHOFER dice que le falta chofer, no que falta el aviso', () => {
    // Se vio mirando el render: los dos casos caen en la misma píldora roja y
    // se arreglan distinto. Mandar al jefe a revisar por qué "no salió el
    // aviso" de un viaje que nunca tuvo a quién avisarle es mandarlo a buscar
    // algo que no existe: lo que falta es asignarlo en Despacho.
    const c = confirmacionDeViaje(viaje({ operadorNombre: null }), AHORA);
    expect(c.clave).toBe('sin_avisar');
    expect(c.detalle).toBe('sin chofer · la escalación no lo ve');
  });

  it('el mismo NULL en un viaje que ya avanzó NO es alarma: es un dato que falta', () => {
    // Éste es el caso de TODOS los viajes anteriores a la 0058. Si `en_cuadre`
    // y `liquidado` salieran rojos, la columna gritaría el día uno y en dos días
    // se aprendería a ignorarla — que es el modo de falla que este repo evita.
    for (const estatus of ['en_cuadre', 'liquidado']) {
      const c = confirmacionDeViaje(viaje({ estatus }), AHORA);
      expect(c.clave, estatus).toBe('sin_registro');
      expect(c.label, estatus).toBe('Sin registro');
      expect(c.estado, estatus).toBe('neutral');
    }
  });

  it('un estatus que la base no admite no se cuela como alarma', () => {
    // El dominio es abierto|en_cuadre|liquidado (`viaje_estatus_dominio`). Un
    // cuarto valor solo puede venir de datos corruptos: no se le inventa
    // urgencia, cae en "falta el dato".
    expect(confirmacionDeViaje(viaje({ estatus: 'cancelado' }), AHORA).clave).toBe('sin_registro');
  });
});

describe('POR CONFIRMAR — avisado y sin respuesta', () => {
  it('enseña hace cuánto se le avisó, no solo que se le avisó', () => {
    const c = confirmacionDeViaje(
      viaje({ avisadoEn: '2026-08-04T16:40:00.000Z', avisosEnviados: 1 }),
      AHORA,
    );
    expect(c.clave).toBe('esperando');
    expect(c.estado).toBe('warn');
    expect(c.detalle).toBe('avisado hace 3 h 20 min · 1 aviso');
  });

  it('la etiqueta cabe en la tarjeta, que recorta con `truncate`', () => {
    // "Esperando confirmación" salía como "Esperando confirma…" en el render.
    // Un rótulo cortado no es un rótulo: el largo es parte de que sea verdad.
    const c = confirmacionDeViaje(viaje({ avisadoEn: '2026-08-04T19:00:00.000Z' }), AHORA);
    expect(c.label).toBe('Por confirmar');
    expect(c.label.length).toBeLessThanOrEqual(14);
  });

  it('cuenta los avisos en plural cuando se insistió', () => {
    const c = confirmacionDeViaje(
      viaje({ avisadoEn: '2026-08-04T19:00:00.000Z', avisosEnviados: 2 }),
      AHORA,
    );
    expect(c.detalle).toBe('avisado hace 1 h · 2 avisos');
  });

  it('sin conteo de avisos no inventa uno', () => {
    // `avisos_enviados` es `not null default 0`, así que un 0 con `avisado_en`
    // puesto es una fila escrita a mano. No se imprime "0 avisos" —se leería
    // como que no se le escribió— ni se asume que fue uno.
    const c = confirmacionDeViaje(viaje({ avisadoEn: '2026-08-04T19:00:00.000Z' }), AHORA);
    expect(c.detalle).toBe('avisado hace 1 h');
  });
});

describe('CONFIRMADO — con la hora, que es lo que se pidió', () => {
  it('imprime la hora en zona de México, no la UTC', () => {
    // El mismo bug de `fechaMx`: 02:00 UTC son las 20:00 del día anterior en
    // CDMX. Una confirmación de las 20:00 fechada al día siguiente vuelve
    // inservible el "hace cuánto" que el jefe usa para decidir.
    const c = confirmacionDeViaje(
      viaje({ avisadoEn: '2026-08-04T18:00:00.000Z', aceptadoEn: '2026-08-05T02:00:00.000Z' }),
      AHORA,
    );
    expect(c.clave).toBe('confirmado');
    expect(c.estado).toBe('ok');
    expect(c.detalle).toBe('04 ago 2026, 20:00');
  });

  it('escalado y DESPUÉS confirmado se lee "Confirmado", sin esconder el escalado', () => {
    // El jefe ya recibió el aviso y pudo haber empezado a buscar reemplazo.
    // Enseñarle "Confirmado" a secas lo dejaría creyendo que nunca pasó nada.
    const c = confirmacionDeViaje(
      viaje({
        avisadoEn: '2026-08-04T08:00:00.000Z',
        escaladoEn: '2026-08-04T13:00:00.000Z',
        aceptadoEn: '2026-08-04T14:00:00.000Z',
      }),
      AHORA,
    );
    expect(c.clave).toBe('confirmado');
    expect(c.detalle).toBe('04 ago 2026, 08:00 · se había escalado');
  });

  it('la confirmación gana sobre cualquier otra marca', () => {
    // `viaje_aceptado_requiere_aviso` impide aceptado sin avisado, pero el orden
    // de las ramas no depende de esa constraint: `aceptado_en` es el único dato
    // que solo se escribe cuando el chofer contesta, así que manda.
    const c = confirmacionDeViaje(
      viaje({ estatus: 'abierto', aceptadoEn: '2026-08-04T14:00:00.000Z' }),
      AHORA,
    );
    expect(c.clave).toBe('confirmado');
  });
});

describe('ESCALADO — donde el jefe decide cambiar de chofer', () => {
  it('dice cuándo se le avisó al jefe y cuántas veces se insistió', () => {
    const c = confirmacionDeViaje(
      viaje({
        avisadoEn: '2026-08-04T08:00:00.000Z',
        escaladoEn: '2026-08-04T13:00:00.000Z',
        avisosEnviados: 2,
      }),
      AHORA,
    );
    expect(c.clave).toBe('escalado');
    expect(c.estado).toBe('bad');
    expect(c.detalle).toBe('jefe avisado 04 ago 2026, 07:00 · 2 avisos');
  });
});

describe('transcurrido: una duración que no miente', () => {
  it('minutos, horas y días, sin ceros de relleno', () => {
    const t = (iso: string) => transcurrido(iso, AHORA);
    expect(t('2026-08-04T19:59:40.000Z')).toBe('hace menos de 1 min');
    expect(t('2026-08-04T19:15:00.000Z')).toBe('hace 45 min');
    expect(t('2026-08-04T17:00:00.000Z')).toBe('hace 3 h');
    expect(t('2026-08-04T16:40:00.000Z')).toBe('hace 3 h 20 min');
    expect(t('2026-08-02T20:00:00.000Z')).toBe('hace 2 d');
    expect(t('2026-08-02T15:00:00.000Z')).toBe('hace 2 d 5 h');
  });

  it('una marca en el FUTURO se dice, no se aplana a "hace un momento"', () => {
    // Un reloj desfasado o una marca puesta a mano no se pueden leer como un
    // aviso reciente: eso convertiría el error en un dato de aspecto normal.
    expect(transcurrido('2026-08-05T09:00:00.000Z', AHORA)).toBe('con fecha futura');
  });

  it('una fecha ilegible se dice, no sale como NaN', () => {
    expect(transcurrido('no es una fecha', AHORA)).toBe('fecha ilegible');
  });
});

describe('resumenConfirmacion: los conteos de la tira de arriba', () => {
  it('cada viaje cae en exactamente un casillero, y suman el total', () => {
    const viajes: MarcasViaje[] = [
      viaje(),                                                                   // sin avisar
      viaje(),                                                                   // sin avisar
      viaje({ estatus: 'liquidado' }),                                           // sin registro
      viaje({ avisadoEn: '2026-08-04T19:00:00.000Z', avisosEnviados: 1 }),       // esperando
      viaje({ avisadoEn: '2026-08-04T08:00:00.000Z', aceptadoEn: '2026-08-04T09:00:00.000Z' }), // confirmado
      viaje({ avisadoEn: '2026-08-04T08:00:00.000Z', escaladoEn: '2026-08-04T13:00:00.000Z' }), // escalado
    ];
    const r = resumenConfirmacion(viajes, AHORA);
    expect(r).toEqual({ sinAvisar: 2, esperando: 1, confirmados: 1, escalados: 1, sinRegistro: 1 });
    const suma = r.sinAvisar + r.esperando + r.confirmados + r.escalados + r.sinRegistro;
    expect(suma, 'un viaje quedó sin contar o se contó dos veces').toBe(viajes.length);
  });

  it('sin viajes, todo en cero — que aquí sí es una medición', () => {
    // Un cero sobre una lista vacía no afirma nada del negocio: la sección solo
    // se pinta cuando hay filas debajo (`viajes.length > 0` en la página).
    expect(resumenConfirmacion([], AHORA)).toEqual({
      sinAvisar: 0, esperando: 0, confirmados: 0, escalados: 0, sinRegistro: 0,
    });
  });
});
