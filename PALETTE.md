# Seagull History Card — Palette

Текущие конфигурируемые цвета из `SEAGULL_HISTORY_THEME_DEFAULT.palette`.

> Превью сделаны через badges, чтобы нормально отображались в Markdown.

| Token | Light (day) | Dark (night) |
|---|---|---|
| `card_border` | ![](https://img.shields.io/badge/-aaaaaa-aaaaaa?style=flat-square) `#aaaaaa` | ![](https://img.shields.io/badge/-64748b-64748b?style=flat-square) `#64748b` |
| `card_bg` | ![](https://img.shields.io/badge/-eeeeee-eeeeee?style=flat-square) `#eeeeee` | ![](https://img.shields.io/badge/-0f172a-0f172a?style=flat-square) `#0f172a` |
| `text_color` | `inherit` | ![](https://img.shields.io/badge/-e2e8f0-e2e8f0?style=flat-square) `#e2e8f0` |
| `icon_color` | `inherit` | ![](https://img.shields.io/badge/-e2e8f0-e2e8f0?style=flat-square) `#e2e8f0` |
| `line_color` | ![](https://img.shields.io/badge/-94a3b8-94a3b8?style=flat-square) `#94a3b8` | ![](https://img.shields.io/badge/-475569-475569?style=flat-square) `#475569` |
| `pearl_color` | ![](https://img.shields.io/badge/-f59e0b-f59e0b?style=flat-square) `#f59e0b` | ![](https://img.shields.io/badge/-f59e0b-f59e0b?style=flat-square) `#f59e0b` |
| `pearl_border` | ![](https://img.shields.io/badge/-ffffff-ffffff?style=flat-square) `#ffffff` | ![](https://img.shields.io/badge/-0f172a-0f172a?style=flat-square) `#0f172a` |
| `icon_bg_candidate` | `rgba(148,163,184,0.55)` | `rgba(71,85,105,0.55)` |
| `icon_bg_detached` | `rgba(148,163,184,0.72)` | `rgba(71,85,105,0.72)` |
| `grid_tick_color` | ![](https://img.shields.io/badge/-94a3b8-94a3b8?style=flat-square) `#94a3b8` | ![](https://img.shields.io/badge/-475569-475569?style=flat-square) `#475569` |
| `sun_event_color` | ![](https://img.shields.io/badge/-facc15-facc15?style=flat-square) `#facc15` | ![](https://img.shields.io/badge/-facc15-facc15?style=flat-square) `#facc15` |
| `axis_surface` | `rgba(255,255,255,0.18)` | `rgba(15,23,42,0.28)` |
| `period_btn_bg` | `rgba(148,163,184,0.20)` | `rgba(100,116,139,0.26)` |
| `period_btn_active_bg` | `rgba(59,130,246,0.42)` | `rgba(37,99,235,0.52)` |
| `tooltip_bg` | `rgba(15,23,42,0.94)` | `rgba(2,6,23,0.94)` |
| `tooltip_text` | ![](https://img.shields.io/badge/-f8fafc-f8fafc?style=flat-square) `#f8fafc` | ![](https://img.shields.io/badge/-f8fafc-f8fafc?style=flat-square) `#f8fafc` |
| `tooltip_shadow` | `rgba(2,6,23,0.35)` | `rgba(2,6,23,0.45)` |

## Использование в конфиге

```yaml
type: custom:seagull-history-card
theme:
  palette:
    icon_color:
      day: "#334155"
      night: "#e2e8f0"
    icon_bg_candidate:
      day: "rgba(251,191,36,0.45)"
      night: "rgba(251,191,36,0.35)"
    sun_event_color:
      day: "#f59e0b"
      night: "#fbbf24"
```
