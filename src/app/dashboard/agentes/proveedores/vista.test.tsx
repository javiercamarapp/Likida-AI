import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionBuzon, VistaAgenteProveedores } from './vista';
import type { FacturaProveedor } from '@/lib/likida/proveedores';

// Los controles de subida llaman `useRouter()` (refresh tras guardar) y el
// render estático de prueba no monta el App Router: el doble devuelve lo
// mínimo que esos efectos tocan. Aquí se prueba QUÉ pinta la vista, no la
// navegación de Next.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ═══════════════════════════════════════════════════════════════════════════
// EL GATEO DEL BUZÓN, PROBADO SOBRE EL RENDER (C1, auditoría 4).
//
// Lo que se fija: generar/rotar es CONTROL y el botón solo se pinta al dueño
// (`puedeAdministrar`); los estados degradados dicen la verdad — una lectura
// caída NO se enseña como "sin buzón", y sin RESEND_EMAIL_DOMAIN se dice qué
// falta en vez de armar una dirección que no existe. Mismo patrón que
// `tablero-operacion.test.tsx`: se renderiza el componente REAL.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => null;
const acciones = { generarBuzon: accion, rotarBuzon: accion };
const DIRECCION = 'f-abcdefghjkmnpqrstvwxyz23@mail.likida.ai';

function pintar(p: {
  buzon: { token: string | null; direccion: string | null } | null;
  dominioConfigurado: boolean;
  puedeAdministrarBuzon: boolean;
}) {
  return renderToStaticMarkup(<SeccionBuzon {...p} acciones={acciones} />);
}

describe('SeccionBuzon — estados honestos', () => {
  it('lectura caída: dice que no se pudo leer y NO ofrece generar', () => {
    const html = pintar({ buzon: null, dominioConfigurado: true, puedeAdministrarBuzon: true });
    expect(html).toContain('No se pudo leer el buzón');
    // Ofrecer "Generar" sobre una lectura caída rotaría un buzón vivo sin querer.
    expect(html).not.toContain('Generar dirección');
    expect(html).not.toContain('Rotar');
  });

  it('sin RESEND_EMAIL_DOMAIN: dice QUÉ falta y no pinta botones', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: false, puedeAdministrarBuzon: true,
    });
    expect(html).toContain('RESEND_EMAIL_DOMAIN');
    expect(html).not.toContain('Generar dirección');
  });
});

describe('SeccionBuzon — el gateo por rol', () => {
  it('con buzón y siendo dueño: la dirección completa Y el rotar (con su advertencia antes)', () => {
    const html = pintar({
      buzon: { token: 'abcdefghjkmnpqrstvwxyz23', direccion: DIRECCION },
      dominioConfigurado: true, puedeAdministrarBuzon: true,
    });
    expect(html).toContain(DIRECCION);
    expect(html).toContain('Rotar e invalidar la anterior');
    expect(html).toContain('invalida la actual en el acto');
  });

  it('con buzón sin ser dueño: la dirección se ve (es dato de la flota), rotar NO', () => {
    const html = pintar({
      buzon: { token: 'abcdefghjkmnpqrstvwxyz23', direccion: DIRECCION },
      dominioConfigurado: true, puedeAdministrarBuzon: false,
    });
    expect(html).toContain(DIRECCION);
    expect(html).not.toContain('Rotar');
  });

  it('sin buzón y siendo dueño: el botón de generar', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: true, puedeAdministrarBuzon: true,
    });
    expect(html).toContain('Generar dirección');
  });

  it('sin buzón sin ser dueño: sin botón, y se dice a quién pedírselo', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: true, puedeAdministrarBuzon: false,
    });
    expect(html).not.toContain('Generar dirección');
    expect(html).toContain('dueño de la flota');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA CON LAS COLUMNAS DE LA 0108, probada sobre el render: la marca
