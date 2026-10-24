// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/liquidaciones-externas/contactos — carga de los correos de los operadores y de sus coordinadores (A37-A1-01).
//
// Sin esta puerta nadie podía cargar los correos: `aplicarContactos` existía sin llamador y cada desglose abría
// `operador_sin_correo` / `coordinador_sin_correo` (corregirlo exigía SQL). Es el MISMO import del CSV de contactos
// (`contactos_csv.ts`), con la misma validación, en JSON:
//
//   { "contactos": [ { "numeroEmpleado": "E-0001", "correo": "op@ejemplo.test",
//                      "coordinadorNombre": "Nombre", "coordinadorCorreo": "coord@ejemplo.test" } ] }   (1 a 500)
//
// Reglas (las de `contactos_csv.ts`): el operador se busca por `numeroEmpleado` y NUNCA se crea; solo se tocan `correo` y
// `coordinador_id` (jamás `telefono`); una celda vacía no borra lo que ya había; es IDEMPOTENTE (re-enviar lo mismo da
// «sin cambios»). La respuesta nunca repite un correo: habla de «fila N» y del motivo.
//
// Área `administracion`. La flota sale SIEMPRE de la credencial, nunca del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi } from '../../_comun';
import { leerCuerpo, traducirFalla } from '../../_escritura';
import { aplicarContactos, interpretarContactos, resumenContactos, ENCABEZADOS_CONTACTOS } from '@/lib/likida/liquidacion_externa/contactos_csv';
import { puertoContactosReal } from '@/lib/likida/liquidacion_externa/repo_correo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_CONTACTOS = 500;
const MAX_CUERPO_CONTACTOS_BYTES = 400_000;
const CAMPOS = ['numeroEmpleado', 'correo', 'coordinadorNombre', 'coordinadorCorreo'] as const;

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req, MAX_CUERPO_CONTACTOS_BYTES);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const otros = Object.keys(cuerpo.cuerpo).filter((k) => k !== 'contactos');
  if (otros.length > 0) {
    return errorApi('parametro_invalido', `El cuerpo trae campos que el contrato no tiene: ${otros.map((s) => `\`${s}\``).join(', ')}.`);
  }
  const crudos = cuerpo.cuerpo.contactos;
  if (!Array.isArray(crudos) || crudos.length === 0) return errorApi('parametro_invalido', '`contactos` tiene que ser una lista con al menos un contacto.');
  if (crudos.length > MAX_CONTACTOS) {
    return errorApi('parametro_invalido', `Máximo ${MAX_CONTACTOS} contactos por petición (mandaste ${crudos.length}); manda el resto en otra petición.`);
  }

  const filas: string[][] = [];
  for (let i = 0; i < crudos.length; i++) {
    const c = crudos[i];
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return errorApi('parametro_invalido', `contactos[${i}]: tiene que ser un objeto.`);
    const o = c as Record<string, unknown>;
    const desconocidos = Object.keys(o).filter((k) => !(CAMPOS as readonly string[]).includes(k));
    if (desconocidos.length > 0) return errorApi('parametro_invalido', `contactos[${i}]: campos desconocidos (${desconocidos.map((s) => `\`${s}\``).join(', ')}).`);
    const fila: string[] = [];
    for (const k of CAMPOS) {
      const v = o[k];
      if (v !== undefined && v !== null && typeof v !== 'string') return errorApi('parametro_invalido', `contactos[${i}].${k}: tiene que ser texto.`);
      fila.push(typeof v === 'string' ? v : '');
    }
    filas.push(fila);
  }

  // La misma lectura y validación del CSV: encabezados canónicos + filas.
  const lectura = interpretarContactos([[...ENCABEZADOS_CONTACTOS], ...filas]);
  if (lectura.error && lectura.filas.length === 0) return errorApi('parametro_invalido', lectura.error);

  try {
    const informe = await aplicarContactos(lectura, puertoContactosReal(acceso.tenantId));
    return NextResponse.json({ datos: { ...informe, resumen: resumenContactos(informe) } }, { status: 200 });
  } catch (e) {
    return traducirFalla('v1.liquidaciones_externas.contactos.post', acceso.tenantId, e);
  }
}
