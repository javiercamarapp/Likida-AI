// EL CEREBRO DE VENTAS — el criterio de los dos porcentajes es determinista
// y estas pruebas lo FIJAN: si alguien mueve un peso, la prueba lo dice y el
// pie del mapa (que enseña CRITERIO_SCORES) se actualiza con él.
import { describe, expect, it } from 'vitest';
import {
  plazaDe, giroDe, scoreUrgencia, scoreCierre, COLOR_EMBUDO, CRITERIO_SCORES,
} from './prospectos-mapa';

describe('plazaDe — la plaza sin adivinar', () => {
  it('ciudad, entidad → separa y normaliza la entidad al nombre del geo', () => {
    expect(plazaDe('Escobedo, Nuevo León')).toEqual({ ciudad: 'Escobedo', entidad: 'Nuevo León' });
    expect(plazaDe('San Pedro Tlaquepaque, Jalisco')).toEqual({ ciudad: 'San Pedro Tlaquepaque', entidad: 'Jalisco' });
  });
  it('ciudad sola conocida → entidad por catálogo; desconocida → sin plaza declarada', () => {
    expect(plazaDe('Guadalajara')).toEqual({ ciudad: 'Guadalajara', entidad: 'Jalisco' });
    expect(plazaDe('Villa Inventada')).toEqual({ ciudad: 'Villa Inventada', entidad: null });
  });
  it('el ruido del censo (nacional/bolsas) NO es una plaza', () => {
    expect(plazaDe('Computrabajo (nacional)')).toEqual({ ciudad: null, entidad: null });
    expect(plazaDe(null)).toEqual({ ciudad: null, entidad: null });
  });
  it('CDMX en sus tres nombres cae a Ciudad de México', () => {
    expect(plazaDe('Azcapotzalco, CDMX').entidad).toBe('Ciudad de México');
    expect(plazaDe('Iztapalapa, Distrito Federal').entidad).toBe('Ciudad de México');
  });
});

describe('giroDe — transportista o qué', () => {
  it('el nombre confiesa el giro', () => {
    expect(giroDe('Transportes Castores', null, null)).toBe('transportista');
    expect(giroDe('KN Logistics', null, null)).toBe('logistica');
    expect(giroDe('Del Fruto Distribuidora', 'Cajero Liquidador', 'reparto y cedis')).toBe('flota_propia');
    expect(giroDe('Grupo Herdez', null, null)).toBe('otro');
  });
  it('la actividad DENUE en notas también clasifica', () => {
    expect(giroDe('AVE', null, 'DENUE: Autotransporte foráneo de carga general')).toBe('transportista');
  });
});

describe('scoreUrgencia — la conducta del prospecto, no un vibe', () => {
  it('dolor directo + anuncios + recencia suma más que señal suelta', () => {
    const caliente = scoreUrgencia({
      vacante: 'Auxiliar de Liquidaciones',
      notas: 'DOLOR DIRECTO: la vacante nombra la liquidación · 5 anuncios en el censo · último anuncio: Hace 8 hor',
    });
    const tibio = scoreUrgencia({ vacante: 'Mecánico diésel', notas: 'SEÑAL DEL GIRO: diésel · 1 anuncio en el censo' });
    expect(caliente).toBeGreaterThan(75);
    expect(tibio).toBeLessThan(40);
    expect(caliente).toBeLessThanOrEqual(100);
  });
  it('sin notas ni vacante → 0, no un número inventado', () => {
    expect(scoreUrgencia({ vacante: null, notas: null })).toBe(0);
  });
});

describe('scoreCierre — alcanzabilidad + fit + embudo', () => {
  const base = {
    telefono: null, correo: null, contacto_nombre: null,
    estado: 'nuevo', fuente: 'censo', empresa: 'Transportes X', vacante: null, notas: null,
  };
  it('cada dato de contacto sube; el decisor pesa como el teléfono', () => {
    const solo = scoreCierre(base);
    const conTel = scoreCierre({ ...base, telefono: '5512345678' });
    const completo = scoreCierre({ ...base, telefono: '55', correo: 'a@b.mx', contacto_nombre: 'Juan, DG' });
    expect(conTel).toBeGreaterThan(solo);
    expect(completo).toBeGreaterThan(conTel);
  });
  it('el embudo manda: cliente=100, perdido=0 — sin importar lo demás', () => {
    expect(scoreCierre({ ...base, estado: 'cerrado' })).toBe(100);
    expect(scoreCierre({ ...base, telefono: '55', correo: 'a@b.mx', estado: 'perdido' })).toBe(0);
  });
});

describe('la paleta del embudo cubre el dominio completo del CHECK 0105', () => {
  it('los 6 estados tienen color y nombre — un estado sin color sería un pin invisible', () => {
    for (const e of ['nuevo', 'contactado', 'demo', 'negociacion', 'cerrado', 'perdido']) {
      expect(COLOR_EMBUDO[e]?.color).toMatch(/^#/);
      expect(COLOR_EMBUDO[e]?.nombre.length).toBeGreaterThan(3);
    }
  });
  it('el criterio publicado dice "estimación", porque lo es', () => {
    expect(CRITERIO_SCORES.urgencia).toMatch(/[Ee]stimación/);
    expect(CRITERIO_SCORES.cierre).toMatch(/[Ee]stimación/);
  });
});
