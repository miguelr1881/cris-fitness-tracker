const GOALS = [['barre',8],['swim',2000],['gym',6],['barre',16],['swim',5000],['gym',15],['barre',30],['gymSets',150],['swim',15000],['gym',40],['barre',60],['gym',80]];
const OLD_DAYS = [8,16,25,36,48,64,80,100,125,155,190,240];
export const METRICS = { barre: 'clases de Barré / Heat', swim: 'metros nadados', gym: 'sesiones de gimnasio', gymSets: 'series completadas de gimnasio', days: 'días activos' };

export const DEFAULT_REWARDS = [
  { id: 'cookies', name: 'Hersheys de cookies and cream', description: 'Miguel te regala un Hersheys de cookies and cream.', days: 8, icon: 'cookie' },
  { id: 'myka', name: 'Yogurt Myka', description: 'Miguel te invita a un yogurt Myka.', days: 16, icon: 'ice-cream-bowl' },
  { id: 'mazapan', name: 'Bolsita de mazapán de Giacomin', description: 'Miguel te regala una bolsita de mazapán de Giacomin.', days: 25, icon: 'gift' },
  { id: 'bubble-tea', name: 'Bubble Tea de Xing Fu Tan', description: 'Un Bubble Tea de Xing Fu Tan, invitado por Miguel.', days: 36, icon: 'cup-soda' },
  { id: 'yogs', name: 'Yogs', description: 'Miguel te invita a Yogs.', days: 48, icon: 'ice-cream-bowl' },
  { id: 'cinema', name: 'Entradas al Cine', description: 'Miguel te regala las entradas para ir juntos al cine.', days: 64, icon: 'clapperboard' },
  { id: 'nacion', name: 'Nacion Sushi', description: 'Miguel te invita a almorzar o cenar en Nacion Sushi.', days: 80, icon: 'utensils' },
  { id: 'kimchis', name: 'Kimchis', description: 'Miguel te invita a almorzar o cenar en Kimchis.', days: 100, icon: 'utensils' },
  { id: 'hikari', name: 'Hikari', description: 'Miguel te invita a almorzar o cenar en Hikari.', days: 125, icon: 'utensils' },
  { id: 'riverside', name: 'Riverside', description: 'Miguel te invita a almorzar o cenar en Riverside.', days: 155, icon: 'utensils' },
  { id: 'pf-changs', name: 'PF Changs', description: 'Miguel te invita a almorzar o cenar en PF Changs.', days: 190, icon: 'utensils' },
  { id: 'beach', name: 'Un finde en la playa', description: 'Un fin de semana en la playa con Miguel. Un regalo para disfrutar juntos.', days: 240, icon: 'palmtree' },
].map((reward, index) => ({ ...reward, metric: GOALS[index][0], days: GOALS[index][1] }));

const LEGACY_NAMES = {
  cookies: 'Hershey’s Cookies & Cream', myka: 'Yogurt Myka', mazapan: 'Mazapán de Giacomin',
  'bubble-tea': 'Bubble Tea de Xing Fu Tan', yogs: 'Yogs', cinema: 'Entradas al cine',
  nacion: 'Una salida a Nación Sushi', kimchis: 'Una salida a Kimchis', hikari: 'Una salida a Hikari',
  riverside: 'Una salida a Riverside', 'pf-changs': 'Una salida a P.F. Chang’s', beach: 'Un finde en la playa',
};

export function migrateRewardCopy(reward) {
  if (!reward || typeof reward !== 'object') return reward;
  const original = DEFAULT_REWARDS.find(item => item.id === reward.id);
  if (reward.description === undefined && original && reward.name === LEGACY_NAMES[reward.id]) {
    return { ...reward, name: original.name, description: original.description };
  }
  return { ...reward, description: reward.description ?? '' };
}

export function activeDays(data, today) {
  return new Set(data.activities.filter(activity => activity.date <= today).map(activity => activity.date)).size;
}

export function rewardProgress(data, today) {
  const earned = new Set(data.rewardAwards.map(award => award.id));
  const pending = data.rewards.filter(reward => !earned.has(reward.id)).sort((left, right) => rewardCount(data, right, today) / right.days - rewardCount(data, left, today) / left.days);
  return { count: pending.length ? rewardCount(data, pending[0], today) : 0, next: pending[0] || null, following: pending[1] || null, followingCount: pending[1] ? rewardCount(data, pending[1], today) : 0, hidden: Math.max(0, pending.length - 2) };
}

export function unlockRewards(data, today) {
  const next = structuredClone(data);
  const earned = new Set(next.rewardAwards.map(award => award.id));
  for (const reward of next.rewards) {
    if (!earned.has(reward.id) && rewardCount(next, reward, today) >= reward.days) {
      next.rewardAwards.push({ ...reward, earnedAt: today, seen: false, redeemed: false });
    }
  }
  return next;
}

export function migrateRewardGoal(reward) {
  const index = DEFAULT_REWARDS.findIndex(item => item.id === reward.id);
  if (reward.metric === undefined && index >= 0 && reward.days === OLD_DAYS[index] && reward.name === DEFAULT_REWARDS[index].name && reward.description === DEFAULT_REWARDS[index].description) {
    return { ...reward, metric: DEFAULT_REWARDS[index].metric, days: DEFAULT_REWARDS[index].days };
  }
  return { ...reward, metric: reward.metric ?? 'days' };
}

export function rewardCount(data, reward, today) {
  const activities = data.activities.filter(activity => activity.date <= today);
  if (reward.metric === 'barre') return activities.filter(activity => ['barre', 'heat'].includes(activity.type)).length;
  if (reward.metric === 'swim') return activities.filter(activity => activity.type === 'swim').reduce((total, activity) => total + (activity.meters || 0), 0);
  if (reward.metric === 'gym') return activities.filter(activity => activity.type === 'gym').length;
  if (reward.metric === 'gymSets') return activities.filter(activity => activity.type === 'gym').reduce((total, activity) => total + (activity.workout?.entries || []).reduce((sum, entry) => sum + entry.sets.filter(set => set.done).length, 0), 0);
  return activeDays(data, today);
}

export function rewardGoal(reward) {
  return `${reward.days} ${METRICS[reward.metric || 'days']}`;
}