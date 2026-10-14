# Registro y sesión

## Chat por curso

`npm run db:groups` crea los seis grupos (1ro/2do/3ro TIC y 1ro/2do/3ro ADM), agrega `users.groupCode` y prepara `group_chat_messages`. El grupo es obligatorio para nuevas cuentas. Las cuentas anteriores sin grupo pueden elegirlo una sola vez con `POST /api/users/group` (groupCode); repetir el mismo grupo es válido, pero cambiar a otro devuelve 409. La pertenencia al curso es independiente de typeUser, que conserva el rol de usuario/admin.

`GET /api/group-chat` devuelve solo el grupo y los mensajes de la cuenta autenticada. `POST /api/group-chat/messages` recibe content (hasta 5000 caracteres). El grupo y el remitente se obtienen siempre desde la sesión; los valores adicionales enviados por el cliente no cambian el destino ni la identidad. El chat requiere pago simulado y actualiza los mensajes cada 5 segundos. No usa SMTP.

Verificación: `node scripts/verify-group-chat.js`. Comprueba los seis grupos aislados, usuarios del mismo grupo, sesión, validación y elección única. Elimina sus cuentas y mensajes temporales al finalizar.

## Mensajería interna

La bandeja admite `GET /api/messages?filter=all|sent|received|starred`. En enviados/recibidos se muestra una conversación por fila, con el último mensaje que el usuario envió/recibió; una conversación con intercambio en ambas direcciones puede aparecer en los dos filtros. `POST /api/messages/:id/star` recibe starred (booleano) y marca o desmarca solo para el usuario autenticado. Las estrellas se conservan en `message_stars`, creada con `npm run db:messages`.

Ejecutar `npm run db:messages` prepara `message_threads` y amplía `mesages` conservando sus datos originales. Los mensajes antiguos sin remitente/destinatario identificados se conservan, pero no se exponen a cuentas ajenas. La mensajería requiere una sesión válida y un paquete simulado. El destinatario puede indicarse por su nombre de usuario o email registrado. No se envían correos: la entrega ocurre dentro de Thotem.

`GET /api/messages` devuelve las conversaciones del usuario. `POST /api/messages` recibe recipient, subject (hasta 120 caracteres) y content (hasta 5000 caracteres). `GET /api/messages/:id` carga el historial y `POST /api/messages/:id/replies` recibe content y responde al otro participante. El servidor obtiene el remitente desde la sesión y comprueba los participantes antes de leer o responder. El front actualiza la bandeja y la conversación cada 5 segundos mientras la pestaña está visible, y al recuperar el foco. La URL de la conversación permite recargar sin perder el historial.

Validación con cuentas temporales: `node scripts/verify-messages.js`. No modifica usuarios reales ni manda correos.

## Recuperación de contraseña

`npm run db:auth` crea también `password_resets`. El flujo usa `POST /api/auth/password-reset/request` con email, `/verify` con requestId y código de 6 dígitos, y `/confirm` con resetToken y password. El código se envía por el mismo SMTP de bienvenida, vence a los 15 minutos y admite 5 intentos incorrectos. Solicitar otro código invalida el anterior. Verificarlo genera una autorización de un solo uso que vence en 10 minutos. Los códigos se guardan como hashes scrypt y las autorizaciones como hashes SHA-256. Al cambiar la contraseña se eliminan las sesiones de esa cuenta, conservando su pago simulado. La respuesta de solicitud no revela si un email existe. Se permiten hasta 5 solicitudes por IP cada 15 minutos. La recuperación comprueba SMTP antes de generar el código y espera a que Gmail acepte el correo antes de responder. Si la conexión o el envío fallan, devuelve 503 y el front muestra el error sin avanzar a la pantalla del código. No hay reintentos automáticos. La red debe permitir SMTP saliente a smtp.gmail.com (465 con TLS o 587 con STARTTLS); verify-mail.js --network permite comprobarlo sin enviar credenciales ni mensajes.

Validación del flujo con MySQL: `node scripts/verify-password-reset.js`. Crea y elimina una cuenta temporal, usa un remitente de prueba en memoria y no envía correos reales.

Las sesiones duran 3 horas desde el registro o el login; navegar o consultar el perfil no renueva ese plazo. La cookie y MySQL usan el mismo vencimiento. El perfil incluye `sessionExpiresAt` para que el front cierre la sesión y muestre el login al vencer, incluso con la página abierta. Ejecutar `node scripts/update-session-duration.js` adapta las sesiones anteriores de 7 días conservando sus primeras 3 horas; las cuentas y sus compras se mantienen.

