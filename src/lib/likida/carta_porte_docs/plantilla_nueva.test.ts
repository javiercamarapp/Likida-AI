import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CampoValor, Extraccion } from './campos';
import { aXlsxPlantillaTms } from './exportacion';
import { AVISO_CRITERIO_PROVISIONAL, campoOrigen, construirPlantilla, contarOrigenes, idRegistro, type ContextoPlantilla } from './plantilla_tms';
import { LAYOUT_NORMAL, LAYOUT_NUEVA, MAX_ORIGENES_NUEVA, coordenadasLayout, layoutPuedeEnviarse } from './plantilla_tms.layout';
import {
  RFC_DESTINO_SINTETICO, RFC_ORIGEN_SINTETICO, ENCABEZADOS_DATOS, ENCABEZADOS_DESTINOS, ENCABEZADOS_MERCANCIAS_NUEVA, ENCABEZADOS_ORIGENES, filasDeHoja, plantillaNuevaEnBlanco,
  plantillaNuevaLlena, verificarReglasGuiaNueva,
} from './evaluacion/plantilla_nueva_real.fixture';

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });
const conv = (o: Record<string, string | null>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v)]));

const ORIGEN = (n: number): Record<string, string | null> => {
  const p = (k: string) => (n === 1 ? `origen_${k}` : `origen_${n}_${k}`);
  return {
    [p('nombre')]: `Embarcador Sintetico ${n === 1 ? 'Uno' : 'Dos'} SA`, [p('rfc')]: RFC_ORIGEN_SINTETICO, [p('calle')]: 'Calle Uno', [p('num_ext')]: '10', [p('num_int')]: null, // grep-limpio:ok
    [p('colonia_clave')]: '0001', [p('cp')]: '44100', [p('localidad_clave')]: '01', [p('municipio_clave')]: '039', [p('estado')]: 'JAL', [p('pais')]: 'MEX',
  };
};
const DESTINO = (n: number): Record<string, string | null> => {
  const p = (k: string) => (n === 1 ? `destino_${k}` : `destino_${n}_${k}`);
  return {
    [n === 1 ? 'distancia_km' : `destino_${n}_distancia_km`]: '874', [p('nombre')]: 'Destino Sintetico LLC', [p('rfc')]: RFC_DESTINO_SINTETICO, [p('calle')]: 'Street Two', [p('num_ext')]: '20', // grep-limpio:ok
    [p('colonia')]: 'Zona Dos', [p('cp')]: '78040', [p('localidad')]: 'Ciudad Dos', [p('municipio')]: 'Condado Dos', [p('estado')]: 'NLE', [p('pais')]: 'USA',
  };
};
const MERC = (sobre: Record<string, string | null> = {}): Record<string, string | null> => ({
  bienes_transp: '43211500', descripcion: 'Equipo de computo', cantidad: '20', clave_unidad: 'H87', unidad_descripcion: 'Pieza', peso_kg: '14130',
  fraccion_arancelaria: '8471500100', tipo_materia: '05', descripcion_materia: 'Materia sintetica', regimen_aduanero: 'EXD', // grep-limpio:ok
  pedimento: '24 16 3456 4000123', material_peligroso: 'false', ...sobre, // grep-limpio:ok
});

/** El caso real: 2 razones sociales, mismo domicilio ⇒ 2 orígenes, 2 destinos idénticos, 2 mercancías con fracciones distintas. */
function extraccionDosPares(): Extraccion {
  return {
    campos: conv({ folio_cliente: 'LP-0001', regimen_aduanero: 'EXD', caja_numero: 'CAJA-0001', ...ORIGEN(1), ...ORIGEN(2), ...DESTINO(1), ...DESTINO(2) }),
    mercancias: [
      conv(MERC({ id_origen: '1', id_destino: '1' })),
      conv(MERC({ id_origen: '2', id_destino: '2', cantidad: '10', peso_kg: '7000', fraccion_arancelaria: '8471500101' })), // grep-limpio:ok
    ],
  };
}

const ctxNueva: ContextoPlantilla = { clienteInterno: '123', plantilla: 'nueva', uso: 'descarga', distanciaFormato: 'numero' };
const hoja = (r: ReturnType<typeof construirPlantilla>, n: string) => r.hojas[n];
const leer = (r: ReturnType<typeof construirPlantilla>) => XLSX.read(aXlsxPlantillaTms(r), { type: 'array' });

