const db = require('./db');

const weekOf = db.getCurrentMonday();
console.log(`Seeding week of ${weekOf}...`);

db.getOrCreateWeek(weekOf);

const meals = [
  { // Monday
    day: 0,
    baby_lunch_cereal: 'Oat',
    baby_lunch_yogurt: 'Yogurt',
    baby_lunch_fruit: 'Peach',
    baby_dinner_cereal: 'Oat',
    baby_dinner_fruit: 'Apple',
    baby_dinner_vegetable: 'Green Beans',
    adult_dinner: 'Steak, Mashed Potatoes, Green beans',
    adult_dinner_note: '',
  },
  { // Tuesday
    day: 1,
    baby_lunch_cereal: 'Oat',
    baby_lunch_yogurt: 'Yogurt',
    baby_lunch_fruit: 'Peach',
    baby_dinner_cereal: 'Oat',
    baby_dinner_fruit: 'Apple',
    baby_dinner_vegetable: 'Green Beans',
    adult_dinner: 'Ribs, Cauliflower, Corn',
    adult_dinner_note: 'Abuelos',
  },
  { // Wednesday
    day: 2,
    baby_lunch_cereal: 'Oat',
    baby_lunch_yogurt: 'Yogurt',
    baby_lunch_fruit: 'Peach',
    baby_dinner_cereal: 'Oat',
    baby_dinner_fruit: 'Apple',
    baby_dinner_vegetable: 'Green Beans',
    adult_dinner: 'Salmon',
    adult_dinner_note: '',
  },
  { // Thursday
    day: 3,
    baby_lunch_cereal: 'Oat',
    baby_lunch_yogurt: 'Yogurt',
    baby_lunch_fruit: 'Peach',
    baby_dinner_cereal: 'Oat',
    baby_dinner_fruit: 'Apple',
    baby_dinner_vegetable: 'Peas or Sweet Potato',
    adult_dinner: 'Costco chicken?',
    adult_dinner_note: '',
  },
];

for (const meal of meals) {
  const { day, ...fields } = meal;
  db.updateDay(weekOf, day, fields);
}

console.log('Seed complete.');
