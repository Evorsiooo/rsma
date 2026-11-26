-- Which session sets the starting grid of a race: NULL picks the latest timed event before it, 'none' has no grid, otherwise a session id.
ALTER TABLE sessions ADD COLUMN qualifying_session TEXT;
