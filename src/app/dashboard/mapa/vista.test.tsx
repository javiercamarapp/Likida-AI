import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaMapa, type Rastreo } from './vista';

/** Un `Rastreo` sin GPS, para variar solo lo que cada prueba necesita. */
function rastreoBase(parcial: Partial<Rastreo> = {}): Rastreo {
  return {
    error: null,
    unidadesConPosicion: null,
    ultimaPosicion: null,
    proveedores: [],
    polls: [],
    pines: [],
    ...parcial,
  };
}

// AUDITORÍA 28, FE-M4 — el mensaje crudo de PostgREST (que `page.tsx` recibe
// de `getEstadoRastreo`/`getUltimasPosiciones` cuando truenan) NO debe llegar
// a la pantalla del contralor. Antes esta vista hacía
// `rastreo.error.slice(0, 140)` y lo pintaba tal cual.
describe('VistaMapa — el error del rastreo no expone el mensaje crudo de Postgres (FE-M4)', () => {
  it('con rastreo.error = mensaje crudo de PostgREST, el HTML no lo contiene y sí pinta la frase fija', () => {
    const html = renderToStaticMarkup(
      <VistaMapa
        ubicados={[]} sinUbicar={[]} totalVivos={0} tope={200}
        rastreo={rastreoBase({ error: 'permission denied for table unidad' })}
      />,
    );
    expect(html).not.toMatch(/permission denied/);
    expect(html).not.toMatch(/table unidad/);
    expect(html).toMatch(/No se pudo leer el rastreo de esta flota/);
  });

  it('sin error, no aparece la frase de fallo y sí las últimas posiciones', () => {
    const html = renderToStaticMarkup(
      <VistaMapa
        ubicados={[]} sinUbicar={[]} totalVivos={0} tope={200}
        rastreo={rastreoBase()}
      />,
    );
    expect(html).not.toMatch(/No se pudo leer el rastreo de esta flota/);
  });

  it('el `ultimo_error` de un poll (ya nuestro tras el arreglo de sincronizar_gps.ts) se sigue pintando', () => {
    const html = renderToStaticMarkup(
      <VistaMapa
        ubicados={[]} sinUbicar={[]} totalVivos={0} tope={200}
        rastreo={rastreoBase({
          polls: [{
            proveedor: 'samsara', recurso: 'posiciones', ultimoPoll: '2026-09-07T12:00:00Z',
            ultimoCompleto: null, ultimaMedida: null, backlogPendiente: true,
            paginas: 0, elementos: 0, error: 'no se pudieron leer las unidades de la flota',
            eventosInvalidosUltima: 0, eventosInvalidosTotal: 0, eventosEnCuarentena: 0,
            eventosCuarentenaMuertos: 0, eventosOutboxPendientes: 0, eventosOutboxMuertos: 0,
            avisosPendientes: 0, avisosMuertos: 0,
          }],
        })}
      />,
    );
    expect(html).toMatch(/no se pudieron leer las unidades de la flota/);
  });
});

// ── W3: semáforo de obsolescencia, respaldo por pin de WhatsApp y huérfanos ──
describe('VistaMapa — frescura del dato, respaldo y dispositivos sin unidad (W3)', () => {
  const pin = (o: Partial<import('./mapa-vivo').PinUnidad>): import('./mapa-vivo').PinUnidad => ({
    unidadId: 'u', etiqueta: 'ECO-1', placas: null, estadoUnidad: 'en_ruta', x: 10, y: 10, lat: 20.1, lng: -99.1,
    medidaEn: '2026-10-01T15:00:00Z', minutos: 5, velocidadKmh: 40, proveedor: 'wialon', ...o,
  });
  const pintar = (r: Partial<Rastreo>) => renderToStaticMarkup(
    <VistaMapa ubicados={[]} sinUbicar={[]} totalVivos={0} tope={200} rastreo={rastreoBase({ unidadesConPosicion: 3, ...r })} />,
  );

  it('rotula cada pin En vivo / Atrasada / Obsoleta y cuenta cada nivel', () => {
    const html = pintar({ pines: [pin({ unidadId: 'a', minutos: 5 }), pin({ unidadId: 'b', minutos: 120 }), pin({ unidadId: 'c', minutos: 2000 })] });
    expect(html).toContain('En vivo'); expect(html).toContain('Atrasada'); expect(html).toContain('Obsoleta');
    expect(html).toMatch(/1 en vivo/); expect(html).toMatch(/1 atrasadas/); expect(html).toMatch(/1 obsoletas/);
    expect(html).toContain('Un camión parado puede tener la posición vieja sin que nada falle');
  });

  it('un pin de WhatsApp de una unidad CON dispositivo se dice respaldo; sin dispositivo, solo pin del chofer', () => {
    const conResp = pintar({ pines: [pin({ proveedor: 'whatsapp', respaldoWa: true })] });
    expect(conResp).toContain('respaldo: el GPS de esta unidad no reportó después');
    const sin = pintar({ pines: [pin({ proveedor: 'whatsapp', respaldoWa: false })] });
    expect(sin).toContain('pin del chofer (WhatsApp)');
    expect(sin).not.toContain('respaldo: el GPS');
  });

  it('los dispositivos huérfanos se dicen y NO se dibujan; con 0 o sin poder contar no se afirma nada', () => {
    expect(pintar({ huerfanos: 4, pines: [pin({})] })).toMatch(/4 dispositivos que reporta tu proveedor no están ligados/);
    expect(pintar({ huerfanos: 0, pines: [pin({})] })).not.toMatch(/no están ligados/);
    expect(pintar({ huerfanos: null, pines: [pin({})] })).not.toMatch(/no están ligados/);
  });
});
