import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionEntrega, SeccionRecepcion } from './seccion_buzon';
import { VistaAgenteProveedores } from './vista';
import type { Entrega } from '@/lib/likida/buzon/entrega_repo';
import type { Recepcion, ConteoBuzon } from '@/lib/likida/buzon/repo';
import { CONFIG_ENTREGA_DEFAULT, type ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import type { FacturaProveedor } from '@/lib/likida/proveedores';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ═══════════════════════════════════════════════════════════════════════════
// El render REAL de las dos secciones del buzón (Agente 9): sin botones muertos (cada acción que se promete
// existe en el estado en que se promete), estados degradados que dicen la verdad, y el gateo por rol.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => null;
const A = { guardar: accion, enviar: accion, reintentar: accion, cancelar: accion };
const CFG: ConfigEntrega = { ...CONFIG_ENTREGA_DEFAULT, activo: true, destinatarios: ['conta@x.mx'] };
const lote = (extra: Partial<Entrega> = {}): Entrega => ({
  id: 'L1', tenantId: 't', creadoEn: '2026-10-02T14:00:00Z', creadoPor: 'ana', disparo: 'manual', estado: 'enviada', formato: 'sap_b1', incluyeZip: true,
  destinatarios: ['conta@x.mx'], nFacturas: 3, total: 3480, intentos: 1, proximoIntentoEn: '2026-10-02T14:00:00Z', leaseHasta: null, resendId: 're_1',
  enviadaEn: '2026-10-02T14:00:10Z', entregadaEn: null, error: null, ...extra,
});
const entrega = (p: Partial<Parameters<typeof SeccionEntrega>[0]> = {}) => renderToStaticMarkup(
  <SeccionEntrega config={CFG} disponible lotes={[]} sinEntregar={0} puedeAdministrar acciones={A} {...p} />,
);

describe('SeccionEntrega', () => {
  it('config caída: lo dice, no pinta una configuración inventada ni botones', () => {
    const html = entrega({ config: null });
    expect(html).toContain('No se pudo leer la configuración');
    expect(html).not.toContain('<form');
  });

  it('base sin la 0531: dice qué falta en vez de ofrecer un formulario que no puede guardar', () => {
    const html = entrega({ disponible: false });
    expect(html).toContain('migración 0531');
    expect(html).not.toContain('<form');
  });

  it('el dueño ve el formulario de configuración; quien no administra solo lee el resumen (el gateo real vive en la action)', () => {
    expect(entrega()).toContain('Correo(s) del contador');
    const lector = entrega({ puedeAdministrar: false });
    expect(lector).not.toContain('Correo(s) del contador');
    expect(lector).toContain('conta@x.mx');
  });

  it('«Enviar ahora» aparece SOLO si está activa y hay aprobadas sin entregar, con el conteo real', () => {
    expect(entrega({ sinEntregar: 4 })).toContain('Enviar ahora (4)');
    expect(entrega({ sinEntregar: 0 })).not.toContain('Enviar ahora (');
    expect(entrega({ sinEntregar: 0 })).toContain('No hay aprobadas pendientes');
    expect(entrega({ config: { ...CFG, activo: false }, sinEntregar: 4 })).not.toContain('Enviar ahora (');
    expect(entrega({ sinEntregar: null })).toContain('No se pudo contar');
  });

  it('historial: una enviada se rotula «sin confirmar» (no «entregada») y no ofrece acciones', () => {
    const html = entrega({ lotes: [lote()] });
    expect(html).toContain('Enviada · sin confirmar');
    expect(html).not.toContain('Reintentar');
    expect(html).not.toContain('Cancelar');
  });

  it('una FALLIDA muestra el motivo y SÍ ofrece reintentar y cancelar; una en cola solo cancelar', () => {
    const fallida = entrega({ lotes: [lote({ estado: 'fallida', error: 'Resend rechazó el envío: HTTP 422' })] });
    expect(fallida).toContain('HTTP 422');
    expect(fallida).toContain('Reintentar');
    expect(fallida).toContain('Cancelar');
    const cola = entrega({ lotes: [lote({ estado: 'pendiente', intentos: 2 })] });
    expect(cola).toContain('intento 2, reintenta solo');
    expect(cola).not.toContain('Reintentar');
    expect(cola).toContain('Cancelar');
  });

  it('un rebote dice qué hacer (corregir la dirección) y que las facturas volvieron a la cola', () => {
    const html = entrega({ lotes: [lote({ estado: 'rebotada' })] });
    expect(html).toContain('Rebotó');
    expect(html).toContain('volvieron a la cola');
  });

  it('sin permiso de control, las acciones de lote no se pintan', () => {
    expect(entrega({ puedeAdministrar: false, lotes: [lote({ estado: 'fallida', error: 'x' })] })).not.toContain('Reintentar');
  });

  it('historial caído se dice; vacío se dice distinto', () => {
    expect(entrega({ lotes: null })).toContain('No se pudo leer el historial');
    expect(entrega({ lotes: [] })).toContain('Aún no se ha enviado ningún lote');
  });
});

const rec = (extra: Partial<Recepcion> = {}): Recepcion => ({
  id: 'r1', nombre: 'factura.pdf', zipOrigen: null, tipo: 'pdf', bytes: 2048, sha256: 'a'.repeat(64), estado: 'revision', motivo: 'lectura de PDF de baja confianza (0.55)',
  cfdiUuid: null, facturaId: null, confianza: 0.55, storageRuta: 't/a.pdf', recibidoEn: '2026-10-02T14:00:00Z', decididoPor: null, decididoEn: null, ...extra,
});
const CONTEO: ConteoBuzon = { porEstado: { procesada: 5, duplicada: 1, revision: 1, descartada: 0, ignorada: 0, rechazada: 2, error: 0 }, total: 9, ultimaRecepcionEn: null, facturasPorRevisar: 3 };
const recepcion = (r: Recepcion[] | null, c: ConteoBuzon | null = CONTEO) => renderToStaticMarkup(
  <SeccionRecepcion recepciones={r} conteo={c} acciones={{ descartar: accion, verPdf: accion }} />,
);

describe('SeccionRecepcion', () => {
  it('lectura caída ≠ vacío', () => {
    expect(recepcion(null)).toContain('No se pudo leer lo recibido');
    expect(recepcion([])).toContain('Todavía no llega ningún archivo');
  });

  it('en revisión: motivo, «Ver PDF» (hay PDF guardado) y «Descartar»; el resumen cuenta lo que espera cotejo y lo rechazado', () => {
    const html = recepcion([rec()]);
    expect(html).toContain('Revísala');
    expect(html).toContain('baja confianza');
    expect(html).toContain('Ver PDF');
    expect(html).toContain('Descartar');
    expect(html).toContain('3 factura(s) leída(s) de PDF esperan tu cotejo');
    expect(html).toContain('2 rechazados por seguridad');
  });

  it('un archivo que ya es factura no se puede descartar; uno sin PDF guardado no ofrece «Ver PDF»', () => {
    const html = recepcion([rec({ facturaId: 'f1', storageRuta: null })]);
    expect(html).not.toContain('Descartar');
    expect(html).not.toContain('Ver PDF');
  });

  it('un zip rechazado muestra el motivo de seguridad, sin botones', () => {
    const html = recepcion([rec({ tipo: 'zip', estado: 'rechazada', motivo: 'zip rechazado por seguridad: bomba', storageRuta: null })]);
    expect(html).toContain('Rechazada por seguridad');
    expect(html).toContain('bomba');
    expect(html).not.toContain('Descartar');
  });

  it('el archivo de un zip dice de cuál venía', () => {
    expect(recepcion([rec({ zipOrigen: 'lote.zip', estado: 'procesada', storageRuta: null })])).toContain('dentro de lote.zip');
  });
});

describe('la bandeja con las marcas del buzón', () => {
  const F: FacturaProveedor = {
    id: 'f1', cfdiUuid: 'U1', emisorRfc: 'AAA010101AAA', emisorNombre: null, receptorRfc: 'BBB010101BBB', receptorEsFlota: true, fecha: '2026-09-30',
    subTotal: 1000, iva: null, total: 1160, descripcion: null, conceptos: 1, estado: 'pendiente', decididoPor: null, decididoEn: null,
    creadoEn: '2026-10-01T10:00:00Z', origen: 'correo', ocrConfianza: 0.55, estadoSat: 'pendiente', exportadaEn: null,
    requiereRevision: true, revisionMotivo: 'lectura de PDF con confianza 0.55 (umbral 0.8)', fuenteDatos: 'pdf_vision', tienePdf: true, entregaId: null, entregadaEn: null,
  };
  const pintar = (f: FacturaProveedor, verPdf = true) => renderToStaticMarkup(
    <VistaAgenteProveedores facturas={[f]} rfcFlota="BBB010101BBB" sufijo=""
      acciones={{ subirFactura: accion, subirFoto: accion, decidir: accion, generarBuzon: accion, rotarBuzon: accion, ...(verPdf ? { verPdf: accion } : {}) }}
      buzon={{ token: null, direccion: null }} dominioConfigurado={false} puedeAdministrarBuzon={false} />,
  );

  it('una lectura de PDF de baja confianza grita su motivo, dice «leída de PDF» y ofrece ver el PDF', () => {
    const html = pintar(F);
    expect(html).toContain('lectura de PDF con confianza 0.55');
    expect(html).toContain('leída de PDF (OCR 0.55)');
    expect(html).toContain('Ver PDF');
  });

  it('sin la acción de PDF no se pinta un botón muerto', () => {
    expect(pintar(F, false)).not.toContain('Ver PDF');
  });

  it('una aprobada ya entregada al contador lo dice en su rótulo', () => {
    expect(pintar({ ...F, estado: 'aprobada', requiereRevision: false, revisionMotivo: null, entregadaEn: '2026-10-02T14:00:00Z' })).toContain('Entregada al contador');
  });
});