El frontend usa la API Express del puerto 3001. Los datos se guardan en MySQL
mediante `mysql2`; los endpoints de autenticación no utilizan el cliente SQLite
antiguo de `prisma/client.js`. El esquema Prisma refleja los campos de autenticación.

1. Creá la base `proyectoIntegrador` y sus tablas con el SQL original.
2. Configurá `.env` dentro de esta carpeta (ver `.env.example`):
   `DATABASE_URL="mysql://USUARIO:CONTRASENA@localhost:3306/proyectoIntegrador"`.
   Si la contraseña contiene caracteres especiales, codificalos para URL.
3. Ejecutá `npm run db:auth` en esta carpeta. Amplía `users.password` a 255,
   añade unicidad de nombre/email y crea `auth_sessions`, sin eliminar usuarios.
   El script se puede repetir. Si hay duplicados, avisa antes de cambiar la base.
4. Iniciá el backend con `npm start` y el frontend con su comando habitual.
   Reiniciá Vite para activar el proxy `/api`.

## Endpoints

- `POST /api/users/register`: `{ name, email, password }`, crea una cuenta de tipo `user`
  e inicia sesión automáticamente con la misma cookie que el login.
- `POST /api/auth/login`: `{ name, password }` (también admite email), devuelve
  el perfil y una cookie HttpOnly válida durante siete días.
- `GET /api/users/profile`: restaura el perfil usando la cookie.
- `POST /api/auth/logout`: elimina la sesión de MySQL y la cookie.

Las contraseñas se guardan con scrypt y sal aleatoria. Las cuentas anteriores
que tienen contraseña sin cifrar se actualizan después de un login correcto.
La API nunca devuelve la contraseña. Los tokens se guardan como hash
en MySQL; el navegador no guarda contraseña ni token en localStorage.
El marcador de localStorage solo sincroniza cambios de sesión entre pestañas.

En producción, serví frontend y `/api` bajo el mismo sitio mediante HTTPS,
configurá `NODE_ENV=production` y `FRONTEND_URL` con el origen real.

`npm test` verifica HTTP, cookies, registro, login, perfil, logout, expiración,
roles y validaciones con un repositorio de prueba, sin modificar MySQL.

## Correo de bienvenida

Cada registro exitoso envía un correo al email de esa nueva cuenta con el asunto
`¡Registro completado!` y el texto solicitado por Thotem. El login y los intentos
de registro duplicados no envían correos. El envío ocurre después de responder al
registro: un fallo de SMTP se informa en la consola del backend y no elimina la
cuenta ni la sesión. Actualmente el envío tiene un intento, sin reenvío automático.

Para Gmail, agregá estas variables al `.env` del backend:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER="tu-cuenta@gmail.com"
SMTP_PASSWORD="tu-contraseña-de-aplicación"
```

Usá una contraseña de aplicación de Google con la verificación en dos pasos
activada, según https://support.google.com/accounts/answer/185833?hl=es.
No uses la contraseña normal de Gmail. La cuenta configurada es la remitente;
el destinatario siempre es el email de quien se registra.

Ejecutá `npm run mail:verify` para comprobar la conexión SMTP sin enviar mensajes,
y reiniciá el backend después de guardar `.env`. Para otro proveedor, configurá
su host, puerto y credenciales SMTP. No se guardan credenciales de correo en el
frontend ni se devuelven a los clientes de la API.
# Pagos simulados

Ejecutar `npm run db:auth` también crea `simulated_purchases`, sin modificar las tablas de facturación o tarjetas. `POST /api/payments/simulate` exige una cookie de sesión válida y recibe `plan` (Small Plan, Medium Plan o Large Plan) y `method` (Visa, Mercado Pago o Mastercard). No procesa cobros ni recibe datos de tarjetas. Guarda el último paquete simulado de cada cuenta y lo devuelve en `user.purchase` al registrar, iniciar sesión o consultar el perfil. Los importes simulados son Small Plan: 250, Medium Plan: 500 y Large Plan: 750, definidos en config/plans.json. El backend calcula y guarda amount sin aceptar importes del cliente. La moneda y los vencimientos están pendientes de definición. Las compras anteriores sin importe se conservan con amount NULL.
