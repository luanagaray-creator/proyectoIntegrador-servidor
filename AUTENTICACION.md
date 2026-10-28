# Instituciones, permisos y sesiones

## Flujo actual

Thotem es el superadministrador. En `/platform` crea instituciones vacías y autoriza cuentas registradas como administradores institucionales. No elige cursos ni crea espacios predefinidos. El registro público siempre crea usuarios comunes y no acepta privilegios.

El administrador institucional puede contratar un plan antes de tener espacios. Después, en `/admin-plan`, escribe el nombre de cada clase para crearla y agrega sus usuarios registrados. Small Plan: 250 usuarios en hasta 10 espacios; Medium Plan: 500 en hasta 20; Large Plan: 750 en hasta 30. El cupo de usuarios por espacio se calcula dividiendo el total del plan entre sus espacios máximos: 25 usuarios comunes por espacio en cada plan. El servidor calcula importes y valida cupos. No se reciben tarjetas ni se hacen cobros reales; moneda y duración del plan siguen pendientes de definición.

Los usuarios comunes no ven planes y solo pueden tener un chat asignado. La API rechaza una segunda asignación y MySQL impone un índice único por usuario; repetir la asignación actual es válido. Para cambiar de curso se retira primero el acceso anterior. Para entrar necesitan una membresía explícita y cobertura pagada por un administrador que conserve el permiso sobre ese espacio. No pueden autoadmitirse seleccionando un curso. Los administradores pueden gestionar varios espacios autorizados por Thotem.

Dos instituciones pueden tener un espacio llamado 3ro TIC sin compartir chats ni mensajes privados. Retirar permisos, membresía o cobertura bloquea el acceso en el servidor. El perfil se actualiza cada 15 segundos y los mensajes cada 5 mientras la página está visible.

## Preparación

El backend usa mysql2 y la base proyectoIntegrador. Configurar DATABASE_URL en `.env` según `.env.example`. Sobre las tablas originales ejecutar:

```sh
npm run db:auth
npm run db:messages
npm run db:groups
npm run db:institutions
npm start
```

Las migraciones conservan los datos anteriores sin asignar chats globales a instituciones arbitrarias. `users.groupCode` y `admin_plan_groups` son datos heredados: ya no otorgan acceso. Las tablas actuales son institutions, communication_spaces, space_administrators, space_memberships y admin_plan_spaces.

`scripts/provision-superadmin.js` recibe credenciales por stdin como JSON y guarda la contraseña con scrypt; no contiene credenciales predeterminadas. Nunca publicar `.env` ni contraseñas.

## API

En `/platform`, Thotem dispone del listado global «Administradores», con nombre, email e instituciones asignadas, búsqueda por esos campos y total de cuentas. GET `/api/platform/institutions` devuelve `adminAccounts` con las cuentas de rol `admin`, incluso sin institución asignada; las relaciones provienen de `institutionAdministrators`. Cada cuenta aparece una sola vez. El acceso a este listado está reservado al superadministrador.

Thotem puede desactivar y reactivar administradores desde ese listado y filtrar por estado. PATCH `/api/platform/administrators/:userId` recibe `{isActive: boolean}`; rechaza usuarios comunes y la cuenta superadministradora. Desactivar conserva el rol `admin`, instituciones, permisos, espacios y planes, pero elimina todas las sesiones y bloquea el login. Los usuarios de la institución conservan sus accesos y el plan sigue vigente. Reactivar permite volver a iniciar sesión; las sesiones anteriores no se restauran. El registro público y la asignación de permisos no pueden reactivar una cuenta inactiva. `npm run db:institutions` agrega `users.isActive` con valor inicial activo, y `npm run test:admin-status` verifica permisos, revocación de sesiones, reactivación y carreras entre login y desactivación con datos temporales.

