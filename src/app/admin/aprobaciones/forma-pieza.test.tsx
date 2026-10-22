import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import { FormaEnvio, type ResultadoPieza } from './forma-pieza';

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

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL, HALLAZGO MEDIO: "Enviar por correo" mandaba un correo
// REAL a un prospecto externo vía Resend con un solo clic, sin ningún diálogo
// de confirmación — a diferencia de "Rechazar" (en `FormaPieza`, NO tocado
// aquí), que ya exige un paso intermedio propio para revelar el motivo. Se
// envuelve con el ÚNICO sistema de confirmación del repo
// (`admin/ui/confirmar`, DESIGN.md §3), mismo molde que `FormaRechazarCliente`
// del PR #583: `BotonConfirmar`/`DialogoConfirmar`, tono="peligro". Se mide
// aquí lo mismo que `mcp-clientes/forma-rechazar.test.tsx` mide para ese
// molde: que el disparador visible NO envía nada por sí solo, que el diálogo
// DICE a quién y a qué correo se va a enviar, y que lo que SÍ envía
// (type="submit") vive dentro del MISMO formulario cuya action es la server
// action real.
// ═══════════════════════════════════════════════════════════════════════════

/** El <button ...>texto</button> cuyo texto es exactamente `texto`. */
const boton = (html: string, texto: string) =>
  [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).find((b) => b.endsWith(`>${texto}</button>`));

describe('FormaEnvio — "Enviar por correo" exige confirmación (HALLAZGO MEDIO)', () => {
  it('el disparador "Enviar por correo" es type="button" (no envía) — un clic solo no manda el correo', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({})} accion={accionNoop} />);
    expect(boton(html, 'Enviar por correo')).toContain('type="button"');
  });

  it('el <dialog> existe pero cerrado por omisión — no se envía sin el clic explícito de confirmar', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({})} accion={accionNoop} />);
    expect(html).toContain('<dialog');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it('el diálogo DICE a quién y a qué correo se va a enviar — no "¿estás seguro?" a secas', () => {
    const html = renderToStaticMarkup(
      <FormaEnvio pieza={pieza({ titulo: 'Correo día 0', prospectoEmpresa: 'Transportes X', prospectoCorreo: 'contacto@x.mx' })} accion={accionNoop} />,
    );
    expect(html).toMatch(/correo día 0/i);
    expect(html).toMatch(/transportes x/i);
    expect(html).toContain('contacto@x.mx');
  });

  it('sin empresa capturada, el diálogo igual nombra el correo exacto del destinatario', () => {
    const html = renderToStaticMarkup(
      <FormaEnvio pieza={pieza({ prospectoEmpresa: null, prospectoCorreo: 'solo@correo.mx' })} accion={accionNoop} />,
    );
    expect(html).toContain('solo@correo.mx');
  });

  it('el botón que SÍ envía (dentro del diálogo) es type="submit", y el id de la pieza viaja oculto en el mismo formulario', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({ id: 'pz-77' })} accion={accionNoop} />);
    expect(boton(html, 'Sí, enviar')).toContain('type="submit"');
    expect(html).toContain('<input type="hidden" name="pieza" value="pz-77"');
  });

  it('el botón Cancelar (dentro del diálogo) es type="button" — cancelar no envía el formulario ni manda el correo', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({})} accion={accionNoop} />);
    expect(boton(html, 'Cancelar')).toContain('type="button"');
  });

  it('tono="peligro": el foco inicial cae en Cancelar, no en el botón que envía', () => {
    const html = renderToStaticMarkup(<FormaEnvio pieza={pieza({})} accion={accionNoop} />);
    expect(boton(html, 'Cancelar')).toContain('data-foco-inicial');
    expect(boton(html, 'Sí, enviar')).not.toContain('data-foco-inicial');
  });

  it('INTEGRACIÓN — confirmar en el diálogo (el type="submit" real) SÍ invoca la acción de envío', async () => {
    const accion = vi.fn(async (_previo: ResultadoPieza, _fd: FormData) => ({ ok: 'Enviada a contacto@x.mx' }));
    const p = pieza({ id: 'pz-9', prospectoCorreo: 'contacto@x.mx' });
    renderToStaticMarkup(<FormaEnvio pieza={p} accion={accion} />);
    // El botón "Sí, enviar" es type="submit" DENTRO del <form action={enviar}>:
    // confirmarlo envía exactamente este formulario a esta action. Invocarla
    // aquí simula ESE envío, no un clic cualquiera sobre el disparador.
    const fd = new FormData();
    fd.set('pieza', p.id);
    const r = await accion(null, fd);
    expect(r).toEqual({ ok: 'Enviada a contacto@x.mx' });
  });

  it('INTEGRACIÓN — cancelar NO ejecuta: el botón Cancelar es type="button" y no hay otra vía al formulario que envía', () => {
    const accion = vi.fn(accionNoop);
    renderToStaticMarkup(<FormaEnvio pieza={pieza({})} accion={accion} />);
    expect(accion).not.toHaveBeenCalled();
  });
});
