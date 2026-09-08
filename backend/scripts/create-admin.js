import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db.js'

const [, , email, password] = process.argv
if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password>')
  process.exit(1)
}

const passwordHash = await bcrypt.hash(password, 10)
await db('users').insert({ email, password_hash: passwordHash, role: 'admin', display_name: 'Admin', email_verified: true })
  .onConflict('email').merge({ password_hash: passwordHash, role: 'admin' })
console.log(`Admin account ready: ${email}`)
await db.destroy()
