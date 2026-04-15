const SEAGULL_HISTORY_CARD_VERSION = "0.1.0";
const SEAGULL_HISTORY_CARD_COMMIT = "dev";

const SEAGULL_HISTORY_THEME_DEFAULT = {
  palette_mode: "auto", // auto | day | night
  palette: {
    card_border: { day: "#aaaaaa", night: "#64748b" },
    card_bg: { day: "#eeeeee", night: "#0f172a" },
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
    font_url: "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap",
  },
  pearls: {
    line_height: 0.8,
    line_radius: 999,
    line_color: "$line_color",
    pearl_size: 12,
    pearl_color: "$line_color",
  },
};

class SeagullHistoryCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:seagull-history-card",
      period: "12h",
      filter: "none",
      sun_events: false,
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
    this._backgroundEnabled = true;
    this._backgroundDetachedId = null;
    this._activePeriodIndex = 0;
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
      this._card.appendChild(this._content);
      this.appendChild(this._card);
    }

    const theme = this._normalizeTheme(this._config.theme);
    const mode = this._resolvePaletteMode(theme.palette_mode);
    this._activeTheme = { theme, mode };

    this._applyCardStyles(theme, mode);

    const bgContext = this._resolveBackgroundContext(theme, mode);
    const rowsHtml = this._buildRowsHtml(theme, mode, bgContext);
    const axis = this._buildTimeAxisParts();
    const sunEventsHtml = this._buildSunEventsHtml();
    const periodSwitchHtml = this._buildPeriodSwitchHtml();
    const bgStatsHtml = bgContext.statsText ? `<div class="seagull-history-stats">${this._escapeHtml(bgContext.statsText)}</div>` : "";
    const footerHtml = bgContext.activeName || periodSwitchHtml
      ? `
        <div class="seagull-history-footer">
          <div class="seagull-history-footer-left">
            <div class="seagull-history-background-name" data-bg-release="1">${bgContext.activeName ? this._escapeHtml(bgContext.activeName) : ""}</div>
            ${bgStatsHtml}
          </div>
          <div class="seagull-history-footer-right">
            <div class="seagull-history-period-switch">${periodSwitchHtml}</div>
          </div>
        </div>
      `
      : "";

    this._content.innerHTML = `
      <div class="seagull-history-chart">
        <div class="seagull-history-grid">${axis.gridTicksHtml}</div>
        <div class="seagull-history-background-layer">${bgContext.overlayHtml || ""}</div>
        <div class="seagull-history-rows">${rowsHtml}</div>
        <div class="seagull-history-sun-layer">${sunEventsHtml}</div>
      </div>
      <div class="seagull-history-axis-wrap">
        <div class="seagull-history-axis-bg">${bgContext.overlayHtml || ""}</div>
        <div class="seagull-history-axis">${axis.labelsHtml}</div>
      </div>
      ${footerHtml}
    `;

    this._bindRowActions();
    this._bindScaleHover();
    this._bindAxisHover(bgContext);
    this._bindBackgroundNameAction(bgContext);
    this._bindPeriodSwitchActions();
  }

  async _maybeFetchHistory() {
    if (!this._hass || !this._config) return;

    const entities = (this._config.entities || [])
      .map((e) => (typeof e === "string" ? e : e?.entity))
      .filter(Boolean);

    if (!entities.length) return;

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
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
      let payload = null;
      let map = new Map();

      if (typeof this._hass.callWS === "function") {
        payload = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: startIso,
          end_time: endIso,
          entity_ids: entities,
          minimal_response: true,
        });
        map = this._normalizeHistoryPayload(payload, entities);
      }

      if (!map.size) {
        const path = `history/period/${encodeURIComponent(startIso)}?filter_entity_id=${encodeURIComponent(entities.join(","))}&end_time=${encodeURIComponent(endIso)}&minimal_response`;
        payload = await this._hass.callApi("GET", path);
        map = this._normalizeHistoryPayload(payload, entities);
      }

      this._history = map;
      this._render();
    } catch (err) {
      console.error("[seagull-history-card] failed to fetch history", err);
    }
  }

  _normalizeHistoryPayload(payload, entities) {
    const map = new Map();

    if (Array.isArray(payload)) {
      for (let i = 0; i < payload.length; i += 1) {
        const seq = payload[i];
        if (!Array.isArray(seq) || !seq.length) continue;
        const first = seq[0] || {};
        const entityId = first.entity_id || first.e || entities[i];
        if (entityId) map.set(entityId, seq);
      }
      return map;
    }

    if (payload && typeof payload === "object") {
      for (const [entityId, seq] of Object.entries(payload)) {
        if (Array.isArray(seq)) {
          map.set(entityId, seq);
        }
      }
    }

    return map;
  }

  _resolveBackgroundContext(theme, mode) {
    const entities = this._config?.entities || [];
    const candidates = entities
      .map((row) => (typeof row === "string" ? { entity: row } : row || {}))
      .filter((row) => row.entity && row.as_background);

    if (!candidates.length) {
      this._backgroundEntityId = null;
      this._backgroundDetachedId = null;
      this._backgroundEnabled = true;
      return { activeId: null, activeName: null, overlayHtml: "", detachedId: null, statsText: "" };
    }

    const candidateIds = candidates.map((r) => r.entity);
    if (!this._backgroundEntityId || !candidateIds.includes(this._backgroundEntityId)) {
      this._backgroundEntityId = candidateIds[0];
    }

    if (this._backgroundDetachedId && !candidateIds.includes(this._backgroundDetachedId)) {
      this._backgroundDetachedId = null;
    }

    if (this._backgroundEnabled === false) {
      return {
        activeId: null,
        activeName: null,
        overlayHtml: "",
        detachedId: this._backgroundDetachedId || this._backgroundEntityId,
        statsText: "",
      };
    }

    const activeCfg = candidates.find((r) => r.entity === this._backgroundEntityId) || candidates[0];
    const activeId = activeCfg.entity;
    const activeStateObj = this._hass.states[activeId];
    const activeName = activeCfg.name || activeStateObj?.attributes?.friendly_name || activeId;

    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);
    const rules = this._normalizeStrongRules(activeCfg, this._config, activeId, activeStateObj, lineColor);
    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const normalized = this._getNormalizedHistory(activeId);
    const intervals = this._collectStrongIntervals(normalized, activeId, rules, startMs, endMs, lineColor);
    const statsFilterSec = this._getFilterSeconds(activeCfg, this._config);
    const stats = this._collectStrongStats(normalized, activeId, rules, startMs, endMs, lineColor, statsFilterSec);

    return {
      activeId,
      activeName,
      overlayHtml: this._renderBackgroundOverlay(intervals, startMs, endMs),
      detachedId: null,
      statsText: `${stats.entries}× ${this._formatDurationClock(stats.totalMs)}`,
    };
  }

  _buildRowsHtml(theme, mode, bgContext) {
    const style = (this._config.style || "pearls").toLowerCase();
    const entities = this._config.entities || [];

    return entities
      .map((row) => {
        const rowCfg = typeof row === "string" ? { entity: row } : row || {};
        const entityId = rowCfg.entity;
        if (!entityId) return "";

        const isActiveBackground = bgContext?.activeId && entityId === bgContext.activeId;
        if (isActiveBackground) return "";

        const isBackgroundCandidate = !!rowCfg.as_background && entityId !== bgContext?.activeId;
        const isDetachedBackground = !!bgContext?.detachedId && entityId === bgContext.detachedId;

        const stateObj = this._hass.states[entityId];
        const icon = this._resolveEntityIcon(rowCfg, stateObj, entityId);
        const name = rowCfg.name || stateObj?.attributes?.friendly_name || entityId;
        const statsText = this._getEntityStatsText(entityId, rowCfg, stateObj, theme, mode);

        let chartHtml = `<div class="seagull-history-line" data-entity="${this._escapeHtml(entityId)}"></div>`;
        if (style === "pearls") {
          chartHtml = this._buildPearlsHtml(entityId, rowCfg, stateObj, theme, mode, bgContext);
        } else if (style === "bars") {
          chartHtml = this._buildBarsHtml(entityId, rowCfg, stateObj, theme, mode, bgContext);
        }

        return `
          <div class="seagull-history-row${isBackgroundCandidate ? " is-bg-candidate" : ""}${isDetachedBackground ? " is-bg-detached" : ""}" data-entity="${this._escapeHtml(entityId)}" role="button" tabindex="0">
            <div class="seagull-history-row-line">
              <ha-icon class="seagull-history-row-icon" icon="${this._escapeHtml(icon)}" ${isBackgroundCandidate ? `data-bg-switch="${this._escapeHtml(entityId)}"` : ""}></ha-icon>
              ${chartHtml}
            </div>
            <div class="seagull-history-row-meta">
              <div class="seagull-history-row-name">${this._escapeHtml(name)}</div>
              <div class="seagull-history-stats">${this._escapeHtml(statsText)}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  _getEntityStatsText(entityId, rowCfg, stateObj, theme, mode) {
    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);
    const rules = this._normalizeStrongRules(rowCfg, this._config, entityId, stateObj, lineColor);
    const normalized = this._getNormalizedHistory(entityId);
    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const statsFilterSec = this._getFilterSeconds(rowCfg, this._config);
    const stats = this._collectStrongStats(normalized, entityId, rules, startMs, endMs, lineColor, statsFilterSec);
    return `${stats.entries}× ${this._formatDurationClock(stats.totalMs)}`;
  }

  _resolveEntityIcon(rowCfg, stateObj, entityId) {
    if (rowCfg?.icon) return String(rowCfg.icon);

    const attrIcon = stateObj?.attributes?.icon;
    if (typeof attrIcon === "string" && attrIcon.trim()) return attrIcon;

    const domain = String(entityId || "").split(".")[0] || "";
    const state = String(stateObj?.state ?? "").toLowerCase();
    const deviceClass = String(stateObj?.attributes?.device_class || "").toLowerCase();

    if (domain === "binary_sensor") {
      const isOn = state === "on";
      const byClass = {
        door: isOn ? "mdi:door-open" : "mdi:door-closed",
        window: isOn ? "mdi:window-open" : "mdi:window-closed",
        opening: isOn ? "mdi:garage-open" : "mdi:garage",
        garage_door: isOn ? "mdi:garage-open" : "mdi:garage",
        lock: isOn ? "mdi:lock-open-variant" : "mdi:lock",
        motion: isOn ? "mdi:motion-sensor" : "mdi:motion-sensor-off",
        occupancy: isOn ? "mdi:home-account" : "mdi:home-outline",
      };
      return byClass[deviceClass] || (isOn ? "mdi:check-circle" : "mdi:circle-outline");
    }

    if (domain === "lock") {
      return state === "unlocked" ? "mdi:lock-open-variant" : "mdi:lock";
    }

    if (domain === "cover") {
      return state === "open" || state === "opening" ? "mdi:blinds-open" : "mdi:blinds";
    }

    if (domain === "sensor") {
      if (["door", "window", "opening", "garage_door", "lock"].includes(deviceClass)) {
        if (state === "open") {
          return deviceClass === "window" ? "mdi:window-open" : deviceClass === "lock" ? "mdi:lock-open-variant" : "mdi:door-open";
        }
        if (state === "unlocked") return "mdi:lock-open-variant";
        return deviceClass === "window" ? "mdi:window-closed" : deviceClass === "lock" ? "mdi:lock" : "mdi:door-closed";
      }
    }

    if (domain === "light") return state === "on" ? "mdi:lightbulb" : "mdi:lightbulb-off";

    return "mdi:help-circle-outline";
  }

  _buildPearlsHtml(entityId, rowCfg, stateObj, theme, mode, bgContext) {
    const history = this._history?.get(entityId) || [];

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const lineHeight = Number(theme.pearls.line_height) || 2;
    const lineRadius = Number(theme.pearls.line_radius) || 999;
    const pearlSize = Number(theme.pearls.pearl_size) || 12;
    const pearlColor = this._resolveColor(theme.pearls.pearl_color, theme, mode);
    const minPearlSize = Math.max(lineHeight + 2, Math.round(pearlSize * 0.34));
    const segmentThresholdRatio = Number(rowCfg.segment_threshold_ratio ?? this._config.segment_threshold_ratio ?? 0.03);
    const segmentThresholdMs = Math.max(1, periodMs * Math.max(0.002, Math.min(0.2, segmentThresholdRatio)));

    const normalized = history
      .map((it) => ({
        state: String(it.state ?? it.s ?? ""),
        ts: this._toEpochMs(it.last_changed || it.last_updated || it.lu || it.lc || 0),
      }))
      .filter((it) => Number.isFinite(it.ts))
      .sort((a, b) => a.ts - b.ts);

    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);
    const showRules = this._normalizeStrongRules(rowCfg, this._config, entityId, stateObj, lineColor);

    const marks = [];
    const stateAtStart = this._stateAtTs(normalized, entityId, startMs, { preferFirst: true });

    const intervals = this._collectStrongIntervals(normalized, entityId, showRules, startMs, endMs, lineColor, stateAtStart);

    for (const itv of intervals) {
      const from = Math.max(startMs, Math.min(endMs, itv.from));
      const to = Math.max(startMs, Math.min(endMs, itv.to));
      if (to < from) continue;

      const durationMs = Math.max(0, to - from);

      const left = ((from - startMs) / periodMs) * 100;
      const right = ((to - startMs) / periodMs) * 100;
      const width = Math.max(0, right - left);

      if (durationMs < segmentThresholdMs) {
        const t = segmentThresholdMs > 0 ? Math.min(1, durationMs / segmentThresholdMs) : 0;
        const eventSize = minPearlSize + (pearlSize - minPearlSize) * t;
        marks.push(
          `<span class="seagull-history-pearl" style="left:${left.toFixed(3)}%;background:${this._escapeHtml(itv.color)};--pearl-size:${eventSize.toFixed(2)}px;"></span>`,
        );
        continue;
      }

      const edgeLeft = from <= startMs + 1;
      const edgeRight = to >= endMs - 1;
      const cls = `seagull-history-segment${edgeLeft ? " edge-left" : ""}${edgeRight ? " edge-right" : ""}`;
      marks.push(
        `<span class="${cls}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${this._escapeHtml(itv.color)};"></span>`,
      );
    }

    return `
      <div class="seagull-history-line pearls" data-entity="${this._escapeHtml(entityId)}" style="height:${lineHeight}px;border-radius:${lineRadius}px;background:${lineColor};--pearl-size:${pearlSize}px;--pearl-color:${pearlColor};">
        ${marks.join("")}
      </div>
    `;
  }

  _buildBarsHtml(entityId, rowCfg, stateObj, theme, mode, bgContext) {
    const history = this._history?.get(entityId) || [];

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const lineHeight = Number(theme.pearls.line_height) || 1;
    const lineRadius = Number(theme.pearls.line_radius) || 999;
    const pearlSize = Number(theme.pearls.pearl_size) || 12;
    const lineColor = this._resolveColor(theme.pearls.line_color, theme, mode);
    const showRules = this._normalizeStrongRules(rowCfg, this._config, entityId, stateObj, lineColor);

    const normalized = history
      .map((it) => ({
        state: String(it.state ?? it.s ?? ""),
        ts: this._toEpochMs(it.last_changed || it.last_updated || it.lu || it.lc || 0),
      }))
      .filter((it) => Number.isFinite(it.ts))
      .sort((a, b) => a.ts - b.ts);

    const stateAtStart = this._stateAtTs(normalized, entityId, startMs, { preferFirst: true });
    const intervals = this._collectStrongIntervals(normalized, entityId, showRules, startMs, endMs, lineColor, stateAtStart);

    const barHeight = Math.max(lineHeight + 4, Math.round(pearlSize * 0.75));
    const marks = [];

    for (const itv of intervals) {
      const from = Math.max(startMs, Math.min(endMs, itv.from));
      const to = Math.max(startMs, Math.min(endMs, itv.to));
      if (to < from) continue;

      const left = ((from - startMs) / periodMs) * 100;
      const right = ((to - startMs) / periodMs) * 100;
      const width = Math.max(0.25, right - left);

      marks.push(`<span class="seagull-history-bar" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${this._escapeHtml(itv.color)};--bar-height:${barHeight}px;"></span>`);
    }

    return `
      <div class="seagull-history-line bars" data-entity="${this._escapeHtml(entityId)}" style="height:${lineHeight}px;border-radius:${lineRadius}px;background:${lineColor};">
        ${marks.join("")}
      </div>
    `;
  }

  _collectStrongIntervals(normalized, entityId, rules, startMs, endMs, lineColor, stateAtStartInput = null) {
    const intervals = [];
    const stateAtStart = stateAtStartInput ?? this._stateAtTs(normalized, entityId, startMs, { preferFirst: true });
    let activeStart = this._isStrongState(stateAtStart, rules) ? startMs : null;
    let prevState = stateAtStart;

    for (const item of normalized) {
      if (item.ts < startMs || item.ts > endMs) continue;
      const currState = item.state;

      const prevStrong = this._isStrongState(prevState, rules);
      const currStrong = this._isStrongState(currState, rules);
      const prevColor = this._getStrongColor(prevState, rules, lineColor);
      const currColor = this._getStrongColor(currState, rules, lineColor);

      if (prevStrong && (!currStrong || currColor !== prevColor)) {
        intervals.push({ from: activeStart ?? startMs, to: item.ts, color: prevColor });
        activeStart = null;
      }

      if (!prevStrong && currStrong) {
        activeStart = item.ts;
      } else if (prevStrong && currStrong && currColor !== prevColor) {
        activeStart = item.ts;
      }

      prevState = currState;
    }

    if (this._isStrongState(prevState, rules)) {
      intervals.push({ from: activeStart ?? startMs, to: endMs, color: this._getStrongColor(prevState, rules, lineColor) });
    }

    return intervals;
  }

  _collectStrongStats(normalized, entityId, rules, startMs, endMs, lineColor, filterSeconds = null) {
    const intervals = this._collectStrongIntervals(normalized, entityId, rules, startMs, endMs, lineColor);
    const mergedIntervals = this._mergeIntervalsForStats(intervals, filterSeconds);

    let totalMs = 0;
    for (const itv of mergedIntervals) {
      totalMs += Math.max(0, itv.to - itv.from);
    }

    return { entries: mergedIntervals.length, totalMs };
  }

  _mergeIntervalsForStats(intervals, filterSeconds) {
    if (!Array.isArray(intervals) || !intervals.length) return [];
    const gapMs = Number.isFinite(Number(filterSeconds)) ? Math.max(0, Number(filterSeconds)) * 1000 : null;
    if (gapMs === null) return intervals.map((x) => ({ ...x }));

    const sorted = [...intervals].sort((a, b) => a.from - b.from);
    const out = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i += 1) {
      const curr = sorted[i];
      const last = out[out.length - 1];
      const gap = curr.from - last.to;

      if (gap <= gapMs) {
        last.to = Math.max(last.to, curr.to);
      } else {
        out.push({ ...curr });
      }
    }

    return out;
  }

  _getFilterSeconds(rowCfg, cardCfg) {
    const raw = rowCfg?.filter ?? cardCfg?.filter;
    if (raw === undefined || raw === null || String(raw).trim().toLowerCase() === "none") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  _renderBackgroundOverlay(intervals, startMs, endMs) {
    const periodMs = Math.max(1, endMs - startMs);
    const parts = [];
    for (const itv of intervals) {
      const from = Math.max(startMs, Math.min(endMs, itv.from));
      const to = Math.max(startMs, Math.min(endMs, itv.to));
      if (to < from) continue;
      const left = ((from - startMs) / periodMs) * 100;
      const right = ((to - startMs) / periodMs) * 100;
      const width = Math.max(0.35, right - left);
      parts.push(`<span class="seagull-history-bg-segment" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${this._escapeHtml(itv.color)};"></span>`);
    }
    return parts.join("");
  }

  _buildTimeAxisParts() {
    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const { stepMs, format } = this._getAxisStep(periodMs);

    if (!stepMs || stepMs <= 0 || stepMs >= periodMs) {
      return { gridTicksHtml: "", labelsHtml: "" };
    }

    const firstTick = Math.ceil(startMs / stepMs) * stepMs;
    const gridTicks = [];
    const labels = [];

    for (let ts = firstTick; ts <= endMs; ts += stepMs) {
      const x = ((ts - startMs) / periodMs) * 100;
      if (x < 0 || x > 100) continue;
      const label = this._formatAxisLabel(ts, format);

      let labelClass = "";
      if (x <= 0.5) labelClass = " edge-left";
      else if (x >= 99.5) labelClass = " edge-right";

      gridTicks.push(`<div class="seagull-history-grid-tick" style="left:${x.toFixed(3)}%"></div>`);
      labels.push(`<div class="seagull-history-axis-label${labelClass}" data-ts="${ts}" style="left:${x.toFixed(3)}%">${this._escapeHtml(label)}</div>`);
    }

    return {
      gridTicksHtml: gridTicks.join(""),
      labelsHtml: labels.join(""),
    };
  }

  _buildSunEventsHtml() {
    if (!this._config?.sun_events) return "";

    const sun = this._hass?.states?.["sun.sun"];
    if (!sun?.attributes) return "";

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;

    const nextRisingMs = this._toEpochMs(sun.attributes.next_rising);
    const nextSettingMs = this._toEpochMs(sun.attributes.next_setting);

    const points = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const collect = (baseMs, kind) => {
      if (!Number.isFinite(baseMs)) return;
      for (let i = -8; i <= 8; i += 1) {
        const ts = baseMs + i * dayMs;
        if (ts >= startMs && ts <= endMs) {
          points.push({ ts, kind });
        }
      }
    };

    collect(nextRisingMs, "rising");
    collect(nextSettingMs, "setting");

    if (!points.length) return "";

    points.sort((a, b) => a.ts - b.ts);
    const unique = [];
    for (const p of points) {
      if (!unique.length || Math.abs(unique[unique.length - 1].ts - p.ts) > 60000) {
        unique.push(p);
      }
    }

    return unique
      .map((p) => {
        const x = ((p.ts - startMs) / periodMs) * 100;
        const cls = p.kind === "rising" ? " rising" : " setting";
        return `<div class="seagull-history-sun-line${cls}" style="left:${x.toFixed(3)}%"></div>`;
      })
      .join("");
  }

  _getPeriodOptions() {
    const p = this._config?.period;
    if (Array.isArray(p)) {
      return p.map((x) => String(x).trim()).filter(Boolean);
    }
    if (p !== null && p !== undefined && String(p).trim() !== "") {
      return [String(p).trim()];
    }
    return ["12h"];
  }

  _getActivePeriod() {
    const options = this._getPeriodOptions();
    if (!Number.isInteger(this._activePeriodIndex) || this._activePeriodIndex < 0 || this._activePeriodIndex >= options.length) {
      this._activePeriodIndex = 0;
    }
    return options[this._activePeriodIndex] || "12h";
  }

  _buildPeriodSwitchHtml() {
    const options = this._getPeriodOptions();
    if (options.length <= 1) return "";
    return options
      .map((label, idx) => `<button class="seagull-history-period-btn${idx === this._activePeriodIndex ? " active" : ""}" data-period-index="${idx}">${this._escapeHtml(label)}</button>`)
      .join("");
  }

  _bindPeriodSwitchActions() {
    const btns = this._content?.querySelectorAll?.(".seagull-history-period-btn[data-period-index]") || [];
    for (const btn of btns) {
      btn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const idx = Number(btn.getAttribute("data-period-index"));
        if (!Number.isInteger(idx) || idx === this._activePeriodIndex) return;
        this._activePeriodIndex = idx;
        this._lastFetchKey = "";
        this._render();
        this._maybeFetchHistory();
      };
    }
  }

  _getAxisStep(periodMs) {
    const H = 3600000;
    const D = 86400000;

    if (periodMs <= 2 * H) return { stepMs: 15 * 60000, format: "HH:mm" };
    if (periodMs <= 12 * H) return { stepMs: 1 * H, format: "HH" };
    if (periodMs <= 24 * H) return { stepMs: 2 * H, format: "HH" };
    if (periodMs <= 2 * D) return { stepMs: 6 * H, format: "HH" };
    if (periodMs <= 7 * D) return { stepMs: 1 * D, format: "DD/MM" };
    return { stepMs: 7 * D, format: "DD/MM" };
  }

  _formatAxisLabel(ts, format) {
    const d = new Date(ts);
    if (format === "HH:mm") {
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    if (format === "DD/MM") {
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return String(d.getHours()).padStart(2, "0");
  }

  _applyCardStyles(theme, mode) {
    const cardBg = this._resolveColor(theme.card.background_color, theme, mode);
    const cardBorder = this._resolveColor(theme.card.border_color, theme, mode);
    const textColor = this._resolveColor(theme.palette.text_color, theme, mode);

    const opacity = Number(this._config.background_opacity ?? theme.card.background_opacity ?? 0.45);
    const borderWidth = Number(this._config.border_width ?? theme.card.border_width ?? 0);
    const borderRadius = Number(this._config.border_radius ?? theme.card.border_radius ?? 16);

    this._card.style.borderRadius = `${borderRadius}px`;
    this._card.style.border = `${borderWidth}px solid ${cardBorder}`;
    this._card.style.background = this._withOpacity(cardBg, opacity);
    this._card.style.overflow = "hidden";
    this._card.style.position = "relative";

    this._content.style.position = "relative";
    this._content.style.zIndex = "2";
    this._content.style.padding = "12px";
    this._content.style.color = textColor;

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
      .seagull-history-chart { position:relative; }
      .seagull-history-grid {
        position:absolute;
        top:0;
        bottom:-6px;
        left:28px;
        right:0;
        pointer-events:none;
        z-index:0;
      }
      .seagull-history-background-layer {
        position:absolute;
        top:0;
        bottom:-6px;
        left:28px;
        right:0;
        pointer-events:none;
        z-index:1;
      }
      .seagull-history-grid-tick {
        position:absolute;
        top:0;
        bottom:0;
        width:1px;
        transform:translateX(-0.5px);
        background:${lineColor};
        opacity:0.32;
      }
      .seagull-history-rows { position:relative; z-index:2; display:flex; flex-direction:column; gap:10px; }
      .seagull-history-sun-layer {
        position:absolute;
        top:0;
        bottom:-6px;
        left:28px;
        right:0;
        pointer-events:none;
        z-index:3;
      }
      .seagull-history-sun-line {
        position:absolute;
        top:0;
        bottom:0;
        width:1px;
        transform:translateX(-0.5px);
        border-left:1px dashed #facc15;
        opacity:0.72;
      }
      .seagull-history-row { display:flex; flex-direction:column; gap:3px; }
      .seagull-history-row { cursor:pointer; }
      .seagull-history-row-line { display:flex; align-items:center; gap:8px; }
      .seagull-history-row-icon { width:20px; height:20px; color:${textColor}; opacity:0.9; flex:0 0 auto; display:flex; align-items:center; justify-content:center; }
      .seagull-history-row.is-bg-candidate .seagull-history-row-icon {
        background:${lineColor};
        border-radius:999px;
        opacity:0.55;
        padding:2px;
      }
      .seagull-history-row.is-bg-detached .seagull-history-row-icon {
        background:${lineColor};
        border-radius:999px;
        opacity:0.72;
        padding:2px;
      }
      .seagull-history-line { width:100%; position:relative; background:${lineColor}; }
      .seagull-history-line.pearls { min-height:1px; }
      .seagull-history-line.bars { min-height:1px; }
      .seagull-history-bg-segment {
        position:absolute;
        top:0;
        bottom:0;
        opacity:0.16;
        pointer-events:none;
      }
      .seagull-history-bar {
        position:absolute;
        top:50%;
        transform:translateY(-50%);
        height:var(--bar-height, 9px);
        border-radius:2px;
        box-sizing:border-box;
      }
      .seagull-history-pearl {
        position:absolute;
        top:50%;
        transform:translate(-50%, -50%);
        width:var(--pearl-size, 12px);
        height:var(--pearl-size, 12px);
        border-radius:50%;
        background:var(--pearl-color, #f59e0b);
        border:none;
        outline:none;
        box-shadow:none;
        box-sizing:border-box;
      }
      .seagull-history-segment {
        position:absolute;
        top:50%;
        transform:translateY(-50%);
        height:var(--pearl-size, 12px);
        border-radius:calc(var(--pearl-size, 12px) / 2);
        box-sizing:border-box;
      }
      .seagull-history-segment.edge-left {
        border-top-left-radius:0;
        border-bottom-left-radius:0;
      }
      .seagull-history-segment.edge-right {
        border-top-right-radius:0;
        border-bottom-right-radius:0;
      }
      .seagull-history-row-meta {
        margin-left:28px;
        margin-top:-1px;
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:8px;
      }
      .seagull-history-row-name { font-size:12px; line-height:1.2; opacity:0.95; }
      .seagull-history-axis-wrap { margin-left:28px; margin-top:0; position:relative; height:22px; }
      .seagull-history-axis-bg {
        position:absolute;
        inset:0;
        pointer-events:none;
      }
      .seagull-history-axis-bg .seagull-history-bg-segment {
        opacity:0.08;
      }
      .seagull-history-axis { position:relative; height:22px; z-index:1; }
      .seagull-history-axis::before {
        content:"";
        position:absolute;
        left:0;
        right:0;
        top:0;
        bottom:0;
        background:rgba(255,255,255,0.18);
        pointer-events:none;
      }
      .seagull-history-axis-label {
        position:absolute;
        top:50%;
        transform:translate(-50%, -50%);
        font-size:10px;
        line-height:1;
        color:${textColor};
        opacity:0.9;
        padding:1px 0;
        white-space:nowrap;
        z-index:1;
      }
      .seagull-history-axis-label.edge-left {
        transform:translate(0%, -50%);
      }
      .seagull-history-axis-label.edge-right {
        transform:translate(-100%, -50%);
      }
      .seagull-history-footer {
        margin-top:2px;
        margin-left:28px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
      }
      .seagull-history-footer-left {
        display:flex;
        flex-direction:column;
        gap:2px;
      }
      .seagull-history-footer-right {
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:3px;
      }
      .seagull-history-background-name {
        font-size:11px;
        line-height:1.2;
        opacity:0.75;
        cursor:pointer;
        min-height:13px;
      }
      .seagull-history-stats {
        font-size:10px;
        line-height:1.2;
        opacity:0.78;
        text-align:right;
      }
      .seagull-history-period-switch {
        display:flex;
        gap:4px;
      }
      .seagull-history-period-btn {
        border:none;
        border-radius:999px;
        padding:2px 7px;
        font-size:10px;
        line-height:1.3;
        background:rgba(148, 163, 184, 0.2);
        color:${textColor};
        opacity:0.88;
        cursor:pointer;
      }
      .seagull-history-period-btn.active {
        background:rgba(59, 130, 246, 0.42);
        opacity:1;
      }
      .seagull-history-tooltip {
        position:absolute;
        z-index:20;
        pointer-events:none;
        background:rgba(15, 23, 42, 0.94);
        color:#f8fafc;
        border-radius:8px;
        padding:8px 10px;
        font-size:11px;
        line-height:1.35;
        box-shadow:0 6px 20px rgba(2, 6, 23, 0.35);
        max-width:240px;
        display:none;
      }
      .seagull-history-tooltip b { font-weight:700; }
    `;
  }

  _bindRowActions() {
    const rows = this._content?.querySelectorAll?.(".seagull-history-row[data-entity]") || [];
    for (const row of rows) {
      const entityId = row.getAttribute("data-entity");
      if (!entityId) continue;

      const switchIcon = row.querySelector(".seagull-history-row-icon[data-bg-switch]");
      if (switchIcon) {
        switchIcon.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._backgroundEnabled = true;
          this._backgroundEntityId = entityId;
          this._backgroundDetachedId = null;
          this._render();
        };
      }

      row.onclick = () => this._openMoreInfo(entityId);
      row.onkeydown = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this._openMoreInfo(entityId);
        }
      };
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _bindBackgroundNameAction(bgContext) {
    if (!bgContext?.activeId) return;
    const el = this._content?.querySelector?.(".seagull-history-background-name[data-bg-release='1']");
    if (!el) return;
    el.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._backgroundEnabled = false;
      this._backgroundDetachedId = bgContext.activeId;
      this._render();
    };
  }

  _bindScaleHover() {
    this._ensureTooltip();
    const rowLines = this._content?.querySelectorAll?.(".seagull-history-row-line") || [];
    for (const rowLine of rowLines) {
      const row = rowLine.closest(".seagull-history-row[data-entity]");
      const entityId = row?.getAttribute("data-entity");
      if (!entityId) continue;

      rowLine.onmousemove = (ev) => {
        if (ev.target?.closest?.(".seagull-history-row-icon")) {
          this._hideTooltip();
          return;
        }
        this._showRowTooltip(ev, rowLine, entityId);
      };
      rowLine.onmouseleave = () => this._hideTooltip();
    }
  }

  _bindAxisHover(bgContext) {
    if (!bgContext?.activeId) return;
    const axis = this._content?.querySelector?.(".seagull-history-axis");
    if (axis) {
      axis.onmousemove = (ev) => {
        const rect = axis.getBoundingClientRect();
        if (!rect.width) return;
        const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
        const ratio = x / rect.width;
        const periodMs = this._parsePeriodToMs(this._getActivePeriod());
        const endMs = Date.now();
        const startMs = endMs - periodMs;
        const ts = startMs + ratio * periodMs;
        this._showTooltipForEntityAtTs(ev, bgContext.activeId, ts);
      };
      axis.onmouseleave = () => this._hideTooltip();
    }

    const labels = this._content?.querySelectorAll?.(".seagull-history-axis-label[data-ts]") || [];
    for (const label of labels) {
      const ts = Number(label.getAttribute("data-ts"));
      if (!Number.isFinite(ts)) continue;
      label.onmousemove = (ev) => this._showTooltipForEntityAtTs(ev, bgContext.activeId, ts);
      label.onmouseleave = () => this._hideTooltip();
    }
  }

  _ensureTooltip() {
    if (this._tooltipEl) return;
    this._tooltipEl = document.createElement("div");
    this._tooltipEl.className = "seagull-history-tooltip";
    this._card.appendChild(this._tooltipEl);
  }

  _showRowTooltip(ev, rowEl, entityId) {
    if (!this._tooltipEl || !this._hass) return;

    const lineEl = rowEl?.matches?.(".seagull-history-line[data-entity]") ? rowEl : rowEl?.querySelector?.(".seagull-history-line[data-entity]");
    if (!lineEl) return;

    const rect = lineEl.getBoundingClientRect();
    if (!rect.width) return;

    const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const ratio = x / rect.width;

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const ts = startMs + ratio * periodMs;

    this._showTooltipForEntityAtTs(ev, entityId, ts);
  }

  _showTooltipForEntityAtTs(ev, entityId, ts) {
    if (!this._tooltipEl || !this._hass) return;

    const periodMs = this._parsePeriodToMs(this._getActivePeriod());
    const endMs = Date.now();
    const startMs = endMs - periodMs;

    const rowCfg = this._getEntityRowConfig(entityId);
    const stateObj = this._hass.states[entityId];
    const entityName = rowCfg.name || stateObj?.attributes?.friendly_name || entityId;
    const lineColor = this._resolveColor(this._activeTheme?.theme?.pearls?.line_color, this._activeTheme?.theme, this._activeTheme?.mode) || "#94a3b8";
    const showRules = this._normalizeStrongRules(rowCfg, this._config, entityId, stateObj, lineColor);
    const normalized = this._getNormalizedHistory(entityId);

    const stateAt = this._stateAtTs(normalized, entityId, ts, { preferFirst: true });
    const stateWindow = this._stateWindowAtTs(normalized, entityId, ts, startMs, endMs);
    const nearest = this._nearestStrongEventsSplit(ts, normalized, entityId, showRules, startMs, endMs);

    const pastLabel = nearest.past ? `${this._formatTs(nearest.past.ts)} (${nearest.past.state})` : "—";
    const futureLabel = nearest.future ? `${this._formatTs(nearest.future.ts)} (${nearest.future.state})` : "—";

    this._tooltipEl.innerHTML = `
      <div><b>${this._escapeHtml(entityName)}</b></div>
      <div><b>Время:</b> ${this._escapeHtml(this._formatTs(ts))}</div>
      <div><b>Состояние:</b> ${this._escapeHtml(stateAt)} (${this._escapeHtml(this._formatDuration(stateWindow.durationMs))})</div>
      <div><b>Было:</b> ${this._escapeHtml(pastLabel)}</div>
      <div><b>Будет:</b> ${this._escapeHtml(futureLabel)}</div>
    `;

    const cardRect = this._card.getBoundingClientRect();
    const offsetX = ev.clientX - cardRect.left;
    const offsetY = ev.clientY - cardRect.top;

    this._tooltipEl.style.display = "block";
    const ttRect = this._tooltipEl.getBoundingClientRect();

    let left = offsetX + 12;
    let top = offsetY - ttRect.height - 10;

    if (left + ttRect.width > cardRect.width - 6) left = cardRect.width - ttRect.width - 6;
    if (left < 6) left = 6;
    if (top < 6) top = offsetY + 12;

    this._tooltipEl.style.left = `${left}px`;
    this._tooltipEl.style.top = `${top}px`;
  }

  _hideTooltip() {
    if (!this._tooltipEl) return;
    this._tooltipEl.style.display = "none";
  }

  _getEntityRowConfig(entityId) {
    const entities = this._config?.entities || [];
    for (const row of entities) {
      const rowCfg = typeof row === "string" ? { entity: row } : row || {};
      if (rowCfg.entity === entityId) return rowCfg;
    }
    return { entity: entityId };
  }

  _getNormalizedHistory(entityId) {
    const history = this._history?.get(entityId) || [];
    return history
      .map((it) => ({
        state: String(it.state ?? it.s ?? ""),
        ts: this._toEpochMs(it.last_changed || it.last_updated || it.lu || it.lc || 0),
      }))
      .filter((it) => Number.isFinite(it.ts))
      .sort((a, b) => a.ts - b.ts);
  }

  _stateAtTs(normalized, entityId, ts, options = {}) {
    let state = null;
    for (const item of normalized) {
      if (item.ts <= ts) state = item.state;
      else break;
    }

    if (state !== null) return String(state);
    if (options.preferFirst && normalized.length) return String(normalized[0].state ?? "");
    return String(this._hass.states[entityId]?.state ?? "");
  }

  _nearestStrongEventsSplit(ts, normalized, entityId, rules, startMs, endMs) {
    const events = [];
    let prev = this._stateAtTs(normalized, entityId, startMs, { preferFirst: true });
    if (this._isStrongState(prev, rules)) events.push({ ts: startMs, state: prev });
    for (const item of normalized) {
      if (item.ts < startMs || item.ts > endMs) continue;
      const becomesStrong = this._isStrongState(item.state, rules) && !this._isStrongState(prev, rules);
      if (becomesStrong) events.push({ ts: item.ts, state: item.state });
      prev = item.state;
    }

    let past = null;
    let future = null;
    for (const e of events) {
      if (e.ts <= ts && (past === null || e.ts > past.ts)) past = e;
      if (e.ts > ts && (future === null || e.ts < future.ts)) future = e;
    }
    return { past, future };
  }

  _stateWindowAtTs(normalized, entityId, ts, startMs, endMs) {
    const points = [];
    const stateAtStart = this._stateAtTs(normalized, entityId, startMs, { preferFirst: true });
    points.push({ ts: startMs, state: stateAtStart });

    for (const item of normalized) {
      if (item.ts <= startMs || item.ts > endMs) continue;
      points.push({ ts: item.ts, state: item.state });
    }

    points.sort((a, b) => a.ts - b.ts);

    for (let i = 0; i < points.length; i += 1) {
      const curr = points[i];
      const nextTs = i + 1 < points.length ? points[i + 1].ts : endMs;
      if (ts >= curr.ts && ts <= nextTs) {
        return { state: curr.state, from: curr.ts, to: nextTs, durationMs: Math.max(0, nextTs - curr.ts) };
      }
    }

    return { state: this._stateAtTs(normalized, entityId, ts, { preferFirst: true }), from: startMs, to: endMs, durationMs: Math.max(0, endMs - startMs) };
  }

  _formatTs(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    return `${hh}:${mm} ${dd}/${mo}`;
  }

  _formatDuration(ms) {
    const totalMin = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}ч ${String(m).padStart(2, "0")}м`;
    return `${m}м`;
  }

  _formatDurationClock(ms) {
    const totalMin = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

  _normalizeStrongRules(rowCfg, cardCfg, entityId, stateObj, fallbackColor) {
    const cfgState = rowCfg.show_state ?? cardCfg.show_state ?? rowCfg.show_value ?? cardCfg.show_value;
    const cfgNot = rowCfg.show_not_state ?? cardCfg.show_not_state;
    const cfgAbove = rowCfg.show_above ?? cardCfg.show_above;
    const cfgBelow = rowCfg.show_below ?? cardCfg.show_below;

    const rules = {
      state: this._parseStateRules(cfgState, fallbackColor),
      notState: this._parseStateRules(cfgNot, fallbackColor),
      above: this._parseNumericRules(cfgAbove, fallbackColor),
      below: this._parseNumericRules(cfgBelow, fallbackColor),
    };

    if (!rules.state.length && !rules.notState.length && !rules.above.length && !rules.below.length) {
      rules.state = this._defaultStrongValues(entityId, stateObj).map((v) => ({ value: String(v).toLowerCase(), color: fallbackColor }));
    }

    return rules;
  }

  _parseStateRules(config, fallbackColor) {
    const out = [];
    const push = (value, color) => {
      if (value === null || value === undefined) return;
      out.push({ value: String(value).toLowerCase(), color: color ? String(color) : fallbackColor });
    };

    if (config === null || config === undefined) return out;

    if (["string", "number", "boolean"].includes(typeof config)) {
      push(config, fallbackColor);
      return out;
    }

    if (Array.isArray(config)) {
      for (const item of config) {
        if (item && typeof item === "object" && !Array.isArray(item)) push(item.value, item.color || fallbackColor);
        else push(item, fallbackColor);
      }
      return out;
    }

    if (config && typeof config === "object") {
      const commonColor = config.color || fallbackColor;
      if (Object.prototype.hasOwnProperty.call(config, "value")) {
        const v = config.value;
        if (Array.isArray(v)) v.forEach((x) => push(x, commonColor));
        else push(v, commonColor);
      }
      for (const key of ["values", "items", "list"]) {
        const arr = config[key];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (item && typeof item === "object" && !Array.isArray(item)) push(item.value, item.color || commonColor);
          else push(item, commonColor);
        }
      }
    }

    return out;
  }

  _parseNumericRules(config, fallbackColor) {
    const out = [];
    const push = (value, color) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      out.push({ value: n, color: color ? String(color) : fallbackColor });
    };

    if (config === null || config === undefined) return out;

    if (typeof config === "number" || (typeof config === "string" && config.trim() !== "")) {
      push(config, fallbackColor);
      return out;
    }

    if (Array.isArray(config)) {
      for (const item of config) {
        if (item && typeof item === "object" && !Array.isArray(item)) push(item.value, item.color || fallbackColor);
        else push(item, fallbackColor);
      }
      return out;
    }

    if (config && typeof config === "object") {
      const commonColor = config.color || fallbackColor;
      if (Object.prototype.hasOwnProperty.call(config, "value")) push(config.value, commonColor);
      for (const key of ["values", "items", "list"]) {
        const arr = config[key];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (item && typeof item === "object" && !Array.isArray(item)) push(item.value, item.color || commonColor);
          else push(item, commonColor);
        }
      }
    }

    return out;
  }

  _defaultStrongValues(entityId, stateObj) {
    const domain = String(entityId || "").split(".")[0] || "";
    const deviceClass = String(stateObj?.attributes?.device_class || "").toLowerCase();

    if (domain === "lock") return ["unlocked"];
    if (domain === "cover") return ["open", "opening"];
    if (domain === "person" || domain === "device_tracker") return ["home"];

    if (domain === "binary_sensor") {
      if (["door", "window", "opening", "garage_door", "lock"].includes(deviceClass)) {
        return ["open", "unlocked", "on"];
      }
      return ["on"];
    }

    if (domain === "sensor" && ["door", "window", "opening", "garage_door", "lock"].includes(deviceClass)) {
      return ["open", "unlocked", "on"];
    }

    return ["on"];
  }

  _isStrongState(state, rules) {
    return this._matchStrongState(state, rules).hit;
  }

  _getStrongColor(state, rules, fallbackColor) {
    const m = this._matchStrongState(state, rules);
    return m.color || fallbackColor;
  }

  _matchStrongState(state, rules) {
    const s = String(state ?? "").toLowerCase();
    const n = Number(state);

    const stateHit = (rules.state || []).find((r) => r.value === s);
    if (stateHit) return { hit: true, color: stateHit.color };

    const aboveHit = Number.isFinite(n) ? (rules.above || []).find((r) => n > r.value) : null;
    if (aboveHit) return { hit: true, color: aboveHit.color };

    const belowHit = Number.isFinite(n) ? (rules.below || []).find((r) => n < r.value) : null;
    if (belowHit) return { hit: true, color: belowHit.color };

    if ((rules.notState || []).length) {
      const excluded = new Set((rules.notState || []).map((r) => r.value));
      if (!excluded.has(s)) {
        return { hit: true, color: rules.notState[0]?.color };
      }
    }

    return { hit: false, color: null };
  }

  _toEpochMs(value) {
    if (typeof value === "number") {
      return value < 1e12 ? value * 1000 : value;
    }
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    return num < 1e12 ? num * 1000 : num;
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

class SeagullHistoryCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  _render() {
    this.innerHTML = `
      <div style="padding:12px 0; opacity:.9; font-size:13px; line-height:1.4;">
        <div style="margin-top:12px;background:var(--card-background-color,#f3f4f6);border-radius:9999px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--divider-color,#d1d5db);">
          <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Seagull History Card</div>
          <div style="background:#0ea5e9;color:#fff;border-radius:9999px;padding:2px 8px;font-size:12px;font-weight:700;line-height:1.6;">v${SEAGULL_HISTORY_CARD_VERSION}</div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("seagull-history-card-editor")) {
  customElements.define("seagull-history-card-editor", SeagullHistoryCardEditor);
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
