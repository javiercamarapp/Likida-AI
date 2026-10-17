import { describe, it, expect } from 'vitest';
import {
  siguienteEstado, ajustarAVentana, multiplicadorBackoff, cumpleInvariante,
  ZONA_FLOTA_POR_DEFECTO, TOPE_TRANSITORIOS, ESTADOS_TERMINALES,
  type ConfigMaquina, type EnvioEnMaquina, type EventoEnvio, type Transicion,
} from './envio_estados';
import type { EstadoEnvioTms } from './repo';

const CFG: ConfigMaquina = { reintentosMax: 6, frecuenciaMin: 60, ventanaInicio: null, ventanaFin: null, destinatarioAlertaCorreo: 'oficina@ejemplo.test' };
const AHORA = new Date('2026-03-10T18:00:00.000Z');
const env = (o: Partial<EnvioEnMaquina> = {}): EnvioEnMaquina => ({ estado: 'pendiente_prechequeo', intentos: 0, alertaEnviada: false, bloqueosAbiertos: 0, ...o });
const ok = (t: Transicion) => { if (!t.ok) throw new Error(t.razon); return t; };

describe('envio_estados · tabla de transiciones', () => {
  const casos: Array<[string, EnvioEnMaquina, EventoEnvio, EstadoEnvioTms]> = [
    ['prechequeo enviar → listo', env(), { tipo: 'prechequeo', accion: 'enviar' }, 'listo'],
    ['prechequeo pendiente_reque → pendiente_reque', env(), { tipo: 'prechequeo', accion: 'pendiente_reque' }, 'pendiente_reque'],
    ['prechequeo revisar → descartado', env(), { tipo: 'prechequeo', accion: 'revisar', motivo: 'Falta la caja.' }, 'descartado'],
    ['reque aparece → listo', env({ estado: 'pendiente_reque', intentos: 2 }), { tipo: 'reque_aparecio' }, 'listo'],
    ['reque sigue ausente → pendiente_reque', env({ estado: 'pendiente_reque', intentos: 2 }), { tipo: 'reque_sigue_ausente' }, 'pendiente_reque'],
    ['listo iniciar → enviando', env({ estado: 'listo' }), { tipo: 'iniciar_envio' }, 'enviando'],
    ['enviando enviado → enviado', env({ estado: 'enviando' }), { tipo: 'resultado_envio', resultado: 'enviado' }, 'enviado'],
    ['enviando rechazado → rechazado_tms', env({ estado: 'enviando' }), { tipo: 'resultado_envio', resultado: 'rechazado' }, 'rechazado_tms'],
    ['enviando transitorio → error_transitorio', env({ estado: 'enviando' }), { tipo: 'resultado_envio', resultado: 'transitorio' }, 'error_transitorio'],
    ['error_transitorio iniciar → enviando', env({ estado: 'error_transitorio', intentos: 1 }), { tipo: 'iniciar_envio' }, 'enviando'],
  ];
  it.each(casos)('%s', (_n, e, ev, esperado) => {
    expect(ok(siguienteEstado(e, ev, CFG, AHORA)).estado).toBe(esperado);
  });

  it('revisar devuelve el documento a por_revisar con el motivo', () => {
    const t = ok(siguienteEstado(env(), { tipo: 'prechequeo', accion: 'revisar', motivo: 'Falta la caja.' }, CFG, AHORA));
    expect(t.devolverDocumento).toEqual({ estado: 'por_revisar', motivo: 'Falta la caja.' });
    expect(t.proximaRevision).toBeNull();
  });

  it('entrar a listo reinicia el contador de intentos', () => {
    expect(ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 5 }), { tipo: 'reque_aparecio' }, CFG, AHORA)).intentos).toBe(0);
  });

  it('eventos que no aplican al estado se rechazan sin excepción', () => {
    const t = siguienteEstado(env({ estado: 'listo' }), { tipo: 'reque_aparecio' }, CFG, AHORA);
    expect(t.ok).toBe(false);
  });

  it.each(ESTADOS_TERMINALES)('%s es terminal: ningún evento lo mueve', (estado) => {
    const eventos: EventoEnvio[] = [{ tipo: 'reque_aparecio' }, { tipo: 'iniciar_envio' }, { tipo: 'prechequeo', accion: 'enviar' }, { tipo: 'resultado_envio', resultado: 'enviado' }];
    for (const ev of eventos) expect(siguienteEstado(env({ estado }), ev, CFG, AHORA).ok).toBe(false);
  });

  it('rechazado_tms exige corrección humana (envío nuevo) y lo dice', () => {
    const t = siguienteEstado(env({ estado: 'rechazado_tms' }), { tipo: 'iniciar_envio' }, CFG, AHORA);
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.razon).toMatch(/reaprobar/);
  });
});

