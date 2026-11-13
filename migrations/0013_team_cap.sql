-- Most driver spots teams can take together in one session; NULL for no cap.
ALTER TABLE session_registration ADD COLUMN team_cap INTEGER;
