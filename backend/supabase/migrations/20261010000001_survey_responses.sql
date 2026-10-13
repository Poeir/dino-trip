-- Satisfaction survey (project report): one row per submitted questionnaire.
-- Anonymous on purpose -- no user_id, no IP -- so respondents can answer
-- without an account. Q1..Q15 are 5-point Likert answers (5 = most satisfied);
-- the question wording and dimensions live in backend/src/lib/surveyQuestions.js
-- and must keep the same 15 numbers. The allowed demographic values mirror the
-- DEMOGRAPHICS lists in that file -- change both together.
create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  gender text not null check (gender in ('male', 'female', 'unspecified')),
  age_group text not null check (age_group in ('under20', '20-29', '30-39', '40plus')),
  occupation text not null check (occupation in ('student', 'staff', 'tourist', 'other')),
  q1 smallint not null check (q1 between 1 and 5),
  q2 smallint not null check (q2 between 1 and 5),
  q3 smallint not null check (q3 between 1 and 5),
  q4 smallint not null check (q4 between 1 and 5),
  q5 smallint not null check (q5 between 1 and 5),
  q6 smallint not null check (q6 between 1 and 5),
  q7 smallint not null check (q7 between 1 and 5),
  q8 smallint not null check (q8 between 1 and 5),
  q9 smallint not null check (q9 between 1 and 5),
  q10 smallint not null check (q10 between 1 and 5),
  q11 smallint not null check (q11 between 1 and 5),
  q12 smallint not null check (q12 between 1 and 5),
  q13 smallint not null check (q13 between 1 and 5),
  q14 smallint not null check (q14 between 1 and 5),
  q15 smallint not null check (q15 between 1 and 5),
  strengths text check (strengths is null or length(strengths) <= 1000),
  improvements text check (improvements is null or length(improvements) <= 1000),
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists survey_responses_created_idx on survey_responses (created_at desc);

-- Same lock-down as event_reports/trips: only the backend touches this table.
alter table survey_responses enable row level security;
revoke all on survey_responses from anon, authenticated;
grant select, insert, delete on survey_responses to service_role;
