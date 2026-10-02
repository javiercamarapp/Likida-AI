import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConvenioFila, ViajeConvenioFila } from '@/lib/likida/convenios/repo';
import { VistaConvenios, type PropsVistaConvenios } from './vista';

const accion = async () => null;
const accionEstado = async () => {};
const C = (o: Partial<ConvenioFila> = {}): ConvenioFila => ({
  id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', version: 3, clienteId: 'c1', cliente: 'Cliente Uno', nombre: 'Ruta norte', origen: 'Zapopan', destino: 'Tlaquepaque',
  origenSitioId: null, destinoSitioId: 'g1', sitioOrigenNombre: null, sitioDestinoNombre: 'CEDIS Tlaquepaque', vigenteDesde: null, vigenteHasta: null, notas: null, activo: true,
  instrucciones: [{ categoria: 'puerta', texto: 'Puerta 3, lado poniente', momento: 'ambos', lugar: 'destino', orden: 0 }],
  comercial: undefined, ...o,
});
const props = (p: Partial<PropsVistaConvenios> = {}): PropsVistaConvenios => ({
  sufijo: '', convenios: [C()], estado: 'ok', puedeEditar: true, verDinero: false, puedeExportar: true, accionImportar: accion, accionEstado, ...p,
});
const pintar = (p?: Partial<PropsVistaConvenios>) => renderToStaticMarkup(<VistaConvenios {...props(p)} />);

describe('la pantalla de convenios', () => {
  it('lista cliente, convenio, A→B, sitios y las instrucciones con su planta y su momento', () => {
    const html = pintar();
    expect(html).toContain('Cliente Uno');
    expect(html).toContain('Ruta norte');
    expect(html).toContain('Zapopan → Tlaquepaque');
    expect(html).toContain('CEDIS Tlaquepaque');
    expect(html).toContain('Por dónde entras:');
    expect(html).toContain('Puerta 3, lado poniente');
    expect(html).toContain('planta de descarga, al despachar y al acercarse');
    expect(html).toContain('Texto para pegar en tu sistema');
  });

  it('SIN permiso de dinero no pinta la tarifa (ni la menciona en el texto ni en el importador)', () => {
    const html = pintar({ convenios: [C({ comercial: { modo: 'por_viaje', precio: 5000, moneda: 'MXN', requisitos: ['Factura'] } })], verDinero: false });
    expect(html).not.toMatch(/Tarifa:|5,000|Factura|tarifa_modo|con tarifa|requisitos de cobro/i);
  });

  it('con permiso de dinero muestra tarifa y requisitos de cobro, y el export completo', () => {
    const html = pintar({ convenios: [C({ comercial: { modo: 'por_viaje', precio: 5000, moneda: 'MXN', requisitos: ['Factura', 'Carta porte'] } })], verDinero: true });
    expect(html).toContain('Tarifa:');
    expect(html).toContain('por viaje');
    expect(html).toContain('Para cobrar: Factura, Carta porte');
    expect(html).toContain('tipo=completo');
  });

  it('sin permiso de edición no ofrece importar ni archivar; sin permiso de exportar no ofrece descargas', () => {
    const html = pintar({ puedeEditar: false, puedeExportar: false });
    expect(html).not.toContain('Importar desde CSV o Excel');
    expect(html).not.toContain('Archivar');
    expect(html).not.toContain('/api/export/convenios');
    expect(html).toContain('Solo el dueño de la flota o el jefe de tráfico editan');
  });

  it('un convenio sin instrucciones lo dice (el operador no recibirá nada)', () => {
    expect(pintar({ convenios: [C({ instrucciones: [] })] })).toContain('el operador no recibirá nada de este convenio');
  });

  it('lista vacía, base sin migrar y lectura caída se distinguen (no «sin convenios» mudo)', () => {
    expect(pintar({ convenios: [] })).toContain('Todavía no hay convenios');
    const sin = pintar({ convenios: null, estado: 'no_disponible' });
    expect(sin).toContain('falta aplicar la actualización de la base (0580)');
    expect(sin).not.toContain('Todavía no hay convenios');
    expect(pintar({ convenios: null, estado: 'error' })).toContain('No se pudieron leer los convenios');
  });

  it('declara que el agente solo dice lo que el convenio dice, y arrastra el ?tenant= del superadmin en los links', () => {
    const html = pintar({ sufijo: '?tenant=abc' });
    expect(html).toContain('El agente solo dice lo que el convenio dice');
    expect(html).toContain('tipo=instrucciones&amp;tenant=abc');
  });

  it('un convenio archivado se marca y ofrece reactivarlo', () => {
    const html = pintar({ convenios: [C({ activo: false })] });
    expect(html).toContain('(archivado)');
    expect(html).toContain('Reactivar');
  });
});

