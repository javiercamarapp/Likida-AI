import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { agentes as agentesEn } from '@/lib/i18n/en/agentes';
import { crearTraductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { VistaAgenteCobranza } from './cobranza/vista';
import { CONFIG_COBRANZA_DEFAULT } from '@/lib/likida/agentes/cobranza_pura';

// Los paneles de los agentes en inglés: la misma pantalla, con el diccionario `agentes` en. En español (sin traductor) dicen lo de
// siempre; sus pruebas de render por agente siguen afirmando el texto en español.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

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
