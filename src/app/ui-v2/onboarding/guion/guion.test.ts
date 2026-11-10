/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validarRecorrido } from '@/app/ui-v2/movimiento/tour/validar';
import { MAX_AYUDA_GUIA, MAX_TEXTO_GUIA, MAX_TITULO_GUIA, IDS_SENAL, type PasoGuia } from '@/lib/likida/guia/tipos';
import { puedeLeerSenal, REGISTRO_SENALES } from '@/lib/likida/guia/senales';
import { NOMBRES_ILU } from '@/app/ui-v2/movimiento/tour/ilustraciones';
import { GUION, publicables, recorridoDeGuion } from './index';
import { PASOS_PM, cierreDePuestaEnMarcha } from './pm';
import { textosParaRevision } from './textos_revision';

const TODOS: PasoGuia[] = Object.values(GUION).flat();
const SRC = join(process.cwd(), 'src');
function fuente(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules') fuente(r, salida); continue; }
    if (/\.(tsx|ts)$/.test(n) && !/\.test\./.test(n)) salida.push(readFileSync(r, 'utf8'));
  }
  return salida;
}

describe('integridad del guion', () => {
  it('ids únicos, con forma estable, y una sola pista por archivo', () => {
    const ids = TODOS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{2}\d-\d{2}$/);
  });
  it('límites de longitud, sin cifras literales, sin signos de exclamación ni emoji', () => {
    for (const p of TODOS) {
      expect(p.titulo.length, p.id).toBeLessThanOrEqual(MAX_TITULO_GUIA);
      expect(p.texto.length, p.id).toBeLessThanOrEqual(MAX_TEXTO_GUIA);
      expect((p.ayuda ?? '').length, p.id).toBeLessThanOrEqual(MAX_AYUDA_GUIA);
      for (const t of [p.titulo, p.texto, p.ayuda ?? '', p.accion?.objetivo ?? '']) {
        expect(t, `${p.id}: cifra literal`).not.toMatch(/\d/);
        expect(t, `${p.id}: exclamación`).not.toMatch(/[!¡]/);
        expect(t, `${p.id}: emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });
  it('un hacer/practicar pide UNA acción y dice cómo se sabe que se hizo', () => {
    for (const p of TODOS.filter((x) => x.tipo === 'hacer' || x.tipo === 'practicar')) {
      expect(p.accion, p.id).toBeDefined();
      expect(p.deteccion.via, p.id).not.toBe('ninguna');
    }
  });
  it('la detección por señal usa una señal registrada que la pista puede leer', () => {
    for (const p of TODOS) {
      if (p.deteccion.via !== 'senal') continue;
      expect(IDS_SENAL, p.id).toContain(p.deteccion.senal);
      expect(puedeLeerSenal(p.pista, p.deteccion.senal), `${p.id}: ${p.pista} no puede leer ${p.deteccion.senal}`).toBe(true);
    }
  });
  it('lo que no se puede medir se declara: una señal «por conectar» nunca se presenta como medida', () => {
    for (const p of TODOS) if (p.deteccion.via === 'senal') expect(REGISTRO_SENALES[p.deteccion.senal].origen, p.id).not.toBe('por_conectar');
    expect(PASOS_PM.find((p) => p.id === 'PM7-01')?.deteccion.via).toBe('declarada');
  });
  it('las ilustraciones citadas existen y cada ancla existe en el marcado de la pantalla', () => {
    const codigo = fuente(join(SRC, 'app')).join('\n');
    const escaparRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const p of TODOS) {
      if (p.visual.tipo === 'ilu') expect(NOMBRES_ILU, p.id).toContain(p.visual.id);
      if (p.ancla) expect(codigo, `${p.id}: ancla ${p.ancla}`).toMatch(new RegExp(`ancla(Tour|Onboarding)\\(\\s*['"]${escaparRe(p.ancla)}['"]|data-(onboarding|tour)=["']${escaparRe(p.ancla)}["']`));
    }
  });
  it('el borrador completo es un recorrido válido para el motor', () => {
    const r = recorridoDeGuion('puesta-en-marcha.dueno_ca', 'Puesta en marcha', PASOS_PM, false);
    expect(r).not.toBeNull();
    expect(validarRecorrido(r!)).toEqual([]);
  });
});

describe('publicación', () => {
  it('nada en borrador llega al motor: sin aprobación el recorrido no existe', () => {
    expect(TODOS.every((p) => !p.aprobado)).toBe(true);
    expect(publicables(PASOS_PM)).toEqual([]);
    expect(recorridoDeGuion('x', 'x', PASOS_PM)).toBeNull();
  });
  it('un paso aprobado sí se publica, y uno de mensaje (WhatsApp) nunca entra al panel', () => {
    const aprobados = PASOS_PM.map((p) => ({ ...p, aprobado: true }));
    expect(recorridoDeGuion('x', 'x', aprobados)?.pasos).toHaveLength(PASOS_PM.length);
    const msg: PasoGuia = { ...PASOS_PM[0], id: 'EN-10', tipo: 'mensaje', aprobado: true };
    expect(recorridoDeGuion('x', 'x', [msg])).toBeNull();
  });
  it('el motor conserva la detección del guion', () => {
    const r = recorridoDeGuion('x', 'x', PASOS_PM.map((p) => ({ ...p, aprobado: true })));
    const tms = r?.pasos.find((p) => p.id === 'PM3-01');
    expect(tms?.tipo).toBe('hacer');
    expect(tms?.deteccion).toEqual({ via: 'senal', senal: 'tms_probada', modo: 'cambia' });
    expect(r?.pasos.find((p) => p.id === 'PM7-01')?.deteccion).toEqual({ via: 'declarada', clave: 'simulacroVisto' });
  });
});

describe('archivo de revisión de textos', () => {
  it('el archivo del repo coincide con lo que genera el guion (no se desfasa)', () => {
    const ruta = join(process.cwd(), 'docs/guia/TEXTOS-REVISION-LIKIDA.md');
    expect(existsSync(ruta), 'falta docs/guia/TEXTOS-REVISION-LIKIDA.md: regéneralo con textosParaRevision').toBe(true);
    expect(readFileSync(ruta, 'utf8')).toBe(textosParaRevision(TODOS));
  });
  it('lleva una fila por campo con su límite y estado', () => {
    const md = textosParaRevision(PASOS_PM);
    expect(md).toContain('| `PM2-01.titulo` | dueno_ca |');
    expect(md).toContain('| 48 |');
    expect(md.match(/\| borrador \|/g)?.length).toBeGreaterThan(10);
  });
});

describe('honestidad del cierre', () => {
  const si = { estado: 'si' as const };
  it('PM1 no promete que todo se marque solo', () => {
    expect(PASOS_PM[0].texto).not.toMatch(/se marca solo cuando Likida ve/);
  });
  it('«conectada» solo con la conexión probada Y datos llegando; omitida o sin dato dice que falta', () => {
    expect(cierreDePuestaEnMarcha({ tms_probada: si, archivos_recibidos: si }).titulo).toBe('Listo: tu operación está conectada');
    for (const s of [{}, { tms_probada: { estado: 'sin_dato' as const } }, { tms_probada: si }, { tms_probada: { estado: 'no' as const }, archivos_recibidos: si }, { archivos_recibidos: si }]) {
      expect(cierreDePuestaEnMarcha(s).titulo, JSON.stringify(s)).toBe('Lo tuyo está listo; falta conectar el sistema');
    }
  });
  it('el título por omisión del paso de cierre no afirma la conexión', () => {
    expect(PASOS_PM.find((p) => p.id === 'PM9-99')?.titulo).not.toMatch(/conectada/);
  });
});
