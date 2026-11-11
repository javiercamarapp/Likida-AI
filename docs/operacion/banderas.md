# Registro de banderas

Cada variable de entorno que cambia lo que el sistema hace. La fuente es `src/lib/banderas.ts`; `src/lib/banderas.test.ts` exige que esta tabla y `.env.example` listen cada una y que el código la lea.

**Reglas**

1. **Todas apagadas.** Sin la variable, el código hace lo seguro. Ninguna se enciende sola ni por un cambio de default.
2. **La decisión es de Javier.** La columna «Deploy 1» está en `pendiente` hasta que la decida; el constructor no la rellena.
3. **Una variable de entorno solo surte efecto con un despliegue nuevo.** Por eso se deciden **juntas** y viajan en el mismo Deploy 1 (un solo build). Encenderlas una por una es un build por bandera.
4. Cada bandera lleva una **prueba de humo**: lo que se mira, ya desplegada, para saber que hace lo que dice.

| Bandera | Enciende con | Dueño | Registrada | Decidir antes de | Deploy 1 | Qué hace | Requiere |
|---|---|---|---|---|---|---|---|
| `IA_GOBIERNO` | `encendido` | Javier | 2026-11-10 | Deploy 1 | pendiente | La guardia sondea la llave de OpenRouter y barre los topes de IA al 80 y 100 % cada 15 minutos. | Migración 0990 aplicada (tabla de alertas de tope). |
| `ALERTAS_IA_GUARDIA` | `encendido` | Javier | 2026-11-10 | Deploy 1 | pendiente | La guardia avisa (campana y `ALERTA_EMAIL`) de «IA sin registro de costo» y de «tasa de respaldo alta». | Confirmar los umbrales propuestos: 12 h sin registro, 5 % de respaldo, muestra mínima de 20 llamadas. Sin migración. |
| `LIKIDA_VER_COMO_SOLO_LECTURA` | `activo` | Javier | 2026-11-10 | Deploy 1 | pendiente | Un superadmin que mira una flota real ya no puede escribir en ella por las server actions. | Decidir cómo opera soporte: hoy opera dentro de las flotas y esta bandera lo bloquearía (falta la concesión de escritura con motivo y caducidad). |
| `LIKIDA_TOTP_ESCALONADO` | `obligatorio` | Javier | 2026-11-10 | Deploy 1 | pendiente | Dueño y contador necesitan TOTP inscrito y AAL2 reciente para emitir/cancelar CFDI, llaves de API, cambio de roles y exportes de dinero. | Decisión D8; que quienes cambian dinero tengan el factor inscrito antes, o se quedan fuera. |
| `LIKIDA_BITACORA_ACCESO_SUPERADMIN` | `activo` | Javier | 2026-11-10 | Deploy 1 | pendiente | Registra lecturas, «ver como» y descargas del superadmin en `superadmin_acceso`. | Migración 0997 aplicada por Javier y la retención D7 decidida. |
| `FACTURACION_PILOTO` | `si` | Javier | 2026-11-10 | Deploy 1 | pendiente | El piloto de visión opera portales de facturación sin adaptador escrito; nunca emite (se detiene antes del botón que crea el CFDI). | Gasto por paso en llamadas de visión (tope de IA por flota) y credencial compartida de la flota si el portal la pide. |
| `DIAGNOSTICO_ALERTAS` | `encendido` | Javier | 2026-11-11 | Deploy 1 | pendiente | Ante una alerta S1/S2 nueva, un agente de SOLO LECTURA escribe un diagnóstico (causa, evidencia, arreglo propuesto) en Aprobaciones; nunca ejecuta nada. | Tope de IA aprobado: US$20 al mes (`DIAGNOSTICO_TOPE_USD`, opcional). Sin migración. |

## Pruebas de humo (ya desplegada la bandera)

- **`IA_GOBIERNO`**: en los siguientes 15 min el latido de `guardia` trae `gobiernoIa.estado = "ok"` y `/admin/consumo` dice que los avisos están encendidos.
- **`ALERTAS_IA_GUARDIA`**: el latido de `guardia` trae `alertasIa` con ambos estados (`ok` o `sin_medir`, nunca ausente) en la siguiente pasada de cada cuarto de hora. Si está en `alerta`, la campana de `/admin` lo suma.
- **`LIKIDA_VER_COMO_SOLO_LECTURA`**: como superadmin dentro de una flota de prueba, guardar un cambio devuelve el rechazo de solo lectura y no escribe.
- **`LIKIDA_TOTP_ESCALONADO`**: con un usuario sin TOTP, cambiar un rol redirige a inscribir el factor; con TOTP vigente la acción procede.
- **`LIKIDA_BITACORA_ACCESO_SUPERADMIN`**: abrir una flota como superadmin deja una fila en `superadmin_acceso` con la ruta (solo rutas, sin contenido).
- **`FACTURACION_PILOTO`**: un comercio con ficha completa pasa a «operable» en `/dashboard/conexiones`; una corrida de prueba termina en captura sin emitir.
- **`DIAGNOSTICO_ALERTAS`**: con una alerta S2 de prueba aparece una pieza «Diagnóstico propuesto» en `/admin/aprobaciones` y el latido de `guardia` trae `diagnostico.estado = "ok"` con el gasto del mes. Al llegar a US$20 el estado pasa a `tope`, deja de llamar al modelo y la campana lo dice; si el gasto no se puede leer, `gasto_ilegible` y tampoco llama.

## Cómo añadir una bandera

1. Léela en el código con el patrón `env.NOMBRE === 'valor'` (parámetro `env` con `process.env` por omisión) para poder probarla.
2. Añádela a `BANDERAS` en `src/lib/banderas.ts`, a esta tabla y a `.env.example` (comentada: `# NOMBRE=`).
3. Corre `npx vitest run src/lib/banderas.test.ts`.

Las variables que no son interruptores (llaves, URLs, topes numéricos) no van aquí: viven solo en `.env.example`.
