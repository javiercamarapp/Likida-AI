import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MUESTRAS, M3, RFC_DORADO, type IdMuestra } from '../src/lib/likida/carta_porte_docs/evaluacion/dorado.fixture';
import { AHORA_FIJO } from '../src/lib/likida/carta_porte_docs/evaluacion/evaluar';
import { llmFalso } from '../src/lib/likida/carta_porte_docs/llm_falso.fixture';
import {
  RAIZ_REPO, estaDentroDelRepo, evaluarCarpeta, leerArgumentos, leerLlave, sinValores, type OpcionesCarpeta,
} from './evaluar-carta-porte-local';

const NOMBRES: Record<IdMuestra, string> = { M1: 'muestra-1.json', M2: 'muestra-2.xlsx', M3: 'muestra-3.pdf', M4: 'muestra-4.pdf', M5: 'muestra-5.xlsx' };

let raiz: string;
let muestras: string;

beforeAll(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'a3-eval-local-'));
  muestras = join(raiz, 'muestras');
  mkdirSync(muestras);
  for (const m of MUESTRAS) writeFileSync(join(muestras, NOMBRES[m.id]), await m.bytes());
});
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

const muestraDe = (archivo: string) => MUESTRAS.find((m) => NOMBRES[m.id] === archivo)!;

function opciones(extra: Partial<OpcionesCarpeta> = {}): OpcionesCarpeta {
  return {
    muestras,
    salida: join(raiz, 'salida', 'a3-evaluacion-local.md'),
    llm: (archivo) => llmFalso(muestraDe(archivo).guion()),
    perfiles: (archivo, contenido) => muestraDe(archivo).perfiles?.(contenido) ?? [],
    asignar: Object.fromEntries(MUESTRAS.map((m) => [NOMBRES[m.id], m.id])),
    ahora: AHORA_FIJO,
    nivelMaximo: 1,
    ...extra,
  };
}

describe('evaluar-carta-porte-local · carpeta sintética (los 5 fixtures de T-A3-35)', () => {
  it('imprime la matriz ✔/◐/✗ de las 5 muestras y la escribe fuera del repo', async () => {
    const { informes, texto } = await evaluarCarpeta(opciones());
    expect(informes.map((i) => i.archivo)).toEqual(Object.values(NOMBRES).sort());
    expect(informes.every((i) => i.error === null && i.embarquesMedidos.length === 1)).toBe(true);
    for (const i of informes) {
      expect(i.embarquesMedidos[0].resumen.total).toBeGreaterThan(0);
      expect(i.embarquesMedidos[0].resumen.ok).toBeGreaterThan(0);
    }
    // M4 trae libras y la unidad en notas: la conversión debe aparecer como ◐, no como ✔ silencioso.
    const m4 = informes.find((i) => i.archivo === NOMBRES.M4)!.embarquesMedidos[0];
    expect(m4.campos.find((c) => c.campo === 'mercancias[0].peso_kg')?.marca).toBe('◐');
    expect(texto).toContain('## Resumen');
    expect(texto).toContain('| Campo | Marca | Motivo |');
    expect(readFileSync(opciones().salida, 'utf8')).toBe(texto);
  });

  it('compara contra 08 §2 con --asignar: sobre las sintéticas no hay discrepancias', async () => {
    const { informes } = await evaluarCarpeta(opciones());
    for (const i of informes) expect(i.embarquesMedidos[0].discrepanciasConDorado).toEqual([]);
  });

  it('no escribe nada en el repo', async () => {
    const antes = readdirSync(join(RAIZ_REPO, 'scripts')).sort();
    await evaluarCarpeta(opciones({ salida: join(raiz, 'otra', 'salida.md') }));
    expect(readdirSync(join(RAIZ_REPO, 'scripts')).sort()).toEqual(antes);
    expect(estaDentroDelRepo(join(raiz, 'otra', 'salida.md'))).toBe(false);
  });

  it('con una salida DENTRO del repo se niega y no escribe', async () => {
    const dentro = join(RAIZ_REPO, 'a3-evaluacion-local.md');
    await expect(evaluarCarpeta(opciones({ salida: dentro }))).rejects.toThrow(/dentro del repo/);
    expect(existsSync(dentro)).toBe(false);
    await expect(evaluarCarpeta(opciones({ salida: join(RAIZ_REPO, 'no', 'existe', 'aun.md') }))).rejects.toThrow(/dentro del repo/);
  });

  it('con las muestras DENTRO del repo se niega (los datos reales no viven en un repo público)', async () => {
    await expect(evaluarCarpeta(opciones({ muestras: join(RAIZ_REPO, 'scripts') }))).rejects.toThrow(/dentro del repo/);
  });

  it('un archivo que no es un documento se reporta como error sin detener a los demás', async () => {
    const m = join(raiz, 'mixta');
    mkdirSync(m);
    writeFileSync(join(m, 'basura.bin'), new Uint8Array([1, 2, 3, 4]));
    writeFileSync(join(m, NOMBRES.M2), readFileSync(join(muestras, NOMBRES.M2)));
    const { informes } = await evaluarCarpeta(opciones({ muestras: m, salida: join(raiz, 'mixta-salida.md') }));
    expect(informes.find((i) => i.archivo === 'basura.bin')?.error).toBeTruthy();
    expect(informes.find((i) => i.archivo === NOMBRES.M2)?.error).toBeNull();
  });
});

