function normalizeUserRole(role) {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return value === 'administrador' || value === 'admin' ? 'admin' : role;
}

const administratorRoleSql = "LOWER(TRIM(typeUser)) IN ('admin', 'administrador')";

module.exports = { normalizeUserRole, administratorRoleSql };
