#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// CONECTAR UNA LÍNEA DE WHATSAPP A UNA FLOTA (mig. 1006, tabla tenant_whatsapp_linea).
//
//   ! node scripts/conectar-linea-whatsapp.mjs --tenant <uuid> --phone-number-id <id> --waba-id <id> \
//       --numero "+52 55 1234 5678" --etiqueta "Servicio al cliente" --proposito servicio_cliente --principal [--activar] [--dry-run]
//
// Entorno (NO se imprime): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIKIDA_COFRE_LLAVE.
// El token permanente se pide en un diálogo OCULTO de macOS: nunca por argumentos ni por logs.
// Contra Meta solo lee (GET). Guarda la línea PENDIENTE; --activar la pasa a activa solo si el webhook está verificado.
// La lógica vive en src/lib/meta/linea_alta_cli.ts (el mismo cofre v2 que la app). Como es TypeScript, este archivo se
// relanza solo con `npx tsx` (como scripts/vincular-portal.mjs): la primera vez baja tsx.
// ════════════════════════════════════════════════════════════════════════════
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

if (process.env.LIKIDA_ALTA_BAJO_TSX !== '1') {
  const r = spawnSync('npx', ['--yes', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, LIKIDA_ALTA_BAJO_TSX: '1' },
  });
  process.exit(r.status ?? 1);
}

const { parsearArgumentos, ejecutarAlta, USO } = await import('../src/lib/meta/linea_alta_cli.ts');

const parsed = parsearArgumentos(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`ERROR: ${parsed.error}\n\n${USO}`);
  process.exit(1);
}

function leerToken() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e',
      'text returned of (display dialog "Pega el token PERMANENTE de WhatsApp de la línea (no se muestra ni se guarda en claro)" default answer "" with hidden answer with title "Conectar línea de WhatsApp")',
    ], (err, stdout) => (err ? reject(new Error('cancelado')) : resolve(String(stdout).replace(/\r?\n$/, ''))));
  });
}

const r = await ejecutarAlta(parsed.args, {
  leerToken, fetch, env: process.env, escribir: (l) => console.log(l),
});
process.exit(r.codigo);
