// ═══════════════════════════════════════════════════════════════════════════
// PARES documento de entrada ↔ segundo documento del mismo embarque (T-A3-56) — fixtures SINTÉTICOS.
//
// Siete pares con la FORMA de los que mandó el cliente (análisis 17 §1.4): cuatro cuadran (✔ o ◐) y tres no (✗). Todos
// los valores (piezas, kilos, cajas, fracciones, pedimentos, nombres) están inventados; ninguno sale de una muestra real.
// El repo es público.
// ═══════════════════════════════════════════════════════════════════════════

import { cv } from '../documentos_sinteticos.fixture';
import type { Extraccion } from '../campos';
import { metadatosNombre } from '../nombre_archivo';
import type { FuenteEmbarque, Marca } from '../verificacion_cruzada';

interface RenglonSintetico { cantidad: string; peso: string; fraccion?: string; pedimento?: string }

function extraccion(r: RenglonSintetico[], caja?: string): Extraccion {
  return {
    campos: caja ? { caja_numero: cv(caja, 0.95, 'llm', caja) } : {},
    mercancias: r.map((x) => ({
      cantidad: cv(x.cantidad, 0.95, 'llm', x.cantidad),
      peso_kg: cv(x.peso, 0.95, 'llm', x.peso),
      ...(x.fraccion ? { fraccion_arancelaria: cv(x.fraccion, 0.95, 'llm', x.fraccion) } : {}),
      ...(x.pedimento ? { pedimento: cv(x.pedimento, 0.95, 'llm', x.pedimento) } : {}),
    })),
  };
}

const fuente = (etiqueta: string, r: RenglonSintetico[], caja?: string, nombreArchivo?: string): FuenteEmbarque => ({
  etiqueta, extraccion: extraccion(r, caja), nombre: nombreArchivo ? metadatosNombre(nombreArchivo) : null,
});

export interface ParSintetico {
  id: string;
  forma: string;
  documento: FuenteEmbarque;
  libro: FuenteEmbarque;
  /** Lo que el análisis dice de la forma de este par. */
  esperado: Marca;
  /** Dimensiones que deben salir distintas (vacío si cuadra). */
  diferencias: string[];
}

export const PARES: ReadonlyArray<ParSintetico> = [
  {
    id: 'P1', forma: 'remisión escaneada ↔ libro: cantidades y pesos iguales (14 de 14), libro con una sola clave',
    documento: fuente('la remisión', [{ cantidad: '40', peso: '1200.5' }, { cantidad: '25', peso: '800' }, { cantidad: '12', peso: '310.25' }], 'ABCD123456', 'CCP Acme-Zeta EXPO ABCD123456 03-10-26.pdf'),
    libro: fuente('el libro de Excel', [{ cantidad: '77', peso: '2310.75' }], 'ABCD123456'),
    esperado: '✔', diferencias: [],
  },
  {
    id: 'P2', forma: 'BOL en libras ↔ libro: peso con coma de miles y fracción genérica en el libro',
    documento: fuente('el BOL', [{ cantidad: '18', peso: '6577.99', fraccion: '8708.99.99' }], 'WXYZ654321'),
    libro: fuente('el libro de Excel', [{ cantidad: '18', peso: '6,577.99', fraccion: '9801.00.01' }], 'WXYZ654321'),
    esperado: '◐', diferencias: ['fraccion'],
  },
  {
    id: 'P3', forma: 'correo en tabla ↔ libro: peso, cantidad, fracción y pedimento iguales',
    documento: fuente('el correo', [{ cantidad: '52', peso: '1275.36', fraccion: '3926.90.99', pedimento: '26 24 1234 1234567' }], 'LMNO111222'),
    libro: fuente('el libro de Excel', [{ cantidad: '52', peso: '1275.36', fraccion: '39269099', pedimento: '26241234 1234567' }], 'LMNO111222'),
    esperado: '✔', diferencias: [],
  },
  {
    id: 'P4', forma: 'captura cortada ↔ libro: todo igual salvo la caja (el nombre del libro trae otra)',
    documento: fuente('la captura', [{ cantidad: '30', peso: '905' }], 'QRST333444'),
    libro: fuente('el libro de Excel', [{ cantidad: '30', peso: '905' }], undefined, 'CCP Acme-Beta IMPO QRST333999 05-10-26 (1).xlsx'),
    esperado: '◐', diferencias: ['caja'],
  },
  {
    id: 'P5', forma: 'correo «Datos para CP» ↔ libro: piezas, peso y fracción distintos con el mismo remitente',
    documento: fuente('el correo', [{ cantidad: '64', peso: '2100', fraccion: '4011.10.01' }], 'UVWX555666'),
    libro: fuente('el libro de Excel', [{ cantidad: '48', peso: '1580', fraccion: '4011.20.05' }], 'UVWX555666'),
    esperado: '✗', diferencias: ['piezas', 'peso', 'fraccion'],
  },
  {
    id: 'P6', forma: 'orden de agente aduanal ↔ libro: cantidad, peso, caja, pedimento distintos',
    documento: fuente('la orden', [{ cantidad: '10', peso: '700', pedimento: '26 24 4321 7654321' }], 'YZAB777888'),
    libro: fuente('el libro de Excel', [{ cantidad: '14', peso: '950', pedimento: '26 24 4321 1112223' }], 'YZAB000111'),
    esperado: '✗', diferencias: ['piezas', 'peso', 'pedimento', 'caja'],
  },
  {
    id: 'P7', forma: 'JSON de plataforma ↔ libro: mismo remitente y producto, otro embarque (piezas, kg, fracción)',
    documento: fuente('el JSON de la plataforma', [{ cantidad: '120', peso: '3400', fraccion: '7326.90.99' }], 'CDEF999000'),
    libro: fuente('el libro de Excel', [{ cantidad: '90', peso: '2550', fraccion: '7326.90.98' }], 'CDEF999000'),
    esperado: '✗', diferencias: ['piezas', 'peso', 'fraccion'],
  },
];
