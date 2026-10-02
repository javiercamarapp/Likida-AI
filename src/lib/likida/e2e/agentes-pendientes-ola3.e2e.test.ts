import { describe, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E2E PENDIENTES — lo que todavía NO tiene su prueba del ciclo (criterio g de la cola maestra).
//
// Quedan dos: Agente 6 (Autofactura, paquete P11) y Agente 12 (Jornada, paquete P10). Los demás `todo` de la Ola 3 ya se
// convirtieron en pruebas o se retiraron por tener cobertura propia (ver docs/e2e/matriz-agentes.md):
//  · Conductor (conciliación obligatoria, escalamiento, validar por API) → conductor/ciclo_completo.e2e.test.ts y
//    app/api/v1/hitos/[id]/validar/route.test.ts;
//  · GPS (poll, push, tabla propia) → e2e/agente-10-gps.e2e.test.ts y conectores/tabla_propia/e2e.test.ts;
//  · Convenios, Orquestador y tablero en vivo → convenios/convenios.e2e.test.ts y orquestador/orquestador*.e2e.test.ts.
//
// Regla: aquí NO hay pruebas verdes falsas. Cada `todo` nombra los CINCO casos del criterio (g) que tendrá que pasar cuando
// se construya: feliz, fallo, duplicado, fuera de orden y otro tenant. Al construirse, el `todo` se convierte en prueba con el
// mismo arnés (db_memoria.fixture, meta.fixture, repos falsos) y se actualiza docs/e2e/matriz-agentes.md.
// ═══════════════════════════════════════════════════════════════════════════

describe('Agente 6 — Autofactura (migraciones 0540-0542; paquete P11)', () => {
  it.todo('FELIZ: lote supervisado de facturas al vuelo → la persona confirma → se consume UNA vez → emisión por portal verificado dentro del cupo diario atómico');
  it.todo('FALLO: portal sin verificación real (verificaciones.json vacío) o sin mandato legal → falla CERRADO a ensayo; CAPTCHA/MFA → pantalla del paso humano con código de un solo uso, cookies cifradas y cancelar');
  it.todo('DUPLICADO: el mismo lote confirmado dos veces o el mismo ticket por dos corridas del cron (facturar cada 15 min) emite UNA sola factura');
  it.todo('FUERA DE ORDEN: el código de vinculación expira/se reclama dos veces; la cancelación de CFDI (SW sapien 201/202/205/400) llega antes de que el timbre quede confirmado');
  it.todo('OTRO TENANT: credenciales, cupo y bandera de emisión real son por flota; la flota B no puede promover ni consumir el lote de la A');
});

describe('Agente 12 — Jornada: alerta saliente al acercarse al tope (cron jornada-alertas; sin UI para encenderla, paquete P10)', () => {
  it.todo('FELIZ: el cron jornada-alertas avisa al operador y al jefe cuando la jornada derivada (marcas + GPS) se acerca al tope, con la plantilla Meta del catálogo');
  it.todo('FALLO: sin GPS ni marcas no se afirma nada («nunca certifica que cumple»); plantilla sin aprobar con ventana cerrada deja el aviso sin sello y se reintenta');
  it.todo('DUPLICADO: el cron cada hora no repite la alerta del mismo umbral en la misma jornada');
  it.todo('FUERA DE ORDEN: una marca de «descanso» tardía reabre/cierra el cálculo y cancela la alerta pendiente sin avisar de más');
  it.todo('OTRO TENANT: topes y destinatarios de cada flota; la alerta de A jamás llega al jefe de B');
});
