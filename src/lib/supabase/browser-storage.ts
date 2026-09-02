'use client';

// Cliente de NAVEGADOR, SOLO para Storage — nunca para tablas ni para Auth.
//
// Este repo, a propósito, no tiene un cliente de Supabase del lado del
// cliente: la sesión vive en cookies propias (ver `lib/supabase/cookies.ts`)
// y toda lectura/escritura de tablas pasa por el servidor (`supabaseAdmin()`
// o Server Actions). Este archivo NO rompe esa regla — el cliente que crea
// aquí NUNCA toca `.from(tabla)` ni `.auth`, solo `.storage`, y solo para
// subir un archivo a una URL que el SERVIDOR ya firmó con service_role
// (`createSignedUploadUrl`, en `lib/likida/marketing/estudio.ts`). La
// autorización de esa subida vive en el token de la URL, no en este cliente:
// es el mismo mecanismo que una URL firmada de LECTURA, al revés.
//
// Por qué no un `fetch` a mano contra el endpoint de Storage: el contrato de
// `uploadToSignedUrl` no es un PUT simple con el archivo de cuerpo — construye
// un FormData con un campo de `cacheControl` y el archivo en un campo sin
// nombre. Reproducir eso a mano es reinventar el cliente oficial con más
// riesgo de errarle al contrato; usar el SDK real es la vía angosta.
import { createClient } from '@supabase/supabase-js';

let _cliente: ReturnType<typeof createClient> | null = null;

function clienteStorage() {
  if (_cliente) return _cliente;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase no está configurado en el navegador — falta NEXT_PUBLIC_SUPABASE_URL/ANON_KEY.');
  _cliente = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _cliente;
}

/**
 * Sube `archivo` directo a Storage usando una URL que el servidor YA firmó
 * (`bucket`/`path`/`token` vienen de `pedirUrlFirmadaHook`). El archivo
 * jamás pasa por una función de Vercel — va del navegador a Storage.
 */
export async function subirConUrlFirmada(bucket: string, path: string, token: string, archivo: File): Promise<void> {
  const { error } = await clienteStorage().storage.from(bucket).uploadToSignedUrl(path, token, archivo);
  if (error) throw new Error(`No se pudo subir el video: ${error.message}`);
}