- GET/POST `/api/platform/institutions`: superadmin; crear con `{name, groupCodes}`.
- POST `/api/platform/administrators`: superadmin; `{user, institutionId}` asigna una institución a una cuenta registrada, aunque todavía no tenga espacios.
- DELETE `/api/platform/institutions/:institutionId/administrators/:userId`: superadmin; retira la administración institucional, los permisos de sus espacios y el plan que hubiera contratado esa cuenta en la institución.
- POST `/api/admin/spaces`: admin institucional; `{institutionId, name}` crea un espacio si hay un plan contratado y un cupo disponible. No acepta crear en instituciones ajenas.
- DELETE `/api/platform/spaces/:spaceId/administrators/:userId`: superadmin; revoca permiso y cobertura.
- GET/POST `/api/admin/spaces/:spaceId/members`: admin asignado; agregar con `{user}`.
- DELETE `/api/admin/spaces/:spaceId/members/:userId`: admin asignado; retira acceso.
- POST `/api/payments/simulate`: admin institucional; `{plan, method, institutionId}`. No hay selección previa de cursos; puede pagarse con cero espacios.
- POST `/api/admin/plan/groups`: admin asignado; `{spaceIds}` actualiza cobertura (nombre histórico de la ruta).
- GET `/api/group-chat?spaceId=...` y POST `/api/group-chat/messages` con `{spaceId, content}`: membresía o administración y espacio activo.
- POST `/api/users/group`: deshabilitado; la admisión corresponde al administrador.

La mensajería privada requiere que ambos participantes tengan acceso activo a la misma institución, aunque estén en cursos diferentes. Las conversaciones guardan institutionId; la migración lo obtiene del espacio original sin borrar mensajes. POST `/api/messages` recibe `{spaceId, recipient, subject, content}`; spaceId determina una institución autorizada del remitente. GET `/api/messages?filter=all|sent|received|starred`, GET `/api/messages/:id`, POST `/api/messages/:id/replies` con `{content}` y POST `/api/messages/:id/star` con `{starred}` comprueban participante e institución vigente de ambos usuarios. Tras cambiar de institución, los mensajes anteriores no se exponen a la nueva institución. Los chats grupales siguen restringidos al curso asignado. El remitente proviene de la sesión. Los mensajes internos no usan SMTP.

DELETE `/api/messages/:id` permite a un participante autorizado eliminar la conversación completa para ambos participantes. Borra mensajes, destacados y conversación en una transacción, con el mismo control de acceso que la lectura y un bloqueo que la sincroniza con las respuestas. La bandeja muestra una papelera y solicita confirmar el borrado irreversible antes de enviar la solicitud.

## Cupos y personalización

Small Plan (250 usuarios) permite crear hasta 10 espacios, Medium Plan (500) hasta 20 y Large Plan (750) hasta 30. Cada espacio admite la división del total de usuarios entre los espacios máximos del plan (25 usuarios comunes por espacio). Los límites de espacios se aplican a toda la institución, no por administrador. Varios administradores comparten el cupo. La creación y los cambios de plan se serializan en MySQL para evitar superar el límite con solicitudes simultáneas.

Para bajar de plan hay que eliminar primero los espacios que excedan el nuevo cupo. Se conservan los espacios existentes de instalaciones anteriores: no se borran automáticamente. El formulario de creación indica cuántos espacios hay y cuántos lugares quedan disponibles.

`institution_administrators` permite administrar instituciones vacías. `simulated_purchases.institutionId` vincula el plan con su institución. `npm run db:institutions` prepara esos datos y migra las asignaciones anteriores sin eliminar espacios. El plan se conserva al borrar el último espacio, permitiendo crear otro sin volver a pagar. Cancelarlo suspende el acceso sin borrar clases, usuarios ni mensajes. El comprobante es accesible antes de crear el primer espacio y lleva a Administración.

`npm run test:space-creation` prueba institución vacía → administrador → pago → creación con nombres propios, cupos 10/20/30, altas simultáneas, borrado y recreación, cancelación y aislamiento institucional, usando datos temporales.

PATCH `/api/admin/spaces/:spaceId` recibe `{name}` y permite renombrar un espacio administrado con entre 1 y 30 caracteres, sin nombres repetidos dentro de la institución. Cada espacio admite hasta 25 usuarios comunes, calculados según el plan activo; los administradores no ocupan esos lugares. GET `/api/admin/spaces/:spaceId/members` informa `capacity` y `available`. Las altas simultáneas se serializan para no superar el cupo vigente y repetir la asignación actual no consume un cupo adicional.

