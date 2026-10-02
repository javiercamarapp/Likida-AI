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
  it('los folios de los escenarios del guion existen en la verdad sembrada o en el plan de viajes', () => {
    // «llegue_sin_gps»: viajes abiertos i % 27 = 5; «silencio»: i % 23 = 0 (02_viajes.sql). Aquí se comprueba que el kit cita todos.
    const llegue = [5, 32, 59, 86, 113, 140].map((n) => `INN-${24000 + n}`);
    const silencio = [23, 46, 69, 92, 115, 138].map((n) => `INN-${24000 + n}`);
        for (const f of llegue) expect(doc).toContain(f);
    for (const f of silencio) expect(doc).toContain(f);
  });
  it('la anomalía de peajes que el guion enseña (INN-24091 / IN-091 y el duplicado de IN-123) está en la verdad sembrada', () => {
    expect(guion).toContain('INN-24091');
    expect(guion).toContain('IN-123');
    expect(anomalias).toMatch(/fuera_de_ruta,INN-24091,IN-091,.*Caseta Demo Encarnacion/);
    expect(anomalias).toMatch(/duplicado,INN-24123,IN-123,/);
    expect(anomalias.trim().split('\n').length - 1).toBe(13); // «13 líneas» del documento
  });
  it('la liquidación con «No coincide» que cita el guion existe en la muestra de su sistema', () => {
    // La muestra versionada trae las 40 primeras (por clave); la 0055 vive en la base sembrada, no en el CSV de muestra.
    expect(guion).toContain('SAP-LIQ-DEMO-0055-261015');
    expect(textoMuestra('liquidacion/liquidaciones_sistema.csv')).toContain('SAP-LIQ-DEMO-0002-261018');
  });
  it('los conteos del guion para los chats son los del resumen esperado', () => {
    const e = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    for (const g of ['afb', 'arr', 'cfn']) {
      expect(guion).toContain(`| ${e[g].mensajes} | ${e[g].preguntas} | ${e[g].sin_respuesta_10min} | ${e[g].quejas} |`);
    }
  });
  it('el guion cubre los 5 agentes y el apartado de terceros', () => {
    for (const s of ['orquestador', 'Conductor', 'Vigía', 'Peajes', 'Liquidación fase 1', 'Carta Porte', 'plantillas aprobadas', 'API de Business']) expect(guion).toContain(s);
  });
});
