import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { analizarHistorial } from './analisis';
import { faqsAExcel, faqsAPdf, AVISO_REPORTE } from './reporte_archivos';

const m = (iso: string, rol: 'cliente' | 'equipo', texto: string) => ({ enviadoEn: iso, rol, texto });
const dia = (n: number) => new Date(Date.UTC(2026, 6, 1 + n, 15, 0, 0)).toISOString();
const conMinutos = (n: number, mins: number) => new Date(Date.UTC(2026, 6, 1 + n, 15, mins, 0)).toISOString();

// 10 semanas de chat: «dónde va mi viaje» cada tres días con respuesta a los 5 min, y una pregunta de citas con respuesta a los 40 min.
const historial = [
  ...Array.from({ length: 24 }, (_, i) => [m(dia(i * 3), 'cliente', '¿Dónde va mi viaje?'), m(conMinutos(i * 3, 5), 'equipo', 'Va por Querétaro.')]).flat(),
  m(dia(2), 'cliente', '¿A qué hora puedo agendar mi cita de descarga?'), m(conMinutos(2, 40), 'equipo', 'Las citas son de 8 a 18 h.'),
  m(dia(30), 'cliente', '¿A qué hora puedo agendar mi cita de descarga?'), m(conMinutos(30, 40), 'equipo', 'Las citas son de 8 a 18 h.'),
  m(dia(40), 'cliente', 'Esto es una vergüenza, nadie me contesta'),
];
const reporte = analizarHistorial(historial, { umbralMin: 10 });
const meta = { alcance: 'Operación Cliente A', truncado: false, umbralMin: 10 };

describe('faqsAExcel', () => {
  const libro = XLSX.read(faqsAExcel(reporte, meta), { type: 'array' });
  const hoja = (n: string) => XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n], { header: 1, defval: null });

  it('trae las cuatro hojas', () => {
    expect(libro.SheetNames).toEqual(['Resumen', 'Preguntas frecuentes', 'Tendencias', 'Por semana']);
  });

  it('resumen: alcance, conteos, tiempos contra el umbral y la leyenda de qué es una «respuesta típica»', () => {
    const r = hoja('Resumen');
    expect(r.flat()).toContain('Alcance: Operación Cliente A');
    expect(r.find((f) => f[0] === 'Mensajes en total')?.[1]).toBe(reporte.mensajes);
    expect(r.find((f) => String(f[0]).startsWith('Esperas que pasaron de 10 min'))?.[1]).toBe(reporte.tiempos.sobreUmbral);
    expect(r.flat()).toContain(AVISO_REPORTE);
  });

  it('preguntas frecuentes: la pregunta, su tema, cuántas veces y lo que contestó el equipo', () => {
    const f = hoja('Preguntas frecuentes');
    expect(f[0]).toEqual(['Pregunta', 'Tema', 'Veces', 'Días distintos', 'Lo que suele contestar el equipo', 'Respuestas encontradas']);
    const donde = f.find((x) => String(x[0]).includes('Dónde va mi viaje'))!;
    expect(donde[1]).toBe('Ubicación del viaje');
    expect(donde[2]).toBe(24);
    expect(donde[4]).toBe('Va por Querétaro.');
    expect(f.some((x) => String(x[0]).includes('agendar mi cita'))).toBe(true);
  });

  it('tendencias y por semana: hay cambio numérico con 8+ semanas y filas semanales por tema', () => {
    const t = hoja('Tendencias');
    const ubic = t.find((x) => x[0] === 'Ubicación del viaje')!;
    expect(ubic[1]).toBe(24);
    expect(typeof ubic[4]).toBe('string');
    expect(String(ubic[4])).not.toContain('Histórico corto');
    expect(hoja('Por semana').filter((x) => x[0] === 'Ubicación del viaje').length).toBeGreaterThan(5);
  });

  it('un texto que empieza como fórmula se escribe como TEXTO, nunca como fórmula', () => {
    const peligroso = analizarHistorial([
      m(dia(0), 'cliente', '=HYPERLINK("http://x","¿dónde va mi viaje?")'), m(conMinutos(0, 5), 'equipo', '=1+1'),
      m(dia(1), 'cliente', '=HYPERLINK("http://x","¿dónde va mi viaje?")'), m(conMinutos(1, 5), 'equipo', '=1+1'),
    ]);
    const l = XLSX.read(faqsAExcel(peligroso, meta), { type: 'array' });
    for (const celda of Object.values(l.Sheets['Preguntas frecuentes'])) {
      const c = celda as { f?: string };
      expect(c.f).toBeUndefined();
    }
  });
});

describe('faqsAPdf', () => {
  it('es un PDF válido, determinista y con el reporte sin datos tampoco rompe', async () => {
    const a = await faqsAPdf(reporte, meta, 'Flota Ejemplo SA');
    const b = await faqsAPdf(reporte, meta, 'Flota Ejemplo SA');
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const vacio = await faqsAPdf(analizarHistorial([m(dia(0), 'cliente', 'hola'), m(conMinutos(0, 1), 'equipo', 'buenas')]), { ...meta, truncado: true });
    expect(Buffer.from(vacio.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('un reporte largo pagina y no revienta con caracteres fuera de WinAnsi', async () => {
    const muchas = Array.from({ length: 40 }, (_, i) => [
      m(dia(i), 'cliente', `¿Pueden agendar mi cita número ${i} de descarga 🚚 en la planta?`), m(conMinutos(i, 5), 'equipo', 'Sí, 😀 se agenda.'),
      m(dia(i + 50), 'cliente', `¿Pueden agendar mi cita número ${i} de descarga 🚚 en la planta?`), m(conMinutos(i + 50, 5), 'equipo', 'Sí, 😀 se agenda.'),
    ]).flat();
    const bytes = await faqsAPdf(analizarHistorial(muchas), meta);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
