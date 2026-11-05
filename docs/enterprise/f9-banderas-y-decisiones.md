# F9 enterprise (código): banderas y decisiones pendientes

Todo lo que depende de una decisión de Javier está **apagado por omisión**. Ninguna bandera se enciende sola; no hay variable nueva en producción.

| Bandera (variable de entorno) | Valor que enciende | Qué hace | Decisión de la que depende |
|---|---|---|---|
| `LIKIDA_TOTP_ESCALONADO` | `obligatorio` | Dueño y contador necesitan factor TOTP inscrito y AAL2 reciente para emitir/cancelar CFDI, llaves de API, cambio de roles y exportes de dinero, y para entrar al panel (salvo Mi perfil) | D8 (fila 10 de `TAREAS-JAVIER.md`) |
| `LIKIDA_MFA_TOPE_SESION_MIN` | minutos (15 a 1440; omisión 720) | Cuánto vale una verificación TOTP antes de pedirla otra vez. La cookie sigue durando 400 días; el tope obliga a repetir el código | D8 (el valor 720 es propuesta, no hecho) |
| `LIKIDA_VER_COMO_SOLO_LECTURA` | `activo` | Un superadmin que mira una flota real no puede escribir en ella por las server actions | Pendiente de Javier (soporte hoy opera dentro de flotas) |
| `LIKIDA_BITACORA_ACCESO_SUPERADMIN` | `activo` | Registra lecturas, "ver como" y descargas del superadmin en `superadmin_acceso` (solo rutas) | Requiere aplicar 0997; retención D7 |
| `LIKIDA_OFFBOARDING_EXPORTACION` | `activo` | Habilita `POST /api/admin/offboarding` (paquete JSONL + manifiesto SHA-256 + constancia) | Requiere aplicar 0998; retención D7 |

## Migraciones (las aplica Javier, una por una, con respaldo, antes del deploy que las use)

- `0997_superadmin_acceso_bitacora.sql`: tabla de solo agregar; poda con piso de 365 días. Reversa en el encabezado.
- `0998_tenant_exportacion_offboarding.sql`: constancia de exportación; transiciones solo hacia adelante. Reversa en el encabezado.

## Lo que NO está hecho (y por qué)

- **Borrado/anonimización posterior al offboarding** y `exportar_datos_titular` (ARCO por titular): dependen de la retención final (D7) y del abogado; no se construyen sin esa decisión.
- **Que el cliente vea quién de Likida leyó sus datos**: decisión de producto/legal, no tomada.
- **Mapa de datos**: `mapa-de-datos.md` se genera de `src/lib/likida/offboarding/mapa_datos.ts`. Los plazos de retención no se repiten ahí (viven en `docs/legal/RETENCION.md`); el proveedor de GPS y el PAC por flota están rotulados "por conectar".