describe('envio_estados · pendiente_reque, reintentos y alerta única', () => {
  it('cada revisión fallida suma 1 y programa ahora + frecuencia', () => {
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
    expect(t.intentos).toBe(2);
    expect(t.proximaRevision?.toISOString()).toBe('2026-03-10T19:00:00.000Z');
    expect(t.alerta).toBeNull();
    expect(t.agotado).toBe(false);
  });

  it('con reintentosMax=6 el 6.º intento aún no alerta y el 7.º sí', () => {
    const sexto = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 5 }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
    expect(sexto.intentos).toBe(6);
    expect(sexto.alerta).toBeNull();
    const septimo = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 6 }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
    expect(septimo.alerta).toEqual({ motivo: 'reque_agotado', destinatario: 'oficina@ejemplo.test' });
    expect(septimo.agotado).toBe(true);
    expect(septimo.estado).toBe('pendiente_reque');
    expect(septimo.proximaRevision).toBeNull();
    expect(septimo.mensaje).toBe('Sigue sin requerimiento: avisamos a oficina@ejemplo.test.');
  });

  it('el 7.º intento dispara UNA sola alerta aunque se llame 3 veces (candado + estado)', () => {
    // Simula la fila y el candado `cp_envio_marcar_alerta` (UPDATE condicional).
    let fila = env({ estado: 'pendiente_reque', intentos: 6 });
    let avisos = 0;
    for (let i = 0; i < 3; i++) {
      const t = ok(siguienteEstado(fila, { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
      if (t.alerta && !fila.alertaEnviada) { fila = { ...fila, alertaEnviada: true }; avisos++; }
      fila = { ...fila, estado: t.estado, intentos: t.intentos, agotado: t.agotado };
    }
    expect(avisos).toBe(1);
  });

  it('con alertaEnviada=true nunca vuelve a pedir alerta', () => {
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 6, alertaEnviada: true }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
    expect(t.alerta).toBeNull();
    expect(t.agotado).toBe(true);
  });

  it('una vez agotado no cuenta más intentos ni vuelve a pedir alerta', () => {
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 7, agotado: true }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA));
    expect(t.intentos).toBe(7);
    expect(t.alerta).toBeNull();
    expect(t.proximaRevision).toBeNull();
    expect(t.mensaje).toMatch(/Sigue sin requerimiento/);
  });

  it('si el reque aparece aun agotado, el envío pasa a listo', () => {
    expect(ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 7, agotado: true }), { tipo: 'reque_aparecio' }, CFG, AHORA)).estado).toBe('listo');
  });

  it('el primer prechequeo fallido es el intento 1; con reintentosMax=0 alerta de inmediato', () => {
    const a = ok(siguienteEstado(env(), { tipo: 'prechequeo', accion: 'pendiente_reque' }, CFG, AHORA));
    expect(a.intentos).toBe(1);
    const b = ok(siguienteEstado(env(), { tipo: 'prechequeo', accion: 'pendiente_reque' }, { ...CFG, reintentosMax: 0 }, AHORA));
    expect(b.alerta?.motivo).toBe('reque_agotado');
  });

  it('sin destinatario configurado el aviso dice «la oficina»', () => {
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 6 }), { tipo: 'reque_sigue_ausente' }, { ...CFG, destinatarioAlertaCorreo: null }, AHORA));
    expect(t.alerta?.destinatario).toBe('la oficina');
    expect(t.mensaje).toBe('Sigue sin requerimiento: avisamos a la oficina.');
  });
});

