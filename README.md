# Climate Sync Card

O carte Lovelace pentru Home Assistant care controlează **mai multe entități `climate` simultan**.

Ideal pentru situația în care ai două (sau mai multe) aparate de aer condiționat **identice** și vrei să le comanzi ca pe unul singur. Cardul:

- **citește automat atributele** din entități (`hvac_modes`, `fan_modes`, `preset_modes`, `swing_modes`, interval de temperatură) — nu trebuie să configurezi manual nicio listă;
- când schimbi **HVAC mode / preset / fan / swing / temperatură**, trimite comanda către **toate** entitățile selectate în același timp;
- afișează un avertisment ⚠️ dacă entitățile nu sunt sincronizate (au valori diferite).

![preview](https://raw.githubusercontent.com/phateks/climate-sync-card/main/preview.png)

---

## Instalare prin HACS

1. HACS → **Frontend** (sau *Custom repositories*).
2. Adaugă acest repo ca **Custom repository**, categorie **Lovelace/Dashboard**.
3. Caută **Climate Sync Card** și instalează.
4. HACS adaugă automat resursa. Dacă nu, adaug-o manual:

   **Settings → Dashboards → ⋮ → Resources → Add resource**
   - URL: `/hacsfiles/climate-sync-card/climate-sync-card.js`
   - Type: `JavaScript Module`

5. Reîncarcă pagina (Ctrl+F5).

### Instalare manuală (fără HACS)

1. Copiază `climate-sync-card.js` în `config/www/`.
2. Adaugă resursa:
   - URL: `/local/climate-sync-card.js`
   - Type: `JavaScript Module`

---

## Utilizare

Poți adăuga cardul din interfața grafică (**Add Card → Climate Sync Card**) și îl configurezi cu editorul vizual — bifezi entitățile pe care le vrei controlate împreună.

Sau în YAML:

```yaml
type: custom:climate-sync-card
name: Aer condiționat
entities:
  - climate.ac_living
  - climate.ac_bedroom
```

### Opțiuni de configurare

| Opțiune            | Tip        | Default            | Descriere |
|--------------------|-----------|--------------------|-----------|
| `entities`         | listă      | **obligatoriu**    | Entitățile `climate` care vor fi controlate simultan. |
| `name`             | string     | numele entității   | Titlul cardului. |
| `primary_entity`   | string     | prima entitate     | Entitatea din care se citesc valorile curente și listele de opțiuni. |
| `show_temperature` | boolean    | `true`             | Afișează controlul de temperatură. |
| `show_hvac_modes`  | boolean    | `true`             | Afișează modurile HVAC. |
| `show_preset`      | boolean    | `true`             | Afișează presetările. |
| `show_fan`         | boolean    | `true`             | Afișează vitezele ventilatorului. |
| `show_swing`       | boolean    | `true`             | Afișează modurile swing. |

### Exemplu complet

```yaml
type: custom:climate-sync-card
name: Aer condiționat casă
entities:
  - climate.ac_living
  - climate.ac_bedroom
primary_entity: climate.ac_living
show_temperature: true
show_hvac_modes: true
show_preset: true
show_fan: true
show_swing: false
```

---

## Cum funcționează

- Listele de opțiuni (moduri, fan, preset, swing) și intervalul de temperatură se iau din `primary_entity`. Pentru că aparatele tale sunt identice, atributele sunt aceleași.
- La orice modificare se apelează serviciul `climate` corespunzător (`set_hvac_mode`, `set_preset_mode`, `set_fan_mode`, `set_swing_mode`, `set_temperature`) cu **toate** entitățile disponibile ca țintă.
- Entitățile `unavailable` sunt ignorate automat la trimiterea comenzilor.

## Licență

MIT
