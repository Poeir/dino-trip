-- Google's addressComponents gives a reliable อำเภอ (district) name per place,
-- instead of guessing from free-text formattedAddress. Lets outlying-district
-- coverage (fetch-places.js's OUTLYING_DISTRICTS search) be verified/filtered
-- by an actual column rather than trusting the text-search query matched.
alter table places add column if not exists district text;
