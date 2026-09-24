import { DEFAULT_REWARDS, METRICS, migrateRewardCopy, migrateRewardGoal, migrateRewardOrder } from './rewards.js';

export const VERSION = '0.6.1';
export const STORAGE_KEY = 'cristina.diary.preview.v1';
export const TYPES = {
  barre: { label: 'Barré', icon: 'sparkles', color: 'lilac' },
  heat: { label: 'Barré Heat', icon: 'flame', color: 'rose' },
  gym: { label: 'Gimnasio', icon: 'dumbbell', color: 'sage' },
  cardio: { label: 'Cardio', icon: 'heart-pulse', color: 'peach' },
  swim: { label: 'Piscina', icon: 'waves', color: 'blue' },
};

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(key) {
  return new Date(`${key}T12:00:00`);
}

export function shiftDate(key, days) {
  const date = parseDate(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDate(value)) === value;
}

export function makeDemo(today = dateKey()) {
  const activities = [
    [0, 'barre', 284, 60, null, ''],
    [-1, 'gym', 210, 35, null, 'Core y movilidad.'],
    [-3, 'swim', 320, 40, 1000, ''],
    [-4, 'heat', 362, 60, null, ''],
    [-6, 'barre', 275, 60, null, ''],
    [-8, 'cardio', 180, 25, 2500, 'Caminata inclinada.'],
    [-9, 'swim', 290, 35, 800, ''],
    [-11, 'heat', 348, 60, null, ''],
    [-13, 'barre', 265, 60, null, ''],
    [-16, 'gym', 195, 30, null, ''],
    [-19, 'barre', 280, 60, null, ''],
    [-22, 'swim', 310, 40, 1000, ''],
  ].map(([offset, type, calories, minutes, meters, notes], index) => ({
    id: `demo-${index}`, date: shiftDate(today, offset), type, calories, minutes, meters, notes,
    title: '', exercises: [], updatedAt: new Date().toISOString(),
  }));
  return {
    format: 'cristina-diary', version: 1, demo: true,
    settings: { unit: 'kg', rest: 45 }, activities,
    routines: [
      { id: 'routine-core', name: 'Core y movilidad', note: '', exercises: [
        { name: 'Dead bug', sets: 3, target: '10 por lado', note: 'Espalda baja apoyada. Extender brazo y pierna contrarios.', url: '' },
        { name: 'Puente de glúteos', sets: 3, target: '15 repeticiones', note: 'Pies apoyados, subir la cadera y bajar con control.', url: '' },
        { name: 'Plancha', sets: 3, target: '30 segundos', note: 'Codos debajo de los hombros. Mantener la respiración.', url: '' },
      ] },
      { id: 'routine-flow', name: 'Fuerza funcional', note: '', exercises: [
        { name: 'Sentadilla', sets: 3, target: '12 repeticiones', note: 'Bajar con control y apoyar todo el pie.', url: '' },
        { name: 'Bird dog', sets: 3, target: '10 por lado', note: 'Desde cuatro apoyos, extender brazo y pierna contrarios.', url: '' },
      ] },
    ],
  };
}

export function emptyStore(settings = { unit: 'kg', rest: 45 }) {
  return { format: 'cristina-diary', version: 1, demo: false, settings: { ...settings }, activities: [], routines: [] };
}

function boundedNumber(value, maximum, nullable = true) {
  return (nullable && value === null) || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum);
}

function validText(value, max = 4000) {
  return typeof value === 'string' && value.length <= max;
}

export function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function validExercises(exercises) {
  return Array.isArray(exercises) && exercises.length <= 100 && exercises.every(exercise =>
    validText(exercise.name, 150) && exercise.name.trim() &&
    Number.isInteger(exercise.sets) && exercise.sets > 0 && exercise.sets <= 30 &&
    validText(exercise.target, 100) && validText(exercise.note) && validText(exercise.url, 2000) &&
    (!exercise.url || safeUrl(exercise.url)));
}

