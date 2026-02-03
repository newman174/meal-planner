# Home Assistant Integration

## Setup

Replace `MEAL_PLANNER_IP` below with the IP/hostname of the machine running the meal planner (e.g. `192.168.1.50`).

### 1. Add REST sensors to `configuration.yaml`

```yaml
rest:
  - resource: http://MEAL_PLANNER_IP:3000/api/schedule/upcoming
    scan_interval: 300
    sensor:
      - name: "Meal Plan Today"
        value_template: "{{ value_json.days[0].adult.dinner }}"
        json_attributes_path: "$.days[0]"
        json_attributes:
          - date
          - day
          - baby
          - adult
          - note

      - name: "Meal Plan Tomorrow"
        value_template: "{{ value_json.days[1].adult.dinner }}"
        json_attributes_path: "$.days[1]"
        json_attributes:
          - date
          - day
          - baby
          - adult
          - note

      - name: "Meal Plan Day After"
        value_template: "{{ value_json.days[2].adult.dinner }}"
        json_attributes_path: "$.days[2]"
        json_attributes:
          - date
          - day
          - baby
          - adult
          - note
```

### 2. Add a dashboard card

Add a **Markdown card** to your dashboard:

```yaml
type: markdown
title: Meal Plan
content: >-
  {% set baby_today = state_attr('sensor.meal_plan_today', 'baby') or {} %}
  {% set baby_tomorrow = state_attr('sensor.meal_plan_tomorrow', 'baby') or {} %}
  {% set baby_after = state_attr('sensor.meal_plan_day_after', 'baby') or {} %}

  ### {{ state_attr('sensor.meal_plan_today', 'day') }}

  {% if state_attr('sensor.meal_plan_today', 'note') %}_{{ state_attr('sensor.meal_plan_today', 'note') }}_{% endif %}

  Dinner: {{ states('sensor.meal_plan_today') }}

  {% if baby_today.get('breakfast') %}Baby Breakfast: {{ baby_today.get('breakfast', {}).get('cereal', '') }}
  / {{ baby_today.get('breakfast', {}).get('yogurt', '') }}
  / {{ baby_today.get('breakfast', {}).get('fruit', '') }}{% endif %}

  {% if baby_today.get('lunch') %}Baby Lunch: {{ baby_today.get('lunch', {}).get('meat', '') }}
  / {{ baby_today.get('lunch', {}).get('vegetable', '') }}
  / {{ baby_today.get('lunch', {}).get('fruit', '') }}{% endif %}

  {% if baby_today.get('dinner') %}Baby Dinner: {{ baby_today.get('dinner', {}).get('meat', '') }}
  / {{ baby_today.get('dinner', {}).get('vegetable', '') }}
  / {{ baby_today.get('dinner', {}).get('fruit', '') }}{% endif %}

  ### {{ state_attr('sensor.meal_plan_tomorrow', 'day') }}

  {% if state_attr('sensor.meal_plan_tomorrow', 'note') %}_{{ state_attr('sensor.meal_plan_tomorrow', 'note') }}_{% endif %}

  Dinner: {{ states('sensor.meal_plan_tomorrow') }}

  {% if baby_tomorrow.get('breakfast') %}Baby Breakfast: {{ baby_tomorrow.get('breakfast', {}).get('cereal', '') }}
  / {{ baby_tomorrow.get('breakfast', {}).get('yogurt', '') }}
  / {{ baby_tomorrow.get('breakfast', {}).get('fruit', '') }}{% endif %}

  {% if baby_tomorrow.get('lunch') %}Baby Lunch: {{ baby_tomorrow.get('lunch', {}).get('meat', '') }}
  / {{ baby_tomorrow.get('lunch', {}).get('vegetable', '') }}
  / {{ baby_tomorrow.get('lunch', {}).get('fruit', '') }}{% endif %}

  {% if baby_tomorrow.get('dinner') %}Baby Dinner: {{ baby_tomorrow.get('dinner', {}).get('meat', '') }}
  / {{ baby_tomorrow.get('dinner', {}).get('vegetable', '') }}
  / {{ baby_tomorrow.get('dinner', {}).get('fruit', '') }}{% endif %}

  ### {{ state_attr('sensor.meal_plan_day_after', 'day') }}

  {% if state_attr('sensor.meal_plan_day_after', 'note') %}_{{ state_attr('sensor.meal_plan_day_after', 'note') }}_{% endif %}

  Dinner: {{ states('sensor.meal_plan_day_after') }}

  {% if baby_after.get('breakfast') %}Baby Breakfast: {{ baby_after.get('breakfast', {}).get('cereal', '') }}
  / {{ baby_after.get('breakfast', {}).get('yogurt', '') }}
  / {{ baby_after.get('breakfast', {}).get('fruit', '') }}{% endif %}

  {% if baby_after.get('lunch') %}Baby Lunch: {{ baby_after.get('lunch', {}).get('meat', '') }}
  / {{ baby_after.get('lunch', {}).get('vegetable', '') }}
  / {{ baby_after.get('lunch', {}).get('fruit', '') }}{% endif %}

  {% if baby_after.get('dinner') %}Baby Dinner: {{ baby_after.get('dinner', {}).get('meat', '') }}
  / {{ baby_after.get('dinner', {}).get('vegetable', '') }}
  / {{ baby_after.get('dinner', {}).get('fruit', '') }}{% endif %}
```

### 3. Restart Home Assistant

After adding the configuration, restart Home Assistant or reload the REST integration. The sensors poll every 5 minutes (`scan_interval: 300`).

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/schedule/upcoming` | Today + next 2 days |
| `GET /api/schedule/current` | Full current week (Mon–Sun) |
| `GET /api/schedule/:weekOf` | Specific week by Monday date (e.g. `2026-01-26`) |
