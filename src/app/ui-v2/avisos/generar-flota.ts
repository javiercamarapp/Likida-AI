// Avisos del panel del cliente: PURO. Convierte las alertas de la flota (`calcularAlertasFlota`, ya filtradas por rol) en `Aviso`.
import type { AlertaFlota } from '@/app/dashboard/calcular-alertas-flota';
import type { Aviso, Categoria } from './modelo';

const CATEGORIA_POR_FUENTE: Record<string, Categoria> = {
  ilegibles: 'sistema_flota',
  conectores: 'conexiones',
  'tareas-asistente': 'operacion',
  'excepciones-conductor': 'operacion',
  escalados: 'operacion',
  huerfanos: 'dinero',
  duplicados: 'dinero',
  'por-revisar': 'dinero',
};

/** La fuente de una alerta es el prefijo de su id (`huerfanos:3` → `huerfanos`). */
export function fuenteDeAlerta(id: string): string {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(0, i);
}

export function avisosDeFlota(alertas: readonly AlertaFlota[]): Aviso[] {
  return alertas.map((a) => {
    const fuente = fuenteDeAlerta(a.id);
    const ciega = fuente === 'ilegibles';
    return {
      clave: `flota:${a.id}`,
      fuente,
      categoria: CATEGORIA_POR_FUENTE[fuente] ?? 'operacion',
      // Lo que no se pudo leer es crítico y no se oculta; `atencion` de la flota = atención; `aviso` = informativo.
      severidad: ciega ? 'critica' : a.tipo === 'atencion' ? 'atencion' : 'info',
      titulo: a.texto, detalle: null, href: a.href, desde: null, silenciable: !ciega,
    } satisfies Aviso;
  });
}
