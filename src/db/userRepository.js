import db from "./db.js";

const insertUser = db.prepare(`
  INSERT INTO users (id, display_name, password_hash, created_at)
  VALUES (@id, @displayName, @passwordHash, @createdAt)
`);

const selectByName = db.prepare(`
  SELECT id, display_name AS displayName, password_hash AS passwordHash, created_at AS createdAt
  FROM users WHERE display_name = ?
`);

const selectById = db.prepare(`
  SELECT id, display_name AS displayName, password_hash AS passwordHash, created_at AS createdAt
  FROM users WHERE id = ?
`);

export function createUser(id, displayName, passwordHash) {
  const createdAt = new Date().toISOString();
  insertUser.run({ id, displayName, passwordHash, createdAt });
  return { id, displayName, createdAt };
}

export function findUserByName(displayName) {
  return selectByName.get(displayName) ?? null;
}

export function findUserById(id) {
  return selectById.get(id) ?? null;
}
