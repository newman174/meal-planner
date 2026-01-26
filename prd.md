# Meal Planner Spec

Create a simple web-based meal planner for tracking weekly baby and adult meals with the following requirements:

## Baby Meals (fixed structure)

Lunch: Cereal, Fruit, Yogurt (all three each day)
Dinner: Cereal, Fruit, Vegetable (all three each day)
Each field is a simple text input

## Adult Meals

Dinner only, simple text field
Optional note field (for things like "Abuelos" or "Costco chicken?")

## Weekly View

Display Monday through Sunday
Show baby lunch, baby dinner, and adult dinner for each day
Easy to edit inline

## History

Save completed weeks
Ability to browse past weeks
Copy a previous week as a starting template for a new week

## Multi-user / Mobile Access

Should work well on phone browsers
Simple backend so multiple people can access the same data

## API

REST API endpoint to read the current week's schedule (for potential Home Assistant integration)
GET /api/schedule/current returns JSON of this week's meals
GET /api/schedule/:weekOf returns JSON for a specific week (by start date)

## Tech Preferences

Keep it simple and self-hostable
SQLite or JSON file for storage is fine
No auth required for now (local network use)