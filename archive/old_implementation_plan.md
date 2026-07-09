# RSMA UI Redesign - Vanilla Shadcn

This plan outlines the complete restructuring of the RSMA application UI, adhering strictly to the requirement of using **100% vanilla Shadcn components** with absolutely zero custom styling, fonts, or colors.

## Proposed Changes

We will use standard React Router to separate the application into distinct zones, and construct the layouts purely by snapping together Shadcn components like Lego bricks.

### 1. Application Routing & Architecture
We will update `src/App.tsx` to handle distinct routing paths:
- `/` - The Landing Page (Role Selection)
- `/tower` - **[PUBLIC]** Live Timing Page (Moved out of Staff area).
- `/driver` - **[PUBLIC]** Dedicated Driver Radio view.
- `/staff` - The base route for all Staff views (Steward, Admin). This route will be wrapped in a global `SidebarProvider`.

### 2. Component Installation
We will use the Shadcn CLI to install the remaining necessary components to build out the features listed in the `ui_audit.md`:
- `table` (for dense live timing and admin data)
- `tabs` (for organizing information in the staff dashboard/logs)
- `slider` (for the driver radio volume)
- `select` (for session type dropdowns)
- `switch` (for toggles)

### 3. Layouts & Pages (The "Legos")

#### The Landing Page (`/`)
- A centered layout (`flex min-h-svh items-center justify-center`).
- Three standard Shadcn `Card` components side-by-side representing roles: **Driver**, **Staff**, **Public (Tower)**.
- Each card will contain a short description and a `Button` to navigate to that route.

#### The Tower / Live Timing (`/tower`) - *Public Route*
- A full-page layout not restricted by a sidebar.
- **Header**: Dynamic Flag Status Banner (GREEN/YELLOW/RED) built with a large `Badge` or `Card`.
- **Content**: A massive data `Table` displaying Position, Car Number, Username, Laps Completed, Best Time/Interval, Gap to Leader, and Driver Status.

#### The Driver Radio (`/driver`) - *Public Route*
- A highly focused, distraction-free layout using an oversized `Card`.
- **Disconnected**: `Select` for driver profile and TTS voice, `Slider` for volume, and a large "Start Listening" `Button`.
- **Connected**: Visual pulse (using standard tailwind `animate-pulse`), `Select` for Lap Time Reminder, and a "Disconnect" `Button` (Destructive variant).

#### The Staff Layout (`/staff/*`)
- We will implement the standard Shadcn `Sidebar` layout.
- **Sidebar**: Will contain navigation links to Steward and Admin.
- **Header**: A standard top bar with a user `Avatar` and `DropdownMenu`.
- **Content Area**: Will render the specific staff page.

#### The Staff Pages (Steward, Admin)
- **Admin (`/staff/admin`)**: 
  - **Cards** separating domains.
  - A `Table` for whitelisted drivers alongside standard `Input`/`Button` forms to add/remove them.
  - A form section with `Select` (Session Type) and `Input` (Total Laps) for configuring the wizard.
  - Action buttons for "Start Track Wizard", "Simulate Completion", and "Reset Race State".
- **Steward (`/staff/steward`)**: 
  - The main race control dashboard. Dense layout of multiple `Card` widgets.
  - **Live Timing Widget**: A minified version of the Tower `Table`.
  - **Session Config**: Controls to change session type, duration, and start/end session.
  - **Race Control**: Large `Button`s for Green/Yellow/Red flags, toggles (`Switch`) for track sensors.
  - **Direct Comms**: Multi-select form and `Textarea` to send messages to drivers.
  - **Logs**: Uses `Tabs` (Practice/Quali/Race) to display a terminal-like feed of events.

## User Review Required

> [!IMPORTANT]  
> Does this structure perfectly align with your vision for a strictly vanilla, Lego-block assembly of the UI? 

If you approve, I will immediately run the Shadcn CLI to fetch the remaining components and assemble the routes and pages exactly as described.
