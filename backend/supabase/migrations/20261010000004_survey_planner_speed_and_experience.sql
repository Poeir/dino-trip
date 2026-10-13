-- Questionnaire v2: a trip-planner speed item and four "before using Dino" items.
--
-- The new planner item is numbered Q10 (so the planner dimension stays Q7-Q10
-- and the report numbers run 1..16), which moves the old Q10..Q15 to Q11..Q16.
-- Rows already collected are shifted to match, and get NULL (= "never used")
-- for the new Q10. Keep in step with backend/src/lib/surveyQuestions.js.
-- Safe to re-run: the shift only touches rows whose q16 is still empty.
-- Order matters: q10 must accept NULL before the UPDATE writes one.
alter table survey_responses
  add column if not exists q16 smallint check (q16 between 1 and 5),
  alter column q10 drop not null;

-- One UPDATE: every right-hand side reads the row's old values.
update survey_responses set
  q16 = q15, q15 = q14, q14 = q13, q13 = q12, q12 = q11, q11 = q10, q10 = null
where q16 is null;

alter table survey_responses
  alter column q16 set not null;

alter table survey_responses
  add column if not exists exp_plan_method text check (exp_plan_method in ('search','social','maps','friends','app','ai','none')),
  add column if not exists exp_plan_time text check (exp_plan_time in ('lt30m','30m-1h','1-3h','gt3h')),
  add column if not exists exp_ai_usage text check (exp_ai_usage in ('often','sometimes','never')),
  add column if not exists exp_khonkaen text check (exp_khonkaen in ('local','visited','never'));
