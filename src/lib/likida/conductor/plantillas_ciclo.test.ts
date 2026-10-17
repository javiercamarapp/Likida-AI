import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PLANTILLAS, plantillaDeCatalogo, validarCatalogo, variablesDeTexto, opcionesDeEnvio, cuerpoCreacionMeta,
} from '@/lib/meta/plantillas_catalogo';
import { renderizarDocPlantillas } from '@/lib/meta/plantillas_doc';
import { armarComponentesPlantilla } from '@/lib/meta/plantilla_payload';
import {
  APROBADAS, PLANTILLAS_CICLO, ESTADO_PROVEEDOR_CICLO, plantillasDelCicloPorPerfil, faltantesPorAprobar, siguienteVersion,
  perfilDePlantilla,
} from './plantillas_requeridas';

const RAIZ = process.cwd();
const doc = (): string => readFileSync(join(RAIZ, 'docs/operacion/plantillas-meta.md'), 'utf8');const NOMBRES = PLANTILLAS_CICLO.map((p) => p.nombre);

describe('T-A5-59: las 12 plantillas del ciclo del conductor (N01–N12)', () => {
  it('son 12, con códigos N01…N12 consecutivos y nombres únicos', () => {
    expect(PLANTILLAS_CICLO.map((p) => p.codigo)).toEqual(['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10', 'N11', 'N12']);
    expect(new Set(NOMBRES).size).toBe(12);
  });

  it('las 12 están en el catálogo y el catálogo completo valida', () => {
    for (const n of NOMBRES) expect(plantillaDeCatalogo(n), n).toBeDefined();
    expect(validarCatalogo()).toEqual([]);
  });

  it('todas UTILITY · es_MX · sin promoción ni marca, cuerpo ≤ 1 024, variables consecutivas, ni al inicio ni al final, con ejemplos', () => {
    for (const n of NOMBRES) {
      const p = plantillaDeCatalogo(n)!;
      expect(p.categoria, n).toBe('UTILITY');
      expect(p.idioma, n).toBe('es_MX');
      expect(p.cuerpo.length, n).toBeLessThanOrEqual(1024);
      const vars = variablesDeTexto(p.cuerpo);
      expect(vars, n).toEqual(vars.map((_v, i) => i + 1));
      expect(p.ejemplos, n).toHaveLength(vars.length);
      expect(p.variables, n).toHaveLength(vars.length);
      expect(p.cuerpo, n).not.toMatch(/^\s*\{\{|\}\}\s*$/);
      const todo = [p.cuerpo, ...p.botones.map((b) => b.texto)].join(' ');
      expect(todo, `${n} suena a promoción`).not.toMatch(/oferta|promoci|descuento|gratis|bono|macro|likida/i);
    }
  });

  it('el cuerpo de cada una es el de 16 §5 (huella por plantilla: variables y botones)', () => {
    const forma = (n: string): string => {
      const p = plantillaDeCatalogo(n)!;
      return `${variablesDeTexto(p.cuerpo).length}|${p.botones.map((b) => (b.tipo === 'QUICK_REPLY' ? b.payloadPrefijo : 'URL')).join(',')}`;
    };
    expect(Object.fromEntries(NOMBRES.map((n) => [n, forma(n)]))).toEqual({
      viaje_asignado_confirmar_v1: '6|viaje_acepto,viaje_rechazo',
      viaje_instrucciones_ruta_v1: '8|instr_ok',
      viaje_gastos_etc_v1: '2|gastos_si,gastos_no',
      conductor_foto_sello_v1: '3|inicio_viaje,inicio_problema',
      conductor_detencion_sin_aviso_v1: '3|parada_ok,parada_motivo,parada_apoyo',
      conductor_confirma_patio_v1: '3|patio_ok,patio_otro,pedir_ubicacion',
      conductor_estadia_descarga_v1: '4|descarga_inicio,descarga_no_inicia,descarga_problema',
      aviso_supervisor_patio_distinto_v1: '5|jefe_atiendo,URL',
      aviso_supervisor_estadia_descarga_v1: '6|jefe_atiendo,URL',
      aviso_supervisor_caja_cargada_v1: '5|jefe_atiendo,URL',
      conductor_pedir_evidencia_v1: '3|evid_listo,evid_falta',
      conductor_llegada_detectada_v1: '3|llegada_det_ok,llegada_det_no',
    });
  });

  it('payloads únicos: dentro de cada plantilla no se repite y un mismo prefijo siempre significa el mismo botón en todo el catálogo', () => {
    const textoDe = new Map<string, string>();
    for (const p of CATALOGO_PLANTILLAS) {
      const prefijos = p.botones.flatMap((b) => (b.tipo === 'QUICK_REPLY' ? [b.payloadPrefijo] : []));
      expect(new Set(prefijos).size, p.nombre).toBe(prefijos.length);
      for (const b of p.botones) {
        if (b.tipo !== 'QUICK_REPLY') continue;
        const previo = textoDe.get(b.payloadPrefijo);
        if (previo !== undefined) expect(previo, `el prefijo «${b.payloadPrefijo}» se usa con dos textos`).toBe(b.texto);
        textoDe.set(b.payloadPrefijo, b.texto);
      }
    }
  });

  it('el payload armado es `<prefijo>:<viaje_id>` y pasa el validador de Meta con los ejemplos', () => {
    for (const n of NOMBRES) {
      const p = plantillaDeCatalogo(n)!;
      const o = opcionesDeEnvio(n, { cuerpo: p.ejemplos, idsBotones: 'viaje-1' });
      for (const b of o.botones ?? []) expect((b as { payload: string }).payload).toMatch(/^[a-z_]+:viaje-1$/);
      expect(armarComponentesPlantilla(o).ok, n).toBe(true);
      const c = cuerpoCreacionMeta(p) as { category: string; language: string };
      expect([c.category, c.language]).toEqual(['UTILITY', 'es_MX']);
    }
  });

  it('el aviso al supervisor usa la URL fija del tablero (no variable) y los de aviso van con botón «Ya lo atiendo»', () => {
    for (const n of ['aviso_supervisor_patio_distinto_v1', 'aviso_supervisor_estadia_descarga_v1', 'aviso_supervisor_caja_cargada_v1']) {
      const p = plantillaDeCatalogo(n)!;
      expect(p.botones.map((b) => b.texto)).toEqual(['Ya lo atiendo', 'Abrir tablero']);
      expect(p.botones[1]).toMatchObject({ tipo: 'URL', url: 'https://app.likida.ai/dashboard/despacho' });
    }
  });

  it('ejemplos sin saltos de línea, sin teléfonos ni datos que parezcan reales', () => {
    for (const n of NOMBRES) {
      const p = plantillaDeCatalogo(n)!;
      for (const e of p.ejemplos) {
        expect(e, n).not.toMatch(/[\n\r]/);
        expect(e, n).not.toMatch(/\+?\d{10,}/);
      }
    }
  });

  it('no se tocaron las plantillas existentes: las 5 de cada tipo siguen con su nombre y estado', () => {
    expect(plantillaDeCatalogo('aviso_jefe_trafico_v1')?.estado).toBe('nueva_para_aprobacion');
    expect(plantillaDeCatalogo('viaje_asignado')?.estado).toBe('en_uso');
    expect(plantillaDeCatalogo('conductor_senal_vida_v1')?.botones).toHaveLength(3);
  });
});

