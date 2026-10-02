import { describe, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E2E PENDIENTES DE INTEGRACIÓN — lo que la Ola 3 (~/likida-worktrees/w3-*) construye y que NO está en loop/punta-a-punta.
//
// Regla: aquí NO hay pruebas verdes falsas. Cada `todo` nombra la interfaz esperada, el worktree/commit que la construye y
// los CINCO casos del criterio (g) que tendrá que pasar cuando se integre: feliz, fallo, duplicado, fuera de orden y otro tenant.
// Al integrar la rama, el `todo` se convierte en prueba con el mismo arnés (db_memoria.fixture, meta.fixture, repo falsos)
// y se actualiza docs/e2e/matriz-agentes.md. El detalle de cada interfaz está en esa matriz.
// ═══════════════════════════════════════════════════════════════════════════

describe('Agente 5 — Conductor: conciliación obligatoria contra la posición real (nada en w3 lo entrega todavía)', () => {
  it.todo('FELIZ: «ya llegué» CON posición GPS dentro de la geocerca sella el hito como confirmado (hoy el veredicto vive en conductor/validar_hito; falta que SIN posición el hito quede «no_confirmado» y NO selle)');
  it.todo('FALLO: «ya llegué» sin posición o con posición lejana → hito «no confirmado», visible como EXCEPCIÓN en el tablero; el chofer recibe línea neutral, nunca acusación');
  it.todo('DUPLICADO: reintento del webhook / segundo «ya llegué» no cambia el veredicto ni duplica la excepción');
  it.todo('FUERA DE ORDEN: la posición llega DESPUÉS del «ya llegué» → el barrido la concilia y el hito pasa de «no confirmado» a «confirmado» (y una posición lejana posterior no lo desdice)');
  it.todo('OTRO TENANT: las posiciones y geocercas de la flota B jamás concilian el hito de la A');
  it.todo('ESCALAMIENTO (0483/pantalla de config, w3-conductor-vigia 3106c28b): sin señal de vida → botones («sí, estoy», «voy a cargar», «estoy bien») → 2.º aviso → aviso al JEFE DE TRÁFICO con los tiempos y contactos de la config de flota');
  it.todo('API: POST /v1/hitos/{id}/validar (w3-conductor-vigia ae0f416d) exige llave de API, deja bitácora firmada y respeta el tenant de la llave');
});

describe('Agente 6 — Autofactura (w3-autofactura 4d0bbe72/f01c697a/9bdd8331/93285d79, migraciones 0540-0542)', () => {
  it.todo('FELIZ: lote supervisado de facturas al vuelo → la persona confirma → se consume UNA vez → emisión por portal verificado dentro del cupo diario atómico');
  it.todo('FALLO: portal sin verificación real (verificaciones.json vacío) o sin mandato legal → falla CERRADO a ensayo; CAPTCHA/MFA → pantalla del paso humano con código de un solo uso, cookies cifradas y cancelar');
  it.todo('DUPLICADO: el mismo lote confirmado dos veces o el mismo ticket por dos corridas del cron (facturar cada 15 min) emite UNA sola factura');
  it.todo('FUERA DE ORDEN: el código de vinculación expira/se reclama dos veces; la cancelación de CFDI (SW sapien 201/202/205/400) llega antes de que el timbre quede confirmado');
  it.todo('OTRO TENANT: credenciales, cupo y bandera de emisión real son por flota; la flota B no puede promover ni consumir el lote de la A');
});

describe('Agente 10 — GPS: lectores Wialon/Geotab/Navixy/genérico + PUSH + tabla propia (w3-gps-jornada 6ea4f725/ed386ef5/477759a1/bb3eb4c5)', () => {
  it.todo('FELIZ: el poll de cada proveedor (fixtures de contrato) y el push firmado /api/gps/push/{flota} asientan la posición en la unidad CORRECTA vía el asentador común, con ignición y semáforo en vivo/atrasada/obsoleta');
  it.todo('FALLO: backoff por clase de falla del proveedor (auth ≠ red ≠ 5xx); firma de push inválida/rotada → 401 sin revelar el motivo; lecturas fuera de dominio descartadas y dichas');
  it.todo('DUPLICADO: el mismo lote de posiciones por poll y por push, o reenviado, no duplica filas (clave tenant+unidad+medida_en) y el push es idempotente');
  it.todo('FUERA DE ORDEN: posiciones atrasadas o fuera de secuencia no sobreescriben la «última posición»; el pin de WhatsApp es respaldo del GPS cuando este está obsoleto');
  it.todo('OTRO TENANT: el mismo device_id en dos flotas asienta cada lectura en SU unidad; dispositivos sin unidad se listan como huérfanos y NO crean camiones');
  it.todo('TABLA PROPIA DEL CLIENTE DE DEMO (lector genérico de vista SQL de solo lectura / CSV-SFTP / endpoint + importador de geocercas): columnas unidad, lat, lon, fecha_hora, velocidad, ignición; geocercas polígono o centro+radio — pendiente de construir y de recibir el acceso del cliente (12-oct)');
});

// Agente 12 — Jornada: sus cinco casos ya son pruebas verdes en `agente-12-jornada.e2e.test.ts`.

describe('Convenios, perfiles de cliente e instrucciones (w3-convenios 46b759fa, migración 0580)', () => {
  it.todo('FELIZ: cliente → convenio (A→B, tarifa, instrucciones de cobro y operación) → al crear el viaje sale la «calle de instrucciones» al operador y al acercarse a la planta (geocerca); el operador pregunta «¿por dónde entro?» y responde el agente con el convenio');
  it.todo('FALLO/DUPLICADO/FUERA DE ORDEN/OTRO TENANT: convenio vigente por fecha, instrucciones no se mandan dos veces por viaje, un convenio nuevo no reescribe viajes ya despachados, y un convenio de la flota B jamás se resuelve en la A; exportación de instrucciones para escribirse en el sistema del cliente');
});

describe('Orquestador / chat unificado y tablero de viajes en vivo; MODO DEMO 20-oct (ola 3 g y h, aún sin stream)', () => {
  it.todo('FELIZ: una sola pestaña lee SAP/GPS/WhatsApp/convenios del tenant y responde de liquidación o supervisión citando la fuente; la IA NO decide temas delicados: escala a mesa de control o liquidación');
  it.todo('FALLO: si un agente falla, el orquestador lo notifica (no responde con el dato viejo como si fuera actual)');
  it.todo('OTRO TENANT: ninguna consulta cruza flotas; el tablero de viajes con ubicación en vivo filtra por tenant');
  it.todo('MODO DEMO: tenant del cliente de demo que se puebla con SUS archivos reales el día que lleguen; importadores de GPS, geocercas, pases, liquidación y Carta Porte probados con fixtures sintéticos');
});
