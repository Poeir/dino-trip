-- places.market_time: when people actually go to a "ตลาด" row.
--
-- The trip planner (chatbot-service route_scheduler.market_kind) guesses a
-- market's time of day from its opening hours and name: a fresh market in the
-- early morning, a night market from about 17:00. That guess decides 17 of
-- the 34 live market rows; the rest list all-day hours under a neutral name,
-- so the planner could not tell and left them with no time preference (and
-- never auto-adds them). This column lets an admin say it outright, and wins
-- over the guess:
--   morning  -- fresh/wholesale market, best early
--   evening  -- night market, from about 17:00
--   all_day  -- worth a visit at any hour (food court, mixed market)
--   NULL     -- not labelled: the planner keeps guessing
-- Mirrored in backend/src/lib/mappers.js (MARKET_TIMES) and the admin place
-- form -- change the three together.
--
-- Safe to re-run. No policy or grant changes: the column is read and written
-- through the same routes as the rest of the row.
alter table places
  add column if not exists market_time text
  check (market_time in ('morning', 'evening', 'all_day'));

-- Initial labels, read off each place's description (reviewed 2026-10-12).
-- Only rows that are still unlabelled markets are touched.
update places set market_time = 'evening'
where category = 'ตลาด' and market_time is null and id in (
  '0f843c27-68c5-4d13-a14f-281db70a7919',  -- ตลาดศิลานคร
  '88714753-351e-46ed-a170-bd57e8c38fd5'   -- R.8 CAMPING KKC ตลาดร.8 แคมปิ้ง
);

update places set market_time = 'morning'
where category = 'ตลาด' and market_time is null and id in (
  'f3b568b2-8dfb-4ecc-92c0-2d4cb70ba7ab',  -- ตลาดบางลำภู
  '816cb167-9543-42f1-918a-1a453ad00639'   -- ตลาดศรีเมืองทอง
);

update places set market_time = 'all_day'
where category = 'ตลาด' and market_time is null and id in (
  '613dad29-f118-4fb4-a1b6-2f6dfe8cce51',  -- ตลาดจอมพลขอนแก่น
  'd67a71e7-ea61-4273-af4c-1aad8d81ff52',  -- ตลาดชุมชน ร.8
  'b63725d6-5a41-4775-8241-ad06792a0a0c'   -- ตลาดตองแปด
);
