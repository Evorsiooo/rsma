-- A session can follow another session's registration: one registration covers both.
ALTER TABLE session_registration ADD COLUMN follows TEXT;
