import { describe, it, expect } from 'vitest';
import { armarReporte, reporteACsv, type DiaDelReporte } from './reporte';
import type { Asiento, Procedencia, TipoAsiento } from './modelo';
import type { PoliticaFlota } from './riesgo';
import {
  LEYENDA_NOM_087, LEYENDA_NO_ES_BITACORA_83, CONSERVACION_LFT_804,
} from './topes';
import { LEYENDA_VEREDICTOS } from './riesgo';

// ═══════════════════════════════════════════════════════════════════════════
// EL DOCUMENTO QUE VIAJA SOLO.
//
// Un CSV se manda por correo, se imprime y se abre en la computadora de un
// abogado tres años después. Todo lo que el documento NO afirma tiene que ir
// PEGADO al archivo: si la advertencia se queda en la pantalla desde donde se
// descargó, deja de estar dicha en el momento en que importa.
//
// Estas pruebas leen el CSV como lo leería un inspector.
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(
  tipo: TipoAsiento,
  momento: string,
  procedencia: Procedencia = 'declarado_operador',
): Asiento {
  n += 1;
  return {
    id: `a-${n}`,
    tipo,
    momento,
    procedencia,
    origenRef: null,
    waMessageId: null,
    viajeId: null,
    registradoPorEmail: null,
    nota: null,
    corrigeA: null,
    anuladoEn: null,
    anuladoPorEmail: null,
    anuladoMotivo: null,
  };
}

const T = (hhmm: string, f = '2026-08-27') => `${f}T${hhmm}:00-06:00`;

function dia(parcial: Partial<DiaDelReporte> = {}): DiaDelReporte {
  return {
    dia: '2026-08-27',
    operadorId: 'op-1',
    operadorNombre: 'Juan Pérez',
    numeroEmpleado: '104',
    estado: 'abierto',
    cerradoEn: null,
    cerradoPorEmail: null,
    conformeOperadorEn: null,
    asientos: [
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('fin_jornada', T('17:00')),
    ],
    ...parcial,
  };
}

const base = {
  tenantNombre: 'Transportes del Bajío',
  desde: '2026-08-24',
  hasta: '2026-08-30',
  generadoEn: new Date('2026-08-31T12:00:00-06:00'),
};

describe('las leyendas viajan pegadas al archivo', () => {
  it('el CSV trae las cinco advertencias de ley en su encabezado', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [dia()], politica: null }));
    expect(csv).toContain(LEYENDA_NO_ES_BITACORA_83);
    expect(csv).toContain(LEYENDA_NOM_087);
    expect(csv).toContain(LEYENDA_VEREDICTOS);
    expect(csv).toContain(CONSERVACION_LFT_804);
    expect(csv).toContain('132 fracción XXXIV');
  });

  // La advertencia MÁS importante del archivo: que un total en blanco no es un
  // cero. Sin ella, un renglón vacío se lee como «ese día no trabajó».
  it('dice, con esas palabras, que un día en blanco NO son cero horas', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [dia()], politica: null }));
    expect(csv).toContain('NO');
    expect(csv).toContain('cero horas trabajadas');
    expect(csv).toContain('nadie las reportó');
  });

  it('explica qué significa la columna de origen y qué NO prueba', () => {
    const r = armarReporte({ ...base, dias: [dia()], politica: null });
    const texto = r.leyendas.join(' ');
    expect(texto).toContain('acota la jornada por abajo');
    expect(texto).toContain('no para descartarlo');
  });

  it('las leyendas van como comentarios `#`, antes de la tabla', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [dia()], politica: null }));
    const lineas = csv.split('\n');
    const primeraTabla = lineas.findIndex((l) => l.startsWith('operador'));
    expect(primeraTabla).toBeGreaterThan(0);
    // Todo lo de arriba de la tabla es comentario: ninguna hoja de cálculo lo
    // confunde con un renglón de datos.
    for (const l of lineas.slice(0, primeraTabla)) {
      if (l.trim() !== '') expect(l.startsWith('#')).toBe(true);
    }
  });

  it('el encabezado nombra la flota y el periodo del archivo', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [dia()], politica: null }));
    expect(csv).toContain('Transportes del Bajío');
    expect(csv).toContain('2026-08-24');
    expect(csv).toContain('2026-08-30');
  });

  it('una flota sin nombre se declara, no se deja en blanco', () => {
    const csv = reporteACsv(armarReporte({ ...base, tenantNombre: null, dias: [dia()], politica: null }));
    expect(csv).toContain('sin nombre registrado');
  });
});