describe('LAYOUT_NUEVA (T-A3-44)', () => {
  it('4 hojas de datos (la Guía no se escribe), serializable, sin verificar y sin tocar la normal', () => {
    expect(LAYOUT_NUEVA.hojas.map((h) => h.hoja)).toEqual(['Datos', 'Origenes', 'Destinos', 'Mercancias']);
    expect(LAYOUT_NUEVA.hojas.map((h) => h.hoja)).not.toContain('Guia de Llenado');
    expect(JSON.parse(JSON.stringify(LAYOUT_NUEVA))).toEqual(LAYOUT_NUEVA);
    expect(LAYOUT_NUEVA.verificada).toBe(false);
    expect(layoutPuedeEnviarse(LAYOUT_NUEVA)).toBe(false);
    expect(LAYOUT_NORMAL.nombre).toBe('normal');
    expect(LAYOUT_NORMAL.hojas.map((h) => h.hoja)).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error']);
  });

  it('las columnas declaradas coinciden con las de la muestra: A..L, A..T y A..Q', () => {
    const tabla = (h: string) => LAYOUT_NUEVA.hojas.find((x) => x.hoja === h)!.tablas[0];
    const letras = (h: string) => tabla(h).columnas.map((c) => c.columna).join('');
    expect(letras('Origenes')).toBe('ABCDEFGHIJKL');
    expect(letras('Destinos')).toBe('ABCDEFGHIJKLMNOPQRST');
    expect(letras('Mercancias')).toBe('ABCDEFGHIJKLMNOPQ');
    expect(tabla('Origenes').columnas.map((c) => c.encabezado.length > 0)).not.toContain(false);
    for (const t of LAYOUT_NUEVA.hojas.flatMap((h) => h.tablas)) { expect(t.filaEncabezado).toBe(1); expect(t.primeraFila).toBe(2); }
    // Datos: rótulos en A1:D1, valores en A2:D2
    const datos = LAYOUT_NUEVA.hojas[0];
    expect(datos.encabezados?.map((e) => e.celda)).toEqual(['A1', 'B1', 'C1', 'D1']);
    expect(datos.celdas.map((e) => e.celda)).toEqual(['A2', 'B2', 'C2', 'D2']);
    expect(coordenadasLayout(LAYOUT_NUEVA)).toContain('Origenes!L2');
  });

  it('el libro en blanco sintético y el layout hablan de las mismas columnas', () => {
    const wb = XLSX.read(plantillaNuevaEnBlanco(), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Datos', 'Origenes', 'Destinos', 'Mercancias', 'Guia de Llenado']);
    const cuenta = (h: string) => Object.keys(wb.Sheets[h]).filter((k) => /^[A-Z]+1$/.test(k)).length;
    expect(cuenta('Datos')).toBe(ENCABEZADOS_DATOS.length);
    expect(cuenta('Origenes')).toBe(ENCABEZADOS_ORIGENES.length);
    expect(cuenta('Destinos')).toBe(ENCABEZADOS_DESTINOS.length);
    expect(cuenta('Mercancias')).toBe(ENCABEZADOS_MERCANCIAS_NUEVA.length);
  });
});

describe('construirPlantilla con la plantilla «nueva»: 2 orígenes × 2 destinos idénticos × 2 mercancías', () => {
  const r = construirPlantilla(extraccionDosPares(), ctxNueva);
  it('solo escribe las 4 hojas de datos y avisa del criterio provisional', () => {
    expect(Object.keys(r.hojas)).toEqual(['Datos', 'Origenes', 'Destinos', 'Mercancias']);
    expect(r.criterio_provisional).toBe(true);
    expect(r.avisos).toContain(AVISO_CRITERIO_PROVISIONAL);
    expect(r.faltantes).toEqual([]);
  });

  it('IDs únicos, estables y con prefijo; cada mercancía apunta a un par existente', () => {
    expect([hoja(r, 'Origenes').A2.valor, hoja(r, 'Origenes').A3.valor]).toEqual(['OR000001', 'OR000002']);
    expect([hoja(r, 'Destinos').A2.valor, hoja(r, 'Destinos').A3.valor]).toEqual(['DE000001', 'DE000002']);
    expect([hoja(r, 'Mercancias').A2.valor, hoja(r, 'Mercancias').B2.valor]).toEqual(['DE000001', 'OR000001']);
    expect([hoja(r, 'Mercancias').A3.valor, hoja(r, 'Mercancias').B3.valor]).toEqual(['DE000002', 'OR000002']);
    expect(construirPlantilla(extraccionDosPares(), ctxNueva).hojas).toEqual(r.hojas); // estable
    expect(idRegistro('origen', 14)).toBe('OR000014');
  });

  it('el libro generado cumple la Guía sintética y coincide celda a celda con el libro «llenado» de la muestra', () => {
    const generado = aXlsxPlantillaTms(r);
    expect(verificarReglasGuiaNueva(generado)).toEqual([]);
    const gen = XLSX.read(generado, { type: 'array' });
    const llena = XLSX.read(plantillaNuevaLlena(), { type: 'array' });
    for (const h of ['Datos', 'Origenes', 'Destinos', 'Mercancias']) {
      const esperadas = filasDeHoja(llena.Sheets[h]);
      const obtenidas = filasDeHoja(gen.Sheets[h]);
      expect(obtenidas.map((f) => f.fila), h).toEqual(esperadas.map((f) => f.fila));
      for (const [i, e] of esperadas.entries()) expect(obtenidas[i].c, `${h} fila ${e.fila}`).toEqual(e.c);
    }
    // encabezados: una celda por columna de la muestra
    const cuenta = (h: string) => Object.keys(gen.Sheets[h]).filter((k) => /^[A-Z]+1$/.test(k)).length;
    expect([cuenta('Datos'), cuenta('Origenes'), cuenta('Destinos'), cuenta('Mercancias')]).toEqual([4, 12, 20, 17]);
  });

  it('los destinos idénticos se repiten completos (misma dirección en las dos filas)', () => {
    for (const col of 'CDEFIJLNOPQ') expect(hoja(r, 'Destinos')[`${col}2`]?.valor, col).toBe(hoja(r, 'Destinos')[`${col}3`]?.valor);
    expect(hoja(r, 'Destinos').P2.valor).toBe('Nuevo León');
  });

  it('las dos mercancías conservan su fracción (último dígito distinto) y la Guía omite el pedimento en exportación', () => {
    expect(hoja(r, 'Mercancias').K2.valor).toBe('8471500100'); // grep-limpio:ok
    expect(hoja(r, 'Mercancias').K3.valor).toBe('8471500101'); // grep-limpio:ok
    expect(hoja(r, 'Mercancias').L2?.valor ?? null).toBeNull();
    expect(hoja(r, 'Mercancias').M2.valor).toBe('No');
    expect(r.avisos.some((a) => a.includes('pedimento'))).toBe(true);
  });

  it('relectura: lo que se escribe en el .xlsx es lo mismo que armó el constructor', () => {
    const wb = leer(r);
    for (const [h, celdas] of Object.entries(r.hojas)) {
      for (const [coord, c] of Object.entries(celdas)) {
        const leido = wb.Sheets[h]?.[coord]?.v;
        if (c.valor === null) expect(leido ?? null, `${h}!${coord}`).toBeNull();
        else expect(String(leido), `${h}!${coord}`).toBe(String(c.valor));
      }
    }
  });

  it('un origen con razón social con fórmula se neutraliza como texto', () => {
    const e = extraccionDosPares(); e.campos.origen_2_nombre = cv('=HYPERLINK("x")');
    const wb = leer(construirPlantilla(e, ctxNueva));
    expect(wb.Sheets.Origenes.B3.t).toBe('s');
    expect(String(wb.Sheets.Origenes.B3.v).startsWith('=')).toBe(false);
  });
});

describe('construirPlantilla «nueva»: casos de borde', () => {
  it('un solo origen y un solo destino: las mercancías apuntan a OR000001 / DE000001 sin que el documento lo diga', () => {
    const e: Extraccion = { campos: conv({ caja_numero: 'CAJA-0001', ...ORIGEN(1), ...DESTINO(1) }), mercancias: [conv(MERC()), conv(MERC())] };
    const r = construirPlantilla(e, ctxNueva);
    expect(hoja(r, 'Origenes').A3).toBeUndefined();
    expect(hoja(r, 'Destinos').A3).toBeUndefined();
    for (const f of [2, 3]) { expect(hoja(r, 'Mercancias')[`A${f}`].valor).toBe('DE000001'); expect(hoja(r, 'Mercancias')[`B${f}`].valor).toBe('OR000001'); }
    expect(r.faltantes).toEqual([]);
  });

  it('14 mercancías se escriben todas, una fila cada una', () => {
    const e: Extraccion = { campos: conv({ caja_numero: 'C1', ...ORIGEN(1), ...DESTINO(1) }), mercancias: Array.from({ length: 14 }, (_, i) => conv(MERC({ cantidad: String(i + 1) }))) };
    const r = construirPlantilla(e, ctxNueva);
    expect(hoja(r, 'Mercancias').E15.valor).toBe(14);
    expect(hoja(r, 'Mercancias').E16).toBeUndefined();
    expect(verificarReglasGuiaNueva(aXlsxPlantillaTms(r))).toEqual([]);
  });

  it('varios orígenes y la mercancía no dice a cuál va: no se adivina (celda vacía y falta)', () => {
    const e = extraccionDosPares(); delete e.mercancias[1].id_origen;
    const r = construirPlantilla(e, ctxNueva);
    expect(hoja(r, 'Mercancias').B3.valor).toBeNull();
    expect(r.faltantes.some((f) => f.campo === 'mercancia.id_origen' && f.celda === 'B3' && !f.bloqueante)).toBe(true);
  });

  it('referencia huérfana (apunta a un destino que no existe): bloquea y lo dice en llano', () => {
    const e = extraccionDosPares(); e.mercancias[0].id_destino = cv('7');
    const r = construirPlantilla(e, ctxNueva);
    const f = r.faltantes.find((x) => x.campo === 'mercancia.id_destino');
    expect(f?.bloqueante).toBe(true);
    expect(f?.mensaje).toContain('no existe');
    expect(hoja(r, 'Mercancias').A2.valor).toBeNull();
  });

  it('más orígenes de los que caben: se bloquea y no se recorta en silencio', () => {
    const campos: Record<string, string | null> = { caja_numero: 'C1', ...DESTINO(1) };
    for (let n = 1; n <= MAX_ORIGENES_NUEVA + 1; n++) Object.assign(campos, ORIGEN(n));
    const r = construirPlantilla({ campos: conv(campos), mercancias: [conv(MERC())] }, ctxNueva);
    expect(r.faltantes.find((f) => f.campo === 'origenes')?.bloqueante).toBe(true);
    expect(hoja(r, 'Origenes')[`A${MAX_ORIGENES_NUEVA + 1}`].valor).toBe(idRegistro('origen', MAX_ORIGENES_NUEVA));
    expect(hoja(r, 'Origenes')[`A${MAX_ORIGENES_NUEVA + 2}`]).toBeUndefined();
  });

  it('peligroso: sale «Sí» con su clave y su embalaje; no peligroso sale «No» sin embalaje', () => {
    const e: Extraccion = {
      campos: conv({ caja_numero: 'C1', ...ORIGEN(1), ...DESTINO(1) }),
      mercancias: [conv(MERC({ material_peligroso: 'true', clave_material_peligroso: '1203', embalaje: '4G', embalaje_descripcion: 'Caja' })), conv(MERC({ embalaje: '4G' }))], // grep-limpio:ok
    };
    const r = construirPlantilla(e, ctxNueva);
    expect(hoja(r, 'Mercancias').M2.valor).toBe('Sí');
    expect(hoja(r, 'Mercancias').N2.valor).toBe('1203');
    expect(hoja(r, 'Mercancias').H2.valor).toBe('4G');
    expect(hoja(r, 'Mercancias').M3.valor).toBe('No');
    expect(hoja(r, 'Mercancias').H3?.valor ?? null).toBeNull();
  });

  it('para ENVIAR sigue saliendo la normal con aviso (la nueva solo descarga); la normal no cambia', () => {
    const env = construirPlantilla(extraccionDosPares(), { ...ctxNueva, uso: 'envio' });
    expect(Object.keys(env.hojas)).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error']);
    expect(env.avisos.some((a) => a.includes('no está verificada'))).toBe(true);
    expect(env.criterio_provisional).toBeUndefined();
    const normal = construirPlantilla(extraccionDosPares(), { clienteInterno: '123', plantilla: 'normal' });
    expect(normal.criterio_provisional).toBeUndefined();
    expect(normal.avisos).not.toContain(AVISO_CRITERIO_PROVISIONAL);
  });

  it('campoOrigen y contarOrigenes siguen la misma convención que los destinos', () => {
    expect(campoOrigen('origen_nombre', 1)).toBe('origen_nombre');
    expect(campoOrigen('origen_nombre', 3)).toBe('origen_3_nombre');
    expect(campoOrigen('caja_numero', 3)).toBe('caja_numero');
    expect(contarOrigenes(extraccionDosPares())).toBe(2);
    expect(contarOrigenes({ campos: conv({ origen_nombre: 'X' }), mercancias: [] })).toBe(1);
    expect(contarOrigenes({ campos: conv({ origen_4_nombre: '' }), mercancias: [] })).toBe(1);
  });
});

describe('el verificador de la Guía sintética detecta incumplimientos (control negativo)', () => {
  const con = (cambio: (wb: XLSX.WorkBook) => void): string[] => {
    const wb = XLSX.read(plantillaNuevaLlena(), { type: 'array' });
    cambio(wb);
    return verificarReglasGuiaNueva(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
  };
  it('el libro llenado de la muestra cumple', () => { expect(verificarReglasGuiaNueva(plantillaNuevaLlena())).toEqual([]); });
  it('ID repetido, ID inexistente y caja larga', () => {
    expect(con((wb) => { wb.Sheets.Origenes.A3.v = 'OR000001'; }).some((m) => m.includes('repetido'))).toBe(true);
    expect(con((wb) => { wb.Sheets.Mercancias.B3.v = 'OR000009'; }).some((m) => m.includes('no existe en Origenes'))).toBe(true);
    expect(con((wb) => { wb.Sheets.Datos.D2.v = 'CAJA-MUY-LARGA-0001'; }).some((m) => m.includes('15'))).toBe(true);
  });
});
