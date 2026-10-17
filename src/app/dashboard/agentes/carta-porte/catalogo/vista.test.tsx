import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { FILAS_VISIBLES, FRASE_SIN_CATALOGO, VistaCatalogo, type AccionesCatalogo, type CatalogoVista, type ClienteVista } from './vista';

const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const C2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const CLIENTES: ClienteVista[] = [{ id: C1, nombre: 'Cliente Uno Ejemplo' }, { id: C2, nombre: 'Cliente Dos Ejemplo' }];
const ACCIONES: AccionesCatalogo = { guardarFila: async () => null, importar: async () => null };
const VACIO: CatalogoVista = { numero: null, productos: [], partes: [], truncado: false };

const producto = (n: number) => ({
  sku: `SKU-${n}`, descripcion_patron: null, bienes_transp: '25172500', clave_unidad: 'H87', embalaje: '1A', fraccion: null, tipo_materia: null,
  material_peligroso: false, clave_material_peligroso: null,
});
const CON_DATOS: CatalogoVista = {
  numero: { numero_interno: '10001', numero_pagador: null, activo: true },
  productos: [producto(1), producto(2)],
  partes: [{ rol: 'remitente', alias: 'Planta Norte Ejemplo', razon_social: 'Planta Norte Ejemplo SA', rfc: 'XAXX010101000', cp: '66600', municipio: null, estado: 'NLE' }], // grep-limpio:ok
  truncado: false,
};

const pintar = (over: Partial<Parameters<typeof VistaCatalogo>[0]> = {}) =>
  renderToStaticMarkup(<VistaCatalogo clientes={CLIENTES} clienteId={C1} catalogo={VACIO} acciones={ACCIONES} {...over} />);

describe('Pantalla «Catálogo del cliente»', () => {
  it('estado vacío: dice qué hacer (importar un CSV o guardar desde un documento) y no inventa filas', () => {
    const html = pintar();
    expect(html).toContain('Catálogo del cliente');
    expect(html).toContain(FRASE_SIN_CATALOGO);
    expect(html).toContain('Aún no hay catálogo para este cliente: importa un CSV o guarda desde un documento.');
    expect(html).not.toMatch(/>SKU-\d/); // la fila de ejemplo de las plantillas viaja en un data: URI, no como fila del catálogo
  });

  it('ofrece las tres plantillas CSV para descargar y la importación con vista previa y confirmación', () => {
    const html = pintar();
    expect(html).toContain('download="plantilla-productos.csv"');
    expect(html).toContain('download="plantilla-remitentes-destinatarios.csv"');
    expect(html).toContain('download="plantilla-cliente-numero.csv"');
    expect((html.match(/href="data:text\/csv;charset=utf-8,/g) ?? []).length).toBe(3);
    expect(html).toContain('Ver vista previa');
    expect(html).toContain('Confirmar e importar');
    expect(html).toContain('nada se guarda hasta que confirmes');
  });

  it('con datos pinta productos, remitentes/destinatarios y el número interno, y cada fila se edita con la clave bloqueada', () => {
    const html = pintar({ catalogo: CON_DATOS });
    expect(html).not.toContain(FRASE_SIN_CATALOGO);
    expect(html).toContain('SKU-1');
    expect(html).toContain('SKU-2');
    expect(html).toContain('Planta Norte Ejemplo');
    expect(html).toContain('XAXX010101000'); // grep-limpio:ok
    expect(html).toContain('10001');
    expect(html).toContain('Productos');
    expect(html).toContain('Remitentes y destinatarios');
    expect(html).toContain('Filtrar');
    // La edición lleva el cliente y la clave natural en solo lectura.
    expect(html).toContain(`name="cliente_id" value="${C1}"`);
    expect(html).toContain('name="modo" value="editar"');
    expect(html).toMatch(/name="c_sku"[^>]*readOnly=""|readOnly=""[^>]*name="c_sku"/);
    expect(html).toContain('Guardar cambios');
    expect(html).toContain('Agregar una fila');
    expect(html).toContain('name="modo" value="nuevo"');
  });

  it('sin número interno lo avisa en claro (el agente no lo inventa)', () => {
    const html = pintar({ catalogo: { ...CON_DATOS, numero: null } });
    expect(html).toContain('Este cliente todavía no tiene número interno.');
  });

  it('muestra como máximo FILAS_VISIBLES filas por tabla y dice cuántas hay', () => {
    const muchos = Array.from({ length: FILAS_VISIBLES + 30 }, (_, i) => producto(i + 1));
    const html = pintar({ catalogo: { ...CON_DATOS, productos: muchos } });
    expect(html).toContain(`Se muestran ${FILAS_VISIBLES} de ${FILAS_VISIBLES + 30} filas`);
    expect(html).toContain(`SKU-${FILAS_VISIBLES}<`);
    expect(html).not.toContain(`SKU-${FILAS_VISIBLES + 30}<`);
  });

  it('sin cliente elegido pide elegir uno; sin clientes lo dice; con lectura caída no finge «sin catálogo»', () => {
    expect(pintar({ clienteId: null, catalogo: null })).toContain('Elige un cliente para ver y editar su catálogo.');
    const sinClientes = pintar({ clientes: [], clienteId: null, catalogo: null });
    expect(sinClientes).toContain('Aún no hay clientes en tu flota');
    const caida = pintar({ catalogo: null, lecturaFallida: true });
    expect(caida).toContain('No se pudo leer el catálogo de Cliente Uno Ejemplo');
    expect(caida).not.toContain(FRASE_SIN_CATALOGO);
  });

  it('avisa cuando el catálogo se leyó incompleto (tope de filas)', () => {
    expect(pintar({ catalogo: { ...CON_DATOS, truncado: true } })).toContain('solo se leyó una parte');
  });

  it('los clientes son ligas que conservan el «ver como» del superadmin, y el elegido se marca', () => {
    const html = pintar({ sufijo: '?tenant=t1', ver: { tenant: 't1' } });
    expect(html).toContain(`/dashboard/agentes/carta-porte/catalogo?tenant=t1&amp;cliente=${C2}`);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/dashboard/agentes/carta-porte?tenant=t1"');
    // Las formas de edición y la importación reenvían el «ver como»: la acción lo valida contra la sesión.
    expect(html).toContain('name="tenant" value="t1"');
  });
});
