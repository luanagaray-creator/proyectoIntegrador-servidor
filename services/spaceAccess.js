// Una cobertura solo vale si quien paga sigue siendo administrador de ese espacio.
const activeCoverage = "EXISTS (SELECT 1 FROM admin_plan_spaces covered JOIN simulated_purchases payment ON payment.idUser = covered.adminId JOIN space_administrators manager ON manager.spaceId = covered.spaceId AND manager.idUser = covered.adminId JOIN users payer ON payer.idUser = covered.adminId AND payer.typeUser = 'admin' WHERE covered.spaceId = s.id)";

async function loadSpaceAccess(db, user) {
  const [managedSpaces] = await db.execute('SELECT s.id, s.name, s.institutionId, i.name AS institutionName FROM communication_spaces s JOIN institutions i ON i.id = s.institutionId JOIN space_administrators manager ON manager.spaceId = s.id WHERE manager.idUser = ? ORDER BY i.name, s.name', [user.idUser]);
  const [rows] = await db.execute(`SELECT s.id, s.name, s.institutionId, i.name AS institutionName, ${activeCoverage} AS isActive FROM communication_spaces s JOIN institutions i ON i.id = s.institutionId WHERE EXISTS (SELECT 1 FROM space_memberships member WHERE member.spaceId = s.id AND member.idUser = ?) OR EXISTS (SELECT 1 FROM space_administrators manager WHERE manager.spaceId = s.id AND manager.idUser = ?) ORDER BY i.name, s.name`, [user.idUser, user.idUser]);
  const spaces = rows.map(space => ({ ...space, isActive: Boolean(space.isActive) }));
  let purchase = null;
  if (user.typeUser === 'admin') {
    const [purchases] = await db.execute('SELECT plan, method, paidAt, amount FROM simulated_purchases WHERE idUser = ?', [user.idUser]);
    if (purchases[0]) {
      const [included] = await db.execute('SELECT covered.spaceId FROM admin_plan_spaces covered JOIN space_administrators manager ON manager.spaceId = covered.spaceId AND manager.idUser = covered.adminId WHERE covered.adminId = ?', [user.idUser]);
      purchase = { ...purchases[0], amount: purchases[0].amount == null ? null : Number(purchases[0].amount), simulated: true, spaceIds: included.map(row => row.spaceId) };
    }
  }
  return { managedSpaces, spaces, purchase, hasAccess: spaces.some(space => space.isActive), canPurchase: user.typeUser === 'admin' && managedSpaces.length > 0 };
}
function selectActiveSpace(user, requestedId) {
  const space = requestedId ? user.spaces.find(item => item.id === requestedId) : user.spaces.find(item => item.isActive);
  if (!space || !space.isActive) throw Object.assign(new Error('No tenés acceso a ese espacio o su plan no está habilitado.'), { status: 403 });
  return space;
}
module.exports = { loadSpaceAccess, selectActiveSpace, activeCoverage };
