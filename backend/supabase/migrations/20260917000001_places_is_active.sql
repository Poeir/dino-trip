-- Persists the admin "hide from public site" toggle for places -- until now
-- PlacesTab.jsx's "ซ่อนจากหน้าเว็บ" button only flipped isActive in local
-- React state (see AppContext.jsx's old togglePlaceActive comment), so it
-- reset on every reload.
--
-- Also backs PlacePicker's Google Maps quick-add flow (EventsTab.jsx): a
-- place created from a Google search result while picking an event venue is
-- inserted with is_active = false, since it's just a venue pin rather than a
-- reviewed touristic destination, until an admin promotes it from PlacesTab.
alter table places add column if not exists is_active boolean not null default true;
