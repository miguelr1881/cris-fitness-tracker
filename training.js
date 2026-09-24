import { completeWorkout, exerciseHistory } from './store.js';
import { unlockRewards } from './rewards.js';
import { dateKey } from './store.js';

export function createTraining(api) {
  const { getData, commit, escape, icon, openSheet, closeSheet, render, toast } = api;
  let historyActivity = null;

  function setSummary(entry, unit) {
    return entry.sets.filter(set => set.done).map(set => `${set.weight === null ? 'Sin peso' : `${set.weight} ${unit}`} × ${set.amount ?? '—'} ${entry.mode === 'seconds' ? 's' : 'reps'}`).join(' · ');
  }

  function view() {
    const data = getData();
    const workout = data.activeWorkout;
    const completed = workout.entries.reduce((sum, entry) => sum + entry.sets.filter(set => set.done).length, 0);
    const total = workout.entries.reduce((sum, entry) => sum + entry.sets.length, 0);
    return `<section class="workout"><div class="workout-heading"><div><p class="eyebrow">SESIÓN EN CURSO · ${escape(workout.unit)}</p><h1>${escape(workout.title)}</h1><p class="subtitle" id="workout-count">${completed} de ${total} series · guardado local</p></div><button class="icon-button" data-action="leave-workout" title="Volver a rutinas" aria-label="Volver a rutinas">${icon('arrow-left')}</button></div>
    <div class="workout-tools"><button class="secondary-button" data-action="workout-rest">${icon('timer')}Descanso · ${data.settings.rest} s</button><button class="icon-button" data-action="timer" aria-label="Abrir temporizador" title="Temporizador y cronómetro">${icon('clock-3')}</button></div>
    ${workout.exercises.map((exercise, exerciseIndex) => {
      const entry = workout.entries[exerciseIndex];
      const previous = exerciseHistory(data, exercise.id)[0];
      const previousEntry = previous?.workout.entries.find(item => item.exerciseId === exercise.id);
      return `<section class="workout-exercise"><div class="exercise-heading"><div><p class="eyebrow">${String(exerciseIndex + 1).padStart(2, '0')}</p><h2>${escape(exercise.name)}</h2></div><button class="icon-button" data-action="exercise-history" data-exercise="${escape(exercise.id)}" title="Historial del ejercicio" aria-label="Historial de ${escape(exercise.name)}">${icon('history')}</button></div>
      ${exercise.note ? `<p class="exercise-note">${escape(exercise.note)}</p>` : ''}
      <p class="previous-set">${previousEntry ? `Última sesión · ${escape(previous.date)} · ${escape(setSummary(previousEntry, previous.workout.unit))}` : 'Sin series anteriores'}</p>
      <div class="set-head"><span>Serie</span><span>Peso (${escape(workout.unit)})</span><span>${entry.mode === 'seconds' ? 'Segundos' : 'Repeticiones'}</span><span>Hecha</span></div>
      ${entry.sets.map((set, setIndex) => `<div class="set-row ${set.done ? 'done' : ''}" data-set-row="${exerciseIndex}-${setIndex}"><span>${setIndex + 1}</span><input type="number" min="0" max="2000" step="0.01" inputmode="decimal" placeholder="—" value="${set.weight ?? ''}" data-workout-input="weight" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="Peso serie ${setIndex + 1} de ${escape(exercise.name)}"><input type="number" min="0" max="100000" step="1" inputmode="numeric" value="${set.amount ?? ''}" data-workout-input="amount" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="${entry.mode === 'seconds' ? 'Segundos' : 'Repeticiones'} serie ${setIndex + 1} de ${escape(exercise.name)}"><button class="set-check" data-action="toggle-set" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-pressed="${set.done}" aria-label="Serie ${setIndex + 1} de ${escape(exercise.name)} completada">${icon('check')}</button></div>`).join('')}
      ${entry.mode === 'seconds' ? `<button class="text-button" data-action="exercise-timer" data-seconds="${entry.sets.find(set => !set.done)?.amount || 30}">${icon('timer')}Temporizar ejercicio</button>` : ''}</section>`;
    }).join('')}<div class="workout-finish"><button class="primary-button" data-action="finish-workout">${icon('check')}Finalizar sesión</button><button class="text-button danger-text" data-action="discard-workout">Descartar sesión</button></div></section>`;
  }

  function sessionDetails(activity) {
    if (!activity?.workout) return;
    historyActivity = structuredClone(activity);
    openSheet(activity.title, `<form id="session-history-form"><div class="sheet-content"><p class="muted-copy">${escape(activity.date)} · ${escape(activity.workout.unit)}</p>${activity.workout.exercises.map((exercise, exerciseIndex) => {
      const entry = activity.workout.entries[exerciseIndex];
      return `<section class="workout-exercise"><h3>${escape(exercise.name)}</h3><div class="set-head"><span>Serie</span><span>${escape(activity.workout.unit)}</span><span>${entry.mode === 'seconds' ? 'Segundos' : 'Reps'}</span><span>Hecha</span></div>${entry.sets.map((set, setIndex) => `<div class="set-row"><span>${setIndex + 1}</span><input name="weight-${exerciseIndex}-${setIndex}" type="number" min="0" max="2000" step="0.01" value="${set.weight ?? ''}" aria-label="Peso serie ${setIndex + 1} de ${escape(exercise.name)}"><input name="amount-${exerciseIndex}-${setIndex}" type="number" min="0" max="100000" value="${set.amount ?? ''}" aria-label="Cantidad serie ${setIndex + 1} de ${escape(exercise.name)}"><input class="history-check" type="checkbox" name="done-${exerciseIndex}-${setIndex}" ${set.done ? 'checked' : ''} aria-label="Serie ${setIndex + 1} de ${escape(exercise.name)} completada"></div>`).join('')}</section>`;
    }).join('')}<p class="form-error" id="history-error" role="alert"></p></div><footer class="sheet-footer"><button type="button" class="secondary-button" data-action="history-metadata">Fecha y notas</button><button type="submit" class="primary-button">Guardar series</button></footer></form>`, '', 'HISTORIAL');
  }

  function change(event) {
    const input = event.target.closest('[data-workout-input]');
    if (!input || !getData().activeWorkout) return false;
    if (!input.checkValidity()) { if (event.type !== 'input') input.reportValidity(); return true; }
    const next = structuredClone(getData());
    next.activeWorkout.entries[Number(input.dataset.exerciseIndex)].sets[Number(input.dataset.setIndex)][input.dataset.workoutInput] = input.value === '' ? null : Number(input.value);
    if (!commit(next)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    return true;
  }

  async function action(name, button) {
    if (name === 'resume-workout') { api.setShowing(true); render(); return true; }
    if (name === 'leave-workout') { api.setShowing(false); render(); return true; }
    if (name === 'view-session') { sessionDetails(getData().activities.find(activity => activity.id === button.dataset.id)); return true; }
    if (name === 'history-metadata') {
      if (document.querySelector('#session-history-form') && !confirm('¿Salir de las series sin guardar cambios?')) return true;
      api.openActivity(null, historyActivity); return true;
    }
    if (name === 'exercise-history') {
      const history = exerciseHistory(getData(), button.dataset.exercise);
      openSheet('Historial del ejercicio', `<div class="sheet-content">${history.map(activity => {
        const entry = activity.workout.entries.find(item => item.exerciseId === button.dataset.exercise);
        return `<button class="history-entry" data-action="view-session" data-id="${escape(activity.id)}"><strong>${escape(activity.date)}</strong><span>${escape(activity.title)}</span><small>${escape(setSummary(entry, activity.workout.unit))}</small></button>`;
      }).join('') || '<p class="muted-copy">Aún no hay series completadas para este ejercicio.</p>'}</div>`);
      return true;
    }
    if (!['toggle-set', 'finish-workout', 'discard-workout', 'workout-rest', 'exercise-timer'].includes(name)) return false;
    const data = getData();
    if (!data.activeWorkout) return true;
    if (name === 'toggle-set') {
      const inputs = [...document.querySelectorAll('[data-workout-input]')];
      const invalid = inputs.find(input => !input.checkValidity());
      if (invalid) { invalid.reportValidity(); return true; }
      const next = structuredClone(data);
      const entry = next.activeWorkout.entries[Number(button.dataset.exerciseIndex)];
      const set = entry.sets[Number(button.dataset.setIndex)];
      set.done = !set.done;
      if (commit(next)) {
        button.setAttribute('aria-pressed', String(set.done));
        button.closest('.set-row').classList.toggle('done', set.done);
        const sets = next.activeWorkout.entries.flatMap(item => item.sets);
        document.querySelector('#workout-count').textContent = `${sets.filter(item => item.done).length} de ${sets.length} series · guardado local`;
      }
    } else if (name === 'finish-workout') {
      const sets = data.activeWorkout.entries.flatMap(entry => entry.sets);
      if (!sets.some(set => set.done)) { toast('Marca al menos una serie antes de finalizar.'); return true; }
      openSheet('Finalizar sesión', `<form id="finish-workout-form"><div class="sheet-content"><p class="muted-copy">${sets.filter(set => set.done).length} de ${sets.length} series completadas. ${sets.some(set => !set.done) ? 'Las series pendientes quedarán sin marcar.' : ''}</p><label class="field"><span>Calorías activas <small>opcional</small></span><input name="calories" type="number" min="0" max="10000" inputmode="numeric"></label><label class="field"><span>Notas <small>opcional</small></span><textarea name="notes" maxlength="4000"></textarea></label></div><footer class="sheet-footer"><button type="submit" class="primary-button">Guardar sesión</button></footer></form>`);
    } else if (name === 'discard-workout') {
      if (!confirm('¿Eliminar esta sesión y sus series? No aparecerá en el historial.')) return true;
      const next = structuredClone(data); next.activeWorkout = null;
      if (commit(next)) { api.stopTimer(); api.setShowing(false); render(); }
    } else api.openTimer(name === 'workout-rest' ? data.settings.rest : Math.min(7200, Math.max(1, Number(button.dataset.seconds) || 30)));
    return true;
  }

  function submit(event) {
    if (event.target.id === 'finish-workout-form') {
      event.preventDefault();
      const fields = new FormData(event.target);
      const calories = fields.get('calories') === '' ? null : Number(fields.get('calories'));
      try {
        const next = unlockRewards(completeWorkout(getData(), calories, fields.get('notes')), dateKey());
        if (commit(next)) { closeSheet(true); api.stopTimer(); api.setShowing(false); render(); toast('Sesión guardada en el historial.'); api.notifyRewards(); }
      } catch (error) { toast(error.message); }
      return true;
    }
    if (event.target.id !== 'session-history-form') return false;
    event.preventDefault();
    const fields = new FormData(event.target);
    const activity = structuredClone(historyActivity);
    activity.workout.entries.forEach((entry, exerciseIndex) => entry.sets.forEach((set, setIndex) => {
      for (const field of ['weight', 'amount']) { const value = fields.get(`${field}-${exerciseIndex}-${setIndex}`); set[field] = value === '' ? null : Number(value); }
      set.done = fields.has(`done-${exerciseIndex}-${setIndex}`);
    }));
    if (!activity.workout.entries.some(entry => entry.sets.some(set => set.done))) { document.querySelector('#history-error').textContent = 'Mantén al menos una serie completada o elimina la actividad desde Fecha y notas.'; return true; }
    activity.updatedAt = new Date().toISOString();
    const next = structuredClone(getData());
    const index = next.activities.findIndex(item => item.id === activity.id);
    if (index < 0) { toast('Esta sesión ya no existe.'); return true; }
    next.activities[index] = activity;
    if (commit(next)) { closeSheet(true); render(); toast('Series corregidas.'); }
    return true;
  }

  return { view, action, change, submit, sessionDetails };
}