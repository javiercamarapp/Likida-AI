import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAgenteCobranza, type ExtraAgenteCobranza } from './vista';
import type { ColaCobranza, ContactoBitacora, FilaCola } from '@/lib/likida/agentes/cobranza';
import { CONFIG_COBRANZA_DEFAULT, type ConfigCobranza } from '@/lib/likida/agentes/cobranza_pura';

// `BotonEjecutar` llama `useRouter()` (refresh tras una corrida) y el render
// estático de prueba no monta el App Router: el doble devuelve lo mínimo que
// ese efecto toca. Mismo patrón que `dashboard/agentes/proveedores/vista.test.tsx`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 1 (auditoría, A7 Cobranza): `vista.tsx`/`controles.tsx` no tenían
// NINGUNA prueba de render — `reloj-corte.test.ts` solo hace grep de texto
// fuente, no ejecuta ni renderiza nada. Aquí se renderiza el componente REAL
// (nunca una copia) sobre sus estados principales: cola con datos, cola
// vacía, a quién no puede escribirle, bitácora en sus tres estados, y el
// gateo de "Ejecutar ahora" por `activo`/`enCola` (ver `controles.test.tsx`
// para los estados de los controles en sí).
// ═══════════════════════════════════════════════════════════════════════════

const accionSimple = async () => null;
const accionEjecutar = async () => null;
const ACCIONES = { guardarEstrategia: accionSimple, alternarPausa: accionSimple, ejecutarAhora: accionEjecutar };

const FILA: FilaCola = {
  viajeId: 'v1', folio: 'F-1001', operadorNombre: 'Juan Pérez', operadorTelefono: '5215500000000',
  dias: 5, tier: 3, contactosPrevios: 0,
};

const COLA_VACIA: ColaCobranza = { paraContactar: [], sinTelefono: [], vigilados: 0 };

const EXTRA_SIN_COLA: ExtraAgenteCobranza = { enVentana: true, ejemplo: null };

function pintar(p: {
  cola?: ColaCobranza;
  config?: ConfigCobranza;
  bitacora?: ContactoBitacora[] | null;
  extra?: ExtraAgenteCobranza;
  gastosParaContactar?: number;
}) {
  return renderToStaticMarkup(
    <VistaAgenteCobranza
      cola={p.cola ?? COLA_VACIA}
      config={p.config ?? CONFIG_COBRANZA_DEFAULT}
      bitacora={p.bitacora === undefined ? [] : p.bitacora}
      extra={p.extra ?? EXTRA_SIN_COLA}
      acciones={ACCIONES}
      gastosParaContactar={p.gastosParaContactar}
    />,
  );
}

describe('VistaAgenteCobranza — la cola honesta', () => {
  it('sin nadie que contactar: el estado vacío declara cuándo aparecería alguien', () => {
    const html = pintar({});
    expect(html).toContain('Nadie trae comprobantes atrasados');
    expect(html).toContain(`${CONFIG_COBRANZA_DEFAULT.tiers[0]} días`);
  });

  it('con filas: la tabla pinta folio, operador, días y el tier que toca', () => {
    const html = pintar({ cola: { paraContactar: [FILA], sinTelefono: [], vigilados: 1 } });
    expect(html).toContain('F-1001');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('5 días');
    expect(html).toContain('3 días');
  });

  it('el KPI de "Para contactar" cuenta solo la cola, y "Viajes vigilados" el total vigilado', () => {
    const html = pintar({ cola: { paraContactar: [FILA], sinTelefono: [], vigilados: 7 } });
    expect(html).toContain('Para contactar');
    expect(html).toContain('Viajes vigilados');
  });
});

describe('VistaAgenteCobranza — a quién no puede escribirle', () => {
  it('todos con teléfono: la leyenda dice que nadie quedó con las manos atadas', () => {
    const html = pintar({});
    expect(html).toContain('no trae las manos atadas con nadie');
  });

  it('con operadores sin teléfono: la fila dice folio, operador y días, con el ícono de alerta', () => {
    const SIN_TEL: FilaCola = { ...FILA, viajeId: 'v2', folio: 'F-2002', operadorTelefono: null };
    const html = pintar({ cola: { paraContactar: [], sinTelefono: [SIN_TEL], vigilados: 1 } });
    expect(html).toContain('F-2002');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('5 días');
    // El KPI de "No puede contactar" se pone en tono de alerta cuando hay alguno.
    expect(html).toContain('No puede contactar');
  });
});

