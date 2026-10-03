import { describe, it, expect, vi } from 'vitest';
import {
  avisarAprobacion, avisarEscalamiento, interpretarBoton, textoDeMotivoEscalamiento,
  PREFIJO_APROBAR, PREFIJO_RECHAZAR, PREFIJO_TOMAR,
} from './avisos';
import type { Enviador } from './enviar';
import { armarComponentesPlantilla } from '@/lib/meta/plantilla_payload';

const MSG = '12345678-1234-4234-8234-123456789abc';
const okEnviar = () => vi.fn(async () => ({ ok: true as const, via: 'botones' as const, id: 'w', motivo: 'ventana_abierta' as const, ventana: 'abierta' as const })) as unknown as Enviador & ReturnType<typeof vi.fn>;

describe('aviso de aprobación al gerente', () => {
  const e = {
    tenantId: 't1', telefonoGerente: '525599999999', mensajeId: MSG, nombreCliente: 'Compras Acme',
    mensajeCliente: '¿Dónde va mi viaje F-1042?', borrador: 'Tu viaje F-1042 va en curso.',
  };

  it('dentro de ventana: texto con la respuesta propuesta y tres botones con el id del mensaje', async () => {
    const enviar = okEnviar();
    await avisarAprobacion(e, enviar);
    const [tel, op] = (enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(tel).toBe('525599999999');
    expect(op.texto).toContain('Compras Acme escribió: «¿Dónde va mi viaje F-1042?»');
    expect(op.texto).toContain('Respuesta propuesta: «Tu viaje F-1042 va en curso.»');
    expect(op.texto).toContain('¿La envío?');
    expect(op.botones).toEqual([
      { id: `${PREFIJO_APROBAR}:${MSG}`, titulo: 'Enviar' },
      { id: `${PREFIJO_RECHAZAR}:${MSG}`, titulo: 'No enviar' },
      { id: `${PREFIJO_TOMAR}:${MSG}`, titulo: 'Yo me encargo' },
    ]);
    expect(op.contexto).toBe('vigia.aprobacion');
    expect(op.tenantId).toBe('t1');
  });

  it('los títulos de botón caben en WhatsApp (≤ 20)', async () => {
    const enviar = okEnviar();
    await avisarAprobacion(e, enviar);
    const op = (enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { botones: Array<{ titulo: string }> };
    for (const b of op.botones) expect(b.titulo.length).toBeLessThanOrEqual(20);
  });

  it('fuera de ventana: la plantilla del catálogo, con los tres botones y valores válidos para Meta', async () => {
    const enviar = okEnviar();
    await avisarAprobacion(e, enviar);
    const op = (enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { plantilla: { nombre: string; parametros: string[]; botones: Array<{ payload: string }>; idioma: string } };
    expect(op.plantilla.nombre).toBe('vigia_aprobacion_v1');
    expect(op.plantilla.parametros).toEqual(['Compras Acme', '¿Dónde va mi viaje F-1042?', 'Tu viaje F-1042 va en curso.']);
    expect(op.plantilla.botones.map((b) => b.payload)).toEqual([`vig_ok:${MSG}`, `vig_no:${MSG}`, `vig_tomo:${MSG}`]);
    expect(armarComponentesPlantilla(op.plantilla as never).ok).toBe(true);
  });

  it('una advertencia (faltantes, señales) se le muestra ANTES de que decida', async () => {
    const enviar = okEnviar();
    await avisarAprobacion({ ...e, advertencia: 'no hay hora estimada registrada' }, enviar);
    expect((enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].texto).toContain('Ojo: no hay hora estimada registrada');
  });

  it('el mensaje del cliente y el borrador se recortan; saltos de línea no rompen la plantilla', async () => {
    const enviar = okEnviar();
    await avisarAprobacion({ ...e, mensajeCliente: `uno\n\ndos ${'x'.repeat(2000)}`, borrador: `a\tb\n${'y'.repeat(2000)}` }, enviar);
    const op = (enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { texto: string; plantilla: { parametros: string[] } };
    expect(op.texto.length).toBeLessThan(1024);
    for (const p of op.plantilla.parametros) expect(p).not.toMatch(/[\n\t]/);
    expect(op.plantilla.parametros[1].length).toBeLessThanOrEqual(160);
    expect(op.plantilla.parametros[2].length).toBeLessThanOrEqual(280);
  });

  it('un nombre de cliente vacío no deja un hueco', async () => {
    const enviar = okEnviar();
    await avisarAprobacion({ ...e, nombreCliente: '   ' }, enviar);
    expect((enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].texto).toContain('Un cliente escribió');
  });
});

describe('aviso de escalamiento', () => {
  const e = {
    tenantId: 't1', telefonoDestino: '525588888888', mensajeId: MSG, nombreCliente: 'Compras Acme',
    motivo: 'sin_respuesta' as const, minutosEsperando: 45, nivel: 1 as const,
  };
  it('dice cliente, motivo, nivel y liga al tablero, con el botón «Yo me encargo»', async () => {
    const enviar = okEnviar();
    await avisarEscalamiento(e, enviar);
    const op = (enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { texto: string; botones: unknown[]; plantilla: { nombre: string; parametros: string[] } };
    expect(op.texto).toContain('el cliente Compras Acme necesita atención (lleva 45 minutos sin respuesta)');
    expect(op.texto).toContain('Nivel 1 de escalamiento');
    expect(op.texto).toContain('/dashboard/agentes/vigia');
    expect(op.botones).toEqual([{ id: `${PREFIJO_TOMAR}:${MSG}`, titulo: 'Yo me encargo' }]);
    expect(op.plantilla.nombre).toBe('vigia_escalamiento_v1');
    expect(op.plantilla.parametros[2]).toBe('1');
    expect(armarComponentesPlantilla(op.plantilla as never).ok).toBe(true);
  });
  it('el nivel 2 sale marcado como tal', async () => {
    const enviar = okEnviar();
    await avisarEscalamiento({ ...e, nivel: 2 }, enviar);
    expect((enviar as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].texto).toContain('Nivel 2');
  });
  it('los motivos se dicen en palabras', () => {
    expect(textoDeMotivoEscalamiento('molestia', 0)).toBe('muestra molestia');
    expect(textoDeMotivoEscalamiento('pide_humano', 0)).toBe('pide hablar con una persona');
    expect(textoDeMotivoEscalamiento('sin_dato', 0)).toContain('no tengo registrado');
    expect(textoDeMotivoEscalamiento('folio_ajeno', 0)).toContain('no es suyo');
  });
});

describe('interpretarBoton', () => {
  it('reconoce los tres botones con su uuid', () => {
    expect(interpretarBoton(`vig_ok:${MSG}`)).toEqual({ accion: 'aprobar', id: MSG });
    expect(interpretarBoton(`vig_no:${MSG}`)).toEqual({ accion: 'rechazar', id: MSG });
    expect(interpretarBoton(`  VIG_TOMO:${MSG.toUpperCase()}  `)).toEqual({ accion: 'tomar', id: MSG });
  });
  it('rechaza todo lo que no es exactamente un botón nuestro', () => {
    for (const t of ['', 'vig_ok', 'vig_ok:', 'vig_ok:123', `vig_ok:${MSG}x`, `vig_borrar:${MSG}`, `hola vig_ok:${MSG}`, `vig_ok:${MSG}\nvig_ok:${MSG}`, 'enviar', `tal_si:${MSG}`]) {
      expect(interpretarBoton(t), t).toBeNull();
    }
  });
});
