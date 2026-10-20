const { randomBytes } = require('node:crypto');
const groups = require('../config/groups.json');
const { MEMBER_CAPACITY } = require('./planCapacity');
const planLimits = require('../config/planLimits.json');
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
    const [institutionPlans] = await db.query("SELECT payment.institutionId, payment.idUser AS payerId, payment.plan, payment.amount, payment.paidAt, payer.name AS payerName, payer.email AS payerEmail, payer.isActive AS payerIsActive FROM simulated_purchases payment LEFT JOIN users payer ON payer.idUser = payment.idUser WHERE payment.institutionId IS NOT NULL ORDER BY payment.paidAt DESC, payment.idUser");
    const [spaces] = await db.query('SELECT id, name, institutionId FROM communication_spaces ORDER BY name');
    const [administrators] = await db.query('SELECT manager.spaceId, u.idUser, u.name, u.email FROM space_administrators manager JOIN users u ON u.idUser = manager.idUser ORDER BY u.name');
    const [institutionAdministrators] = await db.query('SELECT manager.institutionId, u.idUser, u.name, u.email FROM institution_administrators manager JOIN users u ON u.idUser = manager.idUser ORDER BY u.name');
    const [accounts] = await db.query("SELECT idUser, name, email, typeUser, isActive FROM users WHERE typeUser = 'admin' ORDER BY name, idUser");
    const adminAccounts = accounts.map(account => ({ ...account, isActive: Boolean(account.isActive) }));
    const planByInstitution = new Map();
    for (const payment of institutionPlans) {
      if (!planByInstitution.has(payment.institutionId)) planByInstitution.set(payment.institutionId, {
        plan: payment.plan,
        amount: payment.amount == null ? null : Number(payment.amount),
        paidAt: payment.paidAt,
        payerId: payment.payerId,
        payerName: payment.payerName,
        payerEmail: payment.payerEmail,
        payerIsActive: payment.payerIsActive == null ? null : Boolean(payment.payerIsActive),
      });
    }
    return { institutions: institutions.map(institution => ({ ...institution, plan: planByInstitution.get(institution.id) || null })), spaces, administrators, institutionAdministrators, adminAccounts };
  }
  async function setAdministratorStatus(token, targetId, body) {
    await superuser(token);
    if (typeof body.isActive !== 'boolean') throw fail(400, 'Indicá si el administrador debe estar activo o inactivo.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [accounts] = await connection.execute('SELECT idUser, typeUser FROM users WHERE idUser = ? FOR UPDATE', [targetId]);
      if (!accounts[0]) throw fail(404, 'No se encontró el administrador.');
      if (accounts[0].typeUser !== 'admin') throw fail(400, 'Solo se puede cambiar el estado de una cuenta administradora institucional.');
      await connection.execute('UPDATE users SET isActive = ? WHERE idUser = ?', [body.isActive ? 1 : 0, targetId]);
      if (!body.isActive) await connection.execute('DELETE FROM auth_sessions WHERE idUser = ?', [targetId]);
      await connection.commit();
      return { idUser: targetId, isActive: body.isActive, message: body.isActive ? 'Administrador reactivado.' : 'Administrador desactivado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function createInstitution(token, body) {
    await superuser(token);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw fail(400, 'El nombre de la institución debe tener entre 1 y 80 caracteres.');
    const codes = body.groupCodes ?? [];
    if (!Array.isArray(codes) || new Set(codes).size !== codes.length || codes.some(code => !groups.includes(code))) throw fail(400, 'Los espacios iniciales no son válidos.');
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
    if (body.institutionId != null) return grantInstitutionAdministrator(target, body.institutionId);
    if (!Array.isArray(body.spaceIds) || !body.spaceIds.length || body.spaceIds.length > 100 || new Set(body.spaceIds).size !== body.spaceIds.length) throw fail(400, 'Elegí los espacios que podrá administrar.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`SELECT i.id FROM institutions i WHERE EXISTS (SELECT 1 FROM communication_spaces s WHERE s.institutionId = i.id AND s.id IN (${body.spaceIds.map(() => '?').join(',')})) ORDER BY i.id FOR UPDATE`, body.spaceIds);
      const [accounts] = await connection.execute('SELECT typeUser FROM users WHERE idUser = ? FOR UPDATE', [target.idUser]);
      if (!accounts[0] || accounts[0].typeUser === 'superadmin') throw fail(400, 'Elegí una cuenta institucional.');
      for (const id of body.spaceIds) {
        if (typeof id !== 'string' || !/^[a-f0-9]{10}$/.test(id)) throw fail(400, 'El espacio no es válido.');
        const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE id = ? FOR UPDATE', [id]);
        if (!spaces[0]) throw fail(404, 'No se encontró uno de los espacios.');
        await connection.execute('INSERT IGNORE INTO space_administrators (spaceId, idUser) VALUES (?, ?)', [id, target.idUser]);
      }
      await connection.execute('INSERT IGNORE INTO institution_administrators (institutionId, idUser) SELECT DISTINCT s.institutionId, ? FROM communication_spaces s JOIN space_administrators manager ON manager.spaceId = s.id WHERE manager.idUser = ?', [target.idUser, target.idUser]);
      await connection.execute("UPDATE users SET typeUser = 'admin' WHERE idUser = ?", [target.idUser]);
      await connection.execute('DELETE FROM space_memberships WHERE idUser = ?', [target.idUser]);
      await connection.commit();
      return { message: 'Permisos de administración asignados.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function grantInstitutionAdministrator(target, institutionId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [institutions] = await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [institutionId]);
      if (!institutions[0]) throw fail(404, 'No se encontró la institución.');
      const [accounts] = await connection.execute('SELECT typeUser FROM users WHERE idUser = ? FOR UPDATE', [target.idUser]);
      if (!accounts[0] || accounts[0].typeUser === 'superadmin') throw fail(400, 'Elegí una cuenta institucional.');
      await connection.execute('INSERT IGNORE INTO institution_administrators (institutionId, idUser) VALUES (?, ?)', [institutionId, target.idUser]);
      await connection.execute('INSERT IGNORE INTO space_administrators (spaceId, idUser) SELECT id, ? FROM communication_spaces WHERE institutionId = ?', [target.idUser, institutionId]);
      await connection.execute("UPDATE users SET typeUser = 'admin' WHERE idUser = ?", [target.idUser]);
      await connection.execute('DELETE FROM space_memberships WHERE idUser = ?', [target.idUser]);
      await connection.commit();
      return { message: 'Administrador de la institución autorizado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function createSpace(token, body) {
    const user = await auth.profile(token);
    if (user.typeUser !== 'admin') throw fail(403, 'Solo un administrador institucional puede crear espacios.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || [...name].length > 30) throw fail(400, 'El nombre del espacio debe tener entre 1 y 30 caracteres.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [institutions] = await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [body.institutionId || '']);
      if (!institutions[0]) throw fail(404, 'No se encontró la institución.');
      const [permissions] = await connection.execute('SELECT idUser FROM institution_administrators WHERE institutionId = ? AND idUser = ? FOR UPDATE', [body.institutionId, user.idUser]);
      if (!permissions[0]) throw fail(403, 'No administrás esta institución.');
      const [purchases] = await connection.execute("SELECT payment.idUser, payment.plan FROM simulated_purchases payment JOIN institution_administrators manager ON manager.idUser = payment.idUser AND manager.institutionId = payment.institutionId JOIN users u ON u.idUser = payment.idUser AND u.typeUser = 'admin' WHERE payment.institutionId = ? ORDER BY payment.amount DESC, payment.paidAt DESC FOR UPDATE", [body.institutionId]);
      const purchase = purchases[0];
      if (!purchase || !planLimits[purchase.plan]) throw fail(409, 'Contratá un plan antes de crear espacios.');
      const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE institutionId = ? FOR UPDATE', [body.institutionId]);
      if (spaces.length >= planLimits[purchase.plan]) throw fail(409, `Tu plan permite hasta ${planLimits[purchase.plan]} espacios. Eliminá uno o cambiá de plan para crear otro.`);
      const id = idOf();
      await connection.execute('INSERT INTO communication_spaces (id, institutionId, name) VALUES (?, ?, ?)', [id, body.institutionId, name]);
      await connection.execute('INSERT INTO space_administrators (spaceId, idUser) SELECT ?, idUser FROM institution_administrators WHERE institutionId = ?', [id, body.institutionId]);
      await connection.execute('INSERT INTO admin_plan_spaces (adminId, spaceId) VALUES (?, ?)', [purchase.idUser, id]);
      await connection.commit();
      return { id, message: 'Espacio creado.', capacity: MEMBER_CAPACITY };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'Ya existe un espacio con ese nombre en la institución.');
      throw err;
    } finally { connection.release(); }
  }
  async function revokeInstitutionAdministrator(token, institutionId, targetId) {
    await superuser(token);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [institutionId]);
      await connection.execute('SELECT idUser FROM users WHERE idUser = ? FOR UPDATE', [targetId]);
      const [permissions] = await connection.execute('SELECT idUser FROM institution_administrators WHERE institutionId = ? AND idUser = ? FOR UPDATE', [institutionId, targetId]);
      if (!permissions[0]) throw fail(404, 'No se encontró ese administrador en la institución.');
      await connection.execute('DELETE covered FROM admin_plan_spaces covered JOIN communication_spaces s ON s.id = covered.spaceId WHERE covered.adminId = ? AND s.institutionId = ?', [targetId, institutionId]);
      await connection.execute('DELETE manager FROM space_administrators manager JOIN communication_spaces s ON s.id = manager.spaceId WHERE manager.idUser = ? AND s.institutionId = ?', [targetId, institutionId]);
      await connection.execute('DELETE FROM simulated_purchases WHERE idUser = ? AND institutionId = ?', [targetId, institutionId]);
      await connection.execute('DELETE FROM institution_administrators WHERE institutionId = ? AND idUser = ?', [institutionId, targetId]);
      await connection.execute("UPDATE users SET typeUser = 'user' WHERE idUser = ? AND typeUser = 'admin' AND NOT EXISTS (SELECT 1 FROM institution_administrators WHERE idUser = ?) AND NOT EXISTS (SELECT 1 FROM space_administrators WHERE idUser = ?)", [targetId, targetId, targetId]);
      await connection.commit();
      return { message: 'Permiso institucional retirado.' };
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
      await connection.execute("UPDATE users SET typeUser = 'user' WHERE idUser = ? AND typeUser = 'admin' AND NOT EXISTS (SELECT 1 FROM space_administrators WHERE idUser = ?) AND NOT EXISTS (SELECT 1 FROM institution_administrators WHERE idUser = ?)", [targetId, targetId, targetId]);
      await connection.commit();
      return { message: 'Permiso de administración retirado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function members(token, spaceId) {
    await manager(token, spaceId);
    const [members] = await db.execute('SELECT u.idUser, u.name, u.email FROM space_memberships member JOIN users u ON u.idUser = member.idUser WHERE member.spaceId = ? ORDER BY u.name', [spaceId]);
    return { members, capacity: MEMBER_CAPACITY, available: Math.max(0, MEMBER_CAPACITY - members.length) };
  }
  async function renameSpace(token, spaceId, body) {
    const user = await auth.profile(token);
    if (user.typeUser !== 'superadmin' && (user.typeUser !== 'admin' || !user.managedSpaces.some(space => space.id === spaceId))) throw fail(403, 'No administrás ese espacio.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || [...name].length > 30) throw fail(400, 'El nombre del espacio debe tener entre 1 y 30 caracteres.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await lockSpace(connection, spaceId, user);
      await connection.execute('UPDATE communication_spaces SET name = ? WHERE id = ?', [name, spaceId]);
      await connection.commit();
      return { message: 'Nombre del espacio actualizado.' };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'Ya existe un espacio con ese nombre en la institución.');
      throw err;
    } finally { connection.release(); }
  }
  async function lockSpace(connection, spaceId, user) {
    const [institutions] = await connection.execute('SELECT i.id FROM institutions i JOIN communication_spaces s ON s.institutionId = i.id WHERE s.id = ? FOR UPDATE', [spaceId]);
    if (!institutions[0]) throw fail(404, 'No se encontró el espacio.');
    const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE id = ? FOR UPDATE', [spaceId]);
    if (!spaces[0]) throw fail(404, 'No se encontró el espacio.');
    if (user.typeUser !== 'superadmin') {
      const [permissions] = await connection.execute('SELECT spaceId FROM space_administrators WHERE spaceId = ? AND idUser = ? FOR UPDATE', [spaceId, user.idUser]);
      if (!permissions[0]) throw fail(403, 'El permiso para administrar ese espacio fue retirado.');
    }
  }
  async function removeSpace(connection, spaceId) {
    const [payers] = await connection.execute('SELECT adminId FROM admin_plan_spaces WHERE spaceId = ? FOR UPDATE', [spaceId]);
    await connection.execute('DELETE FROM group_chat_messages WHERE spaceId = ?', [spaceId]);
    await connection.execute('UPDATE message_threads SET spaceId = NULL WHERE spaceId = ?', [spaceId]);
    await connection.execute('DELETE FROM space_memberships WHERE spaceId = ?', [spaceId]);
    await connection.execute('DELETE FROM admin_plan_spaces WHERE spaceId = ?', [spaceId]);
    await connection.execute('DELETE FROM space_administrators WHERE spaceId = ?', [spaceId]);
    await connection.execute('DELETE FROM communication_spaces WHERE id = ?', [spaceId]);
    for (const payer of payers) await connection.execute('DELETE FROM simulated_purchases WHERE idUser = ? AND institutionId IS NULL AND NOT EXISTS (SELECT 1 FROM admin_plan_spaces WHERE adminId = ?)', [payer.adminId, payer.adminId]);
  }
  async function deleteSpace(token, spaceId) {
    const user = await auth.profile(token);
    if (user.typeUser !== 'superadmin' && (user.typeUser !== 'admin' || !user.managedSpaces.some(space => space.id === spaceId))) throw fail(403, 'No administrás ese espacio.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await lockSpace(connection, spaceId, user);
      await removeSpace(connection, spaceId);
      await connection.commit();
      return { message: 'Espacio eliminado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function deleteInstitution(token, institutionId) {
    await superuser(token);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [institutions] = await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [institutionId]);
      if (!institutions[0]) throw fail(404, 'No se encontró la institución.');
      const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE institutionId = ? ORDER BY id FOR UPDATE', [institutionId]);
      await connection.execute('SELECT id FROM message_threads WHERE institutionId = ? OR spaceId IN (SELECT id FROM communication_spaces WHERE institutionId = ?) ORDER BY id FOR UPDATE', [institutionId, institutionId]);
      const condition = 't.institutionId = ? OR t.spaceId IN (SELECT id FROM communication_spaces WHERE institutionId = ?)';
      await connection.execute(`DELETE favorite FROM message_stars favorite JOIN message_threads t ON t.id = favorite.threadId WHERE ${condition}`, [institutionId, institutionId]);
      await connection.execute(`DELETE message FROM mesages message JOIN message_threads t ON t.id = message.threadId WHERE ${condition}`, [institutionId, institutionId]);
      await connection.execute(`DELETE t FROM message_threads t WHERE ${condition}`, [institutionId, institutionId]);
      for (const space of spaces) await removeSpace(connection, space.id);
      await connection.execute('DELETE FROM simulated_purchases WHERE institutionId = ?', [institutionId]);
      await connection.execute('DELETE FROM institution_administrators WHERE institutionId = ?', [institutionId]);
      await connection.execute('DELETE FROM institutions WHERE id = ?', [institutionId]);
      await connection.commit();
      return { message: 'Institución eliminada.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function grantMember(token, spaceId, body) {
    const user = await manager(token, spaceId);
    const target = await findUser(body.user);
    if (target.typeUser !== 'user') throw fail(400, 'Elegí una cuenta de usuario común para habilitarla como miembro.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await lockSpace(connection, spaceId, user);
      // Serializa las asignaciones concurrentes del mismo usuario.
      const [targets] = await connection.execute('SELECT typeUser FROM users WHERE idUser = ? FOR UPDATE', [target.idUser]);
      if (targets[0]?.typeUser !== 'user') throw fail(400, 'Solo se puede asignar un chat a una cuenta de usuario común.');
      const [memberships] = await connection.execute('SELECT spaceId FROM space_memberships WHERE idUser = ?', [target.idUser]);
      if (memberships.some(member => member.spaceId !== spaceId)) throw fail(409, 'Este usuario ya tiene un chat asignado. Primero debe retirarse su acceso al chat anterior.');
      const [permissions] = await connection.execute('SELECT spaceId FROM space_administrators WHERE spaceId = ? AND idUser = ? FOR UPDATE', [spaceId, user.idUser]);
      if (!permissions[0]) throw fail(403, 'El permiso para administrar ese espacio fue retirado.');
      const [occupants] = await connection.execute('SELECT idUser FROM space_memberships WHERE spaceId = ? FOR UPDATE', [spaceId]);
      if (!occupants.some(member => member.idUser === target.idUser) && occupants.length >= MEMBER_CAPACITY) throw fail(409, `El espacio alcanzó el máximo de ${MEMBER_CAPACITY} usuarios.`);
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
  return { dashboard, createInstitution, grantAdministrator, revokeAdministrator, members, grantMember, revokeMember, renameSpace, deleteSpace, deleteInstitution, createSpace, revokeInstitutionAdministrator, setAdministratorStatus };
}
module.exports = { createInstitutionService };
