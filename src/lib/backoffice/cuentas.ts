// Plan de cuentas SaaS PROPUESTO del libro contable de Likida (espejo de la semilla de la migración 1014). PURO.
// «Propuesta; el contador lo define»: no es el catálogo oficial del SAT ni un layout de CONTPAQi. Un test compara esta lista con la
// semilla del SQL para que las dos no se separen.

export type TipoCuenta = 'A' | 'P' | 'K' | 'I' | 'C' | 'G';
export type Naturaleza = 'D' | 'A';

export interface Cuenta {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  activa: boolean;
  /** true mientras el contador no la haya revisado (todas, hoy). */
  propuesta: boolean;
  nota?: string | null;
}

export const ROTULO_PLAN_PROPUESTO = 'Propuesta; el contador lo define';

const c = (codigo: string, nombre: string, tipo: TipoCuenta, naturaleza: Naturaleza, activa = true): Cuenta =>
  ({ codigo, nombre, tipo, naturaleza, activa, propuesta: true });

export const CUENTAS_PROPUESTAS: readonly Cuenta[] = [
  c('1110', 'Bancos', 'A', 'D'),
  c('1120', 'Saldos en el procesador de pagos', 'A', 'D'),
  c('1210', 'Clientes por cobrar', 'A', 'D'),
  c('1410', 'IVA acreditable', 'A', 'D'),
  c('1420', 'Anticipos a proveedores', 'A', 'D', false),
  c('2110', 'Proveedores por pagar', 'P', 'A'),
  c('2120', 'Comisiones por pagar a vendedores', 'P', 'A'),
  c('2130', 'Honorarios por pagar a contratistas', 'P', 'A'),
  c('2210', 'IVA trasladado por pagar', 'P', 'A'),
  c('2230', 'ISR por pagar', 'P', 'A'),
  c('2310', 'Ingresos diferidos', 'P', 'A'),
  c('3110', 'Capital social', 'K', 'A'),
  c('3210', 'Resultados de ejercicios anteriores', 'K', 'A'),
  c('4100', 'Ingresos por suscripción SaaS', 'I', 'A'),
  c('4200', 'Otros ingresos', 'I', 'A'),
  c('4210', 'Devoluciones y bonificaciones sobre ingresos', 'I', 'D'),
  c('5100', 'Costos de nube e infraestructura', 'C', 'D'),
  c('5200', 'Costos de IA y modelos', 'C', 'D'),
  c('5300', 'Costos de mensajería y WhatsApp', 'C', 'D'),
  c('6110', 'Software y suscripciones', 'G', 'D'),
  c('6120', 'Dominios y correo', 'G', 'D'),
  c('6130', 'Servicios legales y de firma electrónica', 'G', 'D'),
  c('6140', 'Comisiones de venta', 'G', 'D'),
  c('6150', 'Honorarios de contratistas', 'G', 'D'),
  c('6160', 'Comisiones bancarias y del procesador de pagos', 'G', 'D'),
  c('6290', 'Otros gastos de administración', 'G', 'D'),
  c('7100', 'Pérdida cambiaria', 'G', 'D', false),
  c('7200', 'Ganancia cambiaria', 'I', 'A', false),
  c('7900', 'Ajuste por redondeo', 'G', 'D'),
  c('8100', 'ISR del ejercicio', 'G', 'D', false),
];

const CODIGO = /^[0-9]{4}$/;

/** PURA. ¿Es un código de cuenta bien formado (cuatro dígitos)? No dice si existe. */
export function esCodigoCuenta(codigo: string): boolean {
  return CODIGO.test(codigo);
}

/** PURA. La naturaleza que corresponde a un tipo de cuenta (A, C y G son deudoras; P, K e I acreedoras) — la regla general. */
export function naturalezaUsual(tipo: TipoCuenta): Naturaleza {
  return tipo === 'A' || tipo === 'C' || tipo === 'G' ? 'D' : 'A';
}

/** PURA. Índice por código. */
export function indexarCuentas(cuentas: readonly Cuenta[]): Map<string, Cuenta> {
  return new Map(cuentas.map((x) => [x.codigo, x]));
}

/** PURA. Rótulo corto para tablas: «1110 · Bancos». */
export function rotuloCuenta(cuenta: Pick<Cuenta, 'codigo' | 'nombre'>): string {
  return `${cuenta.codigo} · ${cuenta.nombre}`;
}
