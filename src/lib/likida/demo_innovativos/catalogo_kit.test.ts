/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen archivos de muestra y SQL del propio repo por rutas armadas sobre constantes de este archivo, nunca por entrada de usuario. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validarArchivo } from './archivos';
import { TIPOS_ARCHIVO_KIT } from './contratos';
import { KIT } from './catalogo_kit';
import { bytesMuestra, textoMuestra } from './muestras.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// EL KIT NO PUEDE DECIR MÁS (NI MENOS) DE LO QUE EL CÓDIGO HACE:
//   · cada tipo de archivo del contrato está en el catálogo, y al revés;
//   · cada archivo de muestra del catálogo existe y es válido;
//   · docs/demo/innovativos.md menciona cada entrada (id, muestra e importador);
//   · el guion cita los escenarios sembrados (folios, tracto) que de verdad existen en los datos.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const doc = readFileSync(`${RAIZ}docs/demo/innovativos.md`, 'utf8');
const guion = readFileSync(`${RAIZ}docs/demo/guion-innovativos-20oct.md`, 'utf8');

describe('catálogo del kit', () => {
  it('cubre exactamente los tipos de archivo del contrato', () => {
    expect(KIT.map((k) => k.id).sort()).toEqual([...TIPOS_ARCHIVO_KIT].sort());
  });
  it.each(KIT.map((k) => [k.id, k] as const))('%s: la muestra existe, es válida y el documento la menciona', (_id, k) => {
    expect(existsSync(`${RAIZ}scripts/demo/innovativos/archivos-muestra/${k.muestra}`)).toBe(true);
    const nombre = k.muestra.split('/').pop() as string;
    expect(validarArchivo(k.id, nombre, bytesMuestra(k.muestra)).ok).toBe(true);
    expect(doc).toContain(k.muestra.split('/').slice(-2).join('/').replace(/^[^/]+\//, '') || k.muestra);
    expect(doc).toContain(`\`${k.id}\``);
    expect(doc).toContain(k.pantalla.split(' ')[0]); // la ruta principal de la pantalla
    expect(doc).toContain(k.importador.estado === 'existe' ? '**existe**' : k.importador.estado === 'en_rama' ? '**en_rama**' : '**contrato**');
  });
  it('declara un importador con su dónde', () => {
    for (const k of KIT) {
      expect(k.importador.donde.length).toBeGreaterThan(20);
    }
  });
  it('lo único que es solo contrato es el lector de tabla propia (el resto existe o viene en una rama dueña)', () => {
    expect(KIT.filter((k) => k.importador.estado === 'contrato').map((k) => k.id)).toEqual(['gps_posiciones']);
  });
});

describe('el guion y el documento citan lo que de verdad está sembrado', () => {
  const anomalias = textoMuestra('peajes/anomalias_sembradas.csv');
  const viajesSql = readFileSync(`${RAIZ}scripts/demo/innovativos/sql/02_viajes.sql`, 'utf8');
  /** Los folios de un escenario, calculados del propio SQL del seed (`i % m = r`), no escritos aquí a mano. */
  function foliosDelSql(escenario: string): string[] {
    const m = new RegExp(`g\\.i % (\\d+) = (\\d+) then '${escenario}'`).exec(viajesSql);
    expect(m, `02_viajes.sql ya no define el escenario ${escenario}`).not.toBeNull();
    const [, mod, resto] = m as RegExpExecArray;
    const folios: string[] = [];
    for (let i = 1; i <= 140; i++) if (i % Number(mod) === Number(resto)) folios.push(`INN-${24000 + i}`);
    return folios;
  }
  it('los folios de los escenarios («ya llegué» sin GPS y sin señal de vida) se calculan del SQL y TODOS están en el guion y en el kit', () => {
    const llegue = foliosDelSql('llegue_sin_gps');
    const silencio = foliosDelSql('silencio');
    expect(llegue.length, '0 folios del escenario: el SQL cambió y esta prueba no verifica nada').toBeGreaterThan(0);
    expect(silencio.length).toBeGreaterThan(0);
    for (const f of [...llegue, ...silencio]) {
      expect(doc, `el kit no cita ${f}`).toContain(f);
      expect(guion, `el guion no cita ${f}`).toContain(f);
    }
  });
  it('la anomalía de peajes que el guion enseña (INN-24091 / IN-091 y el duplicado de IN-123) está en la verdad sembrada', () => {
    expect(guion).toContain('INN-24091');
    expect(guion).toContain('IN-123');
    expect(anomalias).toMatch(/fuera_de_ruta,INN-24091,IN-091,.*Caseta Demo Encarnacion/);
    expect(anomalias).toMatch(/duplicado,INN-24123,IN-123,/);
    const lineas = anomalias.trim().split('\n').length - 1;
    expect(lineas).toBeGreaterThan(0);
    expect(lineas).toBe(13); // «13 líneas» del documento (9 fuera de ruta + 4 duplicados)
    expect(doc).toContain(`(${lineas} líneas`);
  });
  it('toda clave de liquidación que cite un documento existe en la muestra de «su sistema» (y la muestra no está vacía)', () => {
    const muestra = textoMuestra('liquidacion/liquidaciones_sistema.csv');
    expect(muestra.trim().split('\n').length, 'la muestra de liquidaciones está vacía').toBeGreaterThan(1);
    const citadas = [...new Set(`${guion}\n${doc}`.match(/SAP-LIQ-DEMO-\d{4}-\d{6}/g) ?? [])];
    for (const clave of citadas) expect(muestra, `${clave} no está en la muestra`).toContain(clave);
    // La verdad de las cifras (8 «No coincide», 158 en total…) se verifica contra la BASE en verificar-hechos-del-guion.mjs.
  });
  it('los conteos del guion para los chats son los del resumen esperado', () => {
    const e = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    for (const g of ['afb', 'arr', 'cfn']) {
      expect(guion).toContain(`| ${e[g].mensajes} | ${e[g].preguntas} | ${e[g].sin_respuesta_10min} | ${e[g].quejas} |`);
    }
  });
  it('«4 de 17 son polígonos» sale del archivo de geocercas de muestra', () => {
    const filas = textoMuestra('gps/geocercas.csv').trim().split('\n');
    const iTipo = filas[0].split(',').indexOf('tipo');
    expect(iTipo).toBeGreaterThanOrEqual(0);
    const datos = filas.slice(1);
    expect(datos.length).toBeGreaterThan(0);
    const poligonos = datos.filter((f) => f.split(',')[iTipo] === 'poligono').length;
    expect(guion.replace(/\*\*/g, '').replace(/\s+/g, ' ')).toContain(`${poligonos} de ${datos.length} son polígonos`);
  });
});

describe('estructura del guion: cada agente en su sección y cada cosa con su etiqueta', () => {
  const secciones = guion.split(/^## /m).slice(1).map((t) => ({ titulo: t.split('\n')[0], cuerpo: t }));
  it('una sección por agente, con el agente en el título', () => {
    const esperado: Array<[string, RegExp]> = [
      ['orquestador', /orquestador/i], ['Conductor', /Conductor/], ['Vigía', /Vigía/], ['Peajes', /Peajes/], ['Liquidación fase 1', /Liquidación fase 1/], ['Carta Porte', /Carta Porte/],
    ];
    for (const [nombre, re] of esperado) expect(secciones.some((s) => re.test(s.titulo)), `falta una sección «${nombre}»`).toBe(true);
  });
  it('las secciones de demostración (1–6) llevan etiquetas de estado: lo que corre hoy, lo que depende de otra rama y lo de terceros', () => {
    const demo = secciones.filter((s) => /^[1-6]\. /.test(s.titulo));
    expect(demo.length).toBe(6);
    for (const s of demo) expect(s.cuerpo, `sin etiqueta «[corre hoy]» en ${s.titulo}`).toContain('[corre hoy');
    const todo = demo.map((s) => s.cuerpo).join('\n');
    expect(todo).toContain('[se enseña cuando se integre');
    expect(todo).toMatch(/\[depende de (Meta|GPS real|el cliente)/);
  });
  it('lo que no existe en esta rama NO se promete: está marcado «se enseña cuando se integre»', () => {
    // Botones de escalamiento, conciliación obligatoria, histórico de grupos, reporte de reclamación, convenios y chat con fuentes nuevas.
    for (const [fragmento, rama] of [['botones de escalamiento', 'w3-conductor-vigia'], ['conciliación obligatoria', 'w3-conductor-vigia'], ['histórico exportado', 'w3-conductor-vigia'], ['reporte de reclamación', 'w3-agentes-1-4'], ['instrucciones por convenio', 'w3-convenios'], ['una sola pestaña', 'w3-agentes-1-4']]) {
      const i = guion.toLowerCase().indexOf(fragmento);
      expect(i, `el guion ya no menciona «${fragmento}»`).toBeGreaterThan(-1);
      expect(guion.slice(Math.max(0, i - 400), i + 400), `«${fragmento}» no está marcado como dependiente de ${rama}`).toContain(`se enseña cuando se integre \`${rama}\``);
    }
  });
  it('lo que no está construido no se dice como si lo estuviera (aviso a la oficina, copia al jefe, Excel por WhatsApp)', () => {
    expect(guion).toMatch(/\[no está construido\][\s\S]{0,200}le avisamos a la oficina/);
    expect(guion).not.toMatch(/el jefe de flota recibe copia/i);
  });
  it('el apartado de terceros cubre Meta, GPS, grupos, pases, liquidación, Carta Porte y la «calle de instrucciones»', () => {
    const t = guion.slice(guion.indexOf('## 8.'));
    for (const fila of ['**Meta (WhatsApp)**', '**GPS real**', '**WhatsApp, grupos**', '**Archivo de pases**', '**Liquidación**', '**Carta Porte**', '**«Calle de instrucciones»**']) expect(t, fila).toContain(fila);
    expect(t).toContain('plantilla aprobada');
    expect(t).toContain('API de Business');
  });
});
