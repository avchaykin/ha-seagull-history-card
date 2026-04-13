# Seagull History Card

Custom Lovelace card for Home Assistant to display entity history in compact visual styles.

Current style:
- `pearls` — timeline line with pearls when a strong value appears (short events are preserved).

Planned next styles: bars, density, stepped segments.

## Installation

Add resources:

```yaml
url: /local/seagull-history-card-loader.js
type: module
```

Copy these files to `/config/www`:
- `seagull-history-card.js`
- `seagull-history-card-loader.js`

## Basic config

```yaml
type: custom:seagull-history-card
title: Living room history
period: 12h
style: pearls
entities:
  - entity: light.living_room
  - entity: switch.tv
```

## Options

- `period`: `1h`, `2h`, `12h`, `1d`, `2d`, `1w`, etc.
- `style`: currently `pearls`
- `entities`: array of entities or objects
  - `entity` (required)
  - `name` (optional)
  - `icon` (optional)
  - `show_value` (optional)
    - string: `show_value: on`
    - list/object with color:
      ```yaml
      show_value:
        values: [open, unlocked]
        color: red
      ```
  - default strong values (when `show_value` omitted):
    - `lock.*` -> `unlocked`
    - `cover.*` -> `open`/`opening`
    - `binary_sensor` door/window/opening/garage/lock classes -> `open`/`unlocked`/`on`
    - others -> `on`
- `theme`: theme overrides (palette and card params)

Card-level visual params (also overridable via `theme.card`):
- `border_radius`
- `border_width`
- `background_opacity`

## Local auto-deploy on commit

This repo includes Git hooks similar to `ha-seagull-room-card`:

```bash
./scripts/setup-hooks.sh
```

Then each commit runs `scripts/deploy-to-ha.sh` and copies card files to HA `/config/www`.