// de OCR nunca se calla, el CFDI cancelado grita, «Exportada» solo aparece
// con `exportadaEn`, y el rótulo del export dice "valídalo" en vez de
// afirmar compatibilidad certificada.
// ═══════════════════════════════════════════════════════════════════════════

const BASE: FacturaProveedor = {
  id: 'f1', cfdiUuid: 'AAAA-BBBB', emisorRfc: 'TAL010101AB1', emisorNombre: null,
  receptorRfc: 'FLO010101AB1', receptorEsFlota: true, fecha: '2026-08-10',
  subTotal: 2300, iva: 368, total: 2668, descripcion: 'CAMBIO DE LLANTA',
  conceptos: 1, estado: 'pendiente', decididoPor: null, decididoEn: null,
  creadoEn: '2026-08-14T16:00:00Z',
  origen: 'correo', ocrConfianza: null, estadoSat: 'vigente', exportadaEn: null,
};

function pintarVista(facturas: FacturaProveedor[]) {
  return renderToStaticMarkup(
    <VistaAgenteProveedores
      facturas={facturas}
      rfcFlota="FLO010101AB1"
      sufijo=""
      acciones={{ subirFactura: accion, subirFoto: accion, decidir: accion, generarBuzon: accion, rotarBuzon: accion }}
      buzon={{ token: null, direccion: null }}
      dominioConfigurado={false}
      puedeAdministrarBuzon={false}
    />,
  );
}

describe('VistaAgenteProveedores — lo nuevo de la 0108 se dice', () => {
  it('una factura de FOTO lleva su marca de OCR con la confianza — nunca pasa por dato duro', () => {
    const html = pintarVista([{ ...BASE, id: 'foto', cfdiUuid: 'CCCC-DDDD', origen: 'subida', ocrConfianza: 0.62 }]);
    expect(html).toContain('leída de foto (OCR 0.62)');
    expect(html).toContain('revisa contra el papel');
    expect(html).toContain('subida a mano');
  });

  it('un CFDI CANCELADO ante el SAT grita; uno vigente lo dice en calma', () => {
    const html = pintarVista([{ ...BASE, estadoSat: 'cancelado' }]);
    expect(html).toContain('CANCELADO ante el SAT');
    expect(pintarVista([BASE])).toContain('vigente ante el SAT');
  });

  it('una fila pre-0108 dice «SAT sin consultar», no finge que se consultó', () => {
    expect(pintarVista([{ ...BASE, estadoSat: null, origen: null }])).toContain('SAT sin consultar');
  });

  it('«Exportada» SOLO con exportadaEn; una aprobada sin exportar sigue siendo «Aprobada»', () => {
    const aprobada = { ...BASE, estado: 'aprobada' as const, decididoPor: 'ana', decididoEn: '2026-08-14T17:00:00Z' };
    expect(pintarVista([aprobada])).toContain('Aprobada');
    expect(pintarVista([aprobada])).not.toContain('Exportada');
    expect(pintarVista([{ ...aprobada, exportadaEn: '2026-08-14T18:00:00Z' }])).toContain('Exportada');
  });

  it('con aprobadas: los DOS botones de export y el rótulo que manda a validar el layout', () => {
    const html = pintarVista([{ ...BASE, estado: 'aprobada', decididoPor: 'ana', decididoEn: '2026-08-14T17:00:00Z' }]);
    expect(html).toContain('Exportar aprobadas (CSV SAP B1)');
    expect(html).toContain('Exportar aprobadas (CSV CONTPAQi)');
    expect(html).toContain('formato=sap_b1');
    expect(html).toContain('formato=contpaqi');
    expect(html).toContain('valídalo con tu contador');
    // La honestidad del escalón 3: la escritura directa NO se afirma.
    expect(html).toContain('no la promete');
  });

  it('sin facturas: estado vacío honesto, sin botones de export', () => {
    const html = pintarVista([]);
    expect(html).toContain('Aún no hay facturas de proveedor');
    expect(html).not.toContain('Exportar aprobadas');
  });
});
