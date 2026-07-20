// terminal_ui.ink — terminal OS content rendered inside the Grok UI plate.
// The artwork remains text-free; all system labels and narrative data live here.

-> desktop

=== desktop ===
SABLE SYSTEM SHELL // OBL-7 # heading
LOCAL BOOT CHANNEL ESTABLISHED. # ok
External carrier: severed. Archive clock: unsynchronised. # dim
Four read-only modules remain available on the quarantine partition.
Select LOG, EMAIL, MAP, or SYSINFO from the launcher rail.

-> END

=== log ===
SYSTEM LOG // ARCHIVE PARTITION 03 # heading
──────────────────────────────────────────────────────────────────────── # divider
[2089-03-14 02:17:04] External uplink lost. Retrying...
[2089-03-14 02:17:09] Retry failed. Switching to local network.
[2089-03-14 02:18:33] Bio-containment seal: ACTIVE.
[2089-03-14 02:19:01] Unauthorized access — Sector 7G.
[2089-03-14 02:19:02] Motion detected — North Corridor.
[2089-03-14 02:19:04] Motion detected — North Corridor.
[2089-03-14 02:19:07] Motion detected — North Corridor.
[2089-03-14 02:19:11] Camera feed lost — North Corridor. # warn
[2089-03-14 02:20:45] Dr. Voss badge authenticated — Lab A.
[2089-03-14 02:21:03] Lab A door sealed from inside.
[2089-03-14 02:22:17] Power fluctuation — Sub-level 2.
[2089-03-14 02:22:18] Backup generator engaged.
[2089-03-14 02:31:00] Automated log suspended.

* [RETURN TO SHELL] -> END

=== email ===
INTERNAL MAIL // LOCAL CACHE # heading
──────────────────────────────────────────────────────────────────────── # divider
FROM:     dr.voss@obelisk.internal
TO:       security@obelisk.internal
SUBJECT:  RE: Containment concerns # heading
DATE:     2089-03-13 23:41

I have raised this three times now. The specimen is responding to stimuli before they are administered. It anticipates the test sequence.

This is not conditioning. It knows.

I am suspending the trials until the ethics board responds. If Director Harker attempts to override this decision, my authorization code is VOSS-7G-BLACK.

— Mara

──────────────────────────────────────────────────────────────────────── # divider
[HIGH PRIORITY — UNSENT DRAFT] # warn

If you are reading this, the containment has already failed.

Do not trust the intercom. Do not follow any voice you cannot see.

* [RETURN TO SHELL] -> END

=== map ===
FACILITY MAP // SUB-LEVEL 2 # heading
──────────────────────────────────────────────────────────────────────── # divider

        ┌───────────┐       ┌───────────┐
        │  LAB  A   │───────│  LAB  B   │
        │  SEALED   │       │  OFFLINE  │
        └─────┬─────┘       └─────┬─────┘
              │                   │
   ┌──────────┴───────────────────┴──────────┐
   │              NORTH CORRIDOR            │
   │              CAMERAS LOST              │
   └──────┬──────────────────────────┬───────┘
          │                          │
   ┌──────┴──────┐            ┌──────┴──────┐
   │  SECURITY   │            │  TERMINAL   │
   │   SEALED    │            │   YOU ARE   │
   │             │            │    HERE     │
   └─────────────┘            └─────────────┘

Sector 7G: QUARANTINE LOCK ACTIVE # warn
Emergency stairwell: UNRESPONSIVE # warn

* [RETURN TO SHELL] -> END

=== sysinfo ===
SYSTEM INFORMATION // DIAGNOSTIC SNAPSHOT # heading
──────────────────────────────────────────────────────────────────────── # divider
OBELISK LABORATORIES TERMINAL SYSTEM
Model:       SABLE-4 / Revision C
Node:        OBL-LAB-SUBLEVEL2-07
OS:          Obelisk Internal 3.1.4
Uptime:      47 days, 06:13:22

PROCESSOR:   M68030 @ 33 MHz
MEMORY:      16 MB / 14.2 MB USED
STORAGE:     340 MB / 338 MB USED
NETWORK:     LOCAL ONLY — EXTERNAL LINK SEVERED # warn

BIOMETRIC READER:    OFFLINE # warn
DOOR CONTROL:        RESTRICTED
CAMERA SYSTEM:       3 / 12 ONLINE # warn
CONTAINMENT SYSTEM:  ACTIVE # ok
EMERGENCY POWER:     68% — EST. 11 HOURS # warn

Last maintenance: 2089-02-28
Administrator: M. VOSS

* [RETURN TO SHELL] -> END
