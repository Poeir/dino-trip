-- Exact age instead of a bracket, and free text for occupation "other".
-- age_group stays (filled by the API from age) so the report's brackets and
-- the rows already collected keep working; old rows simply have age = NULL.
-- Keep the limits in step with AGE_MIN / AGE_MAX / OCCUPATION_OTHER_MAX in
-- backend/src/lib/surveyQuestions.js.
alter table survey_responses
  add column if not exists age smallint check (age between 10 and 99),
  add column if not exists occupation_other text check (char_length(occupation_other) <= 100);
