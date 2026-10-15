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
//   · los escenarios sembrados (folios, anomalías, geocercas) existen de verdad en los datos del SQL y las muestras.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));

describe('catálogo del kit', () => {
  it('cubre exactamente los tipos de archivo del contrato', () => {
    expect(KIT.map((k) => k.id).sort()).toEqual([...TIPOS_ARCHIVO_KIT].sort());
  });
  it.each(KIT.map((k) => [k.id, k] as const))('%s: la muestra existe y es válida', (_id, k) => {
    expect(existsSync(`${RAIZ}scripts/demo/innovativos/archivos-muestra/${k.muestra}`)).toBe(true);
    const nombre = k.muestra.split('/').pop() as string;
    expect(validarArchivo(k.id, nombre, bytesMuestra(k.muestra)).ok).toBe(true);
  });
  it('declara un importador con su dónde', () => {
    for (const k of KIT) {
      expect(k.importador.donde.length).toBeGreaterThan(20);
    }
  });
  it('los nueve importadores están integrados: ninguno queda como contrato ni como «en rama»', () => {
    expect(KIT.filter((k) => k.importador.estado !== 'existe').map((k) => k.id)).toEqual([]);
  });
});

describe('los escenarios del kit son los que de verdad están sembrados', () => {
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
  it('los folios de los escenarios («ya llegué» sin GPS y sin señal de vida) se calculan del SQL y no quedan vacíos', () => {
    const llegue = foliosDelSql('llegue_sin_gps');
    const silencio = foliosDelSql('silencio');
    expect(llegue.length, '0 folios del escenario: el SQL cambió y esta prueba no verifica nada').toBeGreaterThan(0);
    expect(silencio.length).toBeGreaterThan(0);
  });
  it('la anomalía de peajes (DEMO-24091 / IN-091 y el duplicado de IN-123) está en la verdad sembrada', () => {
    expect(anomalias).toMatch(/fuera_de_ruta,INN-24091,IN-091,.*Caseta Demo Encarnacion/);
    expect(anomalias).toMatch(/duplicado,INN-24123,IN-123,/);
    const lineas = anomalias.trim().split('\n').length - 1;
    expect(lineas).toBeGreaterThan(0);
    expect(lineas).toBe(13); // 9 fuera de ruta + 4 duplicados
  });
  it('la muestra de liquidaciones de «su sistema» no está vacía', () => {
    const muestra = textoMuestra('liquidacion/liquidaciones_sistema.csv');
    expect(muestra.trim().split('\n').length, 'la muestra de liquidaciones está vacía').toBeGreaterThan(1);
  });
  it('las quejas esperadas del histórico coinciden con el análisis REAL (lector del Vigía + analizarHistorial)', () => {
    const e = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    const equipo = ['Despacho Innovativos Demo', 'Servicio a Cliente Demo A', 'Servicio a Cliente Demo B', 'Servicio a Cliente Demo C'];
    const filas: Array<[string, string, string]> = [
      ['afb', 'Autopartes (iOS)', 'whatsapp/grupo_afb_silao_ios.txt'], ['arr', 'Armadora (Android)', 'whatsapp/grupo_arr_ramos_android.txt'], ['cfn', 'Cervecería (iOS, .zip)', 'whatsapp/grupo_cfn_apodaca_ios.zip'],
    ];
    for (const [id, , rel] of filas) {
      let texto: string;
      if (rel.endsWith('.zip')) { const z = textoDeZip(bytesMuestra(rel)); if (!z.ok) throw new Error(z.error); texto = z.texto; } else texto = textoMuestra(rel);
      const a = analizarHistorial(leerExportWhatsapp(texto, { equipo, sal: 'prueba' }).mensajes);
      const quejas = a.porTema.find((t) => t.tema === 'queja')?.mensajes ?? 0;
      expect(quejas).toBe(e[id].quejas);
    }
  });
  it('«5 de 17 son polígonos» sale del archivo de geocercas de muestra', () => {
    const filas = textoMuestra('gps/geocercas.csv').trim().split('\n');
    const iTipo = filas[0].split(',').indexOf('tipo');
    expect(iTipo).toBeGreaterThanOrEqual(0);
    const datos = filas.slice(1);
    expect(datos.length).toBeGreaterThan(0);
    const poligonos = datos.filter((f) => f.split(',')[iTipo] === 'poligono').length;
    expect(poligonos).toBe(5);
    expect(datos.length).toBe(17);
  });
  it('los viajes cuyo hito detectó el GPS por geocerca (sin chofer) se calculan del SQL', () => {
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
  });
});

describe('lo que existe en el producto es lo que el kit usa', () => {
  it('la partición de un Excel con varios embarques YA existe (P13)', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/carta_porte_docs/multiembarque.ts`)).toBe(true);
  });
  it('los cursos de peajes YA existen (P8)', () => {
    for (const rel of ['src/lib/likida/peajes/cursos.ts', 'src/lib/likida/peajes/cursos_importar.ts', 'src/lib/likida/conectores/tabla_propia/fixtures/cursos.csv', 'supabase/migrations/0665_peaje_cursos.sql']) {
      expect(existsSync(`${RAIZ}${rel}`), rel).toBe(true);
    }
  });
  it('lo que sigue sin existir en el producto es verdad: no hay lector de SAP', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/conectores/sap`)).toBe(false);
  });
  it('el lector SFTP de la tabla propia YA existe (P15)', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/conectores/tabla_propia/sftp.ts`)).toBe(true);
  });
  it('el lector SQL de la tabla propia YA existe con pg (ronda 18)', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/conectores/tabla_propia/sql.ts`)).toBe(true);
    expect(existsSync(`${RAIZ}node_modules/pg/package.json`)).toBe(true);
    expect(readFileSync(`${RAIZ}package.json`, 'utf8')).toMatch(/"pg": "8\.\d+\.\d+"/);
  });
  it('el alta y la edición de convenios en pantalla ya existen (P7)', () => {
    expect(existsSync(`${RAIZ}src/lib/likida/convenios/edicion.ts`)).toBe(true);
  });
});
