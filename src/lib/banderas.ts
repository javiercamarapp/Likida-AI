// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE BANDERAS (F16). Cada interruptor de entorno que cambia lo que el sistema hace, con su dueño, su fecha y
// su prueba de humo. La lista es DATOS, no lógica: nadie la importa para decidir nada. Existe para que
//   · `docs/operacion/banderas.md` y `.env.example` no se queden atrás (lo exige `banderas.test.ts`),
//   · el Deploy 1 lleve TODAS las decisiones juntas: una variable de entorno solo surte efecto con un despliegue
//     nuevo, así que decidirlas una por una es provocar un build por bandera.
//
// NINGUNA está encendida. `valorSinDecision` es lo que el código hace si la variable no existe; `valorDeploy1` es `null`
// hasta que Javier lo decida (el constructor no lo decide por él).
// ═══════════════════════════════════════════════════════════════════════════

export interface Bandera {
  /** Nombre exacto de la variable de entorno. */
  variable: string;
  /** El valor que la ENCIENDE (cualquier otro, o vacío, la deja apagada). */
  valorEncendido: string;
  /** Qué hace el código sin decisión. Hoy siempre `apagado`. */
  valorSinDecision: 'apagado';
  /** La decisión del dueño para el Deploy 1: `null` = pendiente. */
  valorDeploy1: 'encendido' | 'apagado' | null;
  dueno: string;
  /** Cuándo se registró y cuándo se revisa. ISO AAAA-MM-DD. */
  registrada: string;
  decidirAntesDe: string;
  /** Qué cambia al encenderla, en una línea. */
  efecto: string;
  /** Lo que tiene que existir antes (migración aplicada, proveedor, correo). */
  requiere: string;
  /** Cómo se comprueba, ya desplegada, que hace lo que dice. */
  pruebaDeHumo: string;
}

const COMUN = { valorSinDecision: 'apagado', valorDeploy1: null, dueno: 'Javier', registrada: '2026-11-10', decidirAntesDe: 'Deploy 1' } as const;

export const BANDERAS: readonly Bandera[] = [
  {
    ...COMUN, variable: 'IA_GOBIERNO', valorEncendido: 'encendido',
    efecto: 'La guardia sondea la llave de OpenRouter y barre los topes de IA al 80 y 100 % cada 15 minutos.',
    requiere: 'Migración 0990 aplicada (tabla de alertas de tope).',
    pruebaDeHumo: 'En los siguientes 15 min el latido de `guardia` trae `gobiernoIa.estado = "ok"` y /admin/consumo dice que los avisos están encendidos.',
  },
  {
    ...COMUN, variable: 'ALERTAS_IA_GUARDIA', valorEncendido: 'encendido',
    efecto: 'La guardia avisa (campana y ALERTA_EMAIL) de «IA sin registro de costo» y de «tasa de respaldo alta».',
    requiere: 'Confirmar los umbrales propuestos: 12 h sin registro, 5 % de respaldo, muestra mínima de 20 llamadas. Sin migración.',
    pruebaDeHumo: 'Con la bandera puesta, el latido de `guardia` trae `alertasIa` con ambos estados (`ok` o `sin_medir`, nunca ausente) en la siguiente pasada de cada cuarto de hora.',
  },
  {
    ...COMUN, variable: 'LIKIDA_VER_COMO_SOLO_LECTURA', valorEncendido: 'activo',
    efecto: 'Un superadmin que mira una flota real ya no puede escribir en ella por las server actions.',
    requiere: 'Decidir cómo opera soporte: hoy opera dentro de las flotas y esta bandera lo bloquearía (falta la concesión de escritura con motivo y caducidad).',
    pruebaDeHumo: 'Como superadmin dentro de una flota de prueba, guardar un cambio devuelve el rechazo de solo lectura y no escribe.',
  },
  {
    ...COMUN, variable: 'LIKIDA_TOTP_ESCALONADO', valorEncendido: 'obligatorio',
    efecto: 'Dueño y contador necesitan TOTP inscrito y AAL2 reciente para emitir/cancelar CFDI, llaves de API, cambio de roles y exportes de dinero.',
    requiere: 'Decisión D8; que los usuarios que cambian dinero tengan el factor inscrito antes, o se quedan fuera.',
    pruebaDeHumo: 'Con un usuario sin TOTP, cambiar un rol redirige a inscribir el factor; con TOTP vigente la acción procede.',
  },
  {
    ...COMUN, variable: 'LIKIDA_BITACORA_ACCESO_SUPERADMIN', valorEncendido: 'activo',
    efecto: 'Registra lecturas, «ver como» y descargas del superadmin en `superadmin_acceso`.',
    requiere: 'Migración 0997 aplicada por Javier y la retención D7 decidida.',
    pruebaDeHumo: 'Abrir una flota como superadmin deja una fila en `superadmin_acceso` con la ruta (solo rutas, sin contenido).',
  },
  {
    ...COMUN, variable: 'FACTURACION_PILOTO', valorEncendido: 'si',
    efecto: 'El piloto de visión opera portales de facturación sin adaptador escrito (nunca emite; se detiene antes del botón que crea el CFDI).',
    requiere: 'Gasto por paso en llamadas de visión (tope de IA por flota) y credencial compartida de la flota si el portal la pide.',
    pruebaDeHumo: 'Un comercio con ficha completa pasa a «operable» en /dashboard/conexiones; una corrida de prueba termina en captura sin emitir.',
  },
];
