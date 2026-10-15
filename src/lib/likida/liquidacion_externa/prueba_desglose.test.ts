import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { enviarPruebaDesglose, depurarDetalle, type DependenciasPruebaDesglose } from './prueba_desglose';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';

const DESTINO = 'buzon.prueba@example.com';
const LLAVE = 're_FAKEFAKEFAKEABCDEFGHIJ';

function deps(res: ResultadoEnvio, configurado = true) {
  const enviar = vi.fn(async (_para: string, _c: Correo, _op: unknown) => res);
  const d: DependenciasPruebaDesglose = { enviar: enviar as unknown as DependenciasPruebaDesglose['enviar'], configurado: () => configurado, llave: LLAVE };
  return { d, enviar };
}

describe('enviarPruebaDesglose (contrato, sin red)', () => {
  it('envía el fixture sintético con el renderer real: adjunto desglose-B-0001.xlsx releíble, sin fórmulas, neto del fixture', async () => {
    const { d, enviar } = deps({ ok: true, id: 'abc-123' });
    const r = await enviarPruebaDesglose(DESTINO, d);
    expect(r).toEqual({ ok: true, linea: 'ok resend_id=abc-123', resendId: 'abc-123' });
    expect(enviar).toHaveBeenCalledTimes(1);
    const [para, correo, op] = enviar.mock.calls[0] as unknown as [string, Correo, { sobrio: boolean; adjuntos: Array<{ filename: string; content: string; contentType: string }> }];
    expect(para).toBe(DESTINO);
    expect(op.sobrio).toBe(true);
    expect(op.adjuntos).toHaveLength(1);
    expect(op.adjuntos[0]!.filename).toBe('desglose-B-0001.xlsx');
    expect(op.adjuntos[0]!.contentType).toContain('spreadsheetml.sheet');
    const libro = XLSX.read(Buffer.from(op.adjuntos[0]!.content, 'base64'), { type: 'buffer' });
    const hoja = libro.Sheets['Desglose']!;
    const celdas = Object.values(hoja).filter((c): c is XLSX.CellObject => typeof c === 'object' && c !== null && 'v' in (c as object));
    expect(celdas.some((c) => c.f)).toBe(false);
    expect(celdas.some((c) => c.v === DESGLOSE_SINTETICO.esperado.neto)).toBe(true);
    // El asunto lleva la marca de prueba y ninguna cifra de dinero.
    expect(correo.asunto.startsWith('PRUEBA — ')).toBe(true);
    expect(correo.asunto).not.toMatch(/\d[\d,]*\.\d{2}/);
  });

  it('sin configuración lo dice y NO intenta enviar', async () => {
    const { d, enviar } = deps({ ok: true, id: 'x' }, false);
    const r = await enviarPruebaDesglose(DESTINO, d);
    expect(r).toEqual({ ok: false, linea: 'correo no configurado' });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el envío devuelve sin_configurar también dice «correo no configurado»', async () => {
    const r = await enviarPruebaDesglose(DESTINO, deps({ ok: false, motivo: 'sin_configurar' }).d);
    expect(r.linea).toBe('correo no configurado');
    expect(r.ok).toBe(false);
  });

  it('rechazo de Resend: error con HTTP y detalle sin la llave ni el correo completo', async () => {
    const r = await enviarPruebaDesglose(DESTINO, deps({
      ok: false, motivo: 'rechazado', status: 403,
      detalle: `The domain is not verified for ${DESTINO}; key ${LLAVE}`,
    }).d);
    expect(r.ok).toBe(false);
    expect(r.linea).toMatch(/^error: rechazado \(HTTP 403\)/);
    expect(r.linea).not.toContain(LLAVE);
    expect(r.linea).not.toContain(DESTINO);
    expect(r.linea).toContain('b***@example.com');
  });

  it('error de red: error y sin la llave', async () => {
    const r = await enviarPruebaDesglose(DESTINO, deps({ ok: false, motivo: 'red', detalle: `timeout con ${LLAVE}` }).d);
    expect(r.linea).toMatch(/^error: red — /);
    expect(r.linea).not.toContain(LLAVE);
  });

  it('una dirección inválida se rechaza antes de generar nada', async () => {
    for (const mala of ['', 'sin-arroba', 'a@b', 'a@b.com, c@d.com', 'x y@z.com']) { // grep-limpio:ok
      const { d, enviar } = deps({ ok: true, id: 'x' });
      const r = await enviarPruebaDesglose(mala, d);
      expect(r.ok).toBe(false);
      expect(r.linea).toMatch(/^error: /);
      expect(enviar).not.toHaveBeenCalled();
    }
  });
});

describe('depurarDetalle', () => {
  it('redacta la llave dada, patrones re_… y enmascara correos; recorta a 160', () => {
    const t = depurarDetalle(`k=${LLAVE} otra re_ABCDEFGH12345 correo juan@dominio.mx ${'x'.repeat(400)}`, LLAVE); // grep-limpio:ok
    expect(t).not.toContain(LLAVE);
    expect(t).not.toContain('re_ABCDEFGH12345');
    expect(t).toContain('j***@dominio.mx');
    expect(t.length).toBeLessThanOrEqual(160);
  });
});

// Local-only: lo dispara ~/likida-loop/cinco-agentes/enviar-prueba-desglose.sh (Javier). Envía DE VERDAD el fixture a
// LIKIDA_PRUEBA_DESGLOSE_PARA y escribe un resumen fijo (ok / sin configurar / error), sin datos de red, en LIKIDA_PRUEBA_DESGLOSE_SALIDA. Sin esas variables se salta.
describe.skipIf(!process.env.LIKIDA_PRUEBA_DESGLOSE_PARA)('envío real (local-only)', () => {
  it('manda el fixture sintético al buzón indicado', async () => {
    const { writeFileSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { basename, dirname, join } = await import('node:path');
    const r = await enviarPruebaDesglose(process.env.LIKIDA_PRUEBA_DESGLOSE_PARA as string);
    const salida = process.env.LIKIDA_PRUEBA_DESGLOSE_SALIDA;
    if (salida) {
      // Solo se escribe el archivo temporal que crea el script (mktemp en el directorio temporal, prefijo fijo).
      const destino = join(realpathSync(dirname(salida)), basename(salida));
      if (dirname(destino) !== realpathSync(tmpdir()) || !/^prueba-desglose\.[A-Za-z0-9]+$/.test(basename(destino))) {
        throw new Error('LIKIDA_PRUEBA_DESGLOSE_SALIDA debe ser el temporal prueba-desglose.* del directorio temporal');
      }
      // Nunca se escribe lo recibido por la red (id, detalle, estado): solo un literal fijo elegido según el resultado.
      const resumen = r.ok ? 'ok enviado' : r.linea === 'correo no configurado' ? 'correo no configurado' : 'error: el envío no se completó';
      writeFileSync(destino, `${resumen}\n`);
    }
    expect(r.linea.length).toBeGreaterThan(0);
  });
});
