// ─────────────────────────────────────────────────────────────────────────────
// LEG-C18-C1 (auditoría 32, continuación 18) — la constancia del art. 16
// LFPDPPP escrita en falso porque la guardia del pulido no protege el pie.
//
// `servicio.ts:423` escribe `marcarAvisoPrivacidad` por el ÉXITO DEL ENVÍO:
//
//     if (!e.contacto.avisoPrivacidadEn) await repo.marcarAvisoPrivacidad(...)
//
// y el `update` de `repo.ts:562` lleva `.is('aviso_privacidad_en', null)`: una
// sola escritura, nunca se corrige. El texto que de verdad salió lo decide
// `pulirBorrador`, y su guardia (`guardiaDePulido`) protege cifras, ligas,
// correos y folio — pero NO el pie del aviso. Un modelo que «mejora» el
// mensaje y se come el pie deja al contacto sin aviso y sin saber que existe
// BAJA, con la base afirmando que se le entregó.
//
// Quitar el pie no dispara ninguna de las guardias de hoy: el texto es MÁS
// corto (no `muy_largo`), no agrega cifras (no `cifra_sin_respaldo`), QUITA
// una liga en vez de agregarla (`liga_nueva` solo mira las nuevas) y conserva
// el folio. Por eso pasa.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { redactarBorrador, guardiaDePulido, pulirBorrador, type EntradaRedaccion, type PuertoPulir } from './redactor';
import { AHORA, estatus } from './datos.fixture';

const primerContacto = (c: Partial<EntradaRedaccion> = {}): EntradaRedaccion => ({
  clasificacion: { intencion: 'saludo', secundarias: [], senales: [] },
  nombreContacto: 'María Pérez', nombreFlota: 'Transportes del Norte',
  viaje: { tipo: 'uno', estatus: estatus() },
  ahora: AHORA,
  primerContacto: true,
  avisoPrivacidadUrl: 'https://transportesdelnorte.mx/privacidad',
  ...c,
});

describe('LEG-C18-C1 · el pie del aviso de privacidad sobrevive al pulido', () => {
  it('el borrador de primer contacto trae el pie, y es pulible (riesgo bajo, sin humano)', () => {
    const b = redactarBorrador(primerContacto());
    // El pie, con sus dos partes: el responsable y la salida.
    expect(b.texto).toContain('asistente automatizado de Transportes del Norte');
    expect(b.texto).toContain('Aviso de privacidad: https://transportesdelnorte.mx/privacidad');
    expect(b.texto).toContain('Para dejar de recibir mensajes escribe BAJA');
    // Y ESTO es lo que lo pone en riesgo: un «saludo» es riesgo bajo y no pide
    // humano, así que `pulirBorrador` NO se salta el modelo. Es, además, el
    // primer mensaje que manda un contacto nuevo: el camino más común de todos.
    expect(b.riesgo).toBe('bajo');
    expect(b.requiereHumano).toBe(false);
  });

  it('un pulido que SE COME el pie se rechaza: pie_perdido', () => {
    const b = redactarBorrador(primerContacto());
    // Lo que un modelo devuelve cuando se le pide «hazlo más cálido y breve»:
    // mismo contenido, sin el pie legal. Ni una cifra nueva, ni una liga nueva,
    // más corto que el original.
    const sinPie = '¡Hola María! 👋 Soy el asistente de Transportes del Norte. Puedo decirte dónde va tu viaje, qué documentos tiene pendientes o el estado de tu factura. ¿Qué necesitas?';
    expect(sinPie.length).toBeLessThan(b.texto.length);

    const g = guardiaDePulido(sinPie, b, 'hola', null);
    expect(g).toEqual({ ok: false, motivo: 'pie_perdido' });
  });

  it('pulirBorrador devuelve el DETERMINISTA cuando el modelo se come el pie', async () => {
    const b = redactarBorrador(primerContacto());
    const modelo: PuertoPulir = {
      pulir: async () => '¡Hola María! 👋 Soy el asistente de Transportes del Norte. ¿Qué necesitas saber de tu viaje?',
    };
    const r = await pulirBorrador(b, 'hola', null, modelo, 't1');

    expect(r.motivoDescartado).toBe('pie_perdido');
    // El texto que sale lleva el aviso: es la condición para que
    // `marcarAvisoPrivacidad` no sea una constancia falsa.
    expect(r.borrador.texto).toContain('Para dejar de recibir mensajes escribe BAJA');
    expect(r.borrador.texto).toContain('Aviso de privacidad: https://transportesdelnorte.mx/privacidad');
  });

  it('un pulido que CONSERVA el pie sigue pasando (la guardia no es un candado)', () => {
    const b = redactarBorrador(primerContacto());
    const conPie = `¡Hola María! 👋 Soy el asistente de Transportes del Norte. ¿Qué necesitas?\n\nTus mensajes se atienden con apoyo de un asistente automatizado de Transportes del Norte. Aviso de privacidad: https://transportesdelnorte.mx/privacidad. Para dejar de recibir mensajes escribe BAJA.`;
    expect(guardiaDePulido(conPie, b, 'hola', null)).toEqual({ ok: true, motivo: null });
  });

  it('sin URL capturada el pie sigue siendo invariante (la flota sin aviso no pierde el BAJA)', () => {
    const b = redactarBorrador(primerContacto({ avisoPrivacidadUrl: null }));
    expect(b.texto).toContain('Para dejar de recibir mensajes escribe BAJA');
    expect(b.texto).not.toContain('Aviso de privacidad:');
    const sinPie = '¡Hola María! Soy el asistente de Transportes del Norte. ¿Qué necesitas?';
    expect(guardiaDePulido(sinPie, b, 'hola', null).motivo).toBe('pie_perdido');
  });

  it('un mensaje que NO es primer contacto no tiene pie que perder', () => {
    const b = redactarBorrador(primerContacto({ primerContacto: false }));
    expect(b.texto).not.toContain('escribe BAJA');
    const otro = '¡Hola María! Soy el asistente de Transportes del Norte. ¿Qué necesitas?';
    expect(guardiaDePulido(otro, b, 'hola', null).ok).toBe(true);
  });
});
