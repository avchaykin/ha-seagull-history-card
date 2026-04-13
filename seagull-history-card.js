const SEAGULL_HISTORY_CARD_VERSION = "0.1.0";
const SEAGULL_HISTORY_CARD_COMMIT = "dev";

const SEAGULL_HISTORY_THEME_DEFAULT = {
  palette_mode: "auto", // auto | day | night
  palette: {
    card_border: { day: "#aaaaaa", night: "#64748b" },
    card_bg: { day: "#eeeeee", night: "#0f172a" },
    card_icon: { day: "#2233aa44", night: "#93c5fd55" },
    text_color: { day: "inherit", night: "#e2e8f0" },
    line_color: { day: "#94a3b8", night: "#475569" },
    pearl_color: { day: "#f59e0b", night: "#f59e0b" },
    pearl_border: { day: "#ffffff", night: "#0f172a" },
  },
  card: {
    border_radius: 16,
    border_width: 0,
    border_color: "$card_border",
    background_color: "$card_bg",
    background_opacity: 0.45,
    icon: "mdi:chart-timeline-variant",
    icon_color: "$card_icon",
    icon_size: 76,
    font_url: "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap",
  },
  pearls: {
    line_height: 10,
    line_radius: 999,
    line_color: "$line_color",
    pearl_size: 12,
    pearl_color: "$pearl_color",
    pearl_border_width: 2,
    pearl_border_color: "$pearl_border",
    sample_points: 36,
  },
};

const ACTIVE_STATES_DEFAULT = ["on"];

class SeagullHistoryCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:seagull-history-card",
      period: "12h",
      style: "pearls",
      entities: [{ entity: "switch.example" }],
      theme: {},
    };
  }

  static async getConfigElement() {
    return document.createElement("seagull-history-card-editor");
  }

  setConfig(config) {
    if (!config || config.type !== "custom:seagull-history-card") {
      throw new Error("Card type must be custom:seagull-history-card");
    }
    this._config = config;
    this._history = new Map();
    this._lastFetchKey = "";
    this._lastFetchAt = 0;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._maybeFetchHistory();
  }

  getCardSize() {
    return Math.max(2, (this._config?.entities || []).length + 1);
  }

  _render() {
    if (!this._config || !this._hass) return;

    if (!this._card) {
      this._card = document.createElement("ha-card");
      this._content = document.createElement("div");
      this._content.className = "seagull-history-card-content";
      this._bgIcon = document.createElement("ha-icon");
      this._bgIcon.className = "seagull-history-card-bg-icon";
      this._card.appendChild(this._content);
      this._card.appendChild(this._bgIcon);
      this.appendChild(this._card);
    }

    const theme = this._normalizeTheme(this._config.theme);
    const mode = this._resolvePaletteMode(theme.palette_mode);
    this._activeTheme = { theme, mode };

    this._applyCardStyles(theme, mode);
    this._bgIcon.icon = this._config.icon || theme.card.icon;

    const rowsHtml = this._buildRowsHtml(theme, mode);
    this._content.innerHTML = `
      <div class="seagull-history-head">
        <div class="seagull-history-title">${this._escapeHtml(this._config.title || "History")}</div>
        <div class="seagull-history-period">${this._escapeHtml(this._config.period || "12h")}</div>
      </div>
      <div class="seagull-history-rows">${rowsHtml}</div>
    `;
  }

  async _maybeFetchHistory() {
    if (!this._hass || !this._config) return;

    const entities = (this._config.entities || [])
      .map((e) => (typeof e === "string" ? e : e?.entity))
      .filter(Boolean);

    if (!entities.length) return;

    const periodMs = this._parsePeriodToMs(this._config.period || "12h");
    const nowBucket = Math.floor(Date.now() / 60000);
    const fetchKey = `${entities.join(",")}|${periodMs}|${nowBucket}`;

    if (fetchKey === this._lastFetchKey && Date.now() - this._lastFetchAt < 15000) return;

    this._lastFetchKey = fetchKey;
    this._lastFetchAt = Date.now();

    const end = new Date();
    const start = new Date(end.getTime() - periodMs);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    try {
      const path = `history/period/${encodeURIComponent(startIso)}?filter_entity_id=${encodeURIComponent(entities.join(","))}&end_time=${encodeURIComponent(endIso)}&minimal_response`;
      const payload = await this._hass.callApi("GET", path);

      const map = new Map();
      if (Array.isArray(payload)) {
        for (const seq of payload) {
          if (Array.isArray(seq) && seq.length > 0 && seq[0]?.entity_id) {
            map.set(seq[0].entity_id, seq);
          }
        }
      }
      this._history = map;
      this._render();
    } catch (err) {
      console.error("[seagull-history-card] failed to fetch history", err);
    }
  }

  _buildRowsHtml(theme, mode) {
    const style = (this._config.style || "pearls").toLowerCase();
    const entities = this._config.entities || [];

    return entities
      .map((row) => {
        const rowCfg = typeof row === "string" ? { entity: row } : row || {};
        const entityId = rowCfg.entity;
        if (!entityId) return "";

        const stateObj = this._hass.states[entityId];
        const icon = rowCfg.icon || stateObj?.attributes?.icon || "mdi:help-circle-outline";
        const name = rowCfg.name || stateObj?.attributes?.friendly_name || entityId;

        let chartHtml = `<div class="seagull-history-line"></div>`;
        if (style === "pearls") {
          chartHtml = this._buildPearlsHtml(entityId, rowCfg, theme, mode);
        }

        return `
          <div class="seagull-history-row">
            <ha-icon class="seagull-history-row-icon" icon="${this._escapeHtml(icon)}"></ha-icon>
            <div class="seagull-history-row-main">
              ${chartHtml}
              <div class="seagull-history-row-name">${this._escapeHtml(name)}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  _buildPearlsHtml(entityId, rowCfg, theme, mode) {
    const history = this._history?.get(entityId) || [];
    const activeStates = (rowCfg.active_states || this._config.active_states || ACTIVE_STATES_DEFAULT).map((s) => String(s));

    const periodMs = this._parsePeriodToMs(this._config.period || "12h");
    const pointsCfg = Number(rowCfg.sample_points ?? this._config.sample_points ?? theme.pearls.sample_points);
    const points = Number.isFinite(pointsCfg) ? Math.max(6, Math.min(240, Math.floor(pointsCfg))) : 36;
    const stepMs = periodMs / (points - 1);
    const endMs = Date.now();
    const startMs = endMs - periodMs;

    const normalized = history
      .map((it) => ({
        state: String(it.state ?? ""),
        ts: new Date(it.last_changed || it.last_updated || it.lu || 0).getTime(),
      }))
      .filter((it) => Number.isFinite(it.ts))
      .sort((a, b) => a.ts - b.ts);

    const isActiveAt = (ts) => {
      let state = null;
      for (const item of normalized) {
        if (item.ts <= ts) state = item.state;
        else break;
      }
      if (state == null) {
        const current = this._hass.states[entityId]?.state;
        state = String(current ?? "");
      }
      return activeStates.includes(state);
    };

    const pearls = [];
    for (let i = 0; i < points; i++) {
      const ts = startMs + i * stepMs;
      if (!isActiveAt(ts)) continue;
      const x = (i / (points - 1)) * 100;
      pearls.push(`<span class="seagull-history-pearl" style="left:${x.toFixed(3)}%"></span>`);
    }

    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);
    const lineHeight = Number(theme.pearls.line_height) || 10;
    const lineRadius = Number(theme.pearls.line_radius) || 999;
    const pearlSize = Number(theme.pearls.pearl_size) || 12;
    const pearlColor = this._resolveColor(theme.pearls.pearl_color, theme, mode);
    const pearlBorderWidth = Number(theme.pearls.pearl_border_width) || 2;
    const pearlBorderColor = this._resolveColor(theme.pearls.pearl_border_color, theme, mode);

    return `
      <div class="seagull-history-line pearls" style="height:${lineHeight}px;border-radius:${lineRadius}px;background:${lineColor};--pearl-size:${pearlSize}px;--pearl-color:${pearlColor};--pearl-border-width:${pearlBorderWidth}px;--pearl-border-color:${pearlBorderColor};">
        ${pearls.join("")}
      </div>
    `;
  }

  _applyCardStyles(theme, mode) {
    const cardBg = this._resolveColor(theme.card.background_color, theme, mode);
    const cardBorder = this._resolveColor(theme.card.border_color, theme, mode);
    const textColor = this._resolveColor(theme.palette.text_color, theme, mode);
    const iconColor = this._resolveColor(theme.card.icon_color, theme, mode);

    const opacity = Number(this._config.background_opacity ?? theme.card.background_opacity ?? 0.45);
    const borderWidth = Number(this._config.border_width ?? theme.card.border_width ?? 0);
    const borderRadius = Number(this._config.border_radius ?? theme.card.border_radius ?? 16);
    const iconSize = Number(this._config.icon_size ?? theme.card.icon_size ?? 76);

    this._card.style.borderRadius = `${borderRadius}px`;
    this._card.style.border = `${borderWidth}px solid ${cardBorder}`;
    this._card.style.background = this._withOpacity(cardBg, opacity);
    this._card.style.overflow = "hidden";
    this._card.style.position = "relative";

    this._content.style.position = "relative";
    this._content.style.zIndex = "2";
    this._content.style.padding = "12px";
    this._content.style.color = textColor;

    this._bgIcon.style.position = "absolute";
    this._bgIcon.style.right = "8px";
    this._bgIcon.style.top = "8px";
    this._bgIcon.style.width = `${iconSize}px`;
    this._bgIcon.style.height = `${iconSize}px`;
    this._bgIcon.style.color = iconColor;
    this._bgIcon.style.zIndex = "1";

    this._injectStyles(theme, mode);
    this._ensureFont(theme.card.font_url);
  }

  _injectStyles(theme, mode) {
    if (!this._styleEl) {
      this._styleEl = document.createElement("style");
      this._card.appendChild(this._styleEl);
    }

    const textColor = this._resolveColor(theme.palette.text_color, theme, mode);
    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);

    this._styleEl.textContent = `
      .seagull-history-head { display:flex; justify-content:space-between; gap:8px; align-items:baseline; margin-bottom:10px; }
      .seagull-history-title { font-size:15px; font-weight:600; color:${textColor}; }
      .seagull-history-period { font-size:12px; opacity:0.8; }
      .seagull-history-rows { display:flex; flex-direction:column; gap:10px; }
      .seagull-history-row { display:flex; gap:8px; align-items:flex-start; }
      .seagull-history-row-icon { width:20px; height:20px; color:${textColor}; opacity:0.9; margin-top:2px; flex:0 0 auto; }
      .seagull-history-row-main { flex:1 1 auto; min-width:0; }
      .seagull-history-line { width:100%; position:relative; background:${lineColor}; }
      .seagull-history-line.pearls { min-height:8px; margin-top:2px; }
      .seagull-history-pearl {
        position:absolute;
        top:50%;
        transform:translate(-50%, -50%);
        width:var(--pearl-size, 12px);
        height:var(--pearl-size, 12px);
        border-radius:50%;
        background:var(--pearl-color, #f59e0b);
        border:var(--pearl-border-width, 2px) solid var(--pearl-border-color, #ffffff);
        box-sizing:border-box;
      }
      .seagull-history-row-name { margin-top:6px; font-size:12px; line-height:1.2; opacity:0.95; }
    `;
  }

  _normalizeTheme(custom) {
    const merged = structuredClone(SEAGULL_HISTORY_THEME_DEFAULT);
    this._deepMerge(merged, custom || {});
    return merged;
  }

  _deepMerge(target, source) {
    if (!source || typeof source !== "object") return;
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
        this._deepMerge(target[key], value);
      } else {
        target[key] = value;
      }
    }
  }

  _resolvePaletteMode(mode) {
    if (mode === "day" || mode === "night") return mode;
    return this._hass?.themes?.darkMode ? "night" : "day";
  }

  _resolveColor(value, theme, mode) {
    if (typeof value !== "string") return value;
    if (!value.startsWith("$")) return value;
    const key = value.slice(1);
    const token = theme.palette[key];
    if (!token) return value;
    if (token && typeof token === "object") return token[mode] ?? token.day ?? token.night;
    return token;
  }

  _withOpacity(color, opacity) {
    if (!color || typeof color !== "string") return color;
    const o = Math.max(0, Math.min(1, Number(opacity)));
    if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
      const hex = color.slice(1);
      const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${o})`;
    }
    return color;
  }

  _parsePeriodToMs(period) {
    const str = String(period || "12h").trim().toLowerCase();
    const m = str.match(/^(\d+(?:\.\d+)?)([smhdw])$/);
    if (!m) return 12 * 60 * 60 * 1000;
    const num = Number(m[1]);
    const unit = m[2];
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit] || 3600000;
    return num * mult;
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _ensureFont(url) {
    if (!url || document.head.querySelector(`link[data-seagull-history-font='${url}']`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute("data-seagull-history-font", url);
    document.head.appendChild(link);
  }
}

if (!customElements.get("seagull-history-card")) {
  customElements.define("seagull-history-card", SeagullHistoryCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "seagull-history-card",
  name: "Seagull History Card",
  description: "History visualization card (style: pearls)",
  preview: true,
});

console.info(
  "%c🐦 SEAGULL-HISTORY-CARD%c loaded",
  "color:#fff;background:#f97316;padding:2px 6px;border-radius:4px;font-weight:700;",
  `color:inherit; font-weight:500;`,
  { version: SEAGULL_HISTORY_CARD_VERSION, commit: SEAGULL_HISTORY_CARD_COMMIT },
);
