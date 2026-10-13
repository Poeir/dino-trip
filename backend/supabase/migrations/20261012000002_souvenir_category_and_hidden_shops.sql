-- Follow-up to 20261012000001 (run after it: uses places.market_time): the
-- "ตลาด" rows that are not markets to walk around, reviewed one by one on
-- 2026-10-12. Data only -- no schema, policy or grant changes. Safe to re-run.

-- Pratunam wholesale centre: a real market (five buildings, 2,000+ stalls,
-- air-conditioned), open all day with no particular hour.
update places set market_time = 'all_day'
where category = 'ตลาด' and market_time is null
  and id = '7bff3b62-608a-4b0f-9484-a93a134d9f2e';  -- ศูนย์ค้าส่งประตูน้ําขอนแก่น

-- Not places a visitor goes to: a wholesale superstore, a direct-sales
-- distribution centre, a supermarket and a plant market. No category fixes
-- that -- under any of them the trip planner could still schedule a visit --
-- so they are hidden: out of the public list, the chatbot/trip search
-- (match_places_hybrid filters is_active) and the spare pool. An admin can
-- publish them again from the places tab.
update places set is_active = false
where id in (
  '73e11a6c-9e53-4d31-87a0-14c26fbaf4b5',  -- บริษัท เคี้ยงเทรดดิ้ง จำกัด (สำนักงานใหญ่)
  'edb56d82-67a8-4888-94a6-49fd6a119546',  -- กิฟฟารีนขอนแก่น
  'bd256aed-f243-47cf-b83f-23eaf54a541b',  -- เซ็นโทซ่า มาร์เก็ต ศรีจันทร์
  '3307d2a9-e8d2-4555-9d25-081cb7c8df1d'   -- ลานไม้มิตรภาพ
);

-- New category "ร้านของฝาก" (souvenir / local-product shop): a short stop,
-- 30 minutes in the trip planner, where "ตลาด" gave two hours and
-- "สถานที่ท่องเที่ยว" let a gift shop be offered as a place to walk around.
-- The three such shops in the table were spread over three states: a market,
-- a tourist attraction, and no category at all. The last one stays hidden
-- (it was never published); publishing it is an admin's call.
-- The category list lives in frontend/src/data/seed.js, the Google type
-- mapping in backend/scripts/place-category.js.
-- embedding is cleared because the category is part of the embedded text:
-- re-embed with the admin "reindex" button or scripts/embed_content.py.
update places set
  category = 'ร้านของฝาก',
  market_time = null,
  tags = case when 'ช้อปปิ้ง/หัตถกรรม' = any(tags) then tags else array_append(tags, 'ช้อปปิ้ง/หัตถกรรม') end,
  embedding = null
where category is distinct from 'ร้านของฝาก' and id in (
  '7cc5310f-18db-483b-93c2-2544c19f3f8e',  -- เตียฮั่วหยู (was ตลาด)
  '0fa08a9f-40dc-48cf-95fd-fccc042748b2',  -- SIRI Gift House Workshop ศิลปะ ของฝากขอนแก่น (was สถานที่ท่องเที่ยว)
  '801c8641-6782-4348-8e22-71607019067d'   -- ร้านเจ๊รัชขอนแก่น ผ้าไหม สินค้าพื้นเมืองและของฝาก (had none, hidden)
);
