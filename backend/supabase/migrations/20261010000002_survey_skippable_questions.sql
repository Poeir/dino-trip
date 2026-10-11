-- Q4..Q9 are about the chatbot and the trip planner, which a respondent may
-- never have used: they can answer "ยังไม่เคยใช้", stored as NULL and left out
-- of that question's statistics. The existing 1-5 CHECKs still hold (a NULL
-- passes a CHECK). Keep in step with `skippable` in
-- backend/src/lib/surveyQuestions.js.
alter table survey_responses
  alter column q4 drop not null,
  alter column q5 drop not null,
  alter column q6 drop not null,
  alter column q7 drop not null,
  alter column q8 drop not null,
  alter column q9 drop not null;
