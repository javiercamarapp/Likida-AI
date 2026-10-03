import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOGO_PLANTILLAS, PLANTILLA, validarCatalogo, plantillaDeCatalogo, variablesDeTexto, opcionesDeEnvio,
  textoRenderizado, cuerpoCreacionMeta, parametrosReglaAviso, MAX_FRASE_REGLA_PLANTILLA, type PlantillaCatalogo,
} from './plantillas_catalogo';
import { renderizarDocPlantillas } from './plantillas_doc';
import { armarComponentesPlantilla } from './plantilla_payload';

const RAIZ = process.cwd();

describe('el catálogo respeta las reglas de Meta que se pueden comprobar sin red', () => {
  it('validarCatalogo() no encuentra errores', () => {
    expect(validarCatalogo()).toEqual([]);
  });

  it('nombre+idioma únicos', () => {
    const claves = CATALOGO_PLANTILLAS.map((p) => `${p.nombre}/${p.idioma}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('todas UTILITY y es_MX, salvo respuesta_arco_v2 (aprobada en `es`)', () => {
    for (const p of CATALOGO_PLANTILLAS) {
      expect(p.categoria).toBe('UTILITY');
      expect(p.idioma).toBe(p.nombre === 'respuesta_arco_v2' ? 'es' : 'es_MX');
    }
  });

  it('están las cinco que el código ya manda y las nuevas del Agente 5', () => {
    for (const n of ['viaje_asignado', 'recordatorio_cierre', 'aviso_operacion_v1', 'plazo_factura', 'respuesta_arco_v2']) {
      expect(plantillaDeCatalogo(n), n).toBeDefined();
    }
    const agente5 = CATALOGO_PLANTILLAS.filter((p) => p.agente === 'agente5_conductor').map((p) => p.nombre);
    expect(agente5).toEqual(expect.arrayContaining([
      'conductor_solicitud_llegada_carga_v1', 'conductor_contacto_anden_v1', 'conductor_salida_carga_v1',
      'conductor_llegada_descarga_v1', 'conductor_salida_descarga_v1',
      'conductor_recordatorio_1_v1', 'conductor_recordatorio_2_v1', 'conductor_recordatorio_3_v1',
      'aviso_jefe_trafico_v1',
    ]));
  });

  it('las constantes PLANTILLA apuntan a plantillas del catálogo', () => {
    for (const n of Object.values(PLANTILLA)) expect(plantillaDeCatalogo(n), n).toBeDefined();
  });

  it('un catálogo roto SÍ se detecta (la validación no es decorativa)', () => {
    const base = plantillaDeCatalogo('plazo_factura') as PlantillaCatalogo;
    const malos: Array<[Partial<PlantillaCatalogo>, RegExp]> = [
      [{ cuerpo: '{{1}} empieza con variable' }, /empieza o termina/],
      [{ cuerpo: 'termina con variable {{1}}' }, /empieza o termina/],
      [{ cuerpo: 'Hola {{2}} salta variable' }, /consecutivas/],
      [{ cuerpo: 'Hola {{1}} y {{2}} más', ejemplos: ['a'] }, /ejemplos/],
      [{ nombre: 'Nombre Con Mayúsculas' }, /nombre/],
      [{ categoria: 'MARKETING' as never }, /UTILITY/],
      [{ cuerpo: 'x'.repeat(1025) }, /cuerpo mide/],
      [{ botones: [{ tipo: 'QUICK_REPLY', texto: 'x'.repeat(26), payloadPrefijo: 'a' }] }, /botón inválido/],
      [{ botones: [{ tipo: 'URL', texto: 'Abrir', url: 'http://x.test' }, { tipo: 'QUICK_REPLY', texto: 'Ok', payloadPrefijo: 'a' }] }, /URL de botón|antes que/],
    ];
    for (const [cambio, patron] of malos) {
      const errores = validarCatalogo([{ ...base, ...cambio } as PlantillaCatalogo]);
      expect(errores.join('|'), JSON.stringify(cambio).slice(0, 60)).toMatch(patron);
    }
  });
});

describe('opcionesDeEnvio / textoRenderizado', () => {
  it('arma parámetros y botones de respuesta rápida con el id del viaje', () => {
    const o = opcionesDeEnvio('conductor_recordatorio_2_v1', { cuerpo: ['Juan', 'tu llegada', 'F-1', '30 minutos'], idsBotones: 'viaje-uuid' });
    expect(o.idioma).toBe('es_MX');
    expect(o.botones).toEqual([
      { tipo: 'respuesta_rapida', indice: 0, payload: 'recordatorio_registrar:viaje-uuid' },
      { tipo: 'respuesta_rapida', indice: 1, payload: 'recordatorio_problema:viaje-uuid' },
    ]);
    // …y lo armado pasa el validador del payload de Meta
    expect(armarComponentesPlantilla(o).ok).toBe(true);
  });

  it('el botón URL del aviso al jefe no gasta parámetro (URL fija) y su botón de respuesta rápida es el índice 0', () => {
    const o = opcionesDeEnvio('aviso_jefe_trafico_v1', { cuerpo: ['Juan', 'su llegada', 'F-1', 'sin respuesta', 'km 120'], idsBotones: 'v1' });
    expect(o.botones).toEqual([{ tipo: 'respuesta_rapida', indice: 0, payload: 'jefe_atiendo:v1' }]);
  });

  it('todas las plantillas del catálogo se pueden armar con valores de ejemplo', () => {
    for (const p of CATALOGO_PLANTILLAS) {
      const o = opcionesDeEnvio(p.nombre, { cuerpo: p.ejemplos, idsBotones: 'v-1', medio: { link: 'https://x.test/a.pdf' } });
      const r = armarComponentesPlantilla(o);
      expect(r.ok, `${p.nombre}: ${r.ok ? '' : r.error}`).toBe(true);
    }
  });

  it('número de variables equivocado, plantilla inexistente o falta de ids: error de programación, no una llamada a Meta', () => {
    expect(() => opcionesDeEnvio('plazo_factura', { cuerpo: ['1', '2'] })).toThrow(/1 variable/);
    expect(() => opcionesDeEnvio('no_existe', {})).toThrow(/fuera del catálogo/);
    expect(() => opcionesDeEnvio('conductor_salida_carga_v1', { cuerpo: ['a', 'b'] })).toThrow(/idsBotones/);
  });

  it('el texto renderizado sustituye las variables', () => {
    expect(textoRenderizado('plazo_factura', ['3'])).toBe('Tienes 3 ticket(s) con plazo de facturación por vencer. Entra a tu panel de Likida para revisarlos.');
  });

  it('variablesDeTexto', () => {
    expect(variablesDeTexto('a {{1}} b {{2}} {{10}}')).toEqual([1, 2, 10]);
    expect(variablesDeTexto('sin variables')).toEqual([]);
  });
});

describe('cuerpo para someter a Meta', () => {
  it('lleva ejemplos del cuerpo y botones en el orden del catálogo', () => {
    const c = cuerpoCreacionMeta(plantillaDeCatalogo('aviso_jefe_trafico_v1') as PlantillaCatalogo);
    expect(c).toMatchObject({ name: 'aviso_jefe_trafico_v1', language: 'es_MX', category: 'UTILITY' });
    const comps = c.components as Array<Record<string, unknown>>;
    expect(comps[0]).toMatchObject({ type: 'BODY', example: { body_text: [expect.any(Array)] } });
    expect(comps[1]).toMatchObject({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ya lo atiendo' }, { type: 'URL', text: 'Abrir tablero' }] });
  });
  it('sin variables no manda example (Meta lo rechaza vacío)', () => {
    const p = { ...(plantillaDeCatalogo('plazo_factura') as PlantillaCatalogo), cuerpo: 'Sin variables aquí.', ejemplos: [], variables: [] };
    expect((cuerpoCreacionMeta(p).components as Array<Record<string, unknown>>)[0]).not.toHaveProperty('example');
  });
});

describe('parametrosReglaAviso', () => {
  it('recorta la frase, normaliza espacios y nunca deja vacío', () => {
    const [n, f, liga] = parametrosReglaAviso(3.9, 'a\nb   c', 'https://x.test');
    expect([n, f, liga]).toEqual(['3', 'a b c', 'https://x.test']);
    expect(parametrosReglaAviso(1, 'x'.repeat(500), 'l')[1]).toHaveLength(MAX_FRASE_REGLA_PLANTILLA);
    expect(parametrosReglaAviso(-2, '  ', 'l')).toEqual(['0', 'una de tus reglas', 'l']);
  });
});

describe('el código no manda plantillas que el catálogo no conoce', () => {
  const archivos = [
    'src/lib/meta/client.ts', 'src/lib/meta/aviso_oficina.ts', 'src/lib/likida/notificar.ts',
    'src/lib/likida/agentes/cobranza.ts', 'src/lib/likida/escalar_viaje.ts', 'src/lib/likida/facturacion/avisar.ts',
    'src/lib/likida/reglas/vigilante.ts',
  ];
  it('todo nombre de plantilla literal en esos archivos está en el catálogo', () => {
    const nombres = new Set<string>();
    for (const a of archivos) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas de esta prueba
      const src = readFileSync(join(RAIZ, a), 'utf8');
      for (const m of src.matchAll(/(?:name:\s*(?=[^\n]*language)|PLANTILLA\w*\s*=\s*|PLANTILLA_AVISO_OFICINA_DEFAULT\s*=\s*|sendTemplate\([^,]+,\s*)'([a-z][a-z0-9_]+)'/g)) nombres.add(m[1]);
    }
    expect(nombres.size).toBeGreaterThan(4);
    for (const n of nombres) expect(plantillaDeCatalogo(n), `«${n}» se manda desde el código pero no está en el catálogo`).toBeDefined();
  });
});

describe('docs/operacion/plantillas-meta.md', () => {
  it('es exactamente la salida del catálogo (regenerar con scripts/generar-doc-plantillas.ts)', () => {
    const doc = readFileSync(join(RAIZ, 'docs/operacion/plantillas-meta.md'), 'utf8');
    expect(doc).toBe(`${renderizarDocPlantillas()}\n`);
  });
  it('lleva el texto exacto de cada plantilla y de cada botón', () => {
    const doc = readFileSync(join(RAIZ, 'docs/operacion/plantillas-meta.md'), 'utf8');
    for (const p of CATALOGO_PLANTILLAS) {
      expect(doc).toContain(`### \`${p.nombre}\``);
      for (const linea of p.cuerpo.split('\n')) expect(doc).toContain(linea);
      for (const b of p.botones) expect(doc).toContain(`«${b.texto}»`);
    }
  });
  it('los archivos de scripts referenciados existen', () => {
    for (const f of ['scripts/verificar-plantillas-meta.ts', 'scripts/generar-doc-plantillas.ts']) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas de esta prueba
      expect(statSync(join(RAIZ, f)).isFile()).toBe(true);
    }
    expect(readdirSync(join(RAIZ, 'docs/operacion'))).toContain('plantillas-meta.md');
  });
});

describe('renderizarDocPlantillas: escapado de la tabla markdown', () => {
  it('un ejemplo con backslash y barra vertical no rompe la celda (el backslash se escapa primero)', () => {
    const base = CATALOGO_PLANTILLAS.find((p) => p.variables.length > 0)!;
    const ejemplos = base.ejemplos.map((e, i) => (i === 0 ? 'a\\|b' : e));
    const md = renderizarDocPlantillas([{ ...base, ejemplos }]);
    expect(md).toContain('a\\\\\\|b');
  });
});
