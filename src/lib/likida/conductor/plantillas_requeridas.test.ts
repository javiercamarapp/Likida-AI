import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGO_PLANTILLAS, plantillaDeCatalogo } from '@/lib/meta/plantillas_catalogo';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import {
  APROBADAS, compararConAprobadas, listaCopiableParaMeta, perfilDePlantilla, plantillasRequeridas,
} from './plantillas_requeridas';

const RAIZ = process.cwd();
const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8'); // eslint-disable-line security/detect-non-literal-fs-filename -- rutas fijas de esta prueba
const base = { ...CONFIG_CONDUCTOR_DEFAULT };

describe('plantillasRequeridas', () => {
  it('esenciales con señal de vida apagada: 5 plantillas (salida de carga, aviso al jefe y los 3 recordatorios)', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales', avisarSenalVida: false });
    expect(r).toEqual([
      'conductor_salida_carga_v1', 'conductor_recordatorio_1_v1', 'conductor_recordatorio_2_v1', 'conductor_recordatorio_3_v1', 'aviso_jefe_trafico_v1',
    ]);
  });

  it('esenciales con señal de vida encendida suma las 2 de señal de vida (7)', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales', avisarSenalVida: true });
    expect(r).toHaveLength(7);
    expect(r).toContain('conductor_senal_vida_v1');
    expect(r).toContain('aviso_jefe_senal_vida_v1');
  });

  it('completo: las 12 del Conductor, y 14 con la señal de vida encendida', () => {
    const doce = plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: false });
    expect(doce).toHaveLength(12);
    expect(new Set(doce).size).toBe(12);
    expect(plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: true })).toHaveLength(14);
  });

  it('esenciales es un subconjunto de completo', () => {
    const completo = new Set(plantillasRequeridas({ ...base, perfilSeguimiento: 'completo' }));
    for (const n of plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales' })) expect(completo.has(n)).toBe(true);
  });

  it('una escalera más corta pide menos recordatorios (la solicitud es el nivel 0)', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15] });
    expect(r.filter((n) => n.startsWith('conductor_recordatorio_'))).toEqual(['conductor_recordatorio_1_v1']);
    const sin = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales', solicitudesMin: [0] });
    expect(sin.some((n) => n.startsWith('conductor_recordatorio_'))).toBe(false);
  });

  it('todas existen en el catálogo, son UTILITY y las manda el código del conductor (solicitudes.ts / senal_vida / alertas)', () => {
    const codigo = ['solicitudes.ts', 'alertas_llegada.ts'].map((f) => leer(`src/lib/likida/conductor/${f}`)).join('\n');
    const todas = plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: true });
    for (const n of todas) {
      const p = plantillaDeCatalogo(n);
      expect(p, `«${n}» no está en el catálogo`).toBeDefined();
      expect(p!.categoria).toBe('UTILITY');
      // `conductor_contacto_anden_v1` aún no tiene llamador (lo dice el catálogo): es la única que no sale del código.
      if (p!.llamador !== null) expect(codigo, `«${n}» no se manda desde el código del conductor`).toContain(`'${n}'`);
    }
  });

  it('no queda ninguna plantilla del conductor del catálogo sin clasificar por perfil', () => {
    const del = CATALOGO_PLANTILLAS.filter((p) => p.agente === 'agente5_conductor' && !p.nombre.startsWith('convenio_'));
    const clasificadas = new Set(plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: true }));
    expect(del.filter((p) => !clasificadas.has(p.nombre)).map((p) => p.nombre)).toEqual([]);
  });

  it('no incluye las de convenios ni las de liquidación', () => {
    const todas = plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: true });
    expect(todas.filter((n) => n.startsWith('convenio_') || n.startsWith('liquidacion_'))).toEqual([]);
  });
});

describe('compararConAprobadas y la lista copiable', () => {
  it('APROBADAS solo trae nombres del catálogo', () => {
    for (const n of APROBADAS) expect(plantillaDeCatalogo(n)).toBeDefined();
  });

  it('con ninguna aprobada, todas faltan y la flota no está lista', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales' });
    const c = compararConAprobadas(r, []);
    expect(c.faltantes).toEqual(r);
    expect(c.lista).toBe(false);
  });

  it('con las aprobadas declaradas, solo faltan las demás', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales' });
    const c = compararConAprobadas(r, ['conductor_salida_carga_v1', 'aviso_jefe_trafico_v1']);
    expect(c.aprobadas).toEqual(['conductor_salida_carga_v1', 'aviso_jefe_trafico_v1']);
    expect(c.faltantes).toHaveLength(3);
    expect(compararConAprobadas(r, r).lista).toBe(true);
  });

  it('la lista copiable es un nombre por línea, sin teléfonos ni nada más', () => {
    const r = plantillasRequeridas({ ...base, perfilSeguimiento: 'esenciales' });
    const texto = listaCopiableParaMeta(r);
    expect(texto.split('\n')).toEqual(r);
    expect(texto).not.toMatch(/\d{8,}/);
  });
});

describe('docs/operacion/plantillas-meta.md es coherente con el código', () => {
  const doc = leer('docs/operacion/plantillas-meta.md');
  it('cada plantilla requerida por algún perfil aparece en la tabla con su columna de perfil', () => {
    const todas = plantillasRequeridas({ ...base, perfilSeguimiento: 'completo', avisarSenalVida: true });
    expect(doc).toContain('Perfil (esenciales / completo)');
    for (const n of todas) {
      const fila = doc.split('\n').find((l) => l.startsWith('| ') && l.includes(`| \`${n}\` |`));
      expect(fila, `«${n}» no está en la tabla del documento`).toBeDefined();
      expect(fila).toContain(perfilDePlantilla(n));
    }
  });

  it('las 5 de esenciales dicen «Esenciales y completo» y las demás del conductor «Solo completo» o señal de vida', () => {
    expect(perfilDePlantilla('conductor_salida_carga_v1')).toBe('Esenciales y completo');
    expect(perfilDePlantilla('aviso_jefe_trafico_v1')).toBe('Esenciales y completo');
    expect(perfilDePlantilla('conductor_llegada_descarga_v1')).toBe('Solo completo');
    expect(perfilDePlantilla('conductor_senal_vida_v1')).toContain('señal de vida');
    expect(perfilDePlantilla('regla_aviso_v1')).toBe('—');
  });
});