export function validateStore(data) {
  if (!data || data.format !== 'cristina-diary' || data.version !== 1 || typeof data.demo !== 'boolean') throw new Error('Este archivo no es un respaldo compatible de Cristina.');
  data = structuredClone(data);
  data.activeWorkout ??= null;
  data.rewards ??= structuredClone(DEFAULT_REWARDS);
  data.rewardAwards ??= [];
  if (!data.settings || !['kg', 'lb'].includes(data.settings.unit) || !Number.isInteger(data.settings.rest) || data.settings.rest < 1 || data.settings.rest > 7200) throw new Error('Las preferencias del respaldo no son válidas.');
  if (!Array.isArray(data.activities) || data.activities.length > 50000 || !Array.isArray(data.routines) || data.routines.length > 1000) throw new Error('El respaldo contiene una colección no válida.');
  const activityIds = new Set();
  for (const activity of data.activities) {
    if (!validText(activity.id, 100) || !activity.id || activityIds.has(activity.id) || !validDate(activity.date) || !Object.hasOwn(TYPES, activity.type) ||
      !boundedNumber(activity.calories, 10000) || !boundedNumber(activity.minutes, 1440) || !boundedNumber(activity.meters, 1000000) ||
      !validText(activity.notes) || !validText(activity.title, 150) || !validExercises(activity.exercises) ||
      !validText(activity.updatedAt, 100) || !Number.isFinite(Date.parse(activity.updatedAt)) ||
      (['barre', 'heat'].includes(activity.type) && activity.minutes !== 60)) throw new Error('Hay una actividad no válida en el respaldo. No se ha importado nada.');
    activityIds.add(activity.id);
  }
  const routineIds = new Set();
  for (const routine of data.routines) {
    if (!validText(routine.id, 100) || !routine.id || routineIds.has(routine.id) || !validText(routine.name, 150) || !routine.name.trim() || !validText(routine.note) || !validExercises(routine.exercises)) throw new Error('Hay una rutina no válida en el respaldo.');
    routine.exercises.forEach((exercise, index) => { exercise.id ??= `${routine.id}:exercise:${index}`; });
    if (routine.exercises.some(exercise => !validText(exercise.id, 150) || !exercise.id) || new Set(routine.exercises.map(exercise => exercise.id)).size !== routine.exercises.length) throw new Error('Identificadores de ejercicio no válidos.');
    routineIds.add(routine.id);
  }
  if (data.activeWorkout !== null && !validWorkout(data.activeWorkout)) throw new Error('El entrenamiento en curso no es válido.');
  for (const activity of data.activities) {
    if (activity.workout !== undefined && (!validWorkout(activity.workout) || activity.type !== 'gym')) throw new Error('Las series del entrenamiento no son válidas.');
  }
  if (!Array.isArray(data.rewards) || data.rewards.length > 100 || !Array.isArray(data.rewardAwards) || data.rewardAwards.length > 500) throw new Error('Las recompensas no son válidas.');
  data.rewards = migrateRewardOrder(data.rewards.map(migrateRewardCopy).map(migrateRewardGoal));
  data.rewardAwards = data.rewardAwards.map(migrateRewardCopy);
  if ([...data.rewards, ...data.rewardAwards].some(reward => reward.metric !== undefined && !Object.hasOwn(METRICS, reward.metric))) throw new Error('La meta de recompensa no es válida.');
  const validReward = reward => reward && validText(reward.id, 100) && reward.id && (reward.kind === undefined || reward.kind === 'welcome') && validText(reward.name, 150) && reward.name.trim() && validText(reward.description, 320) && Number.isInteger(reward.days) && reward.days > 0 && reward.days <= (reward.metric === 'swim' ? 1000000 : 10000) && ['heart', 'cookie', 'ice-cream-bowl', 'gift', 'cup-soda', 'clapperboard', 'utensils', 'palmtree'].includes(reward.icon);
  if (data.rewards.some(reward => !validReward(reward)) || new Set(data.rewards.map(reward => reward.id)).size !== data.rewards.length || data.rewardAwards.some(award => !validReward(award) || !validDate(award.earnedAt) || typeof award.seen !== 'boolean' || typeof award.redeemed !== 'boolean') || new Set(data.rewardAwards.map(award => award.id)).size !== data.rewardAwards.length) throw new Error('Hay una recompensa no válida en el respaldo.');
  return structuredClone(data);
}

export function loadStore(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return validateStore(raw ? JSON.parse(raw) : emptyStore());
}

export function saveStore(data, storage = localStorage) {
  const valid = validateStore(data);
  storage.setItem(STORAGE_KEY, JSON.stringify(valid));
  return valid;
}

export function upsertActivity(data, activity) {
  const next = structuredClone(data);
  const index = next.activities.findIndex(item => item.id === activity.id);
  if (index < 0) next.activities.push(activity);
  else next.activities[index] = activity;
  return validateStore(next);
}

