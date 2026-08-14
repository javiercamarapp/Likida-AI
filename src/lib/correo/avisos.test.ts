import { describe, it, expect } from 'vitest';
import {
  avisoVigencias, avisoCorridaFallida, avisoHuerfanos, avisoEscalados, avisoInvitacion,
} from './avisos';
import { armarHtml, aTextoPlano } from './plantilla';

const VIG = {
  flota: 'Transportes Innovativos',
  vencidos: 1, porVencer: 2, enRegla: 9, total: 12,
  detalle: [
    { unidad: 'T-042', estado: 'Verificación vencida hace 8 días' },
    { unidad: 'T-017', estado: 'Póliza vence en 23 días' },
  ],
};

describe('el asunto dice el HECHO, no la categoría', () => {
  // "Notificación de Likida" obliga a abrirlo para saber si importa, y a la
  // tercera vez ya no se abre.
  it('vigencias lleva el conteo en el asunto', () => {
    expect(avisoVigencias(VIG).asunto).toBe('3 unidades necesitan papeles');
  });

  it('una corrida repetida lo dice desde el asunto', () => {
    const a = avisoCorridaFallida({
      flota: null, agente: 'Agente de Cobranza', href: '/dashboard/agentes/cobranza',
      cuando: 'hoy 09:00', motivo: 'No se pudo leer la cola.', seguidas: 4,
    });
    expect(a.asunto).toContain('4 corridas');
  });

  it('ningún asunto dice solo "Likida" o "Notificación"', () => {
    const todos = [
      avisoVigencias(VIG).asunto,
      avisoHuerfanos({ flota: null, cuantos: 3, diasDelMasViejo: 2 }).asunto,
      avisoEscalados({ flota: null, cuantos: 2, folios: ['VJ-1', 'VJ-2'] }).asunto,
    ];
    for (const a of todos) {
      expect(a.toLowerCase()).not.toMatch(/^notificaci/);
      expect(a.length).toBeGreaterThan(12);
    }
  });
});

