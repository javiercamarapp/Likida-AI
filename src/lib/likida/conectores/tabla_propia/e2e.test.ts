/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluarUbicacion, posicionMasCercanaEnTiempo, type PosicionComparada, type SitioValidable } from '../../conductor/validacion';
import type { Http } from '../tipos';
import { geocercasASitios } from './importar_geocercas';
import { crearLectorTablaPropia, leerPosicionesTablaPropia } from './lector';

// ═══════════════════════════════════════════════════════════════════════════
// DE PUNTA A PUNTA, CON FIXTURES DE CONTRATO (sin red, sin base): el archivo de
// SUS posiciones y el de SUS geocercas → el lector → lo que consume el Conductor.
// Es la cadena que hace real «la flota tiene todas sus posiciones en sus tablas»:
//   geocercas de su sistema → sitios;  posiciones de su sistema → `posicion` (UTC);
//   y el Conductor valida la llegada de un hito contra ese sitio con esa posición.
// ═══════════════════════════════════════════════════════════════════════════

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const AHORA = Date.parse('2026-10-20T13:30:00.000Z'); // 07:30 en CDMX
const http = (cuerpo: string): Http => async () => ({ estado: 200, cuerpo });
const reloj = { ahora: () => AHORA, dormir: async () => undefined };

describe('geocercas y posiciones de su sistema alimentan la validación de llegada del Conductor', () => {
  const posiciones = [
    'id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion',
    'UN-1,25.7801,-100.1899,2026-10-20 07:05:00,0,0', // dentro del patio (≈15 m del centro)
    'UN-2,25.8001,-100.1900,2026-10-20 07:05:00,0,0', // ≈2.2 km del patio
    'UN-3,20.6250,-103.2950,2026-10-20 07:05:00,0,0', // dentro del polígono cuadrado
    'UN-4,20.500810,-103.3000,2026-10-20 07:05:00,0,0', // en la carretera, ≈ 68 m al norte del patio alargado
    'UN-5,20.500050,-103.2990,2026-10-20 07:05:00,0,0', // dentro del patio alargado
  ].join('\n');
  it('la cadena completa', async () => {
    const lg = crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv', geocercas_url: 'https://d.ejemplo.com/g.csv' }, { http: http(fx('geocercas.csv')) });
    if (!lg.ok) throw new Error(lg.motivo);
    const geo = await lg.lector.leerGeocercas();
    const s = geocercasASitios(geo.filas);
    expect(s.rechazadas).toEqual([]);
    const sitio = (codigo: string): SitioValidable => {
      const x = s.filas.find((f) => f.codigo === codigo)!;
      return { id: x.codigo, nombre: x.nombre, lat: x.lat, lng: x.lng, radioM: x.radio_m, poligono: x.poligono, aproximada: x.aproximada };
    };

    const r = await leerPosicionesTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv' }, http(posiciones), reloj);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.posiciones.map((p) => p.medidaEn)).toEqual(Array(5).fill('2026-10-20T13:05:00.000Z'));
    const comparada = (deviceId: string): PosicionComparada => {
      const p = r.posiciones.find((x) => x.deviceId === deviceId)!;
      return { lat: p.lat, lng: p.lng, medidaEn: new Date(p.medidaEn), fuente: 'gps' };
    };
    const mensajeEn = new Date('2026-10-20T13:06:00.000Z'); // el chofer escribe a las 07:06 hora local
    const ev = (deviceId: string, codigo: string) => evaluarUbicacion({ sitio: sitio(codigo), posicion: comparada(deviceId), mensajeEn, toleranciaM: 50, ventanaMin: 10 });

    expect(ev('UN-1', 'PATIO-A')).toMatchObject({ resultado: 'validado', fuente: 'gps' });
    expect(ev('UN-2', 'PATIO-A')).toMatchObject({ resultado: 'sin_coincidencia' });
    // el polígono se guarda nativo: un punto DENTRO del polígono valida
    expect(ev('UN-3', 'PL-02')).toMatchObject({ resultado: 'validado', metodo: 'poligono' });
    // P1: el patio alargado de junto a la carretera. Con el círculo que lo contiene la unidad de la carretera «llegaba»; con el polígono no.
    expect(ev('UN-5', 'PATIO-L')).toMatchObject({ resultado: 'validado', metodo: 'poligono' });
    expect(ev('UN-4', 'PATIO-L')).toMatchObject({ resultado: 'sin_coincidencia', metodo: 'poligono' });
    expect(evaluarUbicacion({ sitio: { ...sitio('PATIO-L'), poligono: null }, posicion: comparada('UN-4'), mensajeEn, toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ resultado: 'validado', metodo: 'circulo' });
    // sin el desfase de zona bien resuelto, la misma posición caería fuera de la ventana de 10 min: se prueba que NO
    expect(evaluarUbicacion({ sitio: sitio('PATIO-A'), posicion: comparada('UN-1'), mensajeEn: new Date('2026-10-20T07:06:00.000Z'), toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ motivo: 'ubicacion_fuera_de_ventana' });
    expect(posicionMasCercanaEnTiempo([comparada('UN-1'), comparada('UN-2')], mensajeEn)).not.toBeNull();
  });
});
