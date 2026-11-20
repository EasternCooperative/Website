-- Staffing is planned for a venue, not tied to an event record. An ask now names the venue
-- (a content venue slug or a venue added in the tool), an optional planned date, and the slot.
-- One live ask per person, venue, date, and slot.
DROP INDEX outreach_slot_unique;
ALTER TABLE outreach ADD COLUMN venue_id TEXT;
ALTER TABLE outreach ADD COLUMN plan_date TEXT;
CREATE UNIQUE INDEX outreach_slot_unique ON outreach (person_id, venue_id, slot, COALESCE(plan_date, ''))
  WHERE goal = 'staff_slot' AND deleted_at IS NULL;
