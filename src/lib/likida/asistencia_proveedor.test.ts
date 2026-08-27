import { describe, it, expect } from 'vitest';
import { armarCascada, textoCascadaParaJefe, distanciaKm, RECURSOS_NACIONALES, type EntradaCascada } from './asistencia_proveedor';
import type { ProveedorEmergencia, FlotaPoliza } from './emergencias';

// ═══════════════════════════════════════════════════════════════════════════
// La cascada del proveedor correcto (Capa C) — el motor puro.
//
// Lo que estas pruebas fijan es la HONESTIDAD de cada escalón: sin
// coordenadas no hay "más cercano"; una póliza vencida se dice, no se
// recomienda; el directorio vacío pide captura en vez de callarse; Places no
// configurado se declara, jamás se simula; y en robo la cascada entera se
// omite porque el protocolo mudo manda.
// ═══════════════════════════════════════════════════════════════════════════

const prov = (p: Partial<ProveedorEmergencia> & { nombre: string }): ProveedorEmergencia => ({
  id: 'p-' + p.nombre,
  tipo: 'grua',
  telefono: '5511112222',
  lat: null,
  lng: null,
  radioKm: null,
  verificadoEn: '2026-08-01T00:00:00Z',
  notas: null,
  ...p,
});

const poliza = (extra?: Partial<FlotaPoliza>): FlotaPoliza => ({
  id: 'pol-1',
  aseguradora: 'Qualitas',
  numeroPoliza: 'Q-123',
  telefonoSiniestros: '8002888500',
  vigenciaHasta: '2027-01-01',
  ...extra,
});

const base = (extra?: Partial<EntradaCascada>): EntradaCascada => ({
  tipo: 'varado',
  lat: null,
  lng: null,
  proveedores: [],
  poliza: null,
  hoy: '2026-08-27',
  ...extra,
});

describe('armarCascada — robo/violencia', () => {
  it('omite la cascada entera: el protocolo mudo manda', () => {
    const c = armarCascada(base({ tipo: 'robo', proveedores: [prov({ nombre: 'Grúas X' })], poliza: poliza() }));
    expect(c.omitida).toBe(true);
    expect(c.directorio.opciones).toHaveLength(0);
    expect(c.nacionales).toHaveLength(0);
    expect(textoCascadaParaJefe(c)).toBeNull();
  });
});

