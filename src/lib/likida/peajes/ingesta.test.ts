import { describe, it, expect } from 'vitest';
import {
  claveDeFlota, firmarIngesta, verificarFirmaIngesta, leerCuerpoIngesta, secretoMaestro, huellaDe, bufferDeBytea, byteaDeBuffer,
  esUuid, MAX_ARCHIVO_INGESTA_BYTES, TOLERANCIA_FIRMA_MS,
} from './ingesta';

const SECRETO = 'x'.repeat(40);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const AHORA = Date.UTC(2026, 9, 1, 12, 0, 0);
const ts = (dMs = 0) => String(Math.floor((AHORA + dMs) / 1000));

describe('secretoMaestro — fail-closed', () => {
  it('falta, vacío o corto (< 32) = no hay secreto', () => {
    expect(secretoMaestro({})).toBeNull();
    expect(secretoMaestro({ PEAJES_INGESTA_SECRETO: '' })).toBeNull();
    expect(secretoMaestro({ PEAJES_INGESTA_SECRETO: 'corto' })).toBeNull();
    expect(secretoMaestro({ PEAJES_INGESTA_SECRETO: 'a'.repeat(31) })).toBeNull();
    expect(secretoMaestro({ PEAJES_INGESTA_SECRETO: SECRETO })).toBe(SECRETO);
  });
});

describe('claveDeFlota — una llave por flota y por rotación', () => {
  it('determinista; distinta por flota, por rotación y por secreto', () => {
    const k = claveDeFlota(SECRETO, A, 1);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(claveDeFlota(SECRETO, A, 1)).toBe(k);
    expect(claveDeFlota(SECRETO, B, 1)).not.toBe(k);
    expect(claveDeFlota(SECRETO, A, 2)).not.toBe(k);
    expect(claveDeFlota('y'.repeat(40), A, 1)).not.toBe(k);
  });
  it('el UUID en mayúsculas es la misma flota', () => {
    expect(claveDeFlota(SECRETO, A.toUpperCase(), 1)).toBe(claveDeFlota(SECRETO, A, 1));
  });
});

describe('verificarFirmaIngesta', () => {
  const cuerpo = JSON.stringify({ nombre: 'x.csv', contenido_base64: 'QQ==' });
  const clave = claveDeFlota(SECRETO, A, 1);
  const firmado = (t = ts(), c = cuerpo) => ({ timestamp: t, firma: firmarIngesta(clave, A, t, c) });

  it('una firma buena pasa', () => {
    expect(verificarFirmaIngesta(clave, A, firmado(), cuerpo, AHORA)).toEqual({ ok: true });
  });
  it('cambiar UN byte del cuerpo la invalida (se firma el cuerpo CRUDO)', () => {
    expect(verificarFirmaIngesta(clave, A, firmado(), cuerpo + ' ', AHORA)).toMatchObject({ ok: false, motivo: 'firma_invalida' });
    expect(verificarFirmaIngesta(clave, A, firmado(), cuerpo.replace('x.csv', 'y.csv'), AHORA)).toMatchObject({ ok: false });
  });
  it('un JSON equivalente reordenado NO pasa: no hay re-serialización que adivine', () => {
    const otro = JSON.stringify({ contenido_base64: 'QQ==', nombre: 'x.csv' });
    expect(verificarFirmaIngesta(clave, A, firmado(), otro, AHORA)).toMatchObject({ ok: false });
  });
  it('la firma de una flota NO sirve para otra (el id de la flota entra en el mensaje)', () => {
    const claveB = claveDeFlota(SECRETO, B, 1);
    expect(verificarFirmaIngesta(claveB, B, firmado(), cuerpo, AHORA)).toMatchObject({ ok: false });
    // ni siquiera con la llave correcta de B si el firmante usó la de A
    expect(verificarFirmaIngesta(clave, B, firmado(), cuerpo, AHORA)).toMatchObject({ ok: false });
  });
  it('una llave rotada invalida las firmas viejas', () => {
    const vieja = firmarIngesta(claveDeFlota(SECRETO, A, 1), A, ts(), cuerpo);
    expect(verificarFirmaIngesta(claveDeFlota(SECRETO, A, 2), A, { timestamp: ts(), firma: vieja }, cuerpo, AHORA)).toMatchObject({ ok: false });
  });
  it('ventana de ±5 min: el borde pasa, un segundo más no (replay)', () => {
    const borde = ts(-TOLERANCIA_FIRMA_MS);
    expect(verificarFirmaIngesta(clave, A, firmado(borde), cuerpo, AHORA)).toEqual({ ok: true });
    const pasado = String(Number(borde) - 1);
    expect(verificarFirmaIngesta(clave, A, firmado(pasado), cuerpo, AHORA)).toMatchObject({ ok: false, motivo: 'fuera_de_tiempo' });
    expect(verificarFirmaIngesta(clave, A, firmado(ts(TOLERANCIA_FIRMA_MS + 2000)), cuerpo, AHORA)).toMatchObject({ ok: false, motivo: 'fuera_de_tiempo' });
  });
  it('timestamp en milisegundos, negativo, con letras o decimal = fuera de tiempo, no excepción', () => {
    for (const t of [String(AHORA), '-5', 'abc', '1.5e9', '', '12345678901234']) {
      expect(verificarFirmaIngesta(clave, A, { timestamp: t, firma: 'v1=x' }, cuerpo, AHORA)).toMatchObject({ ok: false });
    }
  });
  it('faltan cabeceras', () => {
    expect(verificarFirmaIngesta(clave, A, { timestamp: null, firma: 'v1=x' }, cuerpo, AHORA)).toMatchObject({ motivo: 'faltan_cabeceras' });
    expect(verificarFirmaIngesta(clave, A, { timestamp: ts(), firma: null }, cuerpo, AHORA)).toMatchObject({ motivo: 'faltan_cabeceras' });
  });
  it('firmas de largo distinto, sin prefijo o basura no lanzan', () => {
    for (const f of ['', 'v1=', 'v1=abc', 'abc', firmarIngesta(clave, A, ts(), cuerpo).slice(3), 'v1=' + 'z'.repeat(64), 'v1=' + '0'.repeat(65)]) {
      expect(verificarFirmaIngesta(clave, A, { timestamp: ts(), firma: f }, cuerpo, AHORA)).toMatchObject({ ok: false });
    }
  });
  it('espacios alrededor de la firma se toleran (cabeceras HTTP)', () => {
    const f = firmado();
    expect(verificarFirmaIngesta(clave, A, { timestamp: f.timestamp, firma: ` ${f.firma} ` }, cuerpo, AHORA)).toEqual({ ok: true });
  });
});