describe('envio_estados · errores transitorios y rechazo', () => {
  it('multiplicador de backoff: 1, 2, 4, 8, 8', () => {
    expect([1, 2, 3, 4, 5, 6].map(multiplicadorBackoff)).toEqual([1, 2, 4, 8, 8, 8]);
  });

  it('el backoff se aplica a la frecuencia y topa en 5 reintentos', () => {
    const horas: number[] = [];
    let fila = env({ estado: 'enviando' });
    for (let i = 1; i <= TOPE_TRANSITORIOS; i++) {
      const t = ok(siguienteEstado(fila, { tipo: 'resultado_envio', resultado: 'transitorio' }, CFG, AHORA));
      horas.push((t.proximaRevision!.getTime() - AHORA.getTime()) / 3600000);
      expect(t.alerta).toBeNull();
      fila = { ...fila, estado: 'enviando', intentos: t.intentos };
    }
    expect(horas).toEqual([1, 2, 4, 8, 8]);
    const sexto = ok(siguienteEstado(fila, { tipo: 'resultado_envio', resultado: 'transitorio' }, CFG, AHORA));
    expect(sexto.agotado).toBe(true);
    expect(sexto.proximaRevision).toBeNull();
    expect(sexto.alerta?.motivo).toBe('transitorio_agotado');
  });

  it('un error_transitorio agotado ya no reintenta solo', () => {
    expect(siguienteEstado(env({ estado: 'error_transitorio', intentos: 6, agotado: true }), { tipo: 'iniciar_envio' }, CFG, AHORA).ok).toBe(false);
  });

  it('rechazo: terminal, alerta única con motivo rechazado_tms', () => {
    const t = ok(siguienteEstado(env({ estado: 'enviando' }), { tipo: 'resultado_envio', resultado: 'rechazado' }, CFG, AHORA));
    expect(t.estado).toBe('rechazado_tms');
    expect(t.proximaRevision).toBeNull();
    expect(t.alerta?.motivo).toBe('rechazado_tms');
    const ya = ok(siguienteEstado(env({ estado: 'enviando', alertaEnviada: true }), { tipo: 'resultado_envio', resultado: 'rechazado' }, CFG, AHORA));
    expect(ya.alerta).toBeNull();
  });
});

describe('envio_estados · ventana horaria y zona explícita', () => {
  const V: ConfigMaquina = { ...CFG, ventanaInicio: '08:00', ventanaFin: '18:00' };

  it('dentro de la ventana no desplaza', () => {
    // 18:00Z = 12:00 en Ciudad de México (UTC-6, sin horario de verano en 2026) → +60 min = 13:00 local, dentro.
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, V, AHORA));
    expect(t.proximaRevision?.toISOString()).toBe('2026-03-10T19:00:00.000Z');
  });

  it('pasada la hora de cierre se desplaza al inicio del día siguiente (hora local)', () => {
    // 23:30Z = 17:30 local; +60 = 18:30 local, fuera → 08:00 local del 11 = 14:00Z.
    const tarde = new Date('2026-03-10T23:30:00.000Z');
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, V, tarde));
    expect(t.proximaRevision?.toISOString()).toBe('2026-03-11T14:00:00.000Z');
  });

  it('antes de abrir se desplaza al inicio del mismo día', () => {
    // 10:00Z = 04:00 local; +60 = 05:00 local, antes de abrir → 08:00 local = 14:00Z del mismo día.
    const madrugada = new Date('2026-03-10T10:00:00.000Z');
    const t = ok(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, V, madrugada));
    expect(t.proximaRevision?.toISOString()).toBe('2026-03-10T14:00:00.000Z');
  });

  it('la zona es explícita: la misma hora cae en otro lado según la zona', () => {
    const t = new Date('2026-03-10T14:30:00.000Z'); // 08:30 México / 15:30 Madrid... fuera para Tokio (23:30)
    expect(ajustarAVentana(t, '08:00', '18:00', 'America/Mexico_City').toISOString()).toBe(t.toISOString());
    expect(ajustarAVentana(t, '08:00', '18:00', 'Asia/Tokyo').toISOString()).toBe('2026-03-10T23:00:00.000Z'); // Tokio: 23:30 local, abre a las 08:00 JST = 23:00Z
  });

  it('ventana que cruza medianoche', () => {
    const noche: [string, string] = ['22:00', '06:00'];
    const dentro = new Date('2026-03-11T05:00:00.000Z'); // 23:00 local
    expect(ajustarAVentana(dentro, ...noche).toISOString()).toBe(dentro.toISOString());
    const fuera = new Date('2026-03-10T18:00:00.000Z'); // 12:00 local → hoy 22:00 local = 04:00Z del 11
    expect(ajustarAVentana(fuera, ...noche).toISOString()).toBe('2026-03-11T04:00:00.000Z');
  });

  it('sin ventana (o a medias) no cambia nada', () => {
    expect(ajustarAVentana(AHORA, null, null)).toBe(AHORA);
    expect(ajustarAVentana(AHORA, '08:00', null)).toBe(AHORA);
  });

  it('la zona por omisión es explícita y no depende del servidor', () => {
    expect(ZONA_FLOTA_POR_DEFECTO).toBe('America/Mexico_City');
  });
});

