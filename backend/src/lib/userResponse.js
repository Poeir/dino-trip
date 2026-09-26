// avatar_updated_at rides along as ?v= so a changed photo isn't served from the
// browser cache under the same URL (the avatar endpoint caches aggressively).
const avatarUrlFor = (row) => {
  if (row.avatar_preset) return `preset:${row.avatar_preset}`
  const hasPhoto = row.avatar_data != null || row.has_avatar
  if (!hasPhoto) return null
  const v = row.avatar_updated_at ? `?v=${new Date(row.avatar_updated_at).getTime()}` : ''
  return `/api/users/${row.id}/avatar${v}`
}

// Compact shape returned by login / confirm / reset / me.
export const toUserResponse = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name || row.email.split('@')[0],
  phone: row.phone || null,
  title: row.title || null,
  avatarUrl: avatarUrlFor(row),
  avatarPosition: row.avatar_position || null,
  avatarScale: row.avatar_scale != null ? Number(row.avatar_scale) : null,
  role: row.role || 'tourist',
})

// Everything the profile page shows and edits. Never includes the password
// hash, the raw avatar bytes, or admin-side account-management fields.
export const toProfileResponse = (row) => ({
  ...toUserResponse(row),
  firstName: row.first_name || null,
  lastName: row.last_name || null,
  gender: row.gender || null,
  province: row.province || null,
  district: row.district || null,
  subdistrict: row.subdistrict || null,
  // db.js keeps `date` columns as plain 'YYYY-MM-DD' strings.
  birthdate: row.birthdate || null,
  occupation: row.occupation || null,
  emailVerified: !!row.email_verified,
  pointsBalance: row.points_balance,
  createdAt: row.created_at,
})
