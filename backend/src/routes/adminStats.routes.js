import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { db } from '../lib/db.js'
import { APP_VERSION, GIT_SHA } from '../lib/version.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'

// Numbers for the admin dashboard's user / points / redemption cards.
export const adminStatsRouter = Router()
adminStatsRouter.use(requireAdmin)

// Which build each service is running, so an admin can spot a deploy where
// the services drifted apart. Kept admin-only on purpose: the public /health
// stays a bare "ok". A chatbot that is down must not fail the whole call.
adminStatsRouter.get('/system', asyncHandler(async (req, res) => {
  const chatbot = await forwardToChatbotService('/version').catch(() => null)
  res.json({
    backend: { version: APP_VERSION, sha: GIT_SHA },
    chatbot: chatbot && { version: chatbot.version, sha: chatbot.sha },
  })
}))

// Trip-planning statistics over the last ?days (7 / 30 / 90 / 365, default 30).
// Counts every recorded plan, including the ones recorded for visitors who
// were not logged in (trips.user_id null). Days are Thailand calendar days.
const TRIP_STAT_WINDOWS = new Set([7, 30, 90, 365])
const BKK_TODAY = "(now() at time zone 'Asia/Bangkok')::date"

adminStatsRouter.get('/trips', asyncHandler(async (req, res) => {
  const requested = parseInt(req.query.days, 10)
  const days = TRIP_STAT_WINDOWS.has(requested) ? requested : 30
  // Trips created since the start of the first day in the window.
  const since = `(${BKK_TODAY} - ${days - 1})::timestamp at time zone 'Asia/Bangkok'`
  const distribution = (expr) => db.raw(
    `select coalesce(${expr}, 'ไม่ระบุ') as label, count(*)::int as count from trips where created_at >= ${since} group by 1 order by 2 desc, 1`)

  const [totals, daily, topPlaces, budget, pace, area, interests, length, flagged, allTime] = await Promise.all([
    db.raw(`
      select count(*)::int as total,
        count(*) filter (where user_id is not null)::int as logged_in,
        count(*) filter (where user_id is null)::int as anonymous,
        coalesce(round(avg(days), 1), 0)::float as avg_days,
        coalesce(round(avg(total_cost_estimate)), 0)::int as avg_cost,
        count(*) filter (where is_favorite)::int as favorites
      from trips where created_at >= ${since}`),
    db.raw(`
      select to_char(g::date, 'YYYY-MM-DD') as day, count(t.id)::int as count
      from generate_series(${BKK_TODAY} - ${days - 1}, ${BKK_TODAY}, interval '1 day') g
      left join trips t on (t.created_at at time zone 'Asia/Bangkok')::date = g::date
      group by g order by g`),
    db.raw(`
      select p.id, p.name, count(distinct d.trip_id)::int as trips
      from trip_items i
      join trip_days d on d.id = i.day_id
      join trips t on t.id = d.trip_id
      join places p on p.id = i.place_id
      where i.kind = 'place' and t.created_at >= ${since}
      group by p.id, p.name order by trips desc, p.name limit 10`),
    distribution("input->>'budget_level'"),
    distribution("input->>'trip_pace'"),
    distribution("input->>'area_scope'"),
    db.raw(`
      select tag as label, count(*)::int as count from (
        select jsonb_array_elements_text(case when jsonb_typeof(input->'interests') = 'array' then input->'interests' else '[]'::jsonb end) as tag
        from trips where created_at >= ${since}
      ) x group by 1 order by 2 desc, 1 limit 10`),
    db.raw(`select days::text as label, count(*)::int as count from trips where created_at >= ${since} group by days order by days`),
    db.raw(`
      select count(*)::int as count from trips t
      where t.user_id is not null and exists (
        select 1 from trip_items i join trip_days d on d.id = i.day_id left join places p on p.id = i.place_id
        where d.trip_id = t.id and i.kind = 'place'
          and (i.place_id is null or p.is_active is false or p.business_status in ('CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY')))`),
    db.raw('select count(*)::int as count from trips'),
  ])

  const t = totals.rows[0]
  res.json({
    days,
    totals: { total: t.total, loggedIn: t.logged_in, anonymous: t.anonymous, avgDays: t.avg_days, avgCost: t.avg_cost, favorites: t.favorites, allTime: allTime.rows[0].count },
    daily: daily.rows,
    topPlaces: topPlaces.rows,
    budget: budget.rows, pace: pace.rows, area: area.rows, interests: interests.rows, length: length.rows,
    savedTripsWithFlaggedPlaces: flagged.rows[0].count,
  })
}))

adminStatsRouter.get('/', asyncHandler(async (req, res) => {
  const [users, points, scans, redemptions, recent] = await Promise.all([
    db.raw(`
      select
        count(*) filter (where deleted_at is null)::int as total,
        count(*) filter (where deleted_at is null and status = 'suspended')::int as suspended,
        count(*) filter (where deleted_at is null and not email_verified)::int as unverified,
        count(*) filter (where deleted_at is null and created_at > now() - interval '7 days')::int as new_7d,
        count(*) filter (where deleted_at is not null)::int as deleted,
        count(*) filter (where deleted_at is null and status = 'active' and role = 'admin')::int as active_admins
      from users`),
    db.raw(`
      select
        (select coalesce(sum(points_awarded), 0)::int from qr_scans) as distributed,
        (select coalesce(sum(points_balance), 0)::int from users where deleted_at is null) as outstanding`),
    db.raw(`select count(*)::int as last_7d from qr_scans where scanned_at > now() - interval '7 days'`),
    db.raw(`select count(*)::int as last_30d from redemptions where status = 'completed' and redeemed_at > now() - interval '30 days'`),
    db('redemptions as r')
      .leftJoin('users as u', 'u.id', 'r.user_id')
      .leftJoin('rewards as w', 'w.id', 'r.reward_id')
      .select('r.id', 'r.cost', 'r.status', 'r.redeemed_at', db.raw('coalesce(r.reward_name, w.name) as reward_name'), 'u.display_name', 'u.email')
      .orderBy('r.redeemed_at', 'desc')
      .limit(5),
  ])
  const u = users.rows[0]
  res.json({
    users: { total: u.total, suspended: u.suspended, unverified: u.unverified, newLast7Days: u.new_7d, deleted: u.deleted },
    activeAdmins: u.active_admins,
    points: { distributed: points.rows[0].distributed, outstanding: points.rows[0].outstanding },
    scansLast7Days: scans.rows[0].last_7d,
    redemptionsLast30Days: redemptions.rows[0].last_30d,
    recentRedemptions: recent.map((r) => ({
      id: r.id,
      userName: r.display_name || r.email || '-',
      rewardName: r.reward_name || '(ของรางวัลถูกลบแล้ว)',
      cost: r.cost,
      status: r.status,
      at: r.redeemed_at,
    })),
  })
}))
