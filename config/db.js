const mysql = require('mysql2/promise');

function createDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Configurá DATABASE_URL en .env con la conexión a proyectoIntegrador.');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL debe usar MySQL.');
  return mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: 5,
    connectTimeout: 5000,
    timezone: 'Z',
  });
}

module.exports = { createDatabase };
