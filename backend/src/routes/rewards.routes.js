import { crudRouter, invalidateCache } from '../lib/crudRouter.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rewardPayload, rowToReward } from '../lib/mappers.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { db } from '../lib/db.js'
import { singleImageCleanup } from '../lib/cloudinaryCleanup.js'

const REWARD_COLUMNS = ['id', 'name', 'cost', 'stock', 'image_url']

export const rewardsRouter = crudRouter({
  table: 'rewards',
  select: REWARD_COLUMNS.join(', '),
  order: { column: 'cost' },
  toRow: rewardPayload,
  toResponse: rowToReward,
  mutateAuth: [requireAdmin],
  beforeDelete: singleImageCleanup('rewards'),
  // ?search= (QrTab's rewards search box).
  searchColumns: ['name'],
  // QrTab's rewards sort dropdown (name/cost).
  sortable: ['name', 'cost'],
})

const imageUpload = createImageUploadMiddleware('imageFile')

// One image per reward: uploading again replaces it (and deletes the old
// Cloudinary asset). Returns the full updated reward so the admin form can
// merge it into state without a refetch.
rewardsRouter.post('/:id/image', requireAdmin, imageUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'ไม่พบไฟล์รูปภาพ')
  const { id } = req.params
  const existing = await db('rewards').select('image_public_id').where('id', id).first()
  if (!existing) throw httpError(404, 'ไม่พบข้อมูล')
  let result
  try {
    result = await uploadImageBuffer(req.file.buffer, `dino/rewards/${id}`)
  } catch (err) {
    console.error(err)
    throw httpError(502, 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }
  const [row] = await db('rewards').where('id', id)
    .update({ image_url: result.secure_url, image_public_id: result.public_id })
    .returning(REWARD_COLUMNS)
  if (existing.image_public_id) await deleteImage(existing.image_public_id).catch(() => {})
  invalidateCache('rewards')
  res.json(rowToReward(row))
}))

rewardsRouter.delete('/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params
  const existing = await db('rewards').select('image_public_id').where('id', id).first()
  if (!existing) throw httpError(404, 'ไม่พบข้อมูล')
  if (existing.image_public_id) await deleteImage(existing.image_public_id).catch(() => {})
  const [row] = await db('rewards').where('id', id)
    .update({ image_url: null, image_public_id: null })
    .returning(REWARD_COLUMNS)
  invalidateCache('rewards')
  res.json(rowToReward(row))
}))
