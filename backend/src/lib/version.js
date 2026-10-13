import { readFileSync } from 'node:fs'

// One version for the whole system, kept in the repo-root VERSION file.
// deploy/deploy.sh exports APP_VERSION / GIT_SHA into the container; running
// from a checkout (npm run dev) falls back to reading VERSION directly.
function readVersionFile() {
  try {
    return readFileSync(new URL('../../../VERSION', import.meta.url), 'utf8').trim()
  } catch {
    return null
  }
}

export const APP_VERSION = process.env.APP_VERSION || readVersionFile() || 'dev'
export const GIT_SHA = process.env.GIT_SHA || null
