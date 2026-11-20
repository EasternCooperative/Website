-- The matched street address of a venue added in the tool. Venues are places, not people,
-- so keeping the address is fine; person locations stay at the postal-code level.
ALTER TABLE venue ADD COLUMN address TEXT;
