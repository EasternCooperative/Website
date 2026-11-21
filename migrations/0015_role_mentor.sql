-- Mentoring happens around one event, so it is recorded on the role being mentored
-- rather than as an ongoing relationship. Someone who led an activity can name who
-- mentored or liaised for them there. Co-leads need no column: they are the other
-- people with a role on the same activity at the same event.
ALTER TABLE role ADD COLUMN mentor_id INTEGER REFERENCES person (id);
CREATE INDEX role_mentor ON role (mentor_id) WHERE mentor_id IS NOT NULL;
