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

      - name: "Meal Plan Tomorrow"
        value_template: "{{ value_json.days[1].adult.dinner }}"
        json_attributes_path: "$.days[1]"
        json_attributes:
          - date
          - day
          - baby
          - adult

      - name: "Meal Plan Day After"
        value_template: "{{ value_json.days[2].adult.dinner }}"
        json_attributes_path: "$.days[2]"
        json_attributes:
          - date
          - day
          - baby
          - adult
```

### 2. Add a dashboard card

Add a **Markdown card** to your dashboard:

```yaml
type: markdown
title: Meal Plan
content: >-
  ## {{ state_attr('sensor.meal_plan_today', 'day') }}

  **Adult Dinner:** {{ states('sensor.meal_plan_today') }}
  {% if state_attr('sensor.meal_plan_today', 'adult').note %}
  _{{ state_attr('sensor.meal_plan_today', 'adult').note }}_
  {% endif %}

  **Baby Lunch:** {{ state_attr('sensor.meal_plan_today', 'baby').lunch.cereal }}
  / {{ state_attr('sensor.meal_plan_today', 'baby').lunch.fruit }}
  / {{ state_attr('sensor.meal_plan_today', 'baby').lunch.yogurt }}

  **Baby Dinner:** {{ state_attr('sensor.meal_plan_today', 'baby').dinner.cereal }}
  / {{ state_attr('sensor.meal_plan_today', 'baby').dinner.fruit }}
  / {{ state_attr('sensor.meal_plan_today', 'baby').dinner.vegetable }}

  ---

  ## {{ state_attr('sensor.meal_plan_tomorrow', 'day') }}

  **Adult Dinner:** {{ states('sensor.meal_plan_tomorrow') }}
  {% if state_attr('sensor.meal_plan_tomorrow', 'adult').note %}
  _{{ state_attr('sensor.meal_plan_tomorrow', 'adult').note }}_
  {% endif %}

  **Baby Lunch:** {{ state_attr('sensor.meal_plan_tomorrow', 'baby').lunch.cereal }}
  / {{ state_attr('sensor.meal_plan_tomorrow', 'baby').lunch.fruit }}
  / {{ state_attr('sensor.meal_plan_tomorrow', 'baby').lunch.yogurt }}

  **Baby Dinner:** {{ state_attr('sensor.meal_plan_tomorrow', 'baby').dinner.cereal }}
  / {{ state_attr('sensor.meal_plan_tomorrow', 'baby').dinner.fruit }}
  / {{ state_attr('sensor.meal_plan_tomorrow', 'baby').dinner.vegetable }}

  ---

  ## {{ state_attr('sensor.meal_plan_day_after', 'day') }}

  **Adult Dinner:** {{ states('sensor.meal_plan_day_after') }}
  {% if state_attr('sensor.meal_plan_day_after', 'adult').note %}
  _{{ state_attr('sensor.meal_plan_day_after', 'adult').note }}_
  {% endif %}
```

### 3. Restart Home Assistant

After adding the configuration, restart Home Assistant or reload the REST integration. The sensors poll every 5 minutes (`scan_interval: 300`).

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/schedule/upcoming` | Today + next 2 days |
| `GET /api/schedule/current` | Full current week (Mon–Sun) |
| `GET /api/schedule/:weekOf` | Specific week by Monday date (e.g. `2026-01-26`) |
