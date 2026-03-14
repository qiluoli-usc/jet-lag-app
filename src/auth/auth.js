import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createUser, findUserByName, findUserById } from "../db/userRepository.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "jetlag-dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";
const BCRYPT_ROUNDS = 10;

function newUserId() {
  return `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

/**
 * Register a new user.
 * @param {{ displayName: string, password: string }} input
 * @returns {{ token: string, user: { id: string, displayName: string } }}
 */
export async function registerUser({ displayName, password }) {
  if (!displayName || typeof displayName !== "string" || displayName.trim().length < 1) {
    const err = new Error("displayName is required (min 1 character)");
    err.status = 400;
    throw err;
  }
  if (!password || typeof password !== "string" || password.length < 4) {
    const err = new Error("password is required (min 4 characters)");
    err.status = 400;
    throw err;
  }

  const normalizedName = displayName.trim();
  const existing = findUserByName(normalizedName);
  if (existing) {
    const err = new Error(`User "${normalizedName}" already exists`);
    err.status = 409;
    throw err;
  }

  const id = newUserId();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = createUser(id, normalizedName, passwordHash);

  return {
    token: signToken(user),
    user: { id: user.id, displayName: user.displayName, createdAt: user.createdAt },
  };
}

/**
 * Login an existing user.
 * @param {{ displayName: string, password: string }} input
 * @returns {{ token: string, user: { id: string, displayName: string } }}
 */
export async function loginUser({ displayName, password }) {
  if (!displayName || !password) {
    const err = new Error("displayName and password are required");
    err.status = 400;
    throw err;
  }

  const user = findUserByName(displayName.trim());
  if (!user) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    throw err;
  }

  return {
    token: signToken(user),
    user: { id: user.id, displayName: user.displayName, createdAt: user.createdAt },
  };
}

/**
 * Verify a JWT token and return the payload.
 * @param {string} token
 * @returns {{ userId: string, displayName: string }}
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("Invalid or expired token");
    err.status = 401;
    throw err;
  }
}

/**
 * Resolve a userId to the full user record (without passwordHash).
 * @param {string} userId
 * @returns {{ id: string, displayName: string } | null}
 */
export function getUserProfile(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  return { id: user.id, displayName: user.displayName, createdAt: user.createdAt };
}
