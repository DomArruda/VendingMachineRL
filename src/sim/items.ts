export type Category =
  | "chips"
  | "candy"
  | "soda"
  | "water"
  | "healthy"
  | "premium";

export interface Item {
  id: string;
  name: string;
  category: Category;
  icon: string;
  baseWholesale: number;
  volatility: number;
  trend: number;
  popularity: number;
  elasticity: number;
  refPrice: number;
}

export const ITEMS: readonly Item[] = [
  // Chips
  { id: "classic-chips", name: "Classic Chips", category: "chips", icon: "🥔", baseWholesale: 0.65, volatility: 0.1, trend: 0, popularity: 5, elasticity: 2.9, refPrice: 1.0 },
  { id: "bbq-chips", name: "BBQ Chips", category: "chips", icon: "🍖", baseWholesale: 0.6, volatility: 0.09, trend: 0, popularity: 4, elasticity: 2.2, refPrice: 1.1 },
  { id: "cheese-puffs", name: "Cheese Puffs", category: "chips", icon: "🧀", baseWholesale: 0.65, volatility: 0.1, trend: 0, popularity: 3, elasticity: 2.1, refPrice: 1.3 },
  { id: "kettle-chips", name: "Kettle Chips", category: "chips", icon: "🥔", baseWholesale: 0.9, volatility: 0.14, trend: 0.001, popularity: 3, elasticity: 2.2, refPrice: 1.75 },
  { id: "jalapeno-chips", name: "Jalapeno Chips", category: "chips", icon: "🌶️", baseWholesale: 0.75, volatility: 0.12, trend: 0, popularity: 2, elasticity: 1.9, refPrice: 1.6 },

  // Candy
  { id: "chocolate-bar", name: "Chocolate Bar", category: "candy", icon: "🍫", baseWholesale: 0.75, volatility: 0.09, trend: 0, popularity: 5, elasticity: 2.4, refPrice: 1.3 },
  { id: "gummy-bears", name: "Gummy Bears", category: "candy", icon: "🐻", baseWholesale: 0.45, volatility: 0.07, trend: 0, popularity: 4, elasticity: 2.0, refPrice: 0.95 },
  { id: "sour-candy", name: "Sour Candy", category: "candy", icon: "🍬", baseWholesale: 0.4, volatility: 0.09, trend: 0, popularity: 3, elasticity: 1.9, refPrice: 0.9 },
  { id: "caramel-chews", name: "Caramel Chews", category: "candy", icon: "🍮", baseWholesale: 0.55, volatility: 0.08, trend: 0, popularity: 2, elasticity: 1.8, refPrice: 1.25 },
  { id: "lollipops", name: "Lollipops", category: "candy", icon: "🍭", baseWholesale: 0.25, volatility: 0.06, trend: 0, popularity: 3, elasticity: 1.8, refPrice: 0.6 },

  // Soda
  { id: "cola", name: "Cola", category: "soda", icon: "🥤", baseWholesale: 0.55, volatility: 0.06, trend: 0.0015, popularity: 5, elasticity: 1.7, refPrice: 1.15 },
  { id: "diet-cola", name: "Diet Cola", category: "soda", icon: "🥤", baseWholesale: 0.55, volatility: 0.06, trend: 0, popularity: 3, elasticity: 1.8, refPrice: 1.15 },
  { id: "lemon-lime", name: "Lemon-Lime Soda", category: "soda", icon: "🍋", baseWholesale: 0.5, volatility: 0.07, trend: 0, popularity: 4, elasticity: 1.9, refPrice: 1.1 },
  { id: "root-beer", name: "Root Beer", category: "soda", icon: "🥤", baseWholesale: 0.55, volatility: 0.07, trend: 0, popularity: 2, elasticity: 1.9, refPrice: 1.2 },
  { id: "energy-drink", name: "Energy Drink", category: "soda", icon: "⚡", baseWholesale: 1.2, volatility: 0.08, trend: 0, popularity: 2, elasticity: 1.3, refPrice: 2.7 },

  // Water / juice
  { id: "bottled-water", name: "Bottled Water", category: "water", icon: "💧", baseWholesale: 0.3, volatility: 0.05, trend: 0, popularity: 5, elasticity: 1.9, refPrice: 0.7 },
  { id: "sparkling-water", name: "Sparkling Water", category: "water", icon: "🫧", baseWholesale: 0.55, volatility: 0.06, trend: 0, popularity: 3, elasticity: 1.9, refPrice: 1.2 },
  { id: "orange-juice", name: "Orange Juice", category: "water", icon: "🍊", baseWholesale: 0.9, volatility: 0.09, trend: 0, popularity: 3, elasticity: 2.0, refPrice: 1.9 },
  { id: "iced-tea", name: "Iced Tea", category: "water", icon: "🍹", baseWholesale: 0.6, volatility: 0.07, trend: 0, popularity: 4, elasticity: 1.9, refPrice: 1.3 },
  { id: "lemonade", name: "Lemonade", category: "water", icon: "🍋", baseWholesale: 0.7, volatility: 0.08, trend: 0, popularity: 2, elasticity: 1.9, refPrice: 1.55 },

  // Healthy
  { id: "granola-bar", name: "Granola Bar", category: "healthy", icon: "🥣", baseWholesale: 0.85, volatility: 0.07, trend: 0, popularity: 3, elasticity: 2.1, refPrice: 1.75 },
  { id: "trail-mix", name: "Trail Mix", category: "healthy", icon: "🥜", baseWholesale: 1.1, volatility: 0.1, trend: 0, popularity: 2, elasticity: 2.0, refPrice: 2.4 },
  { id: "protein-bar", name: "Protein Bar", category: "healthy", icon: "💪", baseWholesale: 1.3, volatility: 0.08, trend: 0, popularity: 3, elasticity: 2.0, refPrice: 2.8 },
  { id: "fruit-cup", name: "Fruit Cup", category: "healthy", icon: "🍎", baseWholesale: 0.95, volatility: 0.12, trend: 0, popularity: 2, elasticity: 2.1, refPrice: 2.0 },
  { id: "yogurt-pretzel", name: "Yogurt Pretzels", category: "healthy", icon: "🥨", baseWholesale: 0.75, volatility: 0.09, trend: 0, popularity: 2, elasticity: 1.9, refPrice: 1.6 },

  // Premium
  { id: "craft-chocolate", name: "Craft Chocolate", category: "premium", icon: "🍫", baseWholesale: 1.8, volatility: 0.1, trend: 0, popularity: 2, elasticity: 2.0, refPrice: 3.8 },
  { id: "fancy-cookies", name: "Fancy Cookies", category: "premium", icon: "🍪", baseWholesale: 1.5, volatility: 0.11, trend: 0, popularity: 2, elasticity: 2.2, refPrice: 3.0 },
  { id: "specialty-coffee", name: "Specialty Coffee", category: "premium", icon: "☕", baseWholesale: 2.2, volatility: 0.13, trend: 0.002, popularity: 2, elasticity: 1.7, refPrice: 4.6 },
  { id: "imported-candy", name: "Imported Candy", category: "premium", icon: "🍬", baseWholesale: 1.6, volatility: 0.12, trend: 0, popularity: 1, elasticity: 2.1, refPrice: 3.3 },
  { id: "premium-nuts", name: "Premium Nuts", category: "premium", icon: "🥜", baseWholesale: 2.5, volatility: 0.12, trend: 0, popularity: 1, elasticity: 2.1, refPrice: 5.0 },
];

export const ITEM_BY_ID: Readonly<Record<string, Item>> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item])
);

export const POPULARITY_TOTAL = ITEMS.reduce((sum, item) => sum + item.popularity, 0);