DELETE `/api/admin/plan` cancela la compra del administrador y retira su cobertura, conservando institución, espacios, miembros, mensajes y rol `admin`. Asignar permisos institucionales convierte la cuenta en `admin` y retira su membresía de usuario común. Cancelar un plan no modifica ese rol. La interfaz muestra “Plan Actual” cuando hay una compra y permite cancelarla desde Administración.

`npm run test:limits` verifica estos límites y sus condiciones concurrentes con MySQL usando cuentas temporales que elimina al finalizar.

## Borrado de espacios e instituciones

DELETE `/api/admin/spaces/:spaceId` permite a su administrador asignado o a Thotem eliminar un espacio. PATCH sobre esa misma ruta permite editar su nombre. La sección «Mis espacios» de Administración muestra ambas acciones para cada espacio, sin tener que seleccionarlo primero para asignar un usuario.

Eliminar un espacio borra sus mensajes grupales, membresías, permisos y cobertura. Las conversaciones privadas pertenecen a la institución y se conservan, con `spaceId` vacío; sus participantes siguen necesitando acceso activo a la misma institución. El plan institucional se conserva y el lugar queda libre para crear otro espacio. Se conservan las cuentas y los roles de administrador.

DELETE `/api/platform/institutions/:institutionId` está reservado a Thotem y elimina la institución, sus espacios, chats grupales, conversaciones privadas, destacados y permisos. Ambas operaciones usan transacciones y la interfaz exige confirmar indicando el nombre del elemento y las consecuencias. No se borran instituciones ajenas ni cuentas de usuario. Los envíos de mensajes y las asignaciones se sincronizan con el borrado para no crear registros huérfanos.

Ejecutar `npm run db:institutions` actualiza el campo heredado `group_chat_messages.groupCode` a 30 caracteres para que los nombres personalizados no impidan enviar mensajes. `npm run test:management` verifica edición, borrado, aislamiento entre instituciones, conservación de cuentas y reversión completa ante un error con datos temporales de MySQL.

## Sesiones

POST `/api/users/register` recibe `{name, email, password}` e inicia sesión. POST `/api/auth/login` acepta nombre o email y contraseña. GET `/api/users/profile` restaura el perfil; POST `/api/auth/logout` elimina la sesión.

Las sesiones duran 3 horas absolutas. Navegar no renueva el plazo. La cookie HttpOnly y MySQL comparten el vencimiento; `sessionExpiresAt` permite al front pedir login al vencer. Se usan hashes SHA-256 para tokens y scrypt para contraseñas. No se guardan credenciales en localStorage. En producción usar HTTPS, NODE_ENV=production y FRONTEND_URL con el origen real.

## Correo y recuperación

El registro envía la bienvenida después de crear la cuenta; un fallo de correo no elimina la cuenta ni la sesión. SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER y SMTP_PASSWORD se configuran únicamente en `.env`. Para Gmail se usa contraseña de aplicación. `npm run mail:verify` verifica la conexión sin enviar mensajes.

La recuperación usa POST `/api/auth/password-reset/request` con email, `/verify` con requestId y código y `/confirm` con resetToken y password. El código de 6 dígitos vence en 15 minutos y admite 5 errores; el token final dura 10 minutos y es de un solo uso. Cambiar la contraseña invalida sesiones sin borrar membresías o compras. Si SMTP falla, la API devuelve 503 y no presenta el correo como enviado. La red debe permitir SMTP saliente.

## Verificación

`npm test` verifica autenticación, cookies y correo con repositorios de prueba. `node scripts/verify-institutions.js` verifica con MySQL el flujo superadmin → administrador → plan → miembro, aislamiento institucional, chat, mensajes y revocaciones. Usa datos temporales y los elimina sin enviar correos reales. Las entradas verify-admin-plans, verify-group-chat y verify-messages redirigen a esa prueba institucional. `node scripts/verify-auth.js` y `node scripts/verify-password-reset.js` prueban autenticación y recuperación con cuentas temporales.