describe('la corrección manual del convenio ligado a cada viaje', () => {
  const V = (o: Partial<ViajeConvenioFila> = {}): ViajeConvenioFila => ({
    viajeId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0aa', folio: 'F-1042', origen: 'Zapopan', destino: 'Tlaquepaque', cliente: 'Cliente Uno', operador: 'Juan Pérez',
    convenioId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', convenioNombre: 'Ruta norte', ligadoPor: 'auto', instrucciones: 2, despachoEnviado: true,
    opciones: [{ id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', nombre: 'Ruta norte' }, { id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d002', nombre: 'Ruta sur' }], ...o,
  });
  const con = (viajes: ViajeConvenioFila[] | null, p: Partial<PropsVistaConvenios> = {}) => pintar({ viajes, accionCorregir: accion, ...p });

  it('lista cada viaje con su convenio ligado, quién lo ligó y las opciones del cliente más «sin convenio»', () => {
    const html = con([V()]);
    expect(html).toContain('Convenio ligado a cada viaje en curso');
    expect(html).toContain('F-1042');
    expect(html).toContain('Ligado: «Ruta norte» (automático) · 2 instrucciones · ya enviadas al operador');
    expect(html).toContain('Sin convenio (no mandar instrucciones)');
    expect(html).toContain('Ruta sur');
    expect(html).toContain('Mandar de nuevo las instrucciones al operador');
    expect(html).toContain('Corregir convenio');
  });

  it('distingue la corrección manual, el viaje sin fila ligada (empate o nunca despachado) y el «sin convenio» de la oficina', () => {
    expect(con([V({ ligadoPor: 'manual' })])).toContain('(corrección manual)');
    expect(con([V({ ligadoPor: null, convenioId: null, convenioNombre: null, instrucciones: 0, despachoEnviado: false })])).toContain('Sin convenio ligado todavía');
    expect(con([V({ ligadoPor: 'manual', convenioId: null, convenioNombre: null, instrucciones: 0, despachoEnviado: false })])).toContain('Sin convenio (decisión de la oficina');
  });

  it('sin permiso de edición, sin lista o con la base sin migrar, la sección no se pinta', () => {
    expect(con([V()], { puedeEditar: false })).not.toContain('Convenio ligado a cada viaje en curso');
    expect(con(null)).not.toContain('Convenio ligado a cada viaje en curso');
    expect(con([V()], { estado: 'no_disponible', convenios: null })).not.toContain('Convenio ligado a cada viaje en curso');
    expect(pintar()).not.toContain('Convenio ligado a cada viaje en curso');
  });

  it('sin viajes abiertos lo dice', () => {
    expect(con([])).toContain('No hay viajes abiertos con cliente');
  });
});

describe('el alta y la edición en pantalla', () => {
  const catalogos = { clientes: [{ id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0c1', nombre: 'Cliente Uno' }], sitios: [{ id: 'g1', nombre: 'CEDIS Tlaquepaque', codigo: 'CED-1' }] };
  const con = (p: Partial<PropsVistaConvenios> = {}) => pintar({ catalogos, accionGuardar: accion, ...p });

  it('ofrece «Nuevo convenio» (con cliente y sitios del catálogo) y «Editar» en cada convenio, con su versión escondida', () => {
    const html = con();
    expect(html).toContain('aria-label="Nuevo convenio"');
    expect(html).toContain('Elige un cliente…');
    expect(html).toContain('CEDIS Tlaquepaque (CED-1)');
    expect(html).toContain('Editar convenio e instrucciones');
    expect(html).toContain('name="version" value="3"');
    expect(html).toContain('name="convenioId"');
    expect(html).toContain('Llevar este cambio a los viajes en curso');
    expect(html).toContain('Puerta 3, lado poniente');
    expect(html).toContain('Guardar cambios');
    expect(html).toContain('Crear convenio');
  });

  it('declara que la tarifa NO se edita aquí y no pinta campos de dinero', () => {
    const html = con({ verDinero: true });
    expect(html).toContain('no se editan aquí');
    expect(html).not.toMatch(/name="tarifa|name="requisitos/i);
  });

  it('sin permiso de edición, sin acción o con la lectura caída no hay formularios de edición', () => {
    expect(con({ puedeEditar: false })).not.toContain('Nuevo convenio');
    expect(con({ puedeEditar: false })).not.toContain('Editar convenio e instrucciones');
    expect(pintar()).not.toContain('Nuevo convenio');
    expect(con({ convenios: null, estado: 'error' })).not.toContain('Nuevo convenio');
  });

  it('con la base sin la 0656 (convenios sin versión) la edición se apaga y se dice; importar sigue', () => {
    const html = con({ convenios: [C({ version: null })] });
    expect(html).not.toContain('Editar convenio e instrucciones');
    expect(html).not.toContain('aria-label="Nuevo convenio"');
    expect(html).toContain('falta aplicar la actualización de la base (0656)');
    expect(html).toContain('Importar desde CSV o Excel');
  });

  it('el pie ya no promete que editar nunca toca a los viajes: dice cómo llevarlo a los viajes en curso', () => {
    expect(con()).toContain('salvo que marques «llevar este cambio a los viajes en curso»');
  });
});
