import { describe, expect, it } from 'vitest';
import type { ConteosEscalaciones, ItemEscalacion } from '@/lib/admin/escalaciones';
import type { AlertaExtra } from '@/lib/admin/fuentes-alerta-extra';
import type { AlertaFlota } from '@/app/dashboard/calcular-alertas-flota';
import { avisosDeAdmin } from './generar-admin';
import { avisosDeFlota } from './generar-flota';
import { contarNoLeidos, filtrarAvisos, FILTROS_INICIALES } from './modelo';

const CEROS: ConteosEscalaciones = { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0 };
const item = (fuente: ItemEscalacion['fuente'], desde: string, titulo = 't'): ItemEscalacion => ({ fuente, titulo, detalle: null, tenantNombre: 'Flota X', desde, vence: null, href: '/x' });
const RESUMEN_SANO = { tendenciaCosto: 5, tenants: 3, flotas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as never;

describe('avisos de admin', () => {
  it('un aviso por fuente con pendientes, con su origen, su hora más antigua y su enlace', () => {
    const avisos = avisosDeAdmin({
      bandeja: {
        conteos: { ...CEROS, arco: 2, talachas: 3, ticketsAbiertos: 4, ticketsVencidos: 1 },
        cola: [item('arco', '2026-11-05T10:00:00Z'), item('arco', '2026-11-03T10:00:00Z'), item('talachas', '2026-11-08T10:00:00Z')],
      },
      extras: [], resumen: RESUMEN_SANO,
    });
    expect(avisos.map((a) => a.fuente).sort()).toEqual(['arco', 'talachas', 'tickets']);
    const arco = avisos.find((a) => a.fuente === 'arco')!;
    expect(arco).toMatchObject({ severidad: 'critica', silenciable: false, categoria: 'escalaciones', href: '/admin/escalaciones' });
    expect(arco.desde).toBe('2026-11-03T10:00:00.000Z');
    expect(arco.titulo).toContain('2 solicitudes ARCO');
    expect(arco.detalle).toContain('Flota X');
    const tickets = avisos.find((a) => a.fuente === 'tickets')!;
    expect(tickets).toMatchObject({ categoria: 'soporte', severidad: 'critica', silenciable: false }); // SLA vencido
    expect(tickets.desde).toBeNull(); // sin items en la cola: no se inventa una hora
    expect(avisos.find((a) => a.fuente === 'talachas')).toMatchObject({ severidad: 'atencion', silenciable: true });
  });

  it('la suma de conteos de antes (19) ya no es el número: es la cantidad de avisos no leídos que la lista muestra', () => {
    const avisos = avisosDeAdmin({
      bandeja: { conteos: { ...CEROS, arco: 7, corridasFallo: 5, ticketsAbiertos: 7 }, cola: [] }, extras: [], resumen: RESUMEN_SANO,
    });
    const leidas = new Set<string>();
    expect(contarNoLeidos(avisos, leidas)).toBe(3);
    expect(filtrarAvisos(avisos, leidas, FILTROS_INICIALES)).toHaveLength(3);
  });

  it('una lectura caída se dice con un aviso crítico que no se puede ocultar, nunca 0', () => {
    const avisos = avisosDeAdmin({ bandeja: null, extras: null, resumen: null });
    expect(avisos.map((a) => a.fuente).sort()).toEqual(['bandeja_ilegible', 'extras_ilegibles', 'resumen_ilegible']);
    expect(avisos.every((a) => a.severidad === 'critica' && !a.silenciable)).toBe(true);
    expect(contarNoLeidos(avisos, new Set(avisos.map((a) => a.clave)))).toBe(3);
  });

  it('una fuente de la bandeja ilegible produce UN aviso que la nombra; las legibles siguen', () => {
    const avisos = avisosDeAdmin({ bandeja: { conteos: { ...CEROS, tickets: undefined, arco: null, corridasFallo: null, talachas: 2 } as never, cola: [] }, extras: [], resumen: RESUMEN_SANO });
    const ciega = avisos.find((a) => a.fuente === 'fuentes_ilegibles')!;
    expect(ciega.titulo).toContain('No se pudo leer');
    expect(ciega.silenciable).toBe(false);
    expect(avisos.some((a) => a.fuente === 'talachas')).toBe(true);
  });

  it('F14/F19 y los crons llegan como avisos de sistema; los que dicen «sistema caído» no se pueden marcar', () => {
    const extras: AlertaExtra[] = [
      { id: 'webhook_en_silencio', tipo: 'atencion', texto: 'silencio', href: '/admin/salud-sistema', items: ['webhook_whatsapp'] },
      { id: 'diagnostico_tope', tipo: 'atencion', texto: 'tope', href: '/admin/salud-sistema', items: ['diagnostico'] },
    ];
    const avisos = avisosDeAdmin({ bandeja: { conteos: CEROS, cola: [] }, extras, resumen: RESUMEN_SANO });
    expect(avisos).toHaveLength(2);
    expect(avisos.every((a) => a.categoria === 'sistema')).toBe(true);
    expect(avisos.find((a) => a.fuente === 'webhook_en_silencio')).toMatchObject({ severidad: 'critica', silenciable: false });
    expect(avisos.find((a) => a.fuente === 'diagnostico_tope')).toMatchObject({ severidad: 'atencion', silenciable: true });
  });

  it('sin nada pendiente y todo leído: lista vacía (se leyó y no hay nada), no un aviso inventado', () => {
    expect(avisosDeAdmin({ bandeja: { conteos: CEROS, cola: [] }, extras: [], resumen: RESUMEN_SANO })).toEqual([]);
  });

  it('la clave cambia con la condición: otro conteo vuelve como no leído', () => {
    const una = avisosDeAdmin({ bandeja: { conteos: { ...CEROS, talachas: 2 }, cola: [] }, extras: [], resumen: RESUMEN_SANO })[0];
    const otra = avisosDeAdmin({ bandeja: { conteos: { ...CEROS, talachas: 3 }, cola: [] }, extras: [], resumen: RESUMEN_SANO })[0];
    expect(una.clave).not.toBe(otra.clave);
  });
});

describe('avisos de la flota', () => {
  const alertas: AlertaFlota[] = [
    { id: 'huerfanos:3', tipo: 'atencion', texto: '3 comprobantes', href: '/dashboard/huerfanos' },
    { id: 'por-revisar:2', tipo: 'aviso', texto: '2 liquidaciones', href: '/dashboard/viajes' },
    { id: 'ilegibles:escalados', tipo: 'atencion', texto: 'No se pudo revisar', href: '/dashboard/soporte' },
    { id: 'conectores:gps', tipo: 'atencion', texto: 'GPS a medias', href: '/dashboard/conexiones' },
  ];
  it('clasifica por fuente, tipo y severidad; lo ilegible es crítico y no se oculta', () => {
    const avisos = avisosDeFlota(alertas);
    expect(avisos.map((a) => [a.fuente, a.categoria, a.severidad, a.silenciable])).toEqual([
      ['huerfanos', 'dinero', 'atencion', true],
      ['por-revisar', 'dinero', 'info', true],
      ['ilegibles', 'sistema_flota', 'critica', false],
      ['conectores', 'conexiones', 'atencion', true],
    ]);
    expect(avisos[0].clave).toBe('flota:huerfanos:3');
  });
  it('el pie y la lista cuentan igual', () => {
    const avisos = avisosDeFlota(alertas);
    const leidas = new Set(['flota:huerfanos:3', 'flota:ilegibles:escalados']);
    expect(contarNoLeidos(avisos, leidas)).toBe(3);
    expect(filtrarAvisos(avisos, leidas, FILTROS_INICIALES)).toHaveLength(3);
  });
});
