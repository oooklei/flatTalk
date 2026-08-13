import { createRegistry } from './registry.js';
import { detectMealPlan } from './meal_plan.js';
import { detectNearby } from './nearby_resource.js';
import { detectTravelRoute } from './travel_route.js';

export function registerDefaultDetectors(reg) {
  reg.register('meal_plan', detectMealPlan);
  reg.register('nearby_resource', detectNearby);
  reg.register('travel_route', detectTravelRoute);
}

let _default;
export function getDefaultRegistry() {
  if (!_default) {
    _default = createRegistry();
    registerDefaultDetectors(_default);
  }
  return _default;
}
