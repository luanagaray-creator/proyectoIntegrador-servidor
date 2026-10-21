const planLimits = require('../config/planLimits.json');
const planCapacitySql = `CASE payment.plan ${Object.entries(planLimits).map(([plan, limit]) => `WHEN '${plan}' THEN ${limit}`).join(' ')} ELSE 0 END`;
const planMemberLimits = require('../config/planMemberLimits.json');

async function memberCapacity(connection, spaceId) {
  const [coverage] = await connection.execute(`SELECT payment.plan FROM communication_spaces s JOIN admin_plan_spaces covered ON covered.spaceId = s.id JOIN simulated_purchases payment ON payment.idUser = covered.adminId JOIN space_administrators manager ON manager.spaceId = s.id AND manager.idUser = covered.adminId JOIN users payer ON payer.idUser = covered.adminId AND payer.typeUser = 'admin' WHERE s.id = ? AND (SELECT COUNT(*) FROM admin_plan_spaces assigned WHERE assigned.adminId = covered.adminId) <= ${planCapacitySql}`, [spaceId]);
  return Math.max(0, ...coverage.map(row => planMemberLimits[row.plan] || 0));
}
const fail = (status, message) => Object.assign(new Error(message), { status });

async function lockInstitutions(connection, adminId) {
  await connection.execute('SELECT i.id FROM institutions i WHERE EXISTS (SELECT 1 FROM communication_spaces s JOIN space_administrators manager ON manager.spaceId = s.id WHERE s.institutionId = i.id AND manager.idUser = ?) OR EXISTS (SELECT 1 FROM communication_spaces s JOIN admin_plan_spaces covered ON covered.spaceId = s.id WHERE s.institutionId = i.id AND covered.adminId = ?) ORDER BY i.id FOR UPDATE', [adminId, adminId]);
}

async function validateCoverage(connection, adminId, spaceIds, plan) {
  const limit = planLimits[plan];
  if (!limit || spaceIds.length > limit) throw fail(400, `Este plan permite hasta ${limit || 0} espacios.`);
  const [selected] = await connection.execute(`SELECT id, institutionId FROM communication_spaces WHERE id IN (${spaceIds.map(() => '?').join(',')})`, spaceIds);
  const institutionIds = [...new Set(selected.map(space => space.institutionId))];
  if (institutionIds.length !== 1) throw fail(400, 'Seleccioná espacios de una sola institución para este plan.');
  const institutionId = institutionIds[0];
  const [coverage] = await connection.execute(`SELECT covered.spaceId, payment.plan FROM admin_plan_spaces covered JOIN communication_spaces s ON s.id = covered.spaceId JOIN simulated_purchases payment ON payment.idUser = covered.adminId JOIN space_administrators manager ON manager.spaceId = covered.spaceId AND manager.idUser = covered.adminId JOIN users payer ON payer.idUser = covered.adminId AND payer.typeUser = 'admin' WHERE s.institutionId = ? AND covered.adminId <> ? AND (SELECT COUNT(*) FROM admin_plan_spaces assigned WHERE assigned.adminId = covered.adminId) <= ${planCapacitySql}`, [institutionId, adminId]);
  const capacity = Math.min(limit, ...coverage.map(row => planLimits[row.plan] || 0));
  const total = new Set([...spaceIds, ...coverage.map(row => row.spaceId)]).size;
  if (total > capacity) throw fail(409, `La institución puede tener hasta ${capacity} espacios activos con sus planes actuales. Elegí menos espacios o contratá un plan mayor.`);
}

module.exports = { memberCapacity, lockInstitutions, validateCoverage, planCapacitySql };
