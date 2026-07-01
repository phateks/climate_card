/*
 * Climate Sync Card
 * A Lovelace card that controls multiple climate entities simultaneously.
 * It reads the available options (hvac_modes, fan_modes, preset_modes,
 * swing_modes, temperature range) automatically from the selected entities
 * and, whenever you change hvac mode / preset / swing / fan / temperature,
 * it applies the change to ALL selected climate entities at once.
 *
 * Author: (generated for Home Assistant)
 * License: MIT
 */

const CARD_VERSION = "1.2.0";

console.info(
  `%c CLIMATE-SYNC-CARD %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */

const HVAC_MODE_ICONS = {
  auto: "mdi:calendar-sync",
  heat_cool: "mdi:sun-snowflake-variant",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
  off: "mdi:power",
};

// Accent color per hvac mode, so the Mode chip icon is colour-coded.
const HVAC_MODE_COLORS = {
  auto: "#2e9e5b",
  heat_cool: "#8bc34a",
  heat: "#ff8100",
  cool: "#2b9af9",
  dry: "#f5c443",
  fan_only: "#00bcd4",
  off: "var(--secondary-text-color)",
};

// The friendly labels HA uses for hvac modes are localized; we do a light
// title-case fallback so it looks nice without translations.
function prettify(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================== *
 *  MAIN CARD
 * ================================================================== */

class ClimateSyncCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._rendered = false;
    // Local optimistic temperature so the +/- buttons feel snappy.
    this._pendingTemp = null;
    this._pendingTempTimer = null;
    // Re-render guards: don't tear down the DOM while a dropdown is open, and
    // skip renders when nothing we display has changed.
    this._selectOpen = false;
    this._dirty = false;
    this._lastSig = null;
  }

  /* ---- Lovelace plumbing ---- */

  static getConfigElement() {
    return document.createElement("climate-sync-card-editor");
  }

  static getStubConfig(hass) {
    const climates = hass
      ? Object.keys(hass.states).filter((e) => e.startsWith("climate."))
      : [];
    return {
      type: "custom:climate-sync-card",
      name: "Climate Sync",
      entities: climates.slice(0, 2),
    };
  }

  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("You need to define at least one climate entity in 'entities'.");
    }
    // Normalize entities to plain id strings.
    const entities = config.entities.map((e) =>
      typeof e === "string" ? e : e.entity
    );
    entities.forEach((e) => {
      if (!e || !e.startsWith("climate.")) {
        throw new Error(`'${e}' is not a climate entity.`);
      }
    });

    this._config = {
      name: config.name,
      entities,
      primary_entity: config.primary_entity || entities[0],
      show_temperature: config.show_temperature !== false,
      show_hvac_modes: config.show_hvac_modes !== false,
      show_preset: config.show_preset !== false,
      show_fan: config.show_fan !== false,
      show_swing: config.show_swing !== false,
    };
    this._rendered = false;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  /* ---- Data helpers ---- */

  get _entityIds() {
    return this._config.entities || [];
  }

  // The entity used to read the *current* selected values & option lists.
  _primaryState() {
    const id = this._config.primary_entity;
    if (id && this._hass.states[id] && this._hass.states[id].state !== "unavailable") {
      return this._hass.states[id];
    }
    // Fall back to the first available entity.
    for (const e of this._entityIds) {
      const st = this._hass.states[e];
      if (st && st.state !== "unavailable") return st;
    }
    // Nothing available – return whatever the first entity is (may be undefined).
    return this._hass.states[this._entityIds[0]];
  }

  // Are all entities in sync for a given hvac state / attribute?
  _isInSync(attr, isState = false) {
    let ref;
    let first = true;
    for (const e of this._entityIds) {
      const st = this._hass.states[e];
      if (!st || st.state === "unavailable") continue;
      const val = isState ? st.state : st.attributes[attr];
      if (first) {
        ref = val;
        first = false;
      } else if (val !== ref) {
        return false;
      }
    }
    return true;
  }

  /* ---- Service calls (apply to ALL entities) ---- */

  _callAll(service, data) {
    const ids = this._entityIds.filter((e) => {
      const st = this._hass.states[e];
      return st && st.state !== "unavailable";
    });
    if (ids.length === 0) return;
    this._hass.callService("climate", service, {
      entity_id: ids,
      ...data,
    });
  }

  _setHvacMode(mode) {
    this._callAll("set_hvac_mode", { hvac_mode: mode });
  }
  _setPreset(mode) {
    this._callAll("set_preset_mode", { preset_mode: mode });
  }
  _setFan(mode) {
    this._callAll("set_fan_mode", { fan_mode: mode });
  }
  _setSwing(mode) {
    this._callAll("set_swing_mode", { swing_mode: mode });
  }

  _setTemperature(temp) {
    // Optimistic UI: show the value immediately, debounce the service call.
    this._pendingTemp = temp;
    this._render();
    clearTimeout(this._pendingTempTimer);
    this._pendingTempTimer = setTimeout(() => {
      this._callAll("set_temperature", { temperature: temp });
      // Let HA report back before we drop the optimistic value.
      setTimeout(() => {
        this._pendingTemp = null;
      }, 1500);
    }, 400);
  }

  _stepTemp(dir) {
    const st = this._primaryState();
    if (!st) return;
    const step = st.attributes.target_temp_step || 0.5;
    const min = st.attributes.min_temp ?? 7;
    const max = st.attributes.max_temp ?? 35;
    const current =
      this._pendingTemp !== null
        ? this._pendingTemp
        : st.attributes.temperature ?? min;
    let next = Math.round((current + dir * step) * 10) / 10;
    next = Math.min(max, Math.max(min, next));
    this._setTemperature(next);
  }

  /* ---- Rendering ---- */

  _render() {
    if (!this._hass || !this._config.entities) return;

    if (!this._rendered) {
      this._buildSkeleton();
      this._rendered = true;
    }

    // Don't tear down the DOM while the user has a dropdown open, otherwise the
    // native <select> gets removed and the popup closes instantly.
    if (this._selectOpen) {
      this._dirty = true;
      return;
    }

    // hass updates fire on *every* state change in HA, not just ours. Only
    // rebuild when something we actually display has changed.
    const sig = this._signature();
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    this._update();
  }

  // A cheap fingerprint of everything the card renders. If it hasn't changed,
  // we can skip the re-render entirely (and avoid flicker / closing dropdowns).
  _signature() {
    const parts = [this._config.name || "", String(this._pendingTemp)];
    for (const e of this._entityIds) {
      const st = this._hass.states[e];
      if (!st) {
        parts.push(e + ":none");
        continue;
      }
      const a = st.attributes;
      parts.push(
        [
          e,
          st.state,
          a.temperature,
          a.current_temperature,
          a.preset_mode,
          a.fan_mode,
          a.swing_mode,
          a.min_temp,
          a.max_temp,
          a.target_temp_step,
          a.friendly_name,
          (a.hvac_modes || []).join(","),
          (a.preset_modes || []).join(","),
          (a.fan_modes || []).join(","),
          (a.swing_modes || []).join(","),
        ].join("|")
      );
    }
    parts.push(this._hass.config?.unit_system?.temperature || "");
    return parts.join("§");
  }

  _buildSkeleton() {
    this.shadowRoot.innerHTML = `
      <style>${ClimateSyncCard.styles}</style>
      <ha-card>
        <div class="header">
          <div class="title"></div>
          <div class="sub"></div>
        </div>
        <div class="content"></div>
      </ha-card>
    `;
    this._lastSig = null;
  }

  _update() {
    const root = this.shadowRoot;
    const st = this._primaryState();
    const card = root.querySelector("ha-card");

    // Header
    const titleEl = root.querySelector(".title");
    const subEl = root.querySelector(".sub");
    titleEl.textContent =
      this._config.name ||
      (st ? st.attributes.friendly_name : "Climate Sync");

    const total = this._entityIds.length;
    const available = this._entityIds.filter((e) => {
      const s = this._hass.states[e];
      return s && s.state !== "unavailable";
    }).length;
    subEl.textContent = `${available}/${total} available`;

    const content = root.querySelector(".content");

    if (!st) {
      content.innerHTML = `<div class="unavailable">All climate entities are unavailable.</div>`;
      return;
    }

    const a = st.attributes;
    content.innerHTML = "";

    /* --- Temperature --- */
    if (this._config.show_temperature && a.temperature !== undefined) {
      const displayTemp =
        this._pendingTemp !== null ? this._pendingTemp : a.temperature;
      const unit = this._hass.config.unit_system.temperature;
      const inSync = this._isInSync("temperature");
      const currentTemp =
        a.current_temperature !== undefined
          ? `${a.current_temperature}${unit}`
          : "";

      const tempEl = document.createElement("div");
      tempEl.className = "temp-block";
      tempEl.innerHTML = `
        <button class="temp-btn" data-dir="down" title="Lower">
          <ha-icon icon="mdi:minus"></ha-icon>
        </button>
        <div class="temp-mid">
          <div class="temp-value">
            ${displayTemp}<span class="temp-unit">${unit}</span>
            ${inSync ? "" : '<ha-icon class="warn" icon="mdi:alert-circle" title="Entities out of sync"></ha-icon>'}
          </div>
          ${currentTemp ? `<div class="temp-current">Current: ${currentTemp}</div>` : ""}
        </div>
        <button class="temp-btn" data-dir="up" title="Raise">
          <ha-icon icon="mdi:plus"></ha-icon>
        </button>
      `;
      tempEl.querySelectorAll(".temp-btn").forEach((btn) => {
        btn.addEventListener("click", () =>
          this._stepTemp(btn.dataset.dir === "up" ? 1 : -1)
        );
      });
      content.appendChild(tempEl);
    }

    /* --- Compact chip selectors: Mode / Preset / Fan / Swing --- */
    const chips = document.createElement("div");
    chips.className = "chips-row";

    if (this._config.show_hvac_modes && Array.isArray(a.hvac_modes)) {
      chips.appendChild(
        this._buildChip({
          label: "Mode",
          options: a.hvac_modes,
          current: st.state,
          inSync: this._isInSync(null, true),
          iconFor: (m) => HVAC_MODE_ICONS[m] || "mdi:thermostat",
          accentFor: (m) => HVAC_MODE_COLORS[m] || "var(--primary-color)",
          onSelect: (m) => this._setHvacMode(m),
        })
      );
    }

    if (
      this._config.show_preset &&
      Array.isArray(a.preset_modes) &&
      a.preset_modes.length
    ) {
      chips.appendChild(
        this._buildChip({
          label: "Preset",
          options: a.preset_modes,
          current: a.preset_mode,
          inSync: this._isInSync("preset_mode"),
          iconFor: () => "mdi:tune-vertical",
          onSelect: (m) => this._setPreset(m),
        })
      );
    }

    if (
      this._config.show_fan &&
      Array.isArray(a.fan_modes) &&
      a.fan_modes.length
    ) {
      chips.appendChild(
        this._buildChip({
          label: "Fan",
          options: a.fan_modes,
          current: a.fan_mode,
          inSync: this._isInSync("fan_mode"),
          iconFor: () => "mdi:fan",
          onSelect: (m) => this._setFan(m),
        })
      );
    }

    if (
      this._config.show_swing &&
      Array.isArray(a.swing_modes) &&
      a.swing_modes.length
    ) {
      chips.appendChild(
        this._buildChip({
          label: "Swing",
          options: a.swing_modes,
          current: a.swing_mode,
          inSync: this._isInSync("swing_mode"),
          iconFor: () => "mdi:arrow-oscillating",
          onSelect: (m) => this._setSwing(m),
        })
      );
    }

    if (chips.children.length) content.appendChild(chips);
  }

  // Builds a compact chip that shows an icon + current value and opens a
  // native dropdown (an invisible <select> overlaid on top) when tapped.
  _buildChip({ label, options, current, inSync, iconFor, accentFor, onSelect }) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.title = label;

    const known = options.includes(current);
    const valueText = !inSync ? "Mixed" : known ? prettify(current) : "—";
    const icon = iconFor && current ? iconFor(current) : null;
    const accent =
      inSync && known && accentFor ? accentFor(current) : "var(--primary-color)";
    chip.style.setProperty("--chip-accent", accent);

    chip.innerHTML = `
      ${icon ? `<ha-icon class="chip-icon" icon="${icon}"></ha-icon>` : ""}
      <span class="chip-val">${valueText}</span>
      ${inSync ? "" : '<ha-icon class="warn" icon="mdi:alert-circle" title="Entities out of sync"></ha-icon>'}
      <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
    `;

    const select = document.createElement("select");
    select.className = "chip-select";
    // If the current value isn't part of the option list (or entities are out
    // of sync), add a neutral placeholder so nothing looks force-selected.
    if (!known || !inSync) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = inSync ? "—" : "Mixed";
      ph.disabled = true;
      ph.selected = true;
      select.appendChild(ph);
    }
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = prettify(opt);
      if (known && inSync && opt === current) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      if (select.value) onSelect(select.value);
    });
    // While the dropdown is open the select holds focus; block re-renders so
    // the popup doesn't get destroyed under the user's cursor.
    select.addEventListener("focus", () => {
      this._selectOpen = true;
    });
    select.addEventListener("blur", () => {
      this._selectOpen = false;
      if (this._dirty) {
        this._dirty = false;
        this._render();
      }
    });

    chip.appendChild(select);
    return chip;
  }
}

ClimateSyncCard.styles = `
  ha-card {
    padding: 16px;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .title {
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--primary-text-color);
  }
  .sub {
    font-size: 0.8rem;
    color: var(--secondary-text-color);
  }
  .unavailable {
    color: var(--secondary-text-color);
    text-align: center;
    padding: 24px 0;
  }
  /* temperature */
  .temp-block {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    margin-bottom: 18px;
  }
  .temp-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: var(--secondary-background-color, #e0e0e0);
    color: var(--primary-text-color);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .temp-btn:hover { background: var(--divider-color, #ccc); }
  .temp-btn:active { transform: scale(0.92); }
  .temp-mid { text-align: center; min-width: 110px; }
  .temp-value {
    font-size: 2.2rem;
    font-weight: 600;
    line-height: 1;
    color: var(--primary-text-color);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
  }
  .temp-unit { font-size: 1rem; margin-top: 4px; }
  .temp-current {
    font-size: 0.8rem;
    color: var(--secondary-text-color);
    margin-top: 4px;
  }
  /* chips */
  .chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    --chip-accent: var(--primary-color);
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 10px 9px 13px;
    border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
    border-radius: 22px;
    background: var(--secondary-background-color, rgba(255, 255, 255, 0.04));
    color: var(--primary-text-color);
    font-size: 0.95rem;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease,
      box-shadow 0.15s ease, transform 0.08s ease;
  }
  .chip:hover {
    border-color: var(--chip-accent);
    box-shadow: 0 0 0 1px var(--chip-accent) inset;
  }
  .chip:active { transform: scale(0.97); }
  .chip:focus-within {
    border-color: var(--chip-accent);
    box-shadow: 0 0 0 1px var(--chip-accent) inset;
  }
  .chip-icon {
    color: var(--chip-accent);
    --mdc-icon-size: 20px;
    pointer-events: none;
    flex: 0 0 auto;
  }
  .chip-val { white-space: nowrap; pointer-events: none; }
  .chip .chevron {
    color: var(--secondary-text-color);
    --mdc-icon-size: 18px;
    pointer-events: none;
    flex: 0 0 auto;
  }
  /* The real <select> sits invisibly on top of the chip and handles taps. */
  .chip-select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    opacity: 0;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .warn { color: var(--warning-color, #ff9800); --mdc-icon-size: 18px; pointer-events: none; }
`;

customElements.define("climate-sync-card", ClimateSyncCard);

/* ================================================================== *
 *  GUI EDITOR
 * ================================================================== */

class ClimateSyncCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._rendered = false;
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _climateEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((e) => e.startsWith("climate."))
      .sort();
  }

  _render() {
    if (!this._hass) return;

    if (!this._rendered) {
      this.innerHTML = `
        <style>
          .cs-editor { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }
          .cs-field label { display:block; font-size:0.85rem; color: var(--secondary-text-color); margin-bottom:4px; }
          .cs-editor input[type="text"] {
            width: 100%; box-sizing: border-box; padding: 8px;
            border: 1px solid var(--divider-color,#ccc); border-radius: 6px;
            background: var(--card-background-color,#fff); color: var(--primary-text-color);
          }
          .cs-entities { display:flex; flex-direction:column; gap:6px; }
          .cs-check { display:flex; align-items:center; gap:8px; font-size:0.95rem; color: var(--primary-text-color); }
          .cs-toggles { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
          .cs-section { font-weight:600; color: var(--primary-text-color); border-bottom:1px solid var(--divider-color,#eee); padding-bottom:4px; }
          .cs-hint { font-size:0.75rem; color: var(--secondary-text-color); }
          select { width:100%; padding:8px; border:1px solid var(--divider-color,#ccc); border-radius:6px;
            background: var(--card-background-color,#fff); color: var(--primary-text-color); }
        </style>
        <div class="cs-editor"></div>
      `;
      this._rendered = true;
    }

    const cfg = this._config;
    const container = this.querySelector(".cs-editor");
    const selected = (cfg.entities || []).map((e) =>
      typeof e === "string" ? e : e.entity
    );

    const entityChecks = this._climateEntities()
      .map((e) => {
        const name = this._hass.states[e].attributes.friendly_name || e;
        const checked = selected.includes(e) ? "checked" : "";
        return `<label class="cs-check">
            <input type="checkbox" data-entity="${e}" ${checked}/>
            <span>${name} <span class="cs-hint">(${e})</span></span>
          </label>`;
      })
      .join("");

    const primaryOptions = selected
      .map(
        (e) =>
          `<option value="${e}" ${
            cfg.primary_entity === e ? "selected" : ""
          }>${this._hass.states[e]?.attributes.friendly_name || e}</option>`
      )
      .join("");

    const toggle = (key, label, def = true) => {
      const val = cfg[key] !== false && (cfg[key] === undefined ? def : cfg[key]);
      return `<label class="cs-check">
          <input type="checkbox" data-toggle="${key}" ${val ? "checked" : ""}/>
          <span>${label}</span>
        </label>`;
    };

    container.innerHTML = `
      <div class="cs-field">
        <label>Card name (optional)</label>
        <input type="text" data-field="name" value="${cfg.name || ""}" placeholder="Climate Sync"/>
      </div>

      <div>
        <div class="cs-section">Climate entities to sync</div>
        <div class="cs-hint">Pick the climate entities that should be controlled together.</div>
        <div class="cs-entities">${entityChecks || '<span class="cs-hint">No climate entities found.</span>'}</div>
      </div>

      <div class="cs-field">
        <label>Primary entity (values are read from this one)</label>
        <select data-field="primary_entity">
          <option value="">Auto (first available)</option>
          ${primaryOptions}
        </select>
      </div>

      <div>
        <div class="cs-section">Controls to show</div>
        <div class="cs-toggles">
          ${toggle("show_temperature", "Temperature")}
          ${toggle("show_hvac_modes", "HVAC mode")}
          ${toggle("show_preset", "Preset")}
          ${toggle("show_fan", "Fan")}
          ${toggle("show_swing", "Swing")}
        </div>
      </div>
    `;

    // Wire up events.
    container.querySelectorAll('input[type="checkbox"][data-entity]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const cur = (this._config.entities || []).map((e) =>
          typeof e === "string" ? e : e.entity
        );
        const id = cb.dataset.entity;
        let next;
        if (cb.checked) {
          next = cur.includes(id) ? cur : [...cur, id];
        } else {
          next = cur.filter((x) => x !== id);
        }
        this._config = { ...this._config, entities: next };
        this._emit();
        this._render();
      });
    });

    container.querySelectorAll("input[data-toggle]").forEach((cb) => {
      cb.addEventListener("change", () => {
        this._config = { ...this._config, [cb.dataset.toggle]: cb.checked };
        this._emit();
      });
    });

    container.querySelectorAll("[data-field]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.field;
        const val = el.value;
        this._config = { ...this._config };
        if (val === "") delete this._config[key];
        else this._config[key] = val;
        this._emit();
      });
    });
  }
}

customElements.define("climate-sync-card-editor", ClimateSyncCardEditor);

/* ------------------------------------------------------------------ *
 *  Register with the card picker
 * ------------------------------------------------------------------ */
window.customCards = window.customCards || [];
window.customCards.push({
  type: "climate-sync-card",
  name: "Climate Sync Card",
  description:
    "Control multiple identical climate entities at once. Auto-reads modes/fan/preset/swing from the entities.",
  preview: true,
  documentationURL: "https://github.com/phateks/climate-sync-card",
});
