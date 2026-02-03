import * as db from '../src/db.js';

const weekOf = db.getCurrentMonday();
console.log(`Seeding week of ${weekOf}...`);

db.getOrCreateWeek(weekOf);

interface MealData {
  day: number;
  baby_breakfast_cereal: string;
  baby_breakfast_fruit: string;
  baby_breakfast_yogurt: string;
  baby_lunch_meat: string;
  baby_lunch_vegetable: string;
  baby_lunch_fruit: string;
  baby_dinner_meat: string;
  baby_dinner_vegetable: string;
  baby_dinner_fruit: string;
  adult_dinner: string;
  note: string;
}

const meals: MealData[] = [
  { // Monday
    day: 0,
    baby_breakfast_cereal: 'Oat',
    baby_breakfast_fruit: 'Banana',
    baby_breakfast_yogurt: 'Yogurt',
    baby_lunch_meat: 'Chicken',
    baby_lunch_vegetable: 'Carrots',
    baby_lunch_fruit: 'Peach',
    baby_dinner_meat: 'Turkey',
    baby_dinner_vegetable: 'Green Beans',
    baby_dinner_fruit: 'Apple',
    adult_dinner: 'Steak, Mashed Potatoes, Green beans',
    note: '',
  },
  { // Tuesday
    day: 1,
    baby_breakfast_cereal: 'Oat',
    baby_breakfast_fruit: 'Banana',
    baby_breakfast_yogurt: 'Yogurt',
    baby_lunch_meat: 'Beef',
    baby_lunch_vegetable: 'Peas',
    baby_lunch_fruit: 'Peach',
    baby_dinner_meat: 'Chicken',
    baby_dinner_vegetable: 'Green Beans',
    baby_dinner_fruit: 'Apple',
    adult_dinner: 'Ribs, Cauliflower, Corn',
    note: 'Abuelos',
  },
  { // Wednesday
    day: 2,
    baby_breakfast_cereal: 'Oat',
    baby_breakfast_fruit: 'Banana',
    baby_breakfast_yogurt: 'Yogurt',
    baby_lunch_meat: 'Turkey',
    baby_lunch_vegetable: 'Squash',
    baby_lunch_fruit: 'Peach',
    baby_dinner_meat: 'Beef',
    baby_dinner_vegetable: 'Green Beans',
    baby_dinner_fruit: 'Apple',
    adult_dinner: 'Salmon',
    note: '',
  },
  { // Thursday
    day: 3,
    baby_breakfast_cereal: 'Oat',
    baby_breakfast_fruit: 'Banana',
    baby_breakfast_yogurt: 'Yogurt',
    baby_lunch_meat: 'Chicken',
    baby_lunch_vegetable: 'Sweet Potato',
    baby_lunch_fruit: 'Peach',
    baby_dinner_meat: 'Turkey',
    baby_dinner_vegetable: 'Peas',
    baby_dinner_fruit: 'Apple',
    adult_dinner: 'Costco chicken?',
    note: '',
  },
];

for (const meal of meals) {
  const { day, ...fields } = meal;
  db.updateDay(weekOf, day, fields);
}

console.log('Seed complete.');
