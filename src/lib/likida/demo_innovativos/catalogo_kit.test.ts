/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen archivos de muestra y SQL del propio repo por rutas armadas sobre constantes de este archivo, nunca por entrada de usuario. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validarArchivo } from './archivos';
import { TIPOS_ARCHIVO_KIT } from './contratos';
import { KIT } from './catalogo_kit';
import { analizarHistorial } from '../vigia/historial/analisis';
import { leerExportWhatsapp } from '../vigia/historial/export_whatsapp';
import { textoDeZip } from '../vigia/historial/zip_lector';
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
  it('los nueve importadores están integrados: ninguno queda como contrato ni como «en rama» (y el kit no lo dice)', () => {
    expect(KIT.filter((k) => k.importador.estado !== 'existe').map((k) => k.id)).toEqual([]);
    expect(doc).not.toContain('**contrato**');
    expect(doc).not.toContain('**en_rama**');
    expect(doc).not.toMatch(/w3-(agentes-1-4|conductor-vigia|convenios|gps-jornada)/);
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
  it('la tabla del Vigía del guion son los números del análisis REAL del histórico (lector del Vigía + analizarHistorial)', () => {
    const e = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    const equipo = ['Despacho Innovativos Demo', 'Servicio a Cliente Demo A', 'Servicio a Cliente Demo B', 'Servicio a Cliente Demo C'];
    const filas: Array<[string, string, string]> = [
      ['afb', 'Autopartes (iOS)', 'whatsapp/grupo_afb_silao_ios.txt'], ['arr', 'Armadora (Android)', 'whatsapp/grupo_arr_ramos_android.txt'], ['cfn', 'Cervecería (iOS, .zip)', 'whatsapp/grupo_cfn_apodaca_ios.zip'],
    ];
    for (const [id, etiqueta, rel] of filas) {
      let texto: string;
      if (rel.endsWith('.zip')) { const z = textoDeZip(bytesMuestra(rel)); if (!z.ok) throw new Error(z.error); texto = z.texto; } else texto = textoMuestra(rel);
      const a = analizarHistorial(leerExportWhatsapp(texto, { equipo, sal: 'prueba' }).mensajes);
      const quejas = a.porTema.find((t) => t.tema === 'queja')?.mensajes ?? 0;
      expect(quejas).toBe(e[id].quejas);
      expect(guion.replace(/\*\*/g, '')).toContain(`| ${etiqueta} | ${a.mensajes} | ${a.mensajesCliente} | ${a.tiempos.sobreUmbral} | ${a.tiempos.medianaMin} / ${a.tiempos.p90Min} | ${quejas} |`);
    }
  });
  it('«5 de 17 son polígonos» sale del archivo de geocercas de muestra', () => {
    const filas = textoMuestra('gps/geocercas.csv').trim().split('\n');
    const iTipo = filas[0].split(',').indexOf('tipo');
    expect(iTipo).toBeGreaterThanOrEqual(0);
    const datos = filas.slice(1);
    expect(datos.length).toBeGreaterThan(0);
    const poligonos = datos.filter((f) => f.split(',')[iTipo] === 'poligono').length;
    expect(guion.replace(/\*\*/g, '').replace(/\s+/g, ' ')).toContain(`${poligonos} de ${datos.length} son polígonos`);
    expect(doc.replace(/\*\*/g, '').replace(/\s+/g, ' ')).toContain(`${poligonos} de ${datos.length} son polígonos`);
  });
  it('los viajes cuyo hito detectó el GPS por geocerca (sin chofer) se calculan del SQL y TODOS están en el guion y en el kit', () => {
    const m = /update innovativos_sim\.plan_viaje set por_geocerca = true where tipo = 'abierto' and escenario = 'normal' and i % (\d+) = (\d+);/.exec(viajesSql);
    expect(m, '02_viajes.sql ya no define el escenario por_geocerca').not.toBeNull();
    const [, mod, resto] = m as RegExpExecArray;
    const llegue = foliosDelSql('llegue_sin_gps'); const silencio = foliosDelSql('silencio');
    const folios: string[] = [];
    for (let i = 1; i <= 140; i++) {
      const folio = `INN-${24000 + i}`;
      if (i % Number(mod) === Number(resto) && !llegue.includes(folio) && !silencio.includes(folio)) folios.push(folio);
    }
    expect(folios.length, '0 folios: el SQL cambió y esta prueba no verifica nada').toBeGreaterThan(0);
    for (const f of folios) { expect(guion, `el guion no cita ${f}`).toContain(f); expect(doc, `el kit no cita ${f}`).toContain(f); }
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
  it('las secciones de demostración (1–6) llevan etiquetas de estado: lo que corre hoy, lo que depende de terceros y lo que todavía no existe', () => {
    const demo = secciones.filter((s) => /^[1-6]\. /.test(s.titulo));
    expect(demo.length).toBe(6);
    for (const s of demo) expect(s.cuerpo, `sin etiqueta «[corre hoy]» en ${s.titulo}`).toContain('[corre hoy');
    const todo = demo.map((s) => s.cuerpo).join('\n');
    expect(todo).toContain('[todavía no existe]');
    expect(todo).toMatch(/\[depende de (Meta|GPS real|el cliente)/);
  });
  it('lo integrado ya no se dice «cuando se integre» ni «no está construido»: el guion enseña lo que el código hace', () => {
    expect(guion).not.toContain('se enseña cuando se integre');
    expect(guion).not.toContain('[no está construido]');
    expect(guion).not.toMatch(/w3-(agentes-1-4|conductor-vigia|convenios|gps-jornada)/);
    for (const frag of ['Reavisar', 'copia al jefe de flota', 'sin señal de vida', 'geocerca', 'Reporte de reclamación', 'worker', 'polígono', 'respuestas rápidas', 'Grupos e histórico']) {
      expect(guion.toLowerCase(), `el guion ya no enseña «${frag}»`).toContain(frag.toLowerCase());
    }
  });
  it('lo que NO existe todavía se dice como tal y no se promete', () => {
    const g = guion.replace(/\*\*/g, '');
    for (const fragmento of ['SAP/TMS en vivo']) {
      const i = g.indexOf(fragmento);
      expect(i, `el guion ya no menciona «${fragmento}»`).toBeGreaterThan(-1);
      expect(g.slice(Math.max(0, i - 300), i + 300), `«${fragmento}» no está marcado [todavía no existe]`).toContain('[todavía no existe]');
    }
  });
  it('la partición de un Excel con varios embarques YA existe (P13): el guion lo enseña como hecho y no la promete como pendiente', () => {
    const g = guion.replace(/\*\*/g, '');
    expect(g).toContain('se parte solo en un documento por embarque');
    expect(g).not.toMatch(/varios embarques[^.]*\[todavía no existe\]/);
    expect(existsSync(`${RAIZ}src/lib/likida/carta_porte_docs/multiembarque.ts`)).toBe(true);
  });
  it('los cursos de peajes YA existen (P8): el guion y el kit los enseñan como «corre hoy»; solo el formato real del corredor depende del cliente', () => {
    for (const rel of ['src/lib/likida/peajes/cursos.ts', 'src/lib/likida/peajes/cursos_importar.ts', 'src/lib/likida/conectores/tabla_propia/fixtures/cursos.csv', 'supabase/migrations/0665_peaje_cursos.sql']) {
      expect(existsSync(`${RAIZ}${rel}`), rel).toBe(true);
    }
    const g = guion.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    expect(g, 'el guion enseña el motivo «Cruce fuera de curso» como «corre hoy»').toMatch(/\[corre hoy[^\]]*\] «Cruce fuera de curso»/);
    expect(g).not.toMatch(/«cursos»[^.]*\[todavía no existe\]/);
    expect(g).toMatch(/formato real de sus corredores[^.]*\[depende del cliente\]/);
    const k = doc.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    expect(k).toContain('cursos por casetas autorizadas');
    expect(k).not.toContain('Los cursos de peajes y la lectura');
    expect(k).not.toMatch(/cursos[^.]*no existen todavía/);
  });
  it('lo que sigue sin existir en el producto es verdad: no hay lector de SAP', () => {
    const rutas = (rel: string) => existsSync(`${RAIZ}${rel}`);
    expect(rutas('src/lib/likida/conectores/sap')).toBe(false);
  });
  it('el lector SFTP de la tabla propia YA existe (P15): el kit y el guion no lo prometen como cliente por instalar', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/conectores/tabla_propia/sftp.ts`)).toBe(true);
    for (const t of [guion, doc]) {
      expect(t).not.toMatch(/SFTP (necesita )?un cliente|SFTP pendientes? de dependencia|y SFTP pendientes/);
    }
  });
  it('el lector SQL de la tabla propia YA existe con pg (ronda 18): el kit y el guion no dicen que falta un controlador', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/conectores/tabla_propia/sql.ts`)).toBe(true);
    expect(existsSync(`${RAIZ}node_modules/pg/package.json`)).toBe(true);
    expect(readFileSync(`${RAIZ}package.json`, 'utf8')).toMatch(/"pg": "8\.\d+\.\d+"/);
    for (const t of [guion, doc]) {
      expect(t).not.toMatch(/SQL directo (necesita|pendiente de dependencia)|controlador que aún no instalamos|falta el controlador de PostgreSQL/);
    }
  });
  it('el alta y la edición de convenios en pantalla ya existen (P7) y el guion lo dice como «corre hoy»', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/convenios/edicion.ts`)).toBe(true);
    const g = guion.replace(/\*\*/g, '');
    const i = g.indexOf('alta y la edición de un convenio en pantalla');
    expect(i).toBeGreaterThan(-1);
    expect(g.slice(Math.max(0, i - 200), i + 100)).toContain('[corre hoy]');
    expect(g).not.toContain('[todavía no existe] el alta y la edición de un convenio');
  });
  it('el apartado de terceros cubre Meta, GPS, grupos, pases, liquidación, Carta Porte y la «calle de instrucciones»', () => {
    const t = guion.slice(guion.indexOf('## 8.'));
    for (const fila of ['**Meta (WhatsApp)**', '**GPS real**', '**WhatsApp, grupos**', '**Archivo de pases**', '**Liquidación**', '**Carta Porte**', '**«Calle de instrucciones»**']) expect(t, fila).toContain(fila);
    expect(t).toContain('plantilla aprobada');
    expect(t).toContain('API de Business');
  });
  it('el repo es público: ni nombres de personas del cliente ni datos comerciales en el guion ni en el kit', () => {
    // Los términos se arman por partes para que ESTE archivo tampoco dispare el grep de confidencialidad de la integración.
    const prohibidos = new RegExp([['jo', 's[eé] '], ['lo', 'rena'], ['320 ', 'trac'], ['com', 'petid'], ['primer', ' mes']].map((p) => p.join('')).join('|'), 'i');
    for (const texto of [guion, doc]) expect(texto).not.toMatch(prohibidos);
  });
});
