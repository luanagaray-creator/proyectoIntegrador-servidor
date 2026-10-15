# Instituciones, permisos y sesiones

## Flujo actual

Thotem es el superadministrador. En `/platform` crea instituciones con sus espacios (1ro, 2do y 3ro TIC o ADM) y autoriza cuentas registradas para administrarlos. El registro público siempre crea usuarios comunes y no acepta privilegios.

El administrador institucional entra en `/admin-plan`, paga un plan simulado para sus espacios autorizados y habilita usuarios registrados por nombre o email. Solo los administradores con espacios asignados pueden pagar. Small Plan: 250; Medium Plan: 500; Large Plan: 750. El servidor calcula los importes. No se reciben tarjetas ni se hacen cobros reales; moneda y duración del plan siguen pendientes de definición.

Los usuarios comunes no ven planes. En `/spaces` ven únicamente sus espacios. Para entrar necesitan una membresía explícita y cobertura pagada por un administrador que conserve el permiso sobre ese espacio. No pueden autoadmitirse seleccionando un curso. Thotem administra permisos, sin acceso automático a chats o compras.

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

- GET/POST `/api/platform/institutions`: superadmin; crear con `{name, groupCodes}`.
- POST `/api/platform/administrators`: superadmin; `{user, spaceIds}` asigna espacios a una cuenta registrada.
- DELETE `/api/platform/spaces/:spaceId/administrators/:userId`: superadmin; revoca permiso y cobertura.
- GET/POST `/api/admin/spaces/:spaceId/members`: admin asignado; agregar con `{user}`.
- DELETE `/api/admin/spaces/:spaceId/members/:userId`: admin asignado; retira acceso.
- POST `/api/payments/simulate`: admin asignado; `{plan, method, spaceIds}`.
- POST `/api/admin/plan/groups`: admin asignado; `{spaceIds}` actualiza cobertura (nombre histórico de la ruta).
- GET `/api/group-chat?spaceId=...` y POST `/api/group-chat/messages` con `{spaceId, content}`: membresía o administración y espacio activo.
- POST `/api/users/group`: deshabilitado; la admisión corresponde al administrador.

La mensajería privada requiere participantes del mismo espacio activo. POST `/api/messages` recibe `{spaceId, recipient, subject, content}`. GET `/api/messages?filter=all|sent|received|starred`, GET `/api/messages/:id`, POST `/api/messages/:id/replies` con `{content}` y POST `/api/messages/:id/star` con `{starred}` comprueban participante y acceso vigente. El remitente proviene de la sesión. Los mensajes internos no usan SMTP.

## Autenticación

POST `/api/users/register` recibe `{name, email, password}` e inicia sesión. POST `/api/auth/login` acepta nombre o email y contraseña. GET `/api/users/profile` restaura el perfil; POST `/api/auth/logout` elimina la sesión.

Las sesiones duran 3 horas absolutas. Navegar no renueva el plazo. La cookie HttpOnly y MySQL comparten el vencimiento; `sessionExpiresAt` permite al front pedir login al vencer. Se usan hashes SHA-256 para tokens y scrypt para contraseñas. No se guardan credenciales en localStorage. En producción usar HTTPS, NODE_ENV=production y FRONTEND_URL con el origen real.

## Correo y recuperación

El registro envía la bienvenida después de crear la cuenta; un fallo de correo no elimina la cuenta ni la sesión. SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER y SMTP_PASSWORD se configuran únicamente en `.env`. Para Gmail se usa contraseña de aplicación. `npm run mail:verify` verifica la conexión sin enviar mensajes.

La recuperación usa POST `/api/auth/password-reset/request` con email, `/verify` con requestId y código y `/confirm` con resetToken y password. El código de 6 dígitos vence en 15 minutos y admite 5 errores; el token final dura 10 minutos y es de un solo uso. Cambiar la contraseña invalida sesiones sin borrar membresías o compras. Si SMTP falla, la API devuelve 503 y no presenta el correo como enviado. La red debe permitir SMTP saliente.

## Verificación

`npm test` verifica autenticación, cookies y correo con repositorios de prueba. `node scripts/verify-institutions.js` verifica con MySQL el flujo superadmin → administrador → plan → miembro, aislamiento institucional, chat, mensajes y revocaciones. Usa datos temporales y los elimina sin enviar correos reales. Las entradas verify-admin-plans, verify-group-chat y verify-messages redirigen a esa prueba institucional. `node scripts/verify-auth.js` y `node scripts/verify-password-reset.js` prueban autenticación y recuperación con cuentas temporales.
