const { randomBytes } = require('node:crypto');
const groups = require('../config/groups.json');
const fail = (status, message) => Object.assign(new Error(message), { status });
const idOf = () => randomBytes(5).toString('hex');
function createInstitutionService(db, auth) {
  async function superuser(token) {
    const user = await auth.profile(token);
    if (user.typeUser !== 'superadmin') throw fail(403, 'Solo Thotem puede administrar instituciones y asignar administradores.');
    return user;
  }
  async function manager(token, spaceId) {
    const user = await auth.profile(token);
    if (user.typeUser !== 'admin' || !user.managedSpaces.some(space => space.id === spaceId)) throw fail(403, 'No administrás ese espacio.');
    return user;
  }
  async function findUser(identifier) {
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.trim().length > 30) throw fail(400, 'Ingresá el usuario o email de una cuenta registrada.');
    const [rows] = await db.execute('SELECT idUser, name, email, typeUser FROM users WHERE name = ? OR email = ?', [identifier.trim(), identifier.trim()]);
    if (rows.length !== 1) throw fail(404, 'No se encontró esa cuenta. Debe registrarse primero.');
    return rows[0];
  }
  async function dashboard(token) {
    await superuser(token);
    const [institutions] = await db.query('SELECT id, name FROM institutions ORDER BY name');
    const [spaces] = await db.query('SELECT id, name, institutionId FROM communication_spaces ORDER BY name');
    const [administrators] = await db.query('SELECT manager.spaceId, u.idUser, u.name, u.email FROM space_administrators manager JOIN users u ON u.idUser = manager.idUser ORDER BY u.name');
    return { institutions, spaces, administrators };
  }
  async function createInstitution(token, body) {
    await superuser(token);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw fail(400, 'El nombre de la institución debe tener entre 1 y 80 caracteres.');
    const codes = body.groupCodes;
    if (!Array.isArray(codes) || !codes.length || new Set(codes).size !== codes.length || codes.some(code => !groups.includes(code))) throw fail(400, 'Elegí al menos uno de los seis espacios disponibles.');
    const connection = await db.getConnection();
    const id = idOf();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO institutions (id, name) VALUES (?, ?)', [id, name]);
      for (const code of codes) await connection.execute('INSERT INTO communication_spaces (id, institutionId, name) VALUES (?, ?, ?)', [idOf(), id, code]);
      await connection.commit();
      return { id };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'Esa institución ya existe.');
      throw err;
    } finally { connection.release(); }
  }
  async function grantAdministrator(token, body) {
    await superuser(token);
    const target = await findUser(body.user);
    if (target.typeUser === 'superadmin') throw fail(400, 'La cuenta de Thotem administra la plataforma. Elegí una cuenta institucional.');
    if (!Array.isArray(body.spaceIds) || !body.spaceIds.length || body.spaceIds.length > 100 || new Set(body.spaceIds).size !== body.spaceIds.length) throw fail(400, 'Elegí los espacios que podrá administrar.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const id of body.spaceIds) {
        if (typeof id !== 'string' || !/^[a-f0-9]{10}$/.test(id)) throw fail(400, 'El espacio no es válido.');
        const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE id = ?', [id]);
        if (!spaces[0]) throw fail(404, 'No se encontró uno de los espacios.');
        await connection.execute('INSERT IGNORE INTO space_administrators (spaceId, idUser) VALUES (?, ?)', [id, target.idUser]);
      }
      await connection.execute("UPDATE users SET typeUser = 'admin' WHERE idUser = ?", [target.idUser]);
      await connection.commit();
      return { message: 'Permisos de administración asignados.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function revokeAdministrator(token, spaceId, targetId) {
    await superuser(token);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM admin_plan_spaces WHERE spaceId = ? AND adminId = ?', [spaceId, targetId]);
      await connection.execute('DELETE FROM space_administrators WHERE spaceId = ? AND idUser = ?', [spaceId, targetId]);
      await connection.execute("UPDATE users SET typeUser = 'user' WHERE idUser = ? AND typeUser = 'admin' AND NOT EXISTS (SELECT 1 FROM space_administrators WHERE idUser = ?)", [targetId, targetId]);
      await connection.commit();
      return { message: 'Permiso de administración retirado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function members(token, spaceId) {
    await manager(token, spaceId);
    const [members] = await db.execute('SELECT u.idUser, u.name, u.email FROM space_memberships member JOIN users u ON u.idUser = member.idUser WHERE member.spaceId = ? ORDER BY u.name', [spaceId]);
    return { members };
  }
  async function grantMember(token, spaceId, body) {
    const user = await manager(token, spaceId);
    const target = await findUser(body.user);
    if (target.typeUser !== 'user') throw fail(400, 'Elegí una cuenta de usuario común para habilitarla como miembro.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [permissions] = await connection.execute('SELECT spaceId FROM space_administrators WHERE spaceId = ? AND idUser = ? FOR UPDATE', [spaceId, user.idUser]);
      if (!permissions[0]) throw fail(403, 'El permiso para administrar ese espacio fue retirado.');
      await connection.execute('INSERT IGNORE INTO space_memberships (spaceId, idUser, grantedBy) VALUES (?, ?, ?)', [spaceId, target.idUser, user.idUser]);
      await connection.commit();
      return { message: 'Usuario habilitado en el espacio.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function revokeMember(token, spaceId, targetId) {
    const user = await manager(token, spaceId);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [permissions] = await connection.execute('SELECT spaceId FROM space_administrators WHERE spaceId = ? AND idUser = ? FOR UPDATE', [spaceId, user.idUser]);
      if (!permissions[0]) throw fail(403, 'El permiso para administrar ese espacio fue retirado.');
      await connection.execute('DELETE FROM space_memberships WHERE spaceId = ? AND idUser = ?', [spaceId, targetId]);
      await connection.commit();
      return { message: 'Acceso del usuario retirado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  return { dashboard, createInstitution, grantAdministrator, revokeAdministrator, members, grantMember, revokeMember };
}
module.exports = { createInstitutionService };