export function periodRange(kind, anchor) {
  const date = parseDate(anchor);
  if (kind === 'week') {
    const start = shiftDate(anchor, -((date.getDay() + 6) % 7));
    return { start, end: shiftDate(start, 6) };
  }
  if (kind === 'year') return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` };
  return { start: dateKey(new Date(date.getFullYear(), date.getMonth(), 1)), end: dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)) };
}

export function summarize(data, kind, anchor) {
  const { start, end } = periodRange(kind, anchor);
  const entries = data.activities.filter(activity => activity.date >= start && activity.date <= end);
  return {
    entries, sessions: entries.length, days: new Set(entries.map(activity => activity.date)).size,
    calories: entries.reduce((sum, activity) => sum + (activity.calories ?? 0), 0),
    missingCalories: entries.filter(activity => activity.calories === null).length,
    minutes: entries.reduce((sum, activity) => sum + (activity.minutes ?? 0), 0),
    meters: entries.filter(activity => activity.type === 'swim').reduce((sum, activity) => sum + (activity.meters ?? 0), 0),
  };
}

function validWorkout(workout) {
  return workout && validText(workout.id, 100) && Boolean(workout.id) && validText(workout.routineId, 100) && validText(workout.title, 150) && validDate(workout.date) &&
    Number.isFinite(workout.startedAt) && ['kg', 'lb'].includes(workout.unit) && validExercises(workout.exercises) &&
    Array.isArray(workout.entries) && workout.entries.length === workout.exercises.length && workout.entries.every((entry, index) =>
      validText(entry.exerciseId, 150) && entry.exerciseId === workout.exercises[index].id && ['reps', 'seconds'].includes(entry.mode) &&
      Array.isArray(entry.sets) && entry.sets.length === workout.exercises[index].sets && entry.sets.every(set =>
        boundedNumber(set.weight, 2000) && boundedNumber(set.amount, 100000) && typeof set.done === 'boolean'));
}

export function convertWeight(value, from, to) {
  if (value === null || from === to) return value;
  return Math.round((from === 'kg' ? value * 2.2046226218 : value / 2.2046226218) * 100) / 100;
}

export function exerciseHistory(data, exerciseId, before = null) {
  return data.activities.filter(activity => activity.workout && activity.id !== before && activity.workout.entries.some(entry => entry.exerciseId === exerciseId && entry.sets.some(set => set.done)))
    .sort((left, right) => right.date.localeCompare(left.date) || right.updatedAt.localeCompare(left.updatedAt));
}

export function startWorkout(data, routine, day = dateKey()) {
  if (data.activeWorkout) throw new Error('Ya hay una sesión en curso.');
  const unit = data.settings.unit;
  const exercises = structuredClone(routine.exercises);
  const entries = exercises.map(exercise => {
    const mode = /seg|sec|\bs\b|min/i.test(exercise.target) ? 'seconds' : 'reps';
    const target = Number(exercise.target.match(/\d+/)?.[0] || 0) * (/min/i.test(exercise.target) ? 60 : 1) || null;
    const previous = exerciseHistory(data, exercise.id)[0];
    const previousEntry = previous?.workout.entries.find(entry => entry.exerciseId === exercise.id);
    return { exerciseId: exercise.id, mode, sets: Array.from({ length: exercise.sets }, (_, index) => {
      const last = previousEntry?.sets[index];
      return { weight: last?.done ? convertWeight(last.weight, previous.workout.unit, unit) : null, amount: last?.done && previousEntry.mode === mode ? last.amount : target, done: false };
    }) };
  });
  return { id: crypto.randomUUID(), routineId: routine.id, title: routine.name, date: day, startedAt: Date.now(), unit, exercises, entries };
}

export function completeWorkout(data, calories = null, notes = '') {
  const workout = data.activeWorkout;
  if (!workout || !workout.entries.some(entry => entry.sets.some(set => set.done))) throw new Error('Marca al menos una serie antes de finalizar.');
  const next = structuredClone(data);
  const activity = { id: workout.id, date: workout.date, type: 'gym', title: workout.title, calories,
    minutes: Math.max(1, Math.min(1440, Math.round((Date.now() - workout.startedAt) / 60000))), meters: null,
    notes, exercises: structuredClone(workout.exercises), workout: structuredClone(workout), updatedAt: new Date().toISOString() };
  next.activeWorkout = null;
  return upsertActivity(next, activity);
}