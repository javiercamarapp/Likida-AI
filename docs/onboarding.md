# Onboarding por cobertura (recorrido, Guía, pistas)

Código: `src/app/ui-v2/onboarding/` (catálogo, recorrido derivado del menú, matriz de cobertura, estado) y el motor
`src/app/ui-v2/movimiento/tour/`. El servidor arma los recorridos por rol y perfil en `src/app/dashboard/recorridos/index.ts`.

## Interruptores
- `ONBOARDING_INVITACION=1` (servidor, por omisión APAGADA): enciende la invitación de primer ingreso. Sin ella el menú Guía, los
  recorridos corto y completo, el recorrido por agente y las pistas contextuales siguen funcionando. Está en `.env.example` y el e2e de
  `LIKIDA_UI_V2_FORZAR` la enciende. No hay interruptor por flota: no existe un mecanismo por tenant que no requiera migración.
- Navegador: `localStorage['likida:onb:desactivado']='1'` apaga invitación y pistas en ese navegador (soporte, pruebas).

## Estado
Cosmético y en el navegador (`estado.ts`, clave hasheada). Con localStorage bloqueado la marca «ya se le ofreció» queda en
sessionStorage y en una cookie de sesión (`likida_onb_visto`), para no invitar en cada recarga. Guardarlo en servidor exige una
migración (tabla `onboarding_estado` con RLS «solo mi fila» y un endpoint); la interfaz `AlmacenEstado` ya está aislada para ese cambio.

## Matriz de cobertura
`cobertura.test.ts` recorre rutas × roles × perfil: cada pantalla visible debe tener un paso, una pista o un motivo de «no aplica» de
la lista cerrada. Una pantalla nueva sin cobertura rompe la prueba.
