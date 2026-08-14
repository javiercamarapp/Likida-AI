import { describe, it, expect } from 'vitest';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  AGENTES_NOTIFICABLES, EVENTOS, ROLES_AVISABLES, MARCAS_DE_INSISTENCIA,
  MAX_DESTINATARIOS, PISO_ENTRE_AVISOS_MS, CONFIG_NOTIF_DEFAULT,
  agentePorId, eventosDe, rolesQuePueden, validarConfigNotificaciones,
  marcaAlcanzada, debeAvisar, motivoDeCorrida, repartoDe, puedeConfigurarAvisos,
  PARES_CON_EMISOR, tieneEmisor,
  type ConfigNotificaciones, type EntradaDecision, type HuellaAviso,
  type UsuarioAvisable,
} from './notificaciones';

// ═══════════════════════════════════════════════════════════════════════════
// La lógica PURA de la pestaña Notificaciones. Nada de esto toca la base:
// son las decisiones que un correo de más arruinaría — y un correo de más
// enseña a ignorar los que sí piden algo.
// ═══════════════════════════════════════════════════════════════════════════

const COBRANZA = agentePorId('cobranza')!;
const CONDUCTORES = agentePorId('conductores')!;

/** La entrada "todo en orden para avisar", que cada prueba tuerce en un solo
 *  eje. Así el motivo del corte es siempre atribuible. */
function entrada(sobre: Partial<EntradaDecision> = {}): EntradaDecision {
  return {
    canalListo: true,
    eventoEncendido: true,
    destinatarios: 2,
    hayProblema: true,
    magnitud: 1,
    ultimo: null,
    ultimoDeIncidenteCerrado: false,
    ahora: new Date('2026-08-14T15:00:00Z'),
    ...sobre,
  };
}

// ── EL CATÁLOGO ────────────────────────────────────────────────────────────

