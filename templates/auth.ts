// Auth: bcrypt password hashes in the Users tab, JWT bearer tokens.
// Mirrors the C# IdentityAuthService behavior: case-insensitive usernames,
// disabled accounts can't log in, first run seeds an admin account.

import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { ConfigurationError, HttpError, ValidationError } from './errors'
import { addUser, findUser, listUsers, updateUserRow } from './stores'
import type { Role } from './types'

const TOKEN_EXPIRY_MINUTES = 480 // matches the C# JwtOptions default (8h)

export type AuthUser = { username: string; roles: string[] }

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new ConfigurationError('JWT_SECRET must be set to a random string of at least 32 characters.')
  }
  return secret
}

let seeded = false

/** First run: if no users exist, create the admin account from env vars. */
export async function ensureAdminSeeded(): Promise<void> {
  if (seeded) return
  const users = await listUsers()
  if (users.length === 0) {
    const username = (process.env.SEED_ADMIN_USERNAME || 'admin').trim()
    const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!'
    await addUser(username, bcrypt.hashSync(password, 10), 'Admin')
  }
  seeded = true
}

export async function login(username: string, password: string): Promise<{
  accessToken: string
  expiresAtUtc: string
  username: string
  roles: string[]
} | null> {
  await ensureAdminSeeded()
  const user = await findUser(username)
  if (!user || user.isDisabled) return null
  if (!bcrypt.compareSync(password, user.passwordHash)) return null

  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60_000)
  const accessToken = jwt.sign(
    { sub: user.username, roles: [user.role] },
    jwtSecret(),
    { expiresIn: `${TOKEN_EXPIRY_MINUTES}m` },
  )
  return {
    accessToken,
    expiresAtUtc: expiresAt.toISOString(),
    username: user.username,
    roles: [user.role],
  }
}

export function authenticate(req: Request): AuthUser {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, 'Authentication required.')
  try {
    const payload = jwt.verify(match[1], jwtSecret()) as { sub?: string; roles?: string[] }
    if (!payload.sub) throw new Error('no subject')
    return { username: payload.sub, roles: payload.roles ?? [] }
  } catch (e) {
    if (e instanceof ConfigurationError) throw e
    throw new HttpError(401, 'Session expired — please log in again.')
  }
}

export function requireAdmin(user: AuthUser): void {
  if (!user.roles.includes('Admin')) {
    throw new HttpError(403, 'Admin role required.')
  }
}

export function isSeamstress(user: AuthUser): boolean {
  return user.roles.includes('Seamstress')
}

function validatePassword(password: string | null | undefined): string {
  if (!password || password.length < 8) {
    throw new ValidationError(['Password must be at least 8 characters.'])
  }
  return password
}

export async function createUser(username: string | null | undefined, password: string | null | undefined, role: Role): Promise<void> {
  const name = (username ?? '').trim()
  if (!name) throw new ValidationError(['Username is required.'])
  const pw = validatePassword(password)
  if (await findUser(name)) {
    throw new ValidationError([`A user named "${name}" already exists.`])
  }
  await addUser(name, bcrypt.hashSync(pw, 10), role)
}

export async function resetPassword(username: string, newPassword: string | null | undefined): Promise<void> {
  const pw = validatePassword(newPassword)
  const user = await findUser(username)
  if (!user) throw new ValidationError(['User not found.'])
  user.passwordHash = bcrypt.hashSync(pw, 10)
  await updateUserRow(user)
}

export async function setUserEnabled(username: string, enabled: boolean): Promise<void> {
  const user = await findUser(username)
  if (!user) throw new ValidationError(['User not found.'])
  user.isDisabled = !enabled
  await updateUserRow(user)
}

export async function changePassword(username: string, currentPassword: string | null | undefined, newPassword: string | null | undefined): Promise<void> {
  const user = await findUser(username)
  if (!user) throw new HttpError(401, 'Authentication required.')
  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    throw new HttpError(400, 'Current password is incorrect.')
  }
  const pw = validatePassword(newPassword)
  user.passwordHash = bcrypt.hashSync(pw, 10)
  await updateUserRow(user)
}