describe('los umbrales de la flota se transcriben sin hacerlos propios', () => {
  const politica: PoliticaFlota = {
    horasMaxJornada: 10,
    minutosMinDescanso: 45,
    horasMinEntreJornadas: 9,
    fundamento: 'Cláusula 14 del contrato colectivo',
  };

  it('salen en el archivo con la aclaración de que Likida no los valida', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [dia()], politica }));
    expect(csv).toContain('esta flota declaró para sí misma');
    expect(csv).toContain('jornada máxima 10 h');
    expect(csv).toContain('Cláusula 14 del contrato colectivo');
    expect(csv).toContain('Likida los transcribe sin validarlos');
  });

  // Una política toda en `null` no es una política de ceros: es no declarada,
  // y no se le inventa un renglón al reporte.
  it('una política sin ningún umbral no añade leyenda', () => {
    const vacia: PoliticaFlota = {
      horasMaxJornada: null, minutosMinDescanso: null,
      horasMinEntreJornadas: null, fundamento: null,
    };
    const r = armarReporte({ ...base, dias: [dia()], politica: vacia });
    expect(r.leyendas.join(' ')).not.toContain('declaró para sí misma');
  });
});

describe('la fila del día', () => {
  it('un día completo trae sus horas, su origen y su tipo de jornada', () => {
    const r = armarReporte({ ...base, dias: [dia()], politica: null });
    const f = r.filas[0];
    expect(f.operador).toBe('Juan Pérez');
    expect(f.numero_empleado).toBe('104');
    expect(f.inicio).toBe('06:00');
    expect(f.fin).toBe('17:00');
    expect(f.origen_inicio).toBe('Declarado por el operador');
    expect(f.minutos_descanso).toBe('45');
    expect(f.total_horas).toBe('10.25');
    expect(f.tipo_jornada).toBe('diurna');
  });

  // ── LA FILA QUE MÁS IMPORTA DEL REPORTE ─────────────────────────────────
  // El día sin marcas: total EN BLANCO —no un 0, no un guion— y la palabra
  // que explica el blanco en la misma fila.
  it('un día sin marcas deja el total VACÍO y lo explica en la misma fila', () => {
    const r = armarReporte({ ...base, dias: [dia({ asientos: [] })], politica: null });
    const f = r.filas[0];
    expect(f.total_horas).toBe('');
    expect(f.total_horas).not.toBe('0');
    expect(f.inicio).toBe('');
    expect(f.fin).toBe('');
    expect(f.veredicto).toBe('Sin registro declarado');
    expect(f.observaciones).toContain('No son cero horas');
  });

  it('sin descanso reportado se escribe con palabras, no con un 0', () => {
    const sinDescanso = dia({
      asientos: [asiento('inicio_jornada', T('06:00')), asiento('fin_jornada', T('14:00'))],
    });
    const f = armarReporte({ ...base, dias: [sinDescanso], politica: null }).filas[0];
    expect(f.minutos_descanso).toBe('sin descanso reportado');
    expect(f.minutos_descanso).not.toBe('0');
  });

  it('una punta faltante no se estima: la otra sale y el total queda vacío', () => {
    const medio = dia({ asientos: [asiento('inicio_jornada', T('06:00'))] });
    const f = armarReporte({ ...base, dias: [medio], politica: null }).filas[0];
    expect(f.inicio).toBe('06:00');
    expect(f.fin).toBe('');
    expect(f.total_horas).toBe('');
    expect(f.observaciones).toContain('No se estima');
  });

  // La procedencia va en su PROPIA columna, junto a cada hora: una hora
  // derivada y una declarada no pueden verse iguales en el documento.
  it('cada hora lleva su origen en columna propia', () => {
    const mezclado = dia({
      asientos: [
        asiento('inicio_jornada', T('06:00'), 'declarado_operador'),
        asiento('fin_jornada', T('17:00'), 'gps'),
      ],
    });
    const f = armarReporte({ ...base, dias: [mezclado], politica: null }).filas[0];
    expect(f.origen_inicio).toBe('Declarado por el operador');
    expect(f.origen_fin).toBe('Derivado del GPS de la unidad');
    expect(f.origen_inicio).not.toBe(f.origen_fin);
    // Y el documento avisa de que la resta no es una sola medición.
    expect(f.observaciones).toContain('no es una sola medición');
  });

  // El tercer párrafo del 132-XXXIV: sin acuerdo acreditado el registro no
  // hace «prueba plena», y el reporte lo DICE en vez de dejarlo suponer.
  it('la ausencia de conformidad del operador se declara, no se deja en blanco', () => {
    const f = armarReporte({ ...base, dias: [dia()], politica: null }).filas[0];
    expect(f.conformidad_del_operador).toBe('Sin conformidad del operador');
  });

  it('con conformidad se dice desde cuándo', () => {
    const conforme = dia({ conformeOperadorEn: '2026-08-27T20:15:00.000Z' });
    const f = armarReporte({ ...base, dias: [conforme], politica: null }).filas[0];
    expect(f.conformidad_del_operador).toContain('Sí');
    expect(f.conformidad_del_operador).toContain('2026-08-27');
  });

  it('un operador sin número de empleado se declara, no se inventa', () => {
    const f = armarReporte({ ...base, dias: [dia({ numeroEmpleado: null })], politica: null }).filas[0];
    expect(f.numero_empleado).toBe('sin registrar');
  });

  it('las observaciones traen el artículo de cada señal', () => {
    // 13 h efectivas: rebasa el tope duro del art. 68.
    const largo = dia({
      asientos: [
        asiento('inicio_jornada', T('05:00')),
        asiento('inicio_descanso', T('12:00')),
        asiento('fin_descanso', T('12:30')),
        asiento('fin_jornada', T('18:30')),
      ],
    });
    const f = armarReporte({ ...base, dias: [largo], politica: null }).filas[0];
    expect(f.veredicto).toBe('Posible exceso');
    expect(f.observaciones).toContain('art. 68');
  });

  // NUNCA la palabra «cumple» en la columna de veredicto, para ningún día.
  it('ningún veredicto del reporte dice que la flota cumple', () => {
    const varios = [
      dia(),
      dia({ asientos: [] }),
      dia({ asientos: [asiento('inicio_jornada', T('06:00'), 'gps'), asiento('fin_jornada', T('14:00'), 'gps')] }),
    ];
    const r = armarReporte({ ...base, dias: varios, politica: null });
    for (const f of r.filas) {
      expect(f.veredicto.toLowerCase()).not.toContain('cumple');
    }
  });
});

