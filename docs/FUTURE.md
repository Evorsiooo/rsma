# Future features (not to be implemented yet)

Noted so the design leaves room for them. Nothing here is built.

- **Team registration**: teams register themselves (name, colour, staff, drivers) instead of being created by an admin.
- **Job listings**: postings for teams (drivers, engineers, strategists) and for RSMA (stewards, marshals, staff).
- **Session registration**: drivers or teams sign up for a specific event or session ahead of time.

Design notes: team, user and race records are separate tables so registration can later create them without schema surgery. Roles are data (not hard-coded), so listings can later grant a role.