describe('leerCuerpoIngesta — hostil', () => {
  const b64 = Buffer.from('Fecha,Caseta,Importe\n05/08/2026,X,1.00\n').toString('base64');
  const ok = (o: Record<string, unknown>) => leerCuerpoIngesta(JSON.stringify({ nombre: 'corte.csv', contenido_base64: b64, ...o }));

  it('un cuerpo bueno', () => {
    const r = ok({ proveedor: ' PASE ' });
    expect(r.ok && r.cuerpo.proveedor).toBe('PASE');
    expect(r.ok && r.cuerpo.contenido.toString()).toContain('Fecha,Caseta');
  });
  it('base64 con saltos de línea (MIME) se acepta', () => {
    const partido = b64.replace(/(.{20})/g, '$1\n');
    expect(ok({ contenido_base64: partido }).ok).toBe(true);
  });
  it('JSON roto, arreglo, null, número', () => {
    for (const t of ['{', '[]', 'null', '42', '"x"', '']) expect(leerCuerpoIngesta(t).ok).toBe(false);
  });
  it('nombre: vacío, con ruta, con control, enorme, sin extensión aceptada', () => {
    for (const nombre of ['', '   ', '../etc/passwd.csv', 'a/b.csv', 'a\\b.csv', 'a\u0000.csv', 'x'.repeat(256) + '.csv', 'virus.exe', 'archivo', 'foto.png', 'a.csv.exe', 7]) {
      expect(ok({ nombre }).ok, String(nombre)).toBe(false);
    }
    for (const nombre of ['A.CSV', 'x.XLSX', 'estado.pdf', 'p.ods']) expect(ok({ nombre }).ok, nombre).toBe(true);
  });
  it('proveedor: no texto o enorme', () => {
    expect(ok({ proveedor: 5 }).ok).toBe(false);
    expect(ok({ proveedor: 'x'.repeat(61) }).ok).toBe(false);
    expect(ok({ proveedor: null }).ok).toBe(true);
    expect(ok({ proveedor: '   ' }).ok && ok({ proveedor: '   ' })).toMatchObject({ cuerpo: { proveedor: null } });
  });
  it('base64: ausente, inválido, mal relleno, vacío, de más de 4 MB', () => {
    expect(ok({ contenido_base64: undefined }).ok).toBe(false);
    expect(ok({ contenido_base64: '***' }).ok).toBe(false);
    expect(ok({ contenido_base64: 'QUJD=' }).ok).toBe(false);
    expect(ok({ contenido_base64: 'QUJDRA' }).ok).toBe(false);
    expect(ok({ contenido_base64: '' }).ok).toBe(false);
    expect(ok({ contenido_base64: 7 }).ok).toBe(false);
    const grande = Buffer.alloc(MAX_ARCHIVO_INGESTA_BYTES + 1, 65).toString('base64');
    expect(ok({ contenido_base64: grande })).toMatchObject({ ok: false, motivo: expect.stringMatching(/MB/) });
    const limite = Buffer.alloc(MAX_ARCHIVO_INGESTA_BYTES, 65).toString('base64');
    expect(ok({ contenido_base64: limite }).ok).toBe(true);
  });
  it('un campo extra (como flota) se ignora: la flota SOLO viene de la cabecera firmada', () => {
    const r = ok({ tenant_id: B, flota: B });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(B);
  });
});

describe('huella, bytea, uuid', () => {
  it('sha256 estable; archivos distintos → huellas distintas', () => {
    expect(huellaDe(Buffer.from('a'))).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    expect(huellaDe(Buffer.from('a'))).not.toBe(huellaDe(Buffer.from('b')));
  });
  it('bytea ida y vuelta, y lo que no es bytea', () => {
    const b = Buffer.from([0, 1, 2, 250, 255]);
    expect(byteaDeBuffer(b)).toBe('\\x000102faff');
    expect(bufferDeBytea(byteaDeBuffer(b))).toEqual(b);
    expect(bufferDeBytea(null)).toBeNull();
    expect(bufferDeBytea('texto')).toBeNull();
    expect(bufferDeBytea(5)).toBeNull();
  });
  it('esUuid', () => {
    expect(esUuid(A)).toBe(true);
    expect(esUuid('no-es-uuid')).toBe(false);
    expect(esUuid("'; drop table x; --")).toBe(false);
    expect(esUuid(null)).toBe(false);
  });
});
