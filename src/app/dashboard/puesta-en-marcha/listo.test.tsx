import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/puesta-en-marcha' }));

import { armarListo, resumirListo, type LecturasListo } from './listo';
import { SeccionListo } from './seccion_listo';

const VACIA: LecturasListo = {
  credencial: 'sin_credencial', mapeoLiquidaciones: false, operadores: { activos: 0, conCorreo: 0 },
  config: { activa: true, usaCorreo: true, remitenteCapturado: false, responderAEfectivo: false, revisores: 0, primerMesVigente: false, noEnviarAntes: null, polizaProvisional: false },
  interruptores: { global: 'encendido', liquidacion: 'encendido' }, llavesApi: 0, entorno: { lector: 'supuesto', banderaMuestra: false },
};
const LISTA: LecturasListo = {
  credencial: { activa: true, probadaEn: '2026-11-10T10:00:00Z', ultimoError: null }, mapeoLiquidaciones: true,
  operadores: { activos: 3, conCorreo: 3 },
  config: { activa: true, usaCorreo: true, remitenteCapturado: true, responderAEfectivo: true, revisores: 1, primerMesVigente: true, noEnviarAntes: '2026-11-15', polizaProvisional: true },
  interruptores: { global: 'encendido', liquidacion: 'encendido' }, llavesApi: 1, entorno: { lector: 'muestra_tms', banderaMuestra: true },
};
const CAIDA: LecturasListo = {
  credencial: null, mapeoLiquidaciones: null, operadores: null, config: null,
  interruptores: { global: null, liquidacion: 'ilegible' }, llavesApi: null, entorno: { lector: 'muestra_tms', banderaMuestra: true },
};
const por = (cs: ReturnType<typeof armarListo>, id: string) => cs.find((x) => x.id === id)!;

describe('¿Estoy listo?', () => {
  it('cuenta vacía: cada punto pendiente y con responsable; nada en «listo» salvo lo medido', () => {
    const cs = armarListo(VACIA);
    expect(por(cs, 'credencial').estado).toBe('pendiente');
    expect(por(cs, 'mapeo')).toMatchObject({ estado: 'pendiente', responsable: 'likida' });
    expect(por(cs, 'operadores').estado).toBe('pendiente');
    expect(por(cs, 'revisor').estado).toBe('pendiente');
    expect(por(cs, 'remitente').estado).toBe('pendiente');
    expect(por(cs, 'corte').estado).toBe('pendiente');
    expect(por(cs, 'poliza').estado).toBe('pendiente');
    expect(por(cs, 'interruptores').estado).toBe('listo');
    expect(resumirListo(cs).todoListo).toBe(false);
  });
  it('base completa: todo listo con evidencia medida', () => {
    const cs = armarListo(LISTA);
    expect(cs.every((x) => x.estado === 'listo')).toBe(true);
    expect(resumirListo(cs)).toMatchObject({ listos: cs.length, total: cs.length, todoListo: true });
  });
  it('lectura caída = «sin dato», nunca listo ni pendiente', () => {
    const cs = armarListo(CAIDA);
    for (const id of ['credencial', 'mapeo', 'llave', 'operadores', 'revisor', 'remitente', 'corte', 'poliza', 'interruptores', 'envio']) {
      expect(por(cs, id).estado, id).toBe('sin_dato');
    }
    expect(resumirListo(cs).sinDato).toBe(10);
  });
  it('una credencial guardada pero nunca probada, o con error, no está lista', () => {
    expect(por(armarListo({ ...LISTA, credencial: { activa: true, probadaEn: null, ultimoError: null } }), 'credencial').estado).toBe('pendiente');
    expect(por(armarListo({ ...LISTA, credencial: { activa: true, probadaEn: 'x', ultimoError: 'e' } }), 'credencial').estado).toBe('pendiente');
  });
  it('operadores: algunos sin correo es pendiente con el conteo; interruptor apagado es pendiente', () => {
    expect(por(armarListo({ ...LISTA, operadores: { activos: 4, conCorreo: 3 } }), 'operadores').evidencia).toContain('3 de 4');
    expect(por(armarListo({ ...LISTA, interruptores: { global: 'encendido', liquidacion: 'apagado' } }), 'interruptores').estado).toBe('pendiente');
  });
  it('la pantalla: un solo encabezado de sección, sin valores del cliente, con «Sin dato» visible', () => {
    const h = renderToStaticMarkup(<SeccionListo lecturas={CAIDA} sufijo="" />);
    expect(h).toContain('Sin dato');
    expect(h).toContain('Faltan 10 de 12 comprobaciones');
    expect(h).not.toContain('<h1');
    expect(h).not.toContain('style=');
    const v = renderToStaticMarkup(<SeccionListo lecturas={LISTA} sufijo="" />);
    expect(v).toContain('Todo listo para conectar');
  });
});
