-- Ejecutar sobre la base del proyecto, sin eliminar usuarios ni otras tablas.
USE proyectoIntegrador;
ALTER TABLE users MODIFY COLUMN password VARCHAR(255);
ALTER TABLE users ADD UNIQUE KEY users_name_unique (name);
ALTER TABLE users ADD UNIQUE KEY users_email_unique (email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  tokenHash CHAR(64) PRIMARY KEY,
  idUser VARCHAR(10) NOT NULL,
  expiresAt DATETIME NOT NULL,
  INDEX auth_sessions_user (idUser),
  INDEX auth_sessions_expiration (expiresAt)
);
