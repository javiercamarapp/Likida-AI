import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PiezaEnCola, CorreoSuprimido } from '@/lib/likida/agentes/cola';
import { RebotesYBajas } from './rebotes';

// ═══════════════════════════════════════════════════════════════════════════
// LOS REBOTES, RENDERIZADOS (agosto-2026).
//
// La regresión que esto fija es de ausencia: el webhook de Resend (0124)
// escribía `entrega_estado` y llenaba `correo_suprimido` (0217) desde hacía
// meses, y NINGÚN `.tsx` los pintaba. Lo que se prueba es lo que la pantalla
// no puede permitirse decir mal:
//   · rebote y queja de spam se distinguen (pesan distinto);
//   · «no se pudo leer» NUNCA se pinta como «no hay rebotes»;
//   · la lista de bajas enseña el MOTIVO y no ofrece reactivar a nadie.
// ═══════════════════════════════════════════════════════════════════════════

function pieza(p: Partial<PiezaEnCola>): PiezaEnCola {
  return {
    id: 'p-1', tipo: 'correo_frio', prioridad: 'normal', agente: 'sdr',
    tenantId: null, prospectoId: null, prospectoEmpresa: null, prospectoCorreo: null,
    titulo: 'Correo día 0', cuerpo: 'x', fuentes: null, estado: 'aprobado',
    cuerpoFinal: null, motivoRechazo: null, enviadoEn: '2026-08-20T00:00:00Z',
    providerMessageId: 're_1', envioError: null,
    entregaEstado: 'rebotado', entregaEventoEn: '2026-08-21T18:00:00Z',
    resueltoPorEmail: null, creadoEn: '2026-08-19T00:00:00Z',
    ...p,
  } as PiezaEnCola;
}

const BAJA: CorreoSuprimido = {
  correo: 'quien@flota.mx',
  motivo: 'queja de spam (webhook Resend)',
  creadoEn: '2026-08-21T18:00:00Z',
};

describe('RebotesYBajas — lo que el operador tenía que poder ver y no veía', () => {
  it('distingue rebote de queja de spam: no son la misma noticia', () => {
    const html = renderToStaticMarkup(
      <RebotesYBajas
        rebotes={[
          pieza({ id: 'p-1', entregaEstado: 'rebotado', prospectoCorreo: 'muerta@flota.mx' }),
          pieza({ id: 'p-2', entregaEstado: 'queja', prospectoCorreo: 'molesto@flota.mx' }),
        ]}
        suprimidos={[]}
      />,
    );
    expect(html).toContain('Rebotó');
    expect(html).toContain('Queja de spam');
    expect(html).toContain('muerta@flota.mx');
    expect(html).toContain('molesto@flota.mx');
  });

  it('«no se pudo leer» NO se pinta como «no hay rebotes»', () => {
    const html = renderToStaticMarkup(<RebotesYBajas rebotes={null} suprimidos={null} />);
    expect(html).toContain('NO significa que no haya');
    expect(html).not.toContain('Ninguna pieza enviada ha rebotado');
    // Y la lista de bajas caída dice que el enviador la consulta aparte y
    // falla cerrado: un fallo de esta pantalla no manda correo de más.
    expect(html).toContain('No se pudo leer la lista de bajas');
  });

  it('sin rebotes lo dice sin prometer que todo llegó', () => {
    const html = renderToStaticMarkup(<RebotesYBajas rebotes={[]} suprimidos={[]} />);
    expect(html).toContain('Ninguna pieza enviada ha rebotado');
    expect(html).toContain('sin envíos, esto no dice nada todavía');
  });

  it('la lista de bajas enseña el motivo y NO ofrece reactivar a nadie', () => {
    const html = renderToStaticMarkup(<RebotesYBajas rebotes={[]} suprimidos={[BAJA]} />);
    expect(html).toContain('quien@flota.mx');
    expect(html).toContain('queja de spam (webhook Resend)');
    expect(html).toContain('suprimir es para siempre');
    expect(html).not.toContain('Reactivar');
  });
});
