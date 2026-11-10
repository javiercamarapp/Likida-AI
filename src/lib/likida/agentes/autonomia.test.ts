import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import {
  ACCIONES_L4, CATALOGO_AUTONOMIA, NIVELES, NUNCA_AUTOMATIZAR, TECHO_POR_CLASE,
  autonomiaDe, debeDescender, evaluarCambioDeNivel, nivelMaximoDeAccion, nivelTrasDescenso,
  ordenNivel, prohibicionDe, validarCatalogo, type EntradaAutonomia,
} from './autonomia';
import { CATALOGO_ACCIONES } from '@/lib/agents/copiloto-acciones';

const humano = { tipo: 'humano', usuario: 'javier', motivo: 'examen verde' } as const;

describe('catálogo de autonomía', () => {
  it('el catálogo real no contradice la escalera ni la lista cerrada', () => {
    expect(validarCatalogo()).toEqual([]);
  });

  it('todos nacen en L0 o L1 y ninguno supera el techo de su clase', () => {
    for (const [id, e] of Object.entries(CATALOGO_AUTONOMIA)) {
      expect(ordenNivel(e.nivel), id).toBeLessThanOrEqual(ordenNivel('L1'));
      expect(ordenNivel(e.nivel), id).toBeLessThanOrEqual(ordenNivel(TECHO_POR_CLASE[e.clase]));
    }
  });

  it('dinero, fiscal y datos personales nunca pasan de L2', () => {
    expect(TECHO_POR_CLASE.dinero_fiscal_datos).toBe('L2');
    for (const id of ['liquidacion', 'facturas', 'cobranza', 'peajes', 'carta_porte']) {
      expect(autonomiaDe(id).techo, id).toBe('L2');
    }
  });

  it('un agente no catalogado es lo más restrictivo: desconocido, L0, techo L1', () => {
    expect(autonomiaDe('inventado')).toMatchObject({ clase: 'desconocida', nivel: 'L0', techo: 'L1', catalogado: false });
    expect(autonomiaDe('constructor').catalogado).toBe(false);
  });

  it('la prueba FALLA (detecta) si el catálogo contradice: techo, nivel inicial y L4 fuera de plataforma', () => {
    const malo: Record<string, EntradaAutonomia> = {
      cobranza: { clase: 'dinero_fiscal_datos', nivel: 'L3' },
      redactor: { clase: 'salida_cliente', nivel: 'L4' },
    };
    const v = validarCatalogo(malo, ACCIONES_L4);
    expect(v.some((x) => x.donde === 'cobranza' && /techo/.test(x.motivo))).toBe(true);
    expect(v.some((x) => x.donde === 'redactor' && /plataforma/.test(x.motivo))).toBe(true);
    expect(v.some((x) => x.donde === 'redactor' && /L0 o L1/.test(x.motivo))).toBe(true);
  });

  it('la prueba FALLA (detecta) si una acción L4 toca la lista cerrada', () => {
    for (const mala of ['cobrar_cliente', 'timbrar_cfdi', 'exportar_datos', 'enviar_correo_cliente', 'subir_autonomia', 'desplegar_produccion']) {
      const v = validarCatalogo({}, [...ACCIONES_L4, mala]);
      expect(v.map((x) => x.donde), mala).toContain(`accion_l4:${mala}`);
    }
  });
});

describe('lista cerrada', () => {
  it('son exactamente las seis categorías del plan', () => {
    expect(NUNCA_AUTOMATIZAR.map((p) => p.id)).toEqual([
      'dinero', 'datos_personales_arco', 'fiscal', 'salidas_sin_revision', 'autonomia_propia', 'produccion',
    ]);
  });

  it('ninguna acción L4 vigente está prohibida', () => {
    for (const a of ACCIONES_L4) expect(prohibicionDe(a), a).toBeNull();
  });

  it('lo prohibido es L0; la lista L4 llega a L4; el resto, a L3', () => {
    expect(nivelMaximoDeAccion('marcar_pago_conciliado')).toBe('L0');
    expect(nivelMaximoDeAccion('marcar_ruido')).toBe('L4');
    expect(nivelMaximoDeAccion('asignar_prospecto')).toBe('L3');
  });

  it('NINGUNA acción del catálogo del Copiloto la contradice: lo prohibido exige doble confirmación y no es L4', () => {
    for (const a of CATALOGO_ACCIONES) {
      const p = prohibicionDe(a.id);
      if (p) {
        expect(a.gateo, `${a.id} (${p}) debe exigir doble confirmación`).toBe('doble');
        expect(ACCIONES_L4, a.id).not.toContain(a.id);
        expect(nivelMaximoDeAccion(a.id), a.id).toBe('L0');
      }
    }
    // Las que mueven dinero están efectivamente reconocidas.
    expect(prohibicionDe('marcar_pago_conciliado')).toBe('dinero');
  });
});

describe('cambios de nivel', () => {
  it('un agente (ni siquiera sobre sí mismo) ni un cron cambian la autonomía', () => {
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: { tipo: 'agente', agente: 'automejora' } }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'cobranza', a: 'L1', actor: { tipo: 'agente', agente: 'otro' } }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: { tipo: 'cron' } }).permitido).toBe(false);
  });

  it('la regla del servidor solo baja', () => {
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L0', actor: { tipo: 'regla_servidor', regla: 'presupuesto' } }).permitido).toBe(true);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: { tipo: 'regla_servidor', regla: 'x' } }).permitido).toBe(false);
  });

  it('un humano sube un escalón, con motivo, bajo el techo y sin presupuesto agotado', () => {
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: humano }).permitido).toBe(true);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L3', actor: humano })).toMatchObject({ permitido: false });
    expect(evaluarCambioDeNivel({ agente: 'cobranza', a: 'L1', actor: humano }).permitido).toBe(true);
    expect(evaluarCambioDeNivel({ agente: 'cobranza', a: 'L2', actor: humano })).toMatchObject({ permitido: false, motivo: expect.stringMatching(/escalón/) });
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: { ...humano, motivo: ' ' } }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: humano, presupuestoAgotado: true }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: humano, s1Abierto: true }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'automejora', a: 'L2', actor: humano, examenFallido: true }).permitido).toBe(false);
    expect(evaluarCambioDeNivel({ agente: 'inventado', a: 'L1', actor: humano }).permitido).toBe(false);
  });

  it('descenso: un escalón, nunca bajo L0, y solo con causa', () => {
    expect(NIVELES.map(nivelTrasDescenso)).toEqual(['L0', 'L0', 'L1', 'L2', 'L3']);
    expect(debeDescender({})).toBe(false);
    expect(debeDescender({ s1Abierto: true })).toBe(true);
  });
});
