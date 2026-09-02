import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import { FormaEnvio } from './forma-pieza';

// ═══════════════════════════════════════════════════════════════════════════
// AGB-4 (auditoría 24, 1-sep-2026) — el botón «Enviar por correo» de
// `FormaEnvio` se pintaba para CUALQUIER pieza aprobada con `prospectoCorreo`,
// sin mirar el tipo: un `ficha_prospecto` (expediente interno del prospecto,
// con correos "INFERIDO — NO VERIFICADO") quedaba a un clic de salir hacia el
// propio prospecto. El candado que de verdad importa es de servidor
// (`aprobadasSinEnviar` + `enviarPiezaPorCorreo`, cola.ts) — esto prueba solo
// la señal visual, que tiene que estar en sincronía con esa lista.
// ═══════════════════════════════════════════════════════════════════════════

function pieza(p: Partial<PiezaEnCola>): PiezaEnCola {
  return {
    id: 'p-1', tipo: 'correo_frio', prioridad: 'normal', agente: 'redactor',
    tenantId: null, prospectoId: 'pr-1', prospectoEmpresa: 'Transportes X', prospectoCorreo: 'contacto@x.mx',
    titulo: 'Correo día 0', cuerpo: 'x', fuentes: null, estado: 'aprobado',
    cuerpoFinal: null, motivoRechazo: null, enviadoEn: null,
    providerMessageId: null, envioError: null,
    entregaEstado: null, entregaEventoEn: null,
    resueltoPorEmail: null, creadoEn: '2026-08-19T00:00:00Z',
    ...p,
  } as PiezaEnCola;
}

const accionNoop = async () => null;

describe('FormaEnvio — el botón de enviar solo aparece para tipos enviables', () => {
  it('correo_frio con prospectoCorreo: SÍ pinta el botón "Enviar por correo"', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({ tipo: 'correo_frio' })} accion={accionNoop} />);
    expect(html).toContain('Enviar por correo');
  });

  it('AGB-4: ficha_prospecto con prospectoCorreo NO pinta el botón — dice que es interna', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({ tipo: 'ficha_prospecto' })} accion={accionNoop} />);
    expect(html).not.toContain('Enviar por correo');
    expect(html).toContain('pieza interna');
  });

  it('AGB-4: brief_demo y propuesta_comercial tampoco pintan el botón', () => {
    for (const tipo of ['brief_demo', 'propuesta_comercial']) {
      const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({ tipo })} accion={accionNoop} />);
      expect(html, tipo).not.toContain('Enviar por correo');
    }
  });
});