describe('envio_estados · invariante de bloqueos', () => {
  it('cumpleInvariante: listo + bloqueos es inválido', () => {
    expect(cumpleInvariante('listo', 1)).toBe(false);
    expect(cumpleInvariante('listo', 0)).toBe(true);
    expect(cumpleInvariante('pendiente_reque', 3)).toBe(true);
  });

  it('con bloqueos abiertos jamás se llega a listo (prechequeo y reque)', () => {
    for (const [e, ev] of [
      [env({ bloqueosAbiertos: 2 }), { tipo: 'prechequeo', accion: 'enviar' }],
      [env({ estado: 'pendiente_reque', bloqueosAbiertos: 1 }), { tipo: 'reque_aparecio' }],
    ] as Array<[EnvioEnMaquina, EventoEnvio]>) {
      const t = ok(siguienteEstado(e, ev, CFG, AHORA));
      expect(t.estado).not.toBe('listo');
      expect(t.estado).toBe('descartado');
      expect(t.devolverDocumento?.estado).toBe('por_revisar');
    }
  });

  it('un envío listo cuyo documento recibe bloqueos no pasa a enviando', () => {
    const t = ok(siguienteEstado(env({ estado: 'listo', bloqueosAbiertos: 1 }), { tipo: 'iniciar_envio' }, CFG, AHORA));
    expect(t.estado).toBe('descartado');
    expect(t.devolverDocumento?.motivo).toMatch(/bloqueos/);
  });

  it('ninguna transición válida produce listo con bloqueos (barrido de estados y eventos)', () => {
    const estados: EstadoEnvioTms[] = ['pendiente_prechequeo', 'pendiente_reque', 'listo', 'enviando', 'error_transitorio'];
    const eventos: EventoEnvio[] = [
      { tipo: 'prechequeo', accion: 'enviar' }, { tipo: 'reque_aparecio' }, { tipo: 'reque_sigue_ausente' }, { tipo: 'iniciar_envio' },
      { tipo: 'resultado_envio', resultado: 'enviado' }, { tipo: 'resultado_envio', resultado: 'transitorio' },
    ];
    for (const estado of estados) for (const ev of eventos) {
      const t = siguienteEstado(env({ estado, bloqueosAbiertos: 1 }), ev, CFG, AHORA);
      if (t.ok) expect(cumpleInvariante(t.estado, 1)).toBe(true);
    }
  });
});

describe('envio_estados · determinismo', () => {
  it('no usa el reloj del sistema: mismo resultado con reloj simulado distinto', () => {
    const a = siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA);
    const antes = Date.now;
    Date.now = () => 0;
    try {
      expect(siguienteEstado(env({ estado: 'pendiente_reque', intentos: 1 }), { tipo: 'reque_sigue_ausente' }, CFG, AHORA)).toEqual(a);
    } finally { Date.now = antes; }
  });
});