describe('el periodo sin expedientes', () => {
  // Un archivo vacío se lee como «no trabajó nadie». Tiene que decir lo otro:
  // que no hay REGISTRO, que es justo lo que la fracción XXXIV manda tener.
  it('no entrega una tabla vacía y muda', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [], politica: null }));
    expect(csv).toContain('No hay expedientes de jornada en este periodo');
    expect(csv).toContain('no significa que nadie trabajó');
    expect(csv).toContain('132 fracción XXXIV');
  });

  it('aun así trae todas las leyendas', () => {
    const csv = reporteACsv(armarReporte({ ...base, dias: [], politica: null }));
    expect(csv).toContain(LEYENDA_NO_ES_BITACORA_83);
    expect(csv).toContain(LEYENDA_NOM_087);
  });
});

describe('armarReporte es puro', () => {
  it('la misma entrada produce el mismo reporte', () => {
    const uno = armarReporte({ ...base, dias: [dia()], politica: null });
    const dos = armarReporte({ ...base, dias: [dia()], politica: null });
    expect(uno.filas).toEqual(dos.filas);
    expect(uno.leyendas).toEqual(dos.leyendas);
  });

  it('sella la hora en que se generó', () => {
    const r = armarReporte({ ...base, dias: [dia()], politica: null });
    expect(r.generadoEn).toBe(base.generadoEn.toISOString());
  });
});