describe('todos llevan a la pantalla donde SE RESUELVE', () => {
  it('cada aviso tiene botón y ninguno apunta al Inicio', () => {
    const avisos = [
      avisoVigencias(VIG),
      avisoCorridaFallida({ flota: null, agente: 'A', href: '/dashboard/agentes/peajes', cuando: 'hoy', motivo: 'x', seguidas: 1 }),
      avisoHuerfanos({ flota: null, cuantos: 1, diasDelMasViejo: null }),
      avisoEscalados({ flota: null, cuantos: 1, folios: ['VJ-9'] }),
      avisoInvitacion({ flota: 'X', invitaNombre: 'Ana', rol: 'contador' }),
    ];
    for (const a of avisos) {
      expect(a.boton, a.asunto).toBeDefined();
      expect(a.boton!.href).toMatch(/^https?:\/\//);
      expect(a.boton!.href).not.toMatch(/\/dashboard$/);
    }
  });

  it('la corrida fallida lleva a la página de ESE agente, no a una lista', () => {
    const a = avisoCorridaFallida({
      flota: null, agente: 'Agente de Peajes', href: '/dashboard/agentes/peajes',
      cuando: 'hoy', motivo: 'x', seguidas: 1,
    });
    expect(a.boton!.href).toContain('/dashboard/agentes/peajes');
  });
});

describe('vigencias — el tono sube solo cuando hay algo vencido', () => {
  it('con vencidos es urgente', () => {
    expect(avisoVigencias(VIG).tono).toBe('urgente');
  });

  it('sin vencidos y con próximos a vencer es atención, no urgencia', () => {
    // Avisar con 30 días de margen no es una emergencia; tratarlo como tal
    // entrena a ignorar el aviso.
    expect(avisoVigencias({ ...VIG, vencidos: 0, porVencer: 2 }).tono).toBe('atencion');
  });

  it('el título habla de lo vencido cuando lo hay', () => {
    expect(avisoVigencias(VIG).titulo).toContain('vencido');
    expect(avisoVigencias({ ...VIG, vencidos: 0 }).titulo).toContain('por vencer');
  });

  it('el singular está escrito, no armado con "(s)"', () => {
    const uno = avisoVigencias({ ...VIG, vencidos: 1, porVencer: 0, detalle: [VIG.detalle[0]] });
    expect(uno.asunto).toBe('1 unidad necesita papeles');
    expect(uno.asunto).not.toContain('(s)');
  });

  it('el avance de la bandeja trae el caso concreto, no el título', () => {
    expect(avisoVigencias(VIG).avance).toContain('T-042');
  });
});

describe('huérfanos — el MONTO no viaja en el correo', () => {
  it('ni el asunto ni el cuerpo traen pesos', () => {
    // El correo puede reenviarse y acabar en una bandeja que no debería ver el
    // gasto de la flota. El conteo alcanza para que alguien entre a resolverlo.
    const a = avisoHuerfanos({ flota: 'X', cuantos: 12, diasDelMasViejo: 20 });
    const todo = `${a.asunto} ${a.titulo} ${a.parrafos.join(' ')} ${a.avance}`;
    expect(todo).not.toMatch(/\$|MXN|peso/i);
  });

  it('sube a atención solo cuando el más viejo lleva una semana', () => {
    expect(avisoHuerfanos({ flota: null, cuantos: 3, diasDelMasViejo: 2 }).tono).toBe('neutral');
    expect(avisoHuerfanos({ flota: null, cuantos: 3, diasDelMasViejo: 9 }).tono).toBe('atencion');
  });

  it('sin dato de antigüedad no inventa urgencia', () => {
    expect(avisoHuerfanos({ flota: null, cuantos: 3, diasDelMasViejo: null }).tono).toBe('neutral');
  });
});

describe('el correo NUNCA acusa a una persona', () => {
  it('ningún aviso usa las palabras fraude, robo o culpa', () => {
    // LFPDPPP 26-II: el agente prepara y marca, el humano decide. La misma
    // regla que rige las alertas del panel.
    const textos = [
      avisoVigencias(VIG), avisoEscalados({ flota: null, cuantos: 2, folios: ['A'] }),
      avisoHuerfanos({ flota: null, cuantos: 1, diasDelMasViejo: 30 }),
      avisoCorridaFallida({ flota: null, agente: 'A', href: '/x', cuando: 'hoy', motivo: 'y', seguidas: 3 }),
    ].map((a) => `${a.titulo} ${a.parrafos.join(' ')}`.toLowerCase());
    for (const t of textos) {
      expect(t).not.toMatch(/fraude|robo|rob[óo]|culpa|mentir/);
    }
  });
});

describe('la invitación es el único que NO es alerta', () => {
  it('lo firma la persona que invita, no "el equipo de Likida"', () => {
    // Likida no invitó a nadie: alguien de la empresa le dio acceso a otro.
    const a = avisoInvitacion({ flota: 'Transportes X', invitaNombre: 'Ana Ruiz', rol: 'contador' });
    expect(a.parrafos[0]).toContain('Ana Ruiz');
    expect(a.parrafos.join(' ')).not.toMatch(/el equipo de Likida/i);
  });

  it('sin nombre de quien invita, no se inventa uno', () => {
    const a = avisoInvitacion({ flota: 'Transportes X', invitaNombre: null, rol: 'contador' });
    expect(a.parrafos[0]).toContain('Te dieron acceso');
  });

  it('su pie NO ofrece apagarlo: es un acceso, no un aviso recurrente', () => {
    const a = avisoInvitacion({ flota: 'X', invitaNombre: 'Ana', rol: 'contador' });
    expect(a.porQueLoRecibes).not.toContain('apagarlo');
    expect(a.tono).toBe('neutral');
  });

  it('explica que se entra con enlace, sin contraseña', () => {
    // La decisión del 4-ago: el acceso se queda en enlace mágico.
    expect(avisoInvitacion({ flota: 'X', invitaNombre: null, rol: 'contador' }).parrafos.join(' '))
      .toMatch(/enlace/i);
  });
});

describe('el pie dice de qué flota y cómo apagarlo', () => {
  it('nombra la flota cuando se conoce', () => {
    expect(avisoVigencias(VIG).porQueLoRecibes).toContain('Transportes Innovativos');
  });

  it('sin nombre de flota no queda cojo', () => {
    const a = avisoVigencias({ ...VIG, flota: null });
    expect(a.porQueLoRecibes).toContain('tu flota');
    expect(a.porQueLoRecibes).not.toContain('null');
  });

  it('los recurrentes ofrecen apagarse, y dicen DÓNDE', () => {
    // Decía "en Configuración" cuando no había dónde apagarlos. Ahora sí lo
    // hay —la pestaña Notificaciones de cada agente— y el pie manda ahí: una
    // instrucción que lleva al lugar equivocado es peor que ninguna, porque
    // quien la sigue concluye que el producto no cumple.
    expect(avisoVigencias(VIG).porQueLoRecibes).toContain('Notificaciones del agente');
  });
});

describe('todos se arman en HTML y en texto sin romperse', () => {
  it('cada aviso produce las dos partes', () => {
    const avisos = [
      avisoVigencias(VIG),
      avisoCorridaFallida({ flota: 'X', agente: 'A', href: '/x', cuando: 'hoy', motivo: 'y', seguidas: 1 }),
      avisoHuerfanos({ flota: 'X', cuantos: 4, diasDelMasViejo: 3 }),
      avisoEscalados({ flota: 'X', cuantos: 2, folios: ['VJ-1', 'VJ-2'] }),
      avisoInvitacion({ flota: 'X', invitaNombre: 'Ana', rol: 'contador' }),
    ];
    for (const a of avisos) {
      const html = armarHtml(a);
      expect(html, a.asunto).toContain('<!doctype html>');
      expect(html).toContain('cid:likida-logo');
      expect(aTextoPlano(a).length).toBeGreaterThan(40);
    }
  });

  it('escalados no imprime una lista infinita de folios', () => {
    const a = avisoEscalados({ flota: null, cuantos: 40, folios: Array.from({ length: 40 }, (_, i) => `VJ-${i}`) });
    expect(a.datos!.length).toBeLessThanOrEqual(8);
  });
});
