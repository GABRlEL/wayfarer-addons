# Wayfarer Image Timestamps

This Microsoft Edge extension preserves Edge’s built-in **right-click → Save image as…** workflow while suggesting filenames in this format:

```text
unnamed - 2026-07-31T134901.705.jpg
```

The timestamp is generated in the computer’s local timezone when Edge starts determining the download filename.

JPG is used by default. PNG, WebP, GIF, and AVIF extensions are preserved when Edge reports those image types.

## Installation

1. Download the ZIP from the extensions/zip folder.
2. Extract the extension ZIP to a folder, for example "image-timestamps".
3. Open `edge://extensions` in Microsoft Edge.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted folder, for example "image-timestamps" containing `manifest.json`.
7. Reload Wayfarer.

## Usage

Use Edge’s normal **right-click → Save image as…** command on a Wayfarer image.

No custom webpage context menu is added.

## How it works

The extension observes downloads through Edge’s downloads API. It marks images right-clicked on Wayfarer’s `/new` pages and also provides a referrer-based fallback for Google-hosted Wayfarer images.

Other downloads are left unchanged.

## Removal

1. Open `edge://extensions`.
2. Find **Wayfarer Image Timestamps**.
3. Click **Remove**.
