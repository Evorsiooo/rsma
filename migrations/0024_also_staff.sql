-- A registered driver can also be registered as staff (an employee spot) without a second registration:
-- the flag on the driver's own registration. It uses one employee spot and changes nothing about the car seat.
ALTER TABLE registrations ADD COLUMN also_staff INTEGER NOT NULL DEFAULT 0;