describe('T-A5-59: estado en el proveedor y requeridas por perfil', () => {
  it('cada una de las 12 tiene un estado en el proveedor válido y el de Meta al 15-oct se refleja', () => {
    const validos = ['no_enviada', 'pendiente', 'aprobada', 'rechazada'];
    for (const n of NOMBRES) expect(validos, n).toContain(ESTADO_PROVEEDOR_CICLO[n]);
    const aprobadas = NOMBRES.filter((n) => ESTADO_PROVEEDOR_CICLO[n] === 'aprobada');
    expect(aprobadas.sort()).toEqual([
      'aviso_supervisor_estadia_descarga_v1', 'aviso_supervisor_patio_distinto_v1', 'conductor_confirma_patio_v1',
      'conductor_detencion_sin_aviso_v1', 'conductor_foto_sello_v1', 'viaje_asignado_confirmar_v1', 'viaje_instrucciones_ruta_v1',
    ].sort());
    expect(NOMBRES.filter((n) => ESTADO_PROVEEDOR_CICLO[n] === 'no_enviada').sort()).toEqual([
      'aviso_supervisor_caja_cargada_v1', 'conductor_estadia_descarga_v1', 'conductor_llegada_detectada_v1',
      'conductor_pedir_evidencia_v1', 'viaje_gastos_etc_v1',
    ].sort());
  });

  it('APROBADAS (lo que lee el preflight) contiene exactamente las marcadas aprobadas y solo nombres del catálogo', () => {
    for (const n of APROBADAS) expect(plantillaDeCatalogo(n), n).toBeDefined();
    for (const n of NOMBRES) expect(APROBADAS.includes(n), n).toBe(ESTADO_PROVEEDOR_CICLO[n] === 'aprobada');
  });

  it('perfil piloto = las 7 P0; cinco_agentes = P0 + P1 (11); la P2 (llegada detectada) no la exige ningún perfil', () => {
    const piloto = plantillasDelCicloPorPerfil('piloto');
    const cinco = plantillasDelCicloPorPerfil('cinco_agentes');
    expect(piloto).toHaveLength(7);
    expect(cinco).toHaveLength(11);
    for (const n of piloto) expect(cinco).toContain(n);
    expect(cinco).not.toContain('conductor_llegada_detectada_v1');
    expect(piloto).not.toContain('viaje_gastos_etc_v1');
  });

  it('FALLA si una plantilla requerida por el perfil piloto no está aprobada (y pasa con las 7 P0 aprobadas)', () => {
    expect(faltantesPorAprobar('piloto')).toEqual([]);
    // con una P0 en cualquier otro estado, el piloto queda con faltantes
    for (const estado of ['no_enviada', 'pendiente', 'rechazada'] as const) {
      const f = faltantesPorAprobar('piloto', { ...ESTADO_PROVEEDOR_CICLO, conductor_foto_sello_v1: estado });
      expect(f, estado).toEqual(['conductor_foto_sello_v1']);
    }
  });

  it('cinco_agentes hoy NO está listo: faltan las P1 sin enviar (esperan al cliente)', () => {
    expect(faltantesPorAprobar('cinco_agentes').sort()).toEqual([
      'aviso_supervisor_caja_cargada_v1', 'conductor_estadia_descarga_v1', 'conductor_pedir_evidencia_v1', 'viaje_gastos_etc_v1',
    ].sort());
  });

  it('regla de versionado: un cambio o rechazo se reenvía con sufijo _v2 (nunca se edita el nombre aprobado)', () => {
    expect(siguienteVersion('conductor_foto_sello_v1')).toBe('conductor_foto_sello_v2');
    expect(siguienteVersion('conductor_foto_sello_v9')).toBe('conductor_foto_sello_v10');
    expect(siguienteVersion('viaje_asignado')).toBe('viaje_asignado_v2');
  });

  it('perfilDePlantilla dice a qué perfil pertenece cada una del ciclo', () => {
    expect(perfilDePlantilla('conductor_foto_sello_v1')).toContain('piloto');
    expect(perfilDePlantilla('viaje_gastos_etc_v1')).toContain('cinco_agentes');
    expect(perfilDePlantilla('viaje_gastos_etc_v1')).not.toContain('piloto');
    expect(perfilDePlantilla('conductor_llegada_detectada_v1')).toContain('opcional');
  });
});

describe('T-A5-59: el documento regenerado es coherente con el catálogo y el estado', () => {
  it('es exactamente la salida del generador y trae la sección de las 12 con su estado en el proveedor', () => {
    const md = doc();
    expect(md).toBe(`${renderizarDocPlantillas()}\n`);
    expect(md).toContain('Estado en el proveedor');
    for (const p of PLANTILLAS_CICLO) {
      const fila = md.split('\n').find((l) => l.startsWith('| ') && l.includes(`| ${p.codigo} |`) && l.includes(`\`${p.nombre}\``));
      expect(fila, `${p.codigo} sin fila`).toBeDefined();
      expect(fila).toContain(` ${ESTADO_PROVEEDOR_CICLO[p.nombre].replace('_', ' ')} `);
      expect(md).toContain(`### \`${p.nombre}\``);
    }
  });

  it('el documento explica la regla _v2 y que nada se envía desde la cola', () => {
    const md = doc();
    expect(md).toMatch(/_v2/);
    expect(md).toMatch(/comparar|no duplicar/i);
  });
});
