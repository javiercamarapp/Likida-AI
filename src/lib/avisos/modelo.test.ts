import { describe, expect, it } from 'vitest';
import {
  aplicarPreferencias, categoriasApagadasEnApp, clavesParaMarcarTodo, contarNoLeidos, contarPestanas, enSilencio, estaActivo, estaLeido,
  filtrarAvisos, FILTROS_INICIALES, hayCriticoNoLeido, ordenarAvisos, validarSilencio, type Aviso, type Silencio,
} from './modelo';

const av = (p: Partial<Aviso> & { clave: string }): Aviso => ({
  fuente: 'x', categoria: 'escalaciones', severidad: 'atencion', titulo: p.clave, detalle: null, href: '/x', desde: null, silenciable: true, ...p,
});

describe('contar y leer', () => {
  const avisos = [av({ clave: 'a|1' }), av({ clave: 'b|2' }), av({ clave: 'arco|2', silenciable: false, severidad: 'critica' })];

  it('el número del pie es exactamente lo que muestra «No leídas»', () => {
    const leidas = new Set(['a|1']);
    expect(contarNoLeidos(avisos, leidas)).toBe(2);
    expect(filtrarAvisos(avisos, leidas, FILTROS_INICIALES)).toHaveLength(contarNoLeidos(avisos, leidas));
    expect(contarPestanas(avisos, leidas)).toEqual({ no_leidos: 2, leidos: 1, todos: 3 });
  });

  it('lo que «leído» no puede ocultar sigue contando aunque su clave esté en la base', () => {
    const leidas = new Set(['arco|2']);
    expect(estaLeido(avisos[2], leidas)).toBe(false);
    expect(contarNoLeidos(avisos, leidas)).toBe(3);
    expect(hayCriticoNoLeido(avisos, leidas)).toBe(true);
  });

  it('si la condición cambia (otra huella) vuelve como no leído', () => {
    expect(estaLeido(av({ clave: 'huerfanos|3' }), new Set(['huerfanos|3']))).toBe(true);
    expect(estaLeido(av({ clave: 'huerfanos|5' }), new Set(['huerfanos|3']))).toBe(false);
  });

  it('pestañas Leídas y Todas, y filtros por tipo y severidad', () => {
    const lista = [av({ clave: 'a', categoria: 'soporte', severidad: 'critica' }), av({ clave: 'b', categoria: 'sistema', severidad: 'info' })];
    const leidas = new Set(['b']);
    expect(filtrarAvisos(lista, leidas, { ...FILTROS_INICIALES, pestana: 'leidos' }).map((a) => a.clave)).toEqual(['b']);
    expect(filtrarAvisos(lista, leidas, { ...FILTROS_INICIALES, pestana: 'todos' })).toHaveLength(2);
    expect(filtrarAvisos(lista, leidas, { pestana: 'todos', categoria: 'soporte', severidad: 'todas' }).map((a) => a.clave)).toEqual(['a']);
    expect(filtrarAvisos(lista, leidas, { pestana: 'todos', categoria: 'todas', severidad: 'info' }).map((a) => a.clave)).toEqual(['b']);
  });

  it('«marcar todo» solo escribe lo silenciable y aún no leído de lo que se ve', () => {
    expect(clavesParaMarcarTodo(avisos, new Set(['a|1']))).toEqual(['b|2']);
  });

  it('ordena crítico primero y, a igual severidad, el que más espera; sin hora al final', () => {
    const o = ordenarAvisos([
      av({ clave: 'n', desde: null }), av({ clave: 'viejo', desde: '2026-11-01T00:00:00Z' }),
      av({ clave: 'nuevo', desde: '2026-11-09T00:00:00Z' }), av({ clave: 'crit', severidad: 'critica' }),
    ]);
    expect(o.map((a) => a.clave)).toEqual(['crit', 'viejo', 'nuevo', 'n']);
  });
});

describe('preferencias', () => {
  it('sin fila = encendido; apagar «en la app» oculta lo silenciable pero nunca lo no silenciable', () => {
    const prefs = [{ categoria: 'costos' as const, canal: 'app' as const, activo: false }, { categoria: 'escalaciones' as const, canal: 'correo' as const, activo: false }];
    expect(estaActivo(prefs, 'soporte', 'app')).toBe(true);
    expect(estaActivo(prefs, 'costos', 'app')).toBe(false);
    const apagadas = categoriasApagadasEnApp(prefs);
    expect([...apagadas]).toEqual(['costos']); // correo apagado no oculta nada de la app
    const lista = [av({ clave: 'c1', categoria: 'costos' }), av({ clave: 'c2', categoria: 'costos', silenciable: false }), av({ clave: 'e', categoria: 'escalaciones' })];
    expect(aplicarPreferencias(lista, apagadas).map((a) => a.clave)).toEqual(['c2', 'e']);
  });
});

describe('horario de silencio', () => {
  const s: Silencio = { activo: true, desde: '22:00', hasta: '07:00', permiteCriticos: true };
  // 2026-11-11 en México es UTC-6 (sin horario de verano): 04:00Z = 22:00 del día 10; 13:00Z = 07:00.
  const ms = (iso: string) => Date.parse(iso);

  it('cruza la medianoche', () => {
    expect(enSilencio(s, ms('2026-11-11T04:30:00Z'))).toBe(true); // 22:30
    expect(enSilencio(s, ms('2026-11-11T09:00:00Z'))).toBe(true); // 03:00
    expect(enSilencio(s, ms('2026-11-11T13:00:00Z'))).toBe(false); // 07:00 ya no
    expect(enSilencio(s, ms('2026-11-11T18:00:00Z'))).toBe(false); // 12:00
  });
  it('apagado nunca silencia; un crítico pasa si se permite', () => {
    expect(enSilencio({ ...s, activo: false }, ms('2026-11-11T09:00:00Z'))).toBe(false);
    expect(enSilencio(s, ms('2026-11-11T09:00:00Z'), 'critica')).toBe(false);
    expect(enSilencio({ ...s, permiteCriticos: false }, ms('2026-11-11T09:00:00Z'), 'critica')).toBe(true);
  });
  it('rango dentro del mismo día', () => {
    const d: Silencio = { activo: true, desde: '13:00', hasta: '15:00', permiteCriticos: false };
    expect(enSilencio(d, ms('2026-11-11T20:00:00Z'))).toBe(true); // 14:00
    expect(enSilencio(d, ms('2026-11-11T22:00:00Z'))).toBe(false); // 16:00
  });
  it('valida forma y rango no vacío', () => {
    expect(validarSilencio({ activo: true, desde: '22:00', hasta: '07:00', permiteCriticos: true })).not.toBeNull();
    expect(validarSilencio({ activo: true, desde: '08:00', hasta: '08:00', permiteCriticos: true })).toBeNull();
    expect(validarSilencio({ activo: true, desde: '25:00', hasta: '07:00', permiteCriticos: true })).toBeNull();
    expect(validarSilencio({ activo: 'si', desde: '22:00', hasta: '07:00', permiteCriticos: true })).toBeNull();
  });
});
