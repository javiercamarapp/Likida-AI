// Cliente service-role (SOLO servidor). Salta RLS — re-imponer scope por
// tenant a mano con .eq('tenant_id', ...). Usado por webhooks/pipeline sin
// sesión de usuario. NUNCA importar en código de cliente.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { combineAbortSignals, currentToolSignal } from '@/lib/llm/runtime-signal';

// AUDITORÍA 1, CRÍTICO (Rendimiento): SIN un tope, un socket que Supabase acepta
// y no contesta cuelga hasta el default de undici (300 s). Los crons de escalación
// y cobranza (`agentes/`) tienen `maxDuration` de 120 s: Vercel mata la función a
// medio camino SIN log, sin `registrarCorrida`, y la corrida de TODAS las flotas
// de esa hora desaparece en silencio. `acotada()` (presupuesto.ts) ya lo cubre
// donde se usa —8 s—, pero no todo el repo pasa por él. Este BACKSTOP en el fetch
// del cliente acota TODA consulta que no traiga ya su propia señal (la de
// `acotada`, más estrecha, gana). Es una red, no el tope fino. Ajustable por env
// sin desplegar; 25 s deja margen bajo cualquier `maxDuration` del repo.
const BACKSTOP_MS = Number(process.env.LIKIDA_SUPABASE_FETCH_MS) || 25_000;

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role no configurado');
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Respeta una señal ya puesta (la de `acotada`, más estrecha); si no hay,
      // hereda la señal de la tool y aplica el backstop. Así una tool abortada
      // cancela también sus consultas directas, Storage y RPCs profundos.
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: init?.signal && !currentToolSignal()
            ? init.signal
            : combineAbortSignals(init?.signal ?? undefined, currentToolSignal(), AbortSignal.timeout(BACKSTOP_MS)),
        }),
    },
  });
  return _admin;
}