describe('el catálogo declara agentes reales, no una lista suelta', () => {
  it('son los seis agentes y sus llaves no se repiten', () => {
    expect(AGENTES_NOTIFICABLES).toHaveLength(6);
    const ids = AGENTES_NOTIFICABLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('la ruta de cada agente es una que el panel sabe gatear', () => {
    // Si una ruta no está en el mapa de visibilidad, `puedeVerRuta` la niega
    // para TODOS los roles y ese agente no podría avisarle a nadie — un
    // interruptor que nunca dispara, que es lo que esta pestaña combate.
    for (const a of AGENTES_NOTIFICABLES) {
      expect(rolesQuePueden(a), a.id).not.toHaveLength(0);
    }
  });

  it('todo evento declarado tiene su texto en el catálogo', () => {
    for (const a of AGENTES_NOTIFICABLES) {
      for (const e of a.eventos) {
        expect(EVENTOS[e], `${a.id}/${e}`).toBeDefined();
        expect(EVENTOS[e].porQue.length).toBeGreaterThan(20);
      }
    }
  });

  it('los seis pueden fallar una corrida — es el único evento universal', () => {
    for (const a of AGENTES_NOTIFICABLES) {
      expect(a.eventos, a.id).toContain('corrida_fallida');
    }
  });

  it('`escalado` solo lo declara quien de verdad escala (Conductores)', () => {
    const conEscalado = AGENTES_NOTIFICABLES.filter((a) => a.eventos.includes('escalado'));
    expect(conEscalado.map((a) => a.id)).toEqual(['conductores']);
  });

  it('ningún evento del catálogo es un "todo salió bien"', () => {
    // La regla que define la pestaña: solo se avisa de lo que pide a una
    // persona. Un aviso de éxito es el que más rápido enseña a ignorar.
    for (const e of Object.values(EVENTOS)) {
      expect(`${e.titulo} ${e.cuando}`.toLowerCase()).not.toMatch(/complet|correctamente|sin problemas|exitos/);
    }
  });

  it('eventosDe devuelve los del agente, no los tres siempre', () => {
    expect(eventosDe(COBRANZA).map((e) => e.id)).toEqual(['corrida_fallida', 'cola_atorada']);
    expect(eventosDe(CONDUCTORES).map((e) => e.id)).toEqual(['corrida_fallida', 'cola_atorada', 'escalado']);
  });
});

describe('a quién se le puede ofrecer cada agente', () => {
  it('el contador no puede recibir avisos del Agente de Conductores', () => {
    // Es de área `operacion`: su botón lo rebotaría a /dashboard.
    expect(rolesQuePueden(CONDUCTORES)).not.toContain('contador');
    expect(puedeVerRuta('contador', CONDUCTORES.ruta)).toBe(false);
  });

  it('el jefe de tráfico no puede recibir avisos de un agente de dinero', () => {
    expect(rolesQuePueden(COBRANZA)).not.toContain('encargado');
  });

  it('el dueño de la flota puede recibir los de todos', () => {
    for (const a of AGENTES_NOTIFICABLES) {
      expect(rolesQuePueden(a), a.id).toContain('flota_admin');
    }
  });

  it('el operador nunca aparece: no tiene login ni columna de correo', () => {
    expect(ROLES_AVISABLES).not.toContain('operador' as never);
  });
});

// ── LA CONFIGURACIÓN ───────────────────────────────────────────────────────

describe('la configuración que se guarda no puede mentir', () => {
  it('el default nace con un solo aviso y una sola persona', () => {
    expect(CONFIG_NOTIF_DEFAULT.eventos).toEqual(['corrida_fallida']);
    expect(CONFIG_NOTIF_DEFAULT.roles).toEqual(['flota_admin']);
  });

  it('descarta un evento que ese agente no emite', () => {
    const v = validarConfigNotificaciones(COBRANZA, {
      eventos: ['corrida_fallida', 'escalado'], roles: ['flota_admin'],
    });
    expect('ok' in v && v.ok.eventos).toEqual(['corrida_fallida']);
  });

  it('descarta un rol que no puede abrir la pantalla del agente', () => {
    const v = validarConfigNotificaciones(COBRANZA, {
      eventos: ['corrida_fallida'], roles: ['flota_admin', 'encargado'],
    });
    expect('ok' in v && v.ok.roles).toEqual(['flota_admin']);
  });

  it('avisos encendidos sin nadie que los reciba es ERROR, no un guardado silencioso', () => {
    const v = validarConfigNotificaciones(COBRANZA, { eventos: ['corrida_fallida'], roles: [] });
    expect('error' in v).toBe(true);
  });

  it('apagarlo TODO sí es una decisión válida', () => {
    const v = validarConfigNotificaciones(COBRANZA, { eventos: [], roles: [] });
    expect('ok' in v && v.ok).toEqual({ eventos: [], roles: [] });
  });

  it('no guarda duplicados', () => {
    // Con `corrida_fallida` y no `cola_atorada`: desde que existe el filtro
    // por emisor, un evento sin quien lo dispare se descarta, y esta prueba
    // caza el DEDUP, no el filtro. Usar uno muerto la volvía verde por la
    // razón equivocada.
    const v = validarConfigNotificaciones(COBRANZA, {
      eventos: ['corrida_fallida', 'corrida_fallida'], roles: ['flota_admin', 'flota_admin'],
    });
    expect('ok' in v && v.ok).toEqual({ eventos: ['corrida_fallida'], roles: ['flota_admin'] });
  });

  it('basura del formulario no se cuela', () => {
    const v = validarConfigNotificaciones(COBRANZA, {
      eventos: ['; drop table', 'corrida_fallida'], roles: ['superadmin', 'flota_admin'],
    });
    expect('ok' in v && v.ok).toEqual({ eventos: ['corrida_fallida'], roles: ['flota_admin'] });
  });
});

// ── EL ANTI-RUIDO ──────────────────────────────────────────────────────────

describe('las marcas de insistencia', () => {
  it('por debajo de la primera no hay marca', () => {
    expect(marcaAlcanzada(0)).toBe(-1);
  });

  it('cada marca sube un escalón y no más', () => {
    expect(marcaAlcanzada(1)).toBe(0);
    expect(marcaAlcanzada(4)).toBe(0);
    expect(marcaAlcanzada(5)).toBe(1);
    expect(marcaAlcanzada(19)).toBe(1);
    expect(marcaAlcanzada(20)).toBe(2);
    expect(marcaAlcanzada(9_999)).toBe(MARCAS_DE_INSISTENCIA.length - 1);
  });
});

/**
 * El bucle real: un agente que falla N corridas seguidas, con `cada` ms entre
 * corridas. Devuelve CUÁNDO salió cada correo. Es la prueba que importa — el
 * resto son sus piezas.
 */
function correosDe(corridas: number, cada: number): number[] {
  let ultimo: HuellaAviso | null = null;
  let magnitud = 0;
  const salieron: number[] = [];
  const t0 = new Date('2026-08-14T06:00:00Z').getTime();
  for (let i = 0; i < corridas; i++) {
    magnitud += 1;
    const ahora = new Date(t0 + i * cada);
    const v = debeAvisar(entrada({ magnitud, ultimo, ahora }));
    if (v.avisar) {
      salieron.push(ahora.getTime());
      ultimo = { avisadoEn: ahora, magnitud };
    }
  }
  return salieron;
}

describe('un agente que falla 40 veces NO manda 40 correos', () => {
  it('manda tres: el primero, el de la mañana entera y el del día', () => {
    expect(correosDe(40, 60 * 60 * 1000)).toHaveLength(3);
  });

  it('la cuenta no crece por seguir fallando', () => {
    expect(correosDe(200, 60 * 60 * 1000)).toHaveLength(MARCAS_DE_INSISTENCIA.length);
  });

  it('un agente en bucle (una corrida cada 5 min) no manda dos en la misma hora', () => {
    // Sin el piso, las tres marcas se cruzan en 100 minutos y los tres correos
    // salen casi juntos: tres correos seguidos son un correo repetido. Con el
    // piso siguen saliendo los tres —la marca cruzada no se pierde—, pero
    // separados. Lo que se prueba es la SEPARACIÓN, no el conteo: el conteo lo
    // fijan las marcas y ya está probado arriba.
    const cuando = correosDe(40, 5 * 60 * 1000);
    expect(cuando.length).toBeGreaterThan(0);
    for (let i = 1; i < cuando.length; i++) {
      expect(cuando[i] - cuando[i - 1]).toBeGreaterThanOrEqual(PISO_ENTRE_AVISOS_MS);
    }
  });

  it('el primer fallo SIEMPRE avisa — el silencio inicial sería el peor bug', () => {
    expect(correosDe(1, 60 * 60 * 1000)).toHaveLength(1);
  });
});

describe('el filo se re-arma cuando el problema se resuelve', () => {
  it('resuelto y vuelto a romper, avisa otra vez desde la primera marca', () => {
    // `hayProblema: false` no manda nada Y pone la cuenta en cero (`avisar`
    // llama a `cerrarIncidente`); la huella del último correo se conserva, y
    // el motor la entrega con `ultimoDeIncidenteCerrado: true`.
    const sano = debeAvisar(entrada({ hayProblema: false, magnitud: 0, ultimo: { avisadoEn: new Date('2026-08-14T06:00:00Z'), magnitud: 7 } }));
    expect(sano.avisar).toBe(false);

    const recaida = debeAvisar(entrada({
      magnitud: 1,
      ultimo: { avisadoEn: new Date('2026-08-14T06:00:00Z'), magnitud: 7 },
      ultimoDeIncidenteCerrado: true,
      ahora: new Date('2026-08-14T15:00:00Z'),
    }));
    expect(recaida.avisar).toBe(true);
    expect(recaida.porque).toMatch(/primera vez/);
  });

  it('sin huella previa (nunca se avisó), la recaída avisa sin esperar nada', () => {
    // El caso `ultimo = null`: el incidente anterior nunca alcanzó a mandar
    // correo, así que no hay piso que respetar.
    const recaida = debeAvisar(entrada({ magnitud: 1, ultimo: null }));
    expect(recaida.avisar).toBe(true);
    expect(recaida.porque).toMatch(/primera vez/);
  });

  it('sin re-armar, la recaída se quedaría muda — por eso el cierre existe', () => {
    const conMemoriaVieja = debeAvisar(entrada({
      magnitud: 1,
      ultimo: { avisadoEn: new Date('2026-08-14T06:00:00Z'), magnitud: 7 },
    }));
    expect(conMemoriaVieja.avisar).toBe(false);
  });
});

describe('el parpadeo — B7: el piso de una hora sobrevive al cierre del incidente', () => {
  // El bug exacto de la auditoría 4: el cierre BORRABA la fila entera, el
  // siguiente incidente encontraba `ultimo === null` y `debeAvisar` lo
  // despachaba como «primera vez» sin consultar el piso. Un agente que falla
  // un lote sí y uno no mandaba un correo POR LOTE, con la pantalla jurando
  // «entre dos avisos siempre pasan al menos 60 minutos».
  const aviso = { avisadoEn: new Date('2026-08-14T06:00:00Z'), magnitud: 1 };

  it('falla→aviso→resuelve→falla DENTRO de la misma hora: NO hay segundo correo', () => {
    const v = debeAvisar(entrada({
      magnitud: 1,
      ultimo: aviso,
      ultimoDeIncidenteCerrado: true,
      ahora: new Date('2026-08-14T06:20:00Z'),
    }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toMatch(/problema nuevo/);
    expect(v.porque).toMatch(/sale en \d+ min/);
  });

  it('falla→aviso→resuelve→falla PASADA la hora: SÍ, y desde la primera marca', () => {
    const v = debeAvisar(entrada({
      magnitud: 1,
      ultimo: aviso,
      ultimoDeIncidenteCerrado: true,
      ahora: new Date('2026-08-14T07:00:01Z'),
    }));
    expect(v.avisar).toBe(true);
    expect(v.porque).toMatch(/primera vez/);
  });

  it('un agente que parpadea cada 5 minutos manda un correo por hora, no uno por lote', () => {
    // El bucle real del bug: falla un lote sí y uno no, con el cierre entre
    // cada par. Es la simulación exacta de `avisar`: el cierre pone la cuenta
    // en cero conservando la huella, y la reapertura entra con la marca de
    // incidente cerrado.
    const t0 = Date.parse('2026-08-14T06:00:00Z');
    let ultimo: HuellaAviso | null = null;
    let cerrado = false;
    const salieron: number[] = [];

    for (let i = 0; i < 36; i++) { // 3 horas de corridas cada 5 min
      const ahora = new Date(t0 + i * 5 * 60 * 1000);
      const falla = i % 2 === 0; // parpadeo: lote sí, lote no
      if (!falla) { cerrado = true; continue; } // el cierre conserva `ultimo`
      const v = debeAvisar(entrada({
        magnitud: 1, ultimo, ultimoDeIncidenteCerrado: cerrado && ultimo !== null, ahora,
      }));
      if (v.avisar) {
        salieron.push(ahora.getTime());
        ultimo = { avisadoEn: ahora, magnitud: 1 };
        cerrado = false;
      }
    }

    // NO es silencio permanente (avisa cada hora) y NO es un correo por lote.
    expect(salieron.length).toBe(3);
    for (let i = 1; i < salieron.length; i++) {
      expect(salieron[i] - salieron[i - 1]).toBeGreaterThanOrEqual(PISO_ENTRE_AVISOS_MS);
    }
  });
});

describe('nunca sale un correo de "todo salió bien"', () => {
  it('sin problema no hay aviso, aunque todo lo demás esté encendido', () => {
    const v = debeAvisar(entrada({ hayProblema: false }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toBe('no hay nada que avisar ahora mismo.');
  });
});

describe('los cortes previos, en el orden que le sirve a quien lee', () => {
  it('sin canal configurado lo dice, aunque el evento esté encendido', () => {
    const v = debeAvisar(entrada({ canalListo: false }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toMatch(/no está configurado/);
  });

  it('el evento apagado se declara apagado', () => {
    expect(debeAvisar(entrada({ eventoEncendido: false })).porque).toMatch(/apagado/);
  });

  it('sin destinatarios NO se manda y se dice por qué', () => {
    const v = debeAvisar(entrada({ destinatarios: 0 }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toMatch(/nadie de la flota/);
  });

  it('la falta de canal gana sobre la falta de destinatarios: es lo accionable', () => {
    expect(debeAvisar(entrada({ canalListo: false, destinatarios: 0 })).porque).toMatch(/configurado/);
  });
});

describe('el piso de una hora es un cinturón, no un candado', () => {
  const base = { avisadoEn: new Date('2026-08-14T15:00:00Z'), magnitud: 1 };

  it('a los 10 minutos y con marca nueva, todavía no sale', () => {
    const v = debeAvisar(entrada({
      magnitud: 6, ultimo: base, ahora: new Date('2026-08-14T15:10:00Z'),
    }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toMatch(/sale en \d+ min/);
  });

  it('pasada la hora, la marca cruzada sigue cruzada y el aviso sale', () => {
    const v = debeAvisar(entrada({
      magnitud: 6, ultimo: base, ahora: new Date(base.avisadoEn.getTime() + PISO_ENTRE_AVISOS_MS + 1_000),
    }));
    expect(v.avisar).toBe(true);
    expect(v.porque).toMatch(/empeoró/);
  });

  it('pasada la hora SIN marca nueva no sale: el reloj no es noticia', () => {
    const v = debeAvisar(entrada({
      magnitud: 2, ultimo: base, ahora: new Date('2026-08-15T15:00:00Z'),
    }));
    expect(v.avisar).toBe(false);
    expect(v.porque).toMatch(/el siguiente sale al llegar a 5/);
  });
});

describe('una cola que oscila no manda un correo por oscilación', () => {
  it('sube a 5, baja a 4, vuelve a 5: un solo correo', () => {
    let ultimo: HuellaAviso | null = null;
    let salieron = 0;
    const t0 = Date.parse('2026-08-14T06:00:00Z');
    // Magnitud MEDIDA (piezas atoradas), no racha: entra tal cual.
    [5, 4, 5, 4, 5].forEach((piezas, i) => {
      const ahora = new Date(t0 + i * 6 * 60 * 60 * 1000);
      const v = debeAvisar(entrada({ magnitud: piezas, ultimo, ahora }));
      if (v.avisar) { salieron++; ultimo = { avisadoEn: ahora, magnitud: piezas }; }
    });
    expect(salieron).toBe(1);
  });
});

describe('una magnitud incoherente no calla un problema real', () => {
  it('con problema y magnitud 0, se cuenta como 1 y avisa', () => {
    expect(debeAvisar(entrada({ magnitud: 0 })).avisar).toBe(true);
  });
});

// ── EL MOTIVO QUE VE UNA PERSONA ───────────────────────────────────────────

describe('el motivo del correo nunca es un stack trace', () => {
  it('de un Error se queda el mensaje, sin los marcos de pila', () => {
    const e = new Error('No se pudo leer la cola de cobranza.');
    e.stack = 'Error: x\n    at colaCobranza (/var/task/cobranza.js:118:11)';
    const m = motivoDeCorrida(e);
    expect(m).toBe('No se pudo leer la cola de cobranza.');
    expect(m).not.toMatch(/at /);
  });

  it('un texto multilínea con pila se queda con la primera línea útil', () => {
    expect(motivoDeCorrida('  \n    at foo (bar.js:1:1)\nSe agotó el tiempo del portal.'))
      .toBe('Se agotó el tiempo del portal.');
  });

  it('sin motivo legible dice que no lo hay, en vez de dejar el renglón vacío', () => {
    expect(motivoDeCorrida('')).toMatch(/sin dejar un motivo/);
    expect(motivoDeCorrida(null)).toMatch(/sin dejar un motivo/);
    expect(motivoDeCorrida({ raro: true })).toMatch(/sin dejar un motivo/);
  });

  it('un motivo larguísimo se recorta con puntos suspensivos', () => {
    const m = motivoDeCorrida('x'.repeat(500));
    expect(m.length).toBeLessThanOrEqual(160);
    expect(m.endsWith('…')).toBe(true);
  });
});

// ── EL REPARTO ─────────────────────────────────────────────────────────────

const CONFIG_TODOS: ConfigNotificaciones = { eventos: ['corrida_fallida'], roles: ['flota_admin', 'contador'] };

function usuario(sobre: Partial<UsuarioAvisable> & { id: string }): UsuarioAvisable {
  return { nombre: null, email: `${sobre.id}@flota.mx`, rol: 'flota_admin', ...sobre };
}

describe('el reparto dice a quién le llega Y a quién no, con el porqué', () => {
  it('quien tiene rol marcado y correo, recibe', () => {
    const r = repartoDe([usuario({ id: 'a' })], CONFIG_TODOS, COBRANZA);
    expect(r.reciben.map((d) => d.email)).toEqual(['a@flota.mx']);
    expect(r.excluidos).toHaveLength(0);
  });

  it('un rol que no abre la pantalla queda fuera aunque la config lo traiga', () => {
    // Config vieja que quedó con `encargado` en un agente de dinero.
    const sucia = { eventos: ['corrida_fallida'], roles: ['flota_admin', 'encargado'] } as ConfigNotificaciones;
    const r = repartoDe([usuario({ id: 'e', rol: 'encargado' })], sucia, COBRANZA);
    expect(r.reciben).toHaveLength(0);
    expect(r.excluidos[0].porque).toMatch(/no puede abrir la pantalla/);
  });

  it('un rol no marcado se declara no marcado, no "sin correo"', () => {
    const solo = { eventos: ['corrida_fallida'], roles: ['flota_admin'] } as ConfigNotificaciones;
    const r = repartoDe([usuario({ id: 'c', rol: 'contador' })], solo, COBRANZA);
    expect(r.excluidos[0].porque).toMatch(/no está marcado/);
  });

  it('una cuenta sin correo se declara, no se rellena con nada', () => {
    const r = repartoDe([usuario({ id: 'a', email: null }), usuario({ id: 'b', email: '   ' })], CONFIG_TODOS, COBRANZA);
    expect(r.reciben).toHaveLength(0);
    expect(r.excluidos.map((x) => x.porque)).toEqual(['su cuenta no tiene correo', 'su cuenta no tiene correo']);
  });

  it('dos cuentas con el mismo correo no lo reciben dos veces', () => {
    const r = repartoDe(
      [usuario({ id: 'a', email: 'jefe@flota.mx' }), usuario({ id: 'b', email: 'JEFE@flota.mx' })],
      CONFIG_TODOS, COBRANZA,
    );
    expect(r.reciben).toHaveLength(1);
    expect(r.excluidos[0].porque).toMatch(/mismo correo/);
  });

  it('nunca se manda a un operador: no está entre los roles que pueden', () => {
    const r = repartoDe([usuario({ id: 'op', rol: 'operador', email: 'chofer@x.mx' })], CONFIG_TODOS, COBRANZA);
    expect(r.reciben).toHaveLength(0);
  });

  it('el tope de destinatarios recorta y lo declara, en vez de tumbar el envío', () => {
    const muchos = Array.from({ length: MAX_DESTINATARIOS + 3 }, (_, i) => usuario({ id: `u${i}` }));
    const r = repartoDe(muchos, CONFIG_TODOS, COBRANZA);
    expect(r.reciben).toHaveLength(MAX_DESTINATARIOS);
    expect(r.excluidos).toHaveLength(3);
    expect(r.excluidos[0].porque).toMatch(/primeras/);
  });

  it('con la config apagada nadie recibe, y nadie queda sin explicación', () => {
    const apagada: ConfigNotificaciones = { eventos: [], roles: [] };
    const r = repartoDe([usuario({ id: 'a' }), usuario({ id: 'b', rol: 'contador' })], apagada, COBRANZA);
    expect(r.reciben).toHaveLength(0);
    expect(r.excluidos).toHaveLength(2);
    for (const x of r.excluidos) expect(x.porque.length).toBeGreaterThan(10);
  });
});

describe('puedeConfigurarAvisos — la puerta de la escritura multi-tenant', () => {
  const cobranza = agentePorId('cobranza')!;      // área dinero
  const conductores = agentePorId('conductores')!; // área operación

  it('el dueño de SU flota pasa', () => {
    expect(puedeConfigurarAvisos({ rol: 'flota_admin', tenantId: 'A' }, 'A', cobranza)).toBeNull();
  });

  it('el dueño de OTRA flota no pasa — es el IDOR que esta puerta existe para tapar', () => {
    // El render nunca le enseña esta pantalla, pero la action es alcanzable
    // por POST directo: sin este cruce, reconfiguraría los correos de una
    // empresa que no es la suya.
    expect(puedeConfigurarAvisos({ rol: 'flota_admin', tenantId: 'B' }, 'A', cobranza))
      .toBe('Este agente no es de tu flota.');
  });

  it('el jefe de tráfico NO configura un agente de dinero', () => {
    // No es una regla nueva: es la misma `puedeVerRuta` que decide si puede
    // abrir la pantalla. Si pudiera configurarlo, se mandaría a sí mismo un
    // correo cuyo botón lo rebota fuera.
    expect(puedeConfigurarAvisos({ rol: 'encargado', tenantId: 'A' }, 'A', cobranza))
      .toBe('Tu rol no puede configurar los avisos de este agente.');
  });

  it('el jefe de tráfico SÍ configura el de conductores, que es su área', () => {
    expect(puedeConfigurarAvisos({ rol: 'encargado', tenantId: 'A' }, 'A', conductores)).toBeNull();
  });

  it('el contador NO configura el de conductores', () => {
    expect(puedeConfigurarAvisos({ rol: 'contador', tenantId: 'A' }, 'A', conductores))
      .toBe('Tu rol no puede configurar los avisos de este agente.');
  });

  it('el operador no configura nada: no tiene panel', () => {
    for (const a of AGENTES_NOTIFICABLES) {
      expect(puedeConfigurarAvisos({ rol: 'operador', tenantId: 'A' }, 'A', a), a.id).toBeTruthy();
    }
  });

  it('el superadmin SÍ cruza flotas — es su consola, y es la única excepción', () => {
    expect(puedeConfigurarAvisos({ rol: 'superadmin', tenantId: 'B' }, 'A', cobranza)).toBeNull();
    expect(puedeConfigurarAvisos({ rol: 'superadmin', tenantId: null }, 'A', conductores)).toBeNull();
  });

  it('una sesión sin tenant que NO es superadmin no pasa', () => {
    // `null !== 'A'`, y el orden importa: el rol se revisa antes que el tenant,
    // pero ninguno de los dos se salta.
    expect(puedeConfigurarAvisos({ rol: 'flota_admin', tenantId: null }, 'A', cobranza))
      .toBe('Este agente no es de tu flota.');
  });

  it('un rol inventado no pasa por ningún agente', () => {
    // Fallar cerrado ante un valor que no está en el dominio: si mañana alguien
    // agrega un rol a la base y olvida `visibilidad.ts`, no hereda permisos.
    for (const a of AGENTES_NOTIFICABLES) {
      expect(puedeConfigurarAvisos({ rol: 'auditor_externo', tenantId: 'A' }, 'A', a), a.id).toBeTruthy();
    }
  });
});


describe('un interruptor sin emisor no se puede encender', () => {
  // EL BUG QUE ESTO EXISTE PARA QUE NO VUELVA: el 14-ago-2026 la pestaña salió
  // con 18 interruptores de los que 16 no podían dispararse nunca. El catálogo
  // declaraba `cola_atorada` para los seis agentes y `escalado` para
  // conductores, y ninguno tenía una sola línea que lo emitiera — con sus
  // plantillas de correo ya escritas y sin llamador. El dueño marcaba la
  // casilla, la pantalla le contestaba "Hoy le llega a: Juan Pérez", y se
  // quedaba esperando un correo que no existía.
  it('los pares declarados con emisor existen de verdad en el catálogo', () => {
    // Si alguien borra un agente o le quita un evento, esta tabla queda
    // citando un par fantasma y el filtro dejaría de morder sin avisar.
    for (const par of PARES_CON_EMISOR) {
      const [id, evento] = par.split(':');
      const agente = agentePorId(id);
      expect(agente, `${par}: ese agente no existe`).not.toBeNull();
      expect(agente!.eventos, `${par}: ese agente no declara ese evento`).toContain(evento);
    }
  });

  it('`cola_atorada` NO se guarda en ningún agente: hoy nadie lo emite', () => {
    for (const a of AGENTES_NOTIFICABLES) {
      if (!a.eventos.includes('cola_atorada')) continue;
      const v = validarConfigNotificaciones(a, { eventos: ['cola_atorada'], roles: ['flota_admin'] });
      expect('ok' in v && v.ok.eventos, a.id).toEqual([]);
    }
  });

  it('`escalado` SÍ se guarda en conductores: lo emite escalar_viaje', () => {
    // El cierre de `escalarViajesSinAceptar` llama `avisar(..., 'escalado', ...)`
    // por cada flota con viajes escalados — el par entró a CON_EMISOR en el
    // mismo commit que su emisor, como manda el comentario de esa tabla.
    const c = agentePorId('conductores')!;
    const v = validarConfigNotificaciones(c, { eventos: ['escalado'], roles: ['encargado'] });
    expect('ok' in v && v.ok.eventos).toEqual(['escalado']);
  });

  it('`corrida_fallida` SÍ se guarda donde hay emisor', () => {
    for (const id of ['cobranza', 'facturas', 'conductores']) {
      const a = agentePorId(id)!;
      const v = validarConfigNotificaciones(a, {
        eventos: ['corrida_fallida'], roles: [rolesQuePueden(a)[0]],
      });
      expect('ok' in v && v.ok.eventos, id).toEqual(['corrida_fallida']);
    }
  });

  it('`corrida_fallida` NO se guarda donde todavía no hay emisor', () => {
    // liquidación, peajes y proveedores declaran el evento y ninguno llama a
    // `avisar()`. Ofrecerlo sería la misma mentira.
    for (const id of ['liquidacion', 'peajes', 'proveedores']) {
      const a = agentePorId(id)!;
      const v = validarConfigNotificaciones(a, {
        eventos: ['corrida_fallida'], roles: [rolesQuePueden(a)[0]],
      });
      expect('ok' in v && v.ok.eventos, id).toEqual([]);
    }
  });

  it('la pestaña recibe cada evento diciendo si está conectado', () => {
    // Es lo que le permite pintarlo apagado con su explicación en vez de
    // esconderlo: el evento sigue siendo el roadmap del agente.
    const cobranza = eventosDe(agentePorId('cobranza')!);
    expect(cobranza.find((e) => e.id === 'corrida_fallida')!.conectado).toBe(true);
    expect(cobranza.find((e) => e.id === 'cola_atorada')!.conectado).toBe(false);
  });

  it('apagar algo que estaba encendido no queda bloqueado por el filtro', () => {
    // Si una flota alcanzó a guardar `cola_atorada` antes del candado, tiene
    // que poder quedar en cero sin toparse con el error de "marca un rol".
    const v = validarConfigNotificaciones(COBRANZA, { eventos: ['cola_atorada'], roles: [] });
    expect('ok' in v && v.ok).toEqual({ eventos: [], roles: [] });
  });
});
