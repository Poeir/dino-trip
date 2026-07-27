-- Full-fidelity source payload per row, so the chatbot's context-building can
-- reach for fields (businessStatus, editorialSummary, full opening-hours,
-- payment/accessibility detail, etc.) that the flattened columns above don't
-- carry, without having to add a column for every Google Places field up front.
-- Shape varies by importer: import-places.js stores the raw Google Places API
-- object as-is; import-places-multi.js stores its nested core/extra/features/
-- contact/maps/address ("DinoDB") object, since that's the fullest payload
-- available for those rows (not literally Google's response shape).
alter table places add column if not exists raw_data jsonb;
