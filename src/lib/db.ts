import type { PrismaClient } from '@prisma/client'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// NOTE: the Prisma client is loaded through Node's NATIVE module resolution
// (createRequire rooted at the project directory) instead of a static import, and any
// previously cached prisma modules are purged from the process-wide require cache
// before loading.
// Rationale: `prisma generate` rewrites node_modules/.prisma/client in place, but the
// running Next dev server keeps serving its in-memory snapshot of those files — a
// static import keeps returning the STALE generated client, so newly added models
// (e.g. round-16 PlatformSetting / Book / PointAward / TelegramLinkCode) don't exist
// at runtime ("Cannot read properties of undefined (reading 'findMany')").
// Native require (after a cache purge) always reads from disk, so the runtime client
// always matches the generated client. The instance is cached on globalThis keyed by
// a generation marker that is bumped whenever the schema gains models (SCHEMA_GEN).
const SCHEMA_GEN = 8 // bump after `prisma generate` adds models

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaGen?: number
}

type PrismaCtor = new (opts?: { log?: Array<'query' | 'info' | 'warn' | 'error'> }) => PrismaClient

interface PrismaModule {
  PrismaClient?: PrismaCtor
  default?: { PrismaClient?: PrismaCtor }
}

function pickCtor(mod: PrismaModule | undefined | null): PrismaCtor | null {
  if (!mod || typeof mod !== 'object') return null
  if (typeof mod.PrismaClient === 'function') return mod.PrismaClient
  if (mod.default && typeof mod.default.PrismaClient === 'function') return mod.default.PrismaClient
  return null
}

function loadViaNativeRequire(): PrismaCtor {
  // Resolution root: the project's package.json — independent of this module's
  // (possibly virtualized) location inside the dev-server module registry.
  const rootManifest = path.join(process.cwd(), 'package.json')
  const req = createRequire(pathToFileURL(rootManifest).href)

  // Purge stale prisma entries from the process-wide CommonJS module cache so the
  // require below re-reads the freshly generated client from disk.
  const cache = (req as unknown as { cache?: Record<string, unknown> }).cache
  if (cache) {
    for (const key of Object.keys(cache)) {
      if (key.includes('@prisma/client') || key.includes('.prisma/client')) {
        delete cache[key]
      }
    }
  }

  const Ctor = pickCtor(req('@prisma/client') as PrismaModule)
  if (!Ctor) throw new Error('PrismaClient not found via native require')
  return Ctor
}

async function makeClient(): Promise<PrismaClient> {
  const Ctor = loadViaNativeRequire()
  const client = new Ctor({ log: ['error'] })
  return client
}

let db: PrismaClient
if (globalForPrisma.prisma && globalForPrisma.prismaGen === SCHEMA_GEN) {
  db = globalForPrisma.prisma
} else {
  db = await makeClient()
  globalForPrisma.prisma = db
  globalForPrisma.prismaGen = SCHEMA_GEN
}

export { db }
