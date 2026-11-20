-- When and where an event happened, so the tracker can tell whether someone has come to
-- something at a similar time of year, or at the same venue. All optional: events made by
-- hand or by an import may not know either. Dates are ISO (YYYY-MM-DD); site_id is the
-- venue slug used by the site content (for example camp-onas).
ALTER TABLE event ADD COLUMN start_date TEXT;
ALTER TABLE event ADD COLUMN end_date TEXT;
ALTER TABLE event ADD COLUMN site_id TEXT;