describe('evaluar-carta-porte-local · CCP timbrado y PII', () => {
  const RFC_CCP = RFC_DORADO.m3Remitente;
  const xml = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Folio="${M3.remision}">
  <cfdi:Complemento>
    <cartaporte31:CartaPorte xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31" TranspInternac="No" TotalDistRec="120">
      <cartaporte31:Ubicaciones>
        <cartaporte31:Ubicacion TipoUbicacion="Origen" RFCRemitenteDestinatario="${RFC_CCP}" NombreRemitenteDestinatario="${M3.remitente}"/>
        <cartaporte31:Ubicacion TipoUbicacion="Destino" NombreRemitenteDestinatario="${M3.destinatario}"/>
      </cartaporte31:Ubicaciones>
    </cartaporte31:CartaPorte>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

  it('compara campo a campo con el CCP del mismo folio y deja ✗ lo que el CCP trae y el documento no', async () => {
    const ccp = join(raiz, 'ccp');
    mkdirSync(ccp, { recursive: true });
    writeFileSync(join(ccp, 'uno.xml'), xml);
    const { informes, texto } = await evaluarCarpeta(opciones({ ccpTimbrados: ccp, salida: join(raiz, 'con-ccp.md'), asignar: {} }));
    const m3 = informes.find((i) => i.archivo === NOMBRES.M3)!.embarquesMedidos[0];
    expect(m3.ccp).toBe('comparado');
    expect(m3.campos.find((c) => c.campo === 'origen_rfc')).toMatchObject({ marca: '✗', fuenteEsperado: 'ccp' });
    expect(m3.campos.find((c) => c.campo === 'folio_cliente')?.marca).toBe('✔');
    expect(informes.filter((i) => i.embarquesMedidos[0]?.ccp === 'comparado')).toHaveLength(1);
    expect(texto).toContain('CCP timbrado cuando el folio coincide');
  });

  it('ni la matriz ni el archivo llevan valores leídos (RFC, nombres)', async () => {
    const ccp = join(raiz, 'ccp');
    const { texto } = await evaluarCarpeta(opciones({ ccpTimbrados: ccp, salida: join(raiz, 'pii.md') }));
    for (const v of [RFC_CCP, RFC_DORADO.m1Remitente, RFC_DORADO.m5Remitente, RFC_DORADO.m5DestinatarioFisica, M3.remitente, M3.destinatario]) {
      expect(texto).not.toContain(v);
    }
    expect(texto).not.toMatch(/distinto: leí «[^…]/);
  });

  it('sinValores reduce lo citado a «…» y no copia notas del modelo', () => {
    expect(sinValores('distinto: leí «ABC123», esperaba «XYZ789»')).toBe('distinto: leí «…», esperaba «…»');
    expect(sinValores('confianza 70 %; nota: placas ABC123 dudosas')).toBe('confianza 70 %; nota: (ver el visor)');
  });
});

describe('evaluar-carta-porte-local · argumentos y llave', () => {
  it('lee los argumentos y exige --muestras', () => {
    const a = leerArgumentos(['--muestras', '/x/y', '--ccp-timbrados', '/x/c', '--llave-archivo', '/k', '--salida', '/s.md', '--asignar', 'a.pdf=M3']);
    expect(a).toMatchObject({ muestras: '/x/y', ccpTimbrados: '/x/c', llaveArchivo: '/k', salida: '/s.md', asignar: { 'a.pdf': 'M3' } });
    expect(() => leerArgumentos([])).toThrow(/--muestras/);
    expect(() => leerArgumentos(['--muestras', '/x'])).toThrow(/--salida/);
    expect(() => leerArgumentos(['--muestras'])).toThrow(/Falta el valor/);
    expect(() => leerArgumentos(['--muestras', '/x', '--raro', '1'])).toThrow(/desconocido/);
    expect(() => leerArgumentos(['--muestras', '/x', '--asignar', 'a.pdf=M9'])).toThrow(/--asignar/);
  });

  it('la llave solo se lee de un archivo chmod 600 y no está vacío', () => {
    const f = join(raiz, 'llave.txt');
    writeFileSync(f, 'sk-de-prueba\n');
    chmodSync(f, 0o644);
    expect(() => leerLlave(f)).toThrow(/chmod 600/);
    chmodSync(f, 0o600);
    expect(leerLlave(f)).toBe('sk-de-prueba');
    writeFileSync(f, '\n');
    expect(() => leerLlave(f)).toThrow(/vacío/);
  });
});