describe('armarCascada — el directorio', () => {
  it('sin coordenadas del incidente: lista sin ordenar y LO DICE', () => {
    const c = armarCascada(base({
      proveedores: [
        prov({ nombre: 'Llantera A', tipo: 'llantera', lat: 19.4, lng: -99.1 }),
        prov({ nombre: 'Grúas B', tipo: 'grua' }),
      ],
    }));
    expect(c.directorio.estado).toBe('con_opciones');
    expect(c.directorio.ordenadoPorDistancia).toBe(false);
    expect(c.directorio.opciones.every((o) => o.distanciaKm === null)).toBe(true);
    expect(textoCascadaParaJefe(c)).toContain('no está ordenada por cercanía');
  });

  it('con coordenadas de ambos lados: ordena por cercanía dentro de los verificados', () => {
    // Incidente en el Zócalo CDMX; la lejana está en Puebla (~106 km).
    const c = armarCascada(base({
      lat: 19.4326, lng: -99.1332,
      proveedores: [
        prov({ nombre: 'Lejana', lat: 19.0414, lng: -98.2063 }),
        prov({ nombre: 'Cercana', lat: 19.45, lng: -99.15 }),
      ],
    }));
    expect(c.directorio.ordenadoPorDistancia).toBe(true);
    expect(c.directorio.opciones[0].nombre).toBe('Cercana');
    expect(c.directorio.opciones[0].distanciaKm).toBeLessThan(5);
    expect(c.directorio.opciones[1].distanciaKm).toBeGreaterThan(90);
  });

  it('los verificados van SIEMPRE antes que los sin confirmar, aunque estén más lejos', () => {
    const c = armarCascada(base({
      lat: 19.4326, lng: -99.1332,
      proveedores: [
        prov({ nombre: 'SinConfirmar', verificadoEn: null, lat: 19.44, lng: -99.14 }),
        prov({ nombre: 'Verificada', lat: 19.0414, lng: -98.2063 }),
      ],
    }));
    expect(c.directorio.opciones[0].nombre).toBe('Verificada');
    expect(textoCascadaParaJefe(c)).toContain('SIN confirmar');
  });

  it('la distancia que rebasa el radio declarado del proveedor se dice', () => {
    const c = armarCascada(base({
      lat: 19.4326, lng: -99.1332,
      proveedores: [prov({ nombre: 'Corta', lat: 19.0414, lng: -98.2063, radioKm: 30 })],
    }));
    expect(c.directorio.opciones[0].fueraDeRadio).toBe(true);
    expect(textoCascadaParaJefe(c)).toContain('fuera de su radio declarado');
  });

  it('directorio sin proveedores del tipo útil: el escalón lo declara y el texto pide capturar', () => {
    const c = armarCascada(base({ proveedores: [prov({ nombre: 'Médico', tipo: 'medico' })] }));
    expect(c.directorio.estado).toBe('sin_proveedores');
    expect(textoCascadaParaJefe(c)).toContain('captúralos en Emergencias');
  });

  it('bloqueo: ningún proveedor lo resuelve — no_aplica_tipo, pero CAPUFE informa', () => {
    const c = armarCascada(base({ tipo: 'bloqueo', proveedores: [prov({ nombre: 'Grúas X' })] }));
    expect(c.directorio.estado).toBe('no_aplica_tipo');
    expect(c.nacionales.map((r) => r.nombre)).toContain('CAPUFE');
  });
});

describe('armarCascada — la póliza', () => {
  it('vigente en siniestro: se presenta con número de póliza en mano', () => {
    const c = armarCascada(base({ tipo: 'siniestro', poliza: poliza() }));
    expect(c.poliza.estado).toBe('vigente');
    expect(textoCascadaParaJefe(c)).toContain('Siniestros Qualitas: 8002888500');
    expect(textoCascadaParaJefe(c)).toContain('Q-123');
  });

  it('VENCIDA: se dice con fecha y NO se presenta como vigente', () => {
    const c = armarCascada(base({ tipo: 'siniestro', poliza: poliza({ vigenciaHasta: '2026-08-01' }) }));
    expect(c.poliza.estado).toBe('vencida');
    const texto = textoCascadaParaJefe(c) as string;
    expect(texto).toContain('VENCIÓ el 2026-08-01');
    expect(texto).not.toContain('Siniestros Qualitas:');
  });

  it('sin vigencia capturada: se presenta pero con la falta dicha', () => {
    const c = armarCascada(base({ tipo: 'varado', poliza: poliza({ vigenciaHasta: null }) }));
    expect(c.poliza.estado).toBe('sin_vigencia_capturada');
    expect(textoCascadaParaJefe(c)).toContain('vigencia sin capturar');
  });

  it('no aplica fuera de siniestro/varado (emergencia médica)', () => {
    const c = armarCascada(base({ tipo: 'emergencia_medica', poliza: poliza() }));
    expect(c.poliza.estado).toBe('no_aplica');
  });

  it('sin póliza capturada: el escalón lo declara sin inventar cobertura', () => {
    const c = armarCascada(base({ tipo: 'siniestro' }));
    expect(c.poliza.estado).toBe('sin_poliza');
  });
});

