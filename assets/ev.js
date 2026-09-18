'use strict';

const KM_PER_MILE = 1.609344;

// Consumption describes battery energy; charging efficiency converts it to purchased energy.
function calculateEVTrip({ price, consumption, consumptionMode, distance, distanceUnit, journeys, efficiency }) {
  if (![price, consumption, distance, journeys, efficiency].every(Number.isFinite) ||
      price < 0 || consumption <= 0 || distance < 0 || efficiency < 1 || efficiency > 100 ||
      ![1, 2].includes(journeys) || !['km', 'miles'].includes(distanceUnit) ||
      !['kwh100', 'milesKwh', 'kmKwh'].includes(consumptionMode)) return null;
  const km = distance * (distanceUnit === 'miles' ? KM_PER_MILE : 1) * journeys;
  const kwhPerKm = consumptionMode === 'kwh100' ? consumption / 100 :
    1 / (consumption * (consumptionMode === 'milesKwh' ? KM_PER_MILE : 1));
  const energy = km * kwhPerKm;
  const purchased = energy / (efficiency / 100);
  const cost = purchased * price;
  const perUnit = kwhPerKm / (efficiency / 100) * price * (distanceUnit === 'miles' ? KM_PER_MILE : 1);
  const totalDistance = distance * journeys;
  if (![energy, purchased, cost, perUnit, totalDistance].every(Number.isFinite)) return null;
  return { energy, purchased, cost, perUnit, totalDistance };
}

const evFields = Object.fromEntries(['electricityPrice', 'currency', 'consumptionMode', 'consumptionValue',
  'distance', 'distanceUnit', 'journeyType', 'chargingEfficiency'].map(id => [id, document.getElementById(id)]));
const evOutputs = Object.fromEntries(['tripCost', 'costPerUnit', 'energyUsed', 'energyPurchased',
  'routeDistance', 'validationMessage', 'costPerUnitLabel', 'consumptionHint'].map(id => [id, document.getElementById(id)]));
const evNumber = field => field.value.trim() === '' ? NaN : Number(field.value);

function updateEVEstimate() {
  const price = evNumber(evFields.electricityPrice);
  const consumption = evNumber(evFields.consumptionValue);
  const distance = evNumber(evFields.distance);
  const efficiency = evNumber(evFields.chargingEfficiency);
  const rules = [
    ['electricityPrice', Number.isFinite(price) && price >= 0, 'Enter an electricity price of zero or more.'],
    ['consumptionValue', Number.isFinite(consumption) && consumption > 0, 'Enter vehicle consumption greater than zero.'],
    ['distance', Number.isFinite(distance) && distance >= 0, 'Enter a distance of zero or more.'],
    ['chargingEfficiency', Number.isFinite(efficiency) && efficiency >= 1 && efficiency <= 100, 'Enter charging efficiency between 1% and 100%.']
  ];
  rules.forEach(([id, valid]) => evFields[id].setAttribute('aria-invalid', String(!valid)));
  const result = calculateEVTrip({ price, consumption, distance, efficiency,
    consumptionMode: evFields.consumptionMode.value, distanceUnit: evFields.distanceUnit.value,
    journeys: Number(evFields.journeyType.value) });
  const unit = evFields.distanceUnit.value === 'miles' ? 'mile' : 'km';
  evOutputs.costPerUnitLabel.textContent = `Cost per ${unit}`;
  evOutputs.consumptionHint.textContent = {
    kwh100: 'Energy used by the car, in kWh / 100 km.',
    milesKwh: 'Miles driven for each kWh of battery energy.',
    kmKwh: 'Kilometres driven for each kWh of battery energy.'
  }[evFields.consumptionMode.value];
  if (!result) {
    ['tripCost', 'costPerUnit', 'energyUsed', 'energyPurchased', 'routeDistance'].forEach(id => { evOutputs[id].textContent = '—'; });
    evOutputs.validationMessage.textContent = rules.find(([, valid]) => !valid)?.[2] || 'These values are too large. Try smaller numbers.';
    return;
  }
  evOutputs.validationMessage.textContent = '';
  const currency = evFields.currency.value.trim() || '$';
  evOutputs.tripCost.textContent = `${currency}${result.cost.toFixed(2)}`;
  evOutputs.costPerUnit.textContent = `${currency}${result.perUnit.toFixed(3)}`;
  evOutputs.energyUsed.textContent = `${result.energy.toFixed(2)} kWh`;
  evOutputs.energyPurchased.textContent = `${result.purchased.toFixed(2)} kWh`;
  evOutputs.routeDistance.textContent = `${result.totalDistance.toFixed(1)} ${unit === 'mile' ? 'miles' : 'km'}`;
}

let previousDistanceUnit = evFields.distanceUnit.value;
let previousConsumptionMode = evFields.consumptionMode.value;
evFields.distanceUnit.addEventListener('change', () => {
  const distance = evNumber(evFields.distance);
  if (Number.isFinite(distance) && distance >= 0 && previousDistanceUnit !== evFields.distanceUnit.value) {
    evFields.distance.value = String(Number((distance * (previousDistanceUnit === 'miles' ? KM_PER_MILE : 1 / KM_PER_MILE)).toFixed(6)));
  }
  previousDistanceUnit = evFields.distanceUnit.value;
  updateEVEstimate();
});
evFields.consumptionMode.addEventListener('change', () => {
  const consumption = evNumber(evFields.consumptionValue);
  if (Number.isFinite(consumption) && consumption > 0 && previousConsumptionMode !== evFields.consumptionMode.value) {
    const kwhPerKm = previousConsumptionMode === 'kwh100' ? consumption / 100 :
      1 / (consumption * (previousConsumptionMode === 'milesKwh' ? KM_PER_MILE : 1));
    const converted = evFields.consumptionMode.value === 'kwh100' ? kwhPerKm * 100 :
      1 / (kwhPerKm * (evFields.consumptionMode.value === 'milesKwh' ? KM_PER_MILE : 1));
    evFields.consumptionValue.value = String(Number(converted.toFixed(6)));
  }
  previousConsumptionMode = evFields.consumptionMode.value;
  updateEVEstimate();
});
Object.entries(evFields).forEach(([id, field]) => {
  if (id !== 'distanceUnit' && id !== 'consumptionMode') field.addEventListener('input', updateEVEstimate);
});

function setEVRouteDistance(km) {
  evFields.distance.value = String(Number((km / (evFields.distanceUnit.value === 'miles' ? KM_PER_MILE : 1)).toFixed(3)));
  updateEVEstimate();
}
updateEVEstimate();
