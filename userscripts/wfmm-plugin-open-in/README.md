# WFMM Open In

WFMM Open In is a WFMM external-plugin port created and maintained by **Gab**,
based on the **Open In** addon from
[Unified Wayfarer Tools](https://github.com/bilde2910/Wayfarer-Tools). The
original Open-In addon was created by **tehstone** and **bilde2910**.

Version 1.0.0 preserves the current addon behavior:

- global and regional map-provider links;
- the complete current UWT provider catalogue and geofence dataset;
- the same coordinate projections and URL substitutions;
- Showcase pagination support;
- Contributions-page selection support;
- NEW, EDIT, and PHOTO review support; and
- Ingress Prime links when the source record includes a GUID.

It adds Apple Maps, six Waymarked Trails (WMT) variants, and the regional
**LGL-BW FreizeitViewer**, plus a dedicated **Quick Links:** line with **OAI
Verify**, **Gemini**, **Sightengine**, and **TinEye**. WFMM-native visibility
settings cover all 77 map providers, the conditional Ingress Prime link, and
all four quick links. Each of the 82 entries can be disabled independently
without otherwise changing the original UWT catalogue, geofences, projections,
or URL behavior.

The Czechia and Slovakia provider follows the latest supplied Open-In source:
it is labelled **Mapy.com** and uses Mapy.com's current coordinate-link format.

New installations enable Apple Maps, Ingress Prime, WMT Hiking, and WMT Cycling. Intel, FIS-Broker, WMT MTB, WMT Riding, WMT Skating, and WMT Slopes
start disabled. FIS-Broker remains manually re-enableable and is marked in
settings as potentially broken. All four quick links and LGL-BW FreizeitViewer
start enabled. Gemini uses account number `0` by default and accepts a different
non-negative account number in the settings window.


## Installation

1. Install and enable Wayfarer Map Mods (WFMM).
2. Install `wfmm-open-in.user.js` in a userscript manager.
3. Disable UWT's original Open In addon if Unified Wayfarer Tools is also
   installed, otherwise both addons will display links.
4. Reload Wayfarer after first installation. The plugin then appears in WFMM's
   Plugins interface and can be enabled or disabled there.

## Provider settings

Open WFMM's map side panel and select **Open In** from its settings/actions
section. The settings window provides:

- an individual checkbox for every entry;
- search by provider name or region identifier;
- **Enable all** and **Disable all** shortcuts;
- separate **Enable global**, **Disable global**, **Enable regional**, and
  **Disable regional** shortcuts;
- a separate **Quick Links** group with individual and bulk toggles;
- independent toggles for showing Open In during reviews and on the
  Contributions page, both enabled by default;
- a choice between placing WMT links on the **Open In:** line or a separate
  **WMT:** line;
- independent choices to keep **Quick Links** and **Regional maps** on their
  existing lines or move either category onto the **Open In:** line;
- an optional adaptive layout that restores the existing regional and Quick
  Links rows when a fully combined Open In line would otherwise wrap;
- options to shorten **OpenStreetMap** to **OSM** and **OAI Verify** to
  **OAI**;
- a Gemini account-number field used to build its `/u/{number}/app` URL; and
- an enabled-entry count.

The WMT layout defaults to the **Open In:** line. In that mode the links are
labelled **WMT Hiking**, **WMT Cycling**, and so on. The separate-line mode uses
**WMT: Hiking, Cycling, MTB, Riding, Skating, Slopes** while respecting the
individual entry toggles.

Quick Links and Regional maps default to their existing separate lines. Either
category can be moved independently onto the **Open In:** line. Regional links
include their country flag in combined-line mode so their geographic context is
not lost.

The adaptive combined layout is off by default. When enabled, it acts only when
both Quick Links and Regional maps are assigned to the **Open In:** line. It
measures the currently enabled links at the rendered width and moves Quick Links
to their existing row first. Only if the remaining Open In line would still wrap
does it restore the existing regional flag row or rows. These stages reverse as
space returns; no consolidated regional row is created.

The OpenStreetMap label uses its full name by default. Enabling the compact
label option changes only its displayed name to **OSM**; the provider, URL, and
individual entry toggle remain unchanged.

The OAI Verify quick link likewise uses **OAI Verify** by default. Its compact
label option changes only the displayed name to **OAI**; the URL and individual
entry toggle remain unchanged.

LGL-BW FreizeitViewer appears only inside the existing Baden-Württemberg
geofence. Its supplied Basemap configuration is encoded locally when a link is
created, with only `lat` and `lon` replaced by the current item's coordinates.

Select **Save** to apply the draft immediately to Open-In lists already on the
page. **Cancel** discards the draft. Choices are stored through `WFMM.settings`
and survive plugin disable/re-enable and browser restarts.

The Review and Contributions availability switches are independent. Disabling
either one immediately removes its Open In links and stops that surface's DOM
controller; re-enabling restores the surface from the current response or
cached contribution data when available. The public 1.0.0 settings model
registers its defaults directly and contains no migration code for prerelease
builds.

The userscript uses the same pinned `proj4` 2.20.0 dependency as UWT. The
geofence data is embedded and decompressed locally; it is not sent to another
service.

Enabling the plugin after a Review or Showcase response has already loaded may
require a page refresh before links appear. Contributions can be restored from
WFMM's cached contribution data. Contribution selection uses a delegated click
handler, retains the active contribution across data refreshes, and restores
the links when Wayfarer replaces the active details pane.
