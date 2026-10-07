# Registro y sesión

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