describe('armarCascada — Places y recursos nacionales', () => {
  it('Places SIEMPRE no_disponible con el motivo dicho — jamás se simula', () => {
    for (const tipo of ['varado', 'siniestro', 'emergencia_medica', 'bloqueo'] as const) {
      const c = armarCascada(base({ tipo }));
      expect(c.places.estado).toBe('no_disponible');
      expect(c.places.motivo).toContain('Google Cloud');
    }
  });

  it('los nacionales se filtran por tipo: Ángeles Verdes al varado, 911 a lo médico, SETIQ al siniestro', () => {
    expect(armarCascada(base({ tipo: 'varado' })).nacionales.map((r) => r.nombre)).toContain('Ángeles Verdes');
    expect(armarCascada(base({ tipo: 'emergencia_medica' })).nacionales.map((r) => r.telefono)).toContain('911');
    expect(armarCascada(base({ tipo: 'siniestro' })).nacionales.map((r) => r.nombre)).toContain('SETIQ');
  });

  it('todo recurso nacional lleva nota y ninguno afirma que Likida marca', () => {
    for (const r of RECURSOS_NACIONALES) {
      expect(r.nota.length).toBeGreaterThan(0);
      expect(r.telefono).toMatch(/^\d{3,10}$/);
    }
    const c = armarCascada(base({ tipo: 'emergencia_medica' }));
    expect(textoCascadaParaJefe(c)).toContain('marca un humano, no Likida');
  });
});

describe('distanciaKm', () => {
  it('CDMX → Puebla ronda los 106 km (aritmética verificable a mano)', () => {
    const d = distanciaKm(19.4326, -99.1332, 19.0414, -98.2063);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(115);
  });
});

// ── AUDITORÍA FABLE CICLO 4 (c4-1): el presupuesto del 🚨 ──────────────────

describe('textoCascadaParaJefe con maxChars — el adorno cabe o se recorta, jamás cuesta el aviso', () => {
  const cargada = (): EntradaCascada => base({
    tipo: 'siniestro',
    lat: 19.4, lng: -99.1,
    proveedores: [
      prov({ nombre: 'Grúas y Plataformas Especializadas del Sureste Peninsular S.A. de C.V. Unidad Carretera', lat: 19.41, lng: -99.11 }),
      prov({ nombre: 'Servicio Integral de Auxilio Vial y Arrastre Pesado Hermanos Rodríguez de Yucatán', lat: 19.42, lng: -99.12 }),
      prov({ nombre: 'Grúas Veinticuatro Horas María Auxiliadora de la Península y Anexas', lat: 19.43, lng: -99.13 }),
    ],
    poliza: poliza(),
  });

  it('sin presupuesto se comporta igual que siempre (compatibilidad)', () => {
    const t = textoCascadaParaJefe(armarCascada(cargada()));
    expect(t).toContain('A quién marcarle');
  });

  it('los nombres largos van truncados con … incluso sin apretar', () => {
    const t = textoCascadaParaJefe(armarCascada(cargada()))!;
    expect(t).toContain('…');
    expect(t).not.toContain('Unidad Carretera'); // la cola del nombre de 90 chars no viaja
  });

  it('con presupuesto apretado recorta opciones pero conserva lo que paga (la póliza)', () => {
    const t = textoCascadaParaJefe(armarCascada(cargada()), 260)!;
    expect(t).not.toBeNull();
    expect(t.length).toBeLessThanOrEqual(260);
    expect(t).toContain('Qualitas'); // el escalón que más paga en un siniestro no se recorta
  });

  it('el escenario del hallazgo: directorio poblado + póliza + nacionales SIEMPRE cabe en lo que quede', () => {
    for (const presupuesto of [150, 300, 500, 700]) {
      const t = textoCascadaParaJefe(armarCascada(cargada()), presupuesto);
      if (t !== null) expect(t.length).toBeLessThanOrEqual(presupuesto);
    }
  });

  it('presupuesto imposible → null: el aviso sale sin cascada, no se pierde', () => {
    expect(textoCascadaParaJefe(armarCascada(cargada()), 10)).toBeNull();
  });
});
