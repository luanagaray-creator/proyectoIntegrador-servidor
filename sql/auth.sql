-- Ejecutar sobre la base del proyecto, sin eliminar usuarios ni otras tablas.
USE proyectoIntegrador;
CREATE TABLE IF NOT EXISTS simulated_purchases (
  idUser VARCHAR(10) PRIMARY KEY,
  plan VARCHAR(30) NOT NULL,
  method VARCHAR(20) NOT NULL,
  amount DECIMAL(10,2) NULL,
  paidAt DATETIME NOT NULL
);
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