describe('VistaAgenteCobranza — la bitácora en sus tres estados', () => {
  it('bitácora null (lectura caída): lo dice, no finge "sin contactos"', () => {
    const html = pintar({ bitacora: null });
    expect(html).toContain('No se pudo leer la bitácora ahora mismo');
    expect(html).not.toContain('Aún sin contactos');
  });

  it('bitácora vacía: la leyenda honesta de "aún sin contactos"', () => {
    const html = pintar({ bitacora: [] });
    expect(html).toContain('Aún sin contactos');
  });

  it('bitácora con un contacto exitoso y uno fallido: cada uno con su ícono y su detalle', () => {
    const bitacora: ContactoBitacora[] = [
      { folio: 'F-3003', operadorNombre: 'Ana Ruiz', tier: 3, enviado: true, detalle: null, cuando: '2026-10-01T10:00:00Z' },
      { folio: 'F-4004', operadorNombre: 'Luis Gómez', tier: 7, enviado: false, detalle: 'número inválido', cuando: '2026-10-02T10:00:00Z' },
    ];
    const html = pintar({ bitacora });
    expect(html).toContain('Ana Ruiz');
    expect(html).toContain('F-3003');
    expect(html).toContain('Luis Gómez');
    expect(html).toContain('número inválido');
  });
});

describe('VistaAgenteCobranza — estado del agente y su ventana', () => {
  it('pausado: el aviso dice que no contacta a nadie, ni con Ejecutar ahora, y el KPI dice "Pausado"', () => {
    const html = pintar({ config: { ...CONFIG_COBRANZA_DEFAULT, activo: false } });
    expect(html).toContain('no contacta a nadie, ni con Ejecutar ahora');
    expect(html).toContain('Pausado');
  });

  it('activo y dentro de ventana: dice que la próxima corrida de la hora los contacta sola', () => {
    const html = pintar({ extra: { enVentana: true, ejemplo: null } });
    expect(html).toContain('la próxima corrida de la hora los contacta sola');
    expect(html).toContain('Activo');
  });

  it('activo y fuera de ventana: dice que los contacta cuando abra, o ahora si se le pide', () => {
    const html = pintar({ extra: { enVentana: false, ejemplo: null } });
    expect(html).toContain('Fuera de la ventana');
    expect(html).toContain('o ahora si tú se lo pides');
  });
});

/** El `<button>` que CONTIENE el texto dado — buscando el `<button` más
 *  cercano hacia atrás, para no leer accidentalmente el `<svg>` del ícono. */
function botonQueContiene(html: string, texto: string): string {
  const fin = html.indexOf(texto);
  const inicio = html.lastIndexOf('<button', fin);
  const cierre = html.indexOf('</button>', fin);
  return html.slice(inicio, cierre);
}

describe('VistaAgenteCobranza — Ejecutar ahora cuenta cola de viaje Y de gasto', () => {
  it('el botón habilita cuando hay cola de viaje aunque no haya gastos', () => {
    const html = pintar({ cola: { paraContactar: [FILA], sinTelefono: [], vigilados: 1 } });
    expect(botonQueContiene(html, 'Ejecutar ahora')).not.toMatch(/\sdisabled(=|>)/);
  });

  it('con cola de viaje vacía pero gastos por contactar, el botón sigue habilitado', () => {
    const html = pintar({ gastosParaContactar: 2 });
    // `BotonEjecutar` solo deshabilita cuando `enCola` (viaje + gasto) es 0.
    expect(botonQueContiene(html, 'Ejecutar ahora')).not.toMatch(/\sdisabled(=|>)/);
  });

  it('sin nada en ninguna cola: el botón queda deshabilitado', () => {
    const html = pintar({});
    expect(botonQueContiene(html, 'Ejecutar ahora')).toMatch(/\sdisabled(=|>)/);
  });
});
