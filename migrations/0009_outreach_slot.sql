-- Asking someone to staff a particular slot at a particular event. The outreach row
-- already carries who, status, and when; this adds which event and which slot (for
-- example "Games class"). One live ask per person, event, and slot.
ALTER TABLE outreach ADD COLUMN event_id INTEGER REFERENCES event (id);
ALTER TABLE outreach ADD COLUMN slot TEXT;
CREATE UNIQUE INDEX outreach_slot_unique ON outreach (person_id, event_id, slot)
  WHERE goal = 'staff_slot' AND deleted_at IS NULL;
