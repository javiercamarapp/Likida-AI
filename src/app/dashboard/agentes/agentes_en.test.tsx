import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { agentes as agentesEn } from '@/lib/i18n/en/agentes';
import { crearTraductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { VistaAgenteCobranza } from './cobranza/vista';
import { CONFIG_COBRANZA_DEFAULT } from '@/lib/likida/agentes/cobranza_pura';
import { VistaAgenteFacturas } from './facturas/vista';
import { SeccionBuzon } from './proveedores/vista';
import { VistaAgenteCartaPorte } from './carta-porte/vista';

// Los paneles de los agentes en inglés: la misma pantalla, con el diccionario `agentes` en. En español (sin traductor) dicen lo de
// siempre; sus pruebas de render por agente siguen afirmando el texto en español.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('./facturas/acciones-control', () => ({
  accionEncenderEmision: vi.fn(), accionApagarEmision: vi.fn(), accionCambiarLimites: vi.fn(),
  accionDecidirLote: vi.fn(), accionPromoverPortal: vi.fn(), accionDevolverPortal: vi.fn(),
}));
vi.mock('./facturas/acciones-vinculacion', () => ({}));
vi.mock('../../admin/ui/notificaciones', () => ({ useNotificar: () => ({ notificar: vi.fn() }) }));

const trEn = crearTraductor<DiccionarioDe<'agentes'>>('en', agentesEn, agentesEs);
const accion = async () => null;
const ACCIONES = { guardarEstrategia: accion, alternarPausa: accion, ejecutarAhora: accion };

describe('Agente de seguimiento de comprobantes (cobranza) en inglés', () => {
  it('rotula la cola, la bitácora y la estrategia en inglés, con cifras y fechas iguales', () => {
    const html = renderToStaticMarkup(
      <IdiomaProvider idioma="en" diccionarios={{ agentes: agentesEn }}>
        <VistaAgenteCobranza
          tr={trEn}
          cola={{
            paraContactar: [{ viajeId: 'v1', folio: 'F-1001', operadorNombre: 'Juan Pérez', operadorTelefono: '5215500000000', dias: 5, tier: 3, contactosPrevios: 0 }],
            sinTelefono: [], vigilados: 4,
          }}
          config={CONFIG_COBRANZA_DEFAULT}
          bitacora={[{ cuando: '2026-08-04T15:00:00Z', folio: 'F-1001', operadorNombre: 'Juan Pérez', tier: 3, enviado: true, detalle: null }]}
          extra={{ enVentana: true, ejemplo: null }}
          acciones={ACCIONES}
        />
      </IdiomaProvider>,
    );
    expect(html).toContain('Receipt follow-up');
    expect(html).toContain('To contact');
    expect(html).toContain('Contact log');
    expect(html).toContain('Aug 4');
    expect(html).toContain('F-1001');
    expect(html).not.toContain('Seguimiento de comprobantes');
    expect(html).not.toContain('>Bitácora de contactos<');
  });
});

describe('Agente de facturas en inglés', () => {
  it('en ensayo lo dice arriba y los vacíos dicen qué falta, en inglés', () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <VistaAgenteFacturas
        tr={trEn} tickets={[]} extra={{ conCfdi: 0, emite: false }} marcarFacturada={noop as never} portalesConAdaptador={[]}
        portales={[]} vinculosLeidos autorizarRelogin={noop as never} revocarRelogin={noop as never}
        control={{ control: { emisionReal: false, maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 }, lotes: [], portales: [], minimoParaAutonomia: 5 } as never}
      />,
    );
    expect(html).toContain('Invoices on autopilot');
    expect(html).toContain('Nothing for you to enter today');
    expect(html).not.toContain('Hoy no te toca capturar nada');
  });
});

describe('Agente de proveedores en inglés', () => {
  it('el buzón con lectura caída lo dice en inglés y no ofrece generar', () => {
    const accion = async () => null;
    const html = renderToStaticMarkup(
      <SeccionBuzon tr={trEn} buzon={null} dominioConfigurado puedeAdministrarBuzon acciones={{ generarBuzon: accion, rotarBuzon: accion }} />,
    );
    expect(html).toContain('Could not read the fleet');
    expect(html).not.toContain('No se pudo leer el buzón');
  });
});

describe('Agente de Carta Porte en inglés', () => {
  it('rotula las cifras y la explicación sin mencionar grupos de WhatsApp fuera de su frase', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte tr={trEn} datos={null} />);
    expect(html).toContain('Carta Porte on autopilot');
    expect(html).not.toContain('Carta Porte en automático');
  });
});
