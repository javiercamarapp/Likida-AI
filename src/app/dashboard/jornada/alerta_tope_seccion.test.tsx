import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertaTopeSeccion, type FilaJornada } from './vista';
import type { AlertaDeJornada } from '@/lib/likida/jornada/alerta_tope_datos';
import type { ConfigAlertaForma } from './formas';

// ═══════════════════════════════════════════════════════════════════════════
// LA SECCIÓN «ALERTA DE TOPE» DE /dashboard/jornada (P10). Lo que se fija:
//   · «no pude leer» NUNCA se pinta como «apagada» ni como «ninguna alerta»;
//   · solo quien administra ve la forma de configuración;
//   · una cota inferior se dice «al menos» y la fuente se nombra;
//   · el estado por destinatario se escribe en palabras.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => ({ ok: true as const });
const CONFIG: ConfigAlertaForma = {
  activa: true, topeHoras: 10, umbralAvisoPct: 80, umbralCriticoPct: 95, canalEncargado: 'ambos', canalOperador: 'whatsapp', correoEncargado: 'jefe@flota.mx',
};
const FILA = { jornadaId: 'j1', operadorNombre: 'Juan Norte', dia: '2026-10-01' } as unknown as FilaJornada;
const ALERTA: AlertaDeJornada = {
  jornadaId: 'j1', nivel: 'critico', minutos: 570, topeMin: 600, cotaInferior: true, fuente: 'gps', estado: 'parcial',
  encargadoEstado: 'enviado', operadorEstado: 'fallido', creadaEn: '2026-10-01T22:00:00Z',
};

function pintar(p: Partial<Parameters<typeof AlertaTopeSeccion>[0]> = {}) {
  return renderToStaticMarkup(
    <AlertaTopeSeccion config={CONFIG} configIlegible={false} alertas={[]} filas={[FILA]} truncada={false} puedeConfigurar guardarAlerta={accion} {...p} />,
  );
}

describe('AlertaTopeSeccion', () => {
  it('sin configuración dice que está apagada y que nadie recibe avisos', () => {
    const html = pintar({ config: null });
    expect(html).toContain('la alerta está apagada');
  });

  it('configuración ilegible NO se pinta como apagada y no ofrece la forma (no se guarda a ciegas)', () => {
    const html = pintar({ config: null, configIlegible: true });
    expect(html).toContain('No se pudo leer la configuración de la alerta');
    expect(html).not.toContain('la alerta está apagada');
    expect(html).not.toContain('Guardar la alerta');
  });

  it('con la config encendida resume tope y umbrales y la forma trae los valores vigentes', () => {
    const html = pintar();
    expect(html).toContain('Encendida');
    expect(html).toContain('propio de 10 h');
    expect(html).toContain('Guardar la alerta');
    expect(html).toContain('value="jefe@flota.mx"');
    expect(html).toContain('name="umbralAvisoPct"');
  });

  it('quien no administra ve la configuración pero no la forma', () => {
    const html = pintar({ puedeConfigurar: false });
    expect(html).toContain('Encendida');
    expect(html).not.toContain('Guardar la alerta');
  });

  it('alertas ilegibles se dicen y no equivalen a «ninguna»', () => {
    const html = pintar({ alertas: null });
    expect(html).toContain('No se pudieron leer las alertas emitidas');
    expect(html).not.toContain('Ninguna alerta emitida');
  });

  it('sin alertas lo dice, y avisa si la lista de jornadas estaba truncada', () => {
    expect(pintar()).toContain('Ninguna alerta emitida');
    expect(pintar({ truncada: true })).toContain('acota el periodo');
  });

  it('una alerta se lista con operador, nivel, «al menos», fuente y estado por destinatario', () => {
    const html = pintar({ alertas: [ALERTA] });
    expect(html).toContain('Juan Norte · 2026-10-01');
    expect(html).toContain('Crítico');
    expect(html).toContain('(al menos)');
    expect(html).toContain('según el GPS');
    expect(html).toContain('Enviada en parte');
    expect(html).toContain('enviado');
    expect(html).toContain('no llegó');
  });

  it('una alerta de una jornada que la tabla no trae se dice, no inventa un operador', () => {
    const html = pintar({ alertas: [{ ...ALERTA, jornadaId: 'otra' }] });
    expect(html).toContain('Jornada fuera de la tabla');
  });
});
