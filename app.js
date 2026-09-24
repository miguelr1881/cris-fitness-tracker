import { VERSION, STORAGE_KEY, TYPES, dateKey, parseDate, shiftDate, periodRange, summarize, loadStore, saveStore, upsertActivity, emptyStore, validateStore, safeUrl, startWorkout } from './store.js';
import { unlockRewards } from './rewards.js';
import { createTraining } from './training.js';
import { createRewards } from './reward-ui.js';
import { createCloud } from './cloud.js';

const main = document.querySelector('#main');
const sheet = document.querySelector('#sheet');
const sheetBody = document.querySelector('#sheet-body');
const number = new Intl.NumberFormat('es-CR');
const today = dateKey();
let data;
let cloud = null;
let blocked = false;
try { data = loadStore(); } catch { blocked = true; data = emptyStore(); }
let view = ['diary', 'routines', 'progress'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'diary';
let selectedDate = today;
let calendarAnchor = today;
let expandedCalendar = false;
let period = 'month';
let progressAnchor = today;
let filter = 'all';
let activityDraft = null;
let routineDraft = null;
let pendingImport = null;
let pendingExternalData = null;
let toastTimeout;
let undoAction = null;
let modalOpener = null;
let sheetDirty = false;
let shareBlob = null;
let showingWorkout = false;
let audioContext = null;
let previousAudioType = null;
const activeTones = new Set();
const timerKey = 'cristina.diary.timer.v1';
let timer = { mode: 'rest', duration: data.settings.rest, remaining: data.settings.rest, elapsed: 0, running: false, startedAt: null, endsAt: null, finished: false };
try {
  const stored = JSON.parse(sessionStorage.getItem(timerKey) || 'null');
  if (stored && ['rest', 'exercise', 'stopwatch'].includes(stored.mode) && Number.isFinite(stored.duration) && stored.duration >= 1 && stored.duration <= 7200 && Number.isFinite(stored.remaining) && Number.isFinite(stored.elapsed) && typeof stored.running === 'boolean' && (!stored.running || (Number.isFinite(stored.startedAt) && Number.isFinite(stored.endsAt)))) timer = stored;
} catch {}

function escape(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name, className = '') {
  return `<i data-lucide="${name}"${className ? ` class="${className}"` : ''} aria-hidden="true"></i>`;
}

function icons() { globalThis.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
function formatDate(key, options) { return parseDate(key).toLocaleDateString('es-ES', options); }
function monthLabel(key) { return formatDate(key, { month: 'long', year: 'numeric' }); }
function dayLabel(key) { return key === today ? 'Hoy' : formatDate(key, { weekday: 'long', day: 'numeric', month: 'short' }); }
function minutesLabel(value) { return value === null ? '' : `${number.format(value)} min`; }
function nullable(value) { return String(value ?? '').trim() === '' ? null : Number(value); }

function commit(next) {
  try {
    if (blocked) throw new Error('El almacenamiento necesita recuperarse antes de guardar.');
    if (pendingExternalData) throw new Error('Hay cambios de otra pestaña. Conserva tus notas y cierra esta edición antes de continuar.');
    if (cloud?.loading) throw new Error('Espera a que termine la conexión de cuenta.');
    data = saveStore(next, cloud?.storage || localStorage);
    return true;
  } catch (error) {
    toast(error instanceof DOMException ? 'No se pudo guardar. Conserva un respaldo antes de cerrar.' : error.message);
    return false;
  }
}

function toast(message, undo = null) {
  clearTimeout(toastTimeout);
  undoAction = undo;
  const element = document.querySelector('#toast');
  element.innerHTML = `<span>${escape(message)}</span>${undo ? '<button data-action="undo">Deshacer</button>' : ''}`;
  element.hidden = false;
  toastTimeout = setTimeout(() => { element.hidden = true; undoAction = null; }, undo ? 12000 : 4500);
}

function heading(title, eyebrow, subtitle, button = 'activity') {
  const buttons = {
    activity: `<button class="primary-button" data-action="new-activity" aria-label="Registrar actividad" title="Registrar actividad">${icon('plus')}<span>Registrar actividad</span></button>`,
    routine: `<button class="primary-button" data-action="new-routine" aria-label="Nueva rutina" title="Nueva rutina">${icon('plus')}<span>Nueva rutina</span></button>`,
    share: `<button class="secondary-button" data-action="share" aria-label="Compartir resumen" title="Compartir resumen">${icon('share-2')}<span>Compartir</span></button>`,
  };
  return `<div class="page-heading"><div><p class="eyebrow">${escape(eyebrow)}</p><h1>${title}</h1><p class="subtitle">${escape(subtitle)}</p></div>${buttons[button]}</div>`;
}

function render() {
  if (blocked) {
    main.innerHTML = `<section class="fatal"><h1>Tu diario está a salvo aquí.</h1><p>No pudimos leer el guardado local. No lo hemos reemplazado.</p><button class="secondary-button" data-action="raw-backup">${icon('download')}Rescatar archivo local</button><p class="muted-copy">Guarda el archivo antes de pedir ayuda para recuperarlo.</p></section>`;
    icons();
    return;
  }
  document.querySelectorAll('[data-nav]').forEach(button => {
    const active = button.dataset.nav === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelector('#data-label').textContent = data.demo ? 'Vista previa · datos de ejemplo' : 'Guardado local · sin conexión a la nube';
  document.querySelector('#app-version').textContent = `v${VERSION}`;
  main.innerHTML = `<div class="view-enter">${showingWorkout && data.activeWorkout ? training.view() : view === 'diary' ? diaryView() : view === 'routines' ? routinesView() : progressView()}</div>`;
  const resume = data.activeWorkout && !showingWorkout ? `<button class="resume-session" data-action="resume-workout">${icon('play')}<span>${escape(data.activeWorkout.title)}<small>Sesión en curso</small></span>${icon('arrow-right')}</button>` : '';
  if (resume) main.insertAdjacentHTML('afterbegin', resume);
  document.title = `Cristina · ${view === 'diary' ? 'Mi diario' : view === 'routines' ? 'Mis rutinas' : 'Mi progreso'}`;
  icons();
  updateTimer();
  cloud?.renderStatus();
}

function activityRow(activity, showDate = false) {
  const type = TYPES[activity.type];
  const details = [showDate ? formatDate(activity.date, { day: 'numeric', month: 'short' }) : null, minutesLabel(activity.minutes), activity.meters !== null ? `${number.format(activity.meters)} m` : null].filter(Boolean).join(' · ');
  return `<button class="activity-row" data-action="${activity.workout ? 'view-session' : 'edit-activity'}" data-id="${escape(activity.id)}" aria-label="Editar ${escape(activity.title || type.label)} del ${escape(activity.date)}">
    <span class="activity-symbol ${type.color}">${icon(type.icon)}</span>
    <span class="activity-description"><strong>${escape(activity.title || type.label)}</strong><small>${escape(details || type.label)}</small>${activity.notes && !showDate ? `<p>${escape(activity.notes.slice(0, 90))}</p>` : ''}</span>
    <span class="activity-value">${activity.calories === null ? '—' : number.format(activity.calories)}<small>${activity.calories === null ? 'sin kcal' : 'kcal activas'}</small></span>${icon('chevron-right', 'activity-chevron')}
  </button>`;
}

function calendarView() {
  const anchor = parseDate(calendarAnchor);
  let start;
  let count;
  if (expandedCalendar) {
    const first = dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    start = shiftDate(first, -((parseDate(first).getDay() + 6) % 7));
    const monthDays = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    count = Math.ceil((((parseDate(first).getDay() + 6) % 7) + monthDays) / 7) * 7;
  } else {
    const monday = periodRange('week', calendarAnchor).start;
    start = shiftDate(monday, -7);
    count = 14;
  }
  const cells = Array.from({ length: count }, (_, index) => {
    const key = shiftDate(start, index);
    const entries = data.activities.filter(activity => activity.date === key);
    const colors = [...new Set(entries.map(activity => activity.type))].slice(0, 3);
    return `<button class="calendar-day ${key === selectedDate ? 'selected' : ''} ${key === today ? 'today' : ''} ${expandedCalendar && parseDate(key).getMonth() !== anchor.getMonth() ? 'outside' : ''}" data-action="select-day" data-date="${key}" aria-pressed="${key === selectedDate}" aria-label="${escape(formatDate(key, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${entries.length} actividades" ${key === today ? 'aria-current="date"' : ''}><span>${parseDate(key).getDate()}</span><span class="day-dots">${colors.map(type => `<span class="day-dot ${type}"></span>`).join('')}</span></button>`;
  }).join('');
  return `<section class="calendar-section" aria-label="Calendario de actividades"><div class="section-top"><h2 class="calendar-title">${escape(monthLabel(calendarAnchor))}</h2><div class="calendar-controls"><button class="icon-button" data-action="calendar-prev" aria-label="Periodo anterior" title="Periodo anterior">${icon('chevron-left')}</button><button class="icon-button" data-action="calendar-next" aria-label="Periodo siguiente" title="Periodo siguiente">${icon('chevron-right')}</button></div></div><div class="weekdays" aria-hidden="true">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(label => `<span>${label}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-bottom"><span>${expandedCalendar ? 'CALENDARIO MENSUAL' : 'DOS SEMANAS'}</span><button class="text-button" data-action="toggle-calendar" aria-expanded="${expandedCalendar}">${expandedCalendar ? 'Ver menos' : 'Ver mes'}${icon(expandedCalendar ? 'chevron-up' : 'chevron-down')}</button></div></section>`;
}

function diaryView() {
  const entries = data.activities.filter(activity => activity.date === selectedDate);
  const weekly = summarize(data, 'week', selectedDate);
  const weekStart = periodRange('week', selectedDate).start;
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDate(weekStart, index);
    const minutes = data.activities.filter(activity => activity.date === key).reduce((sum, activity) => sum + (activity.minutes ?? 0), 0);
    return { key, minutes };
  });
  const maximum = Math.max(60, ...days.map(day => day.minutes));
  return `${heading('Mi diario', formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }), '')}
    <div class="dashboard-grid"><div>${calendarView()}<section class="day-section" aria-label="Actividades del día"><div class="section-top"><h2 class="day-title">${escape(dayLabel(selectedDate))}</h2><span class="count-label">${entries.length ? `${entries.length} ${entries.length === 1 ? 'actividad' : 'actividades'}` : 'Sin actividades'}</span></div><div class="activity-list">${entries.length ? entries.map(activity => activityRow(activity)).join('') : `<div class="empty-state">${icon('sun')}<h3>Sin actividades</h3><p>${selectedDate > today ? 'Fecha futura' : ''}</p><button class="text-button" data-action="new-activity">${icon('plus')}Registrar actividad</button></div>`}</div></section><p class="quick-title">REGISTRAR</p><div class="quick-actions"><button class="quick-action" data-action="new-activity" data-type="barre">${icon('sparkles')}Barré</button><button class="quick-action" data-action="new-activity" data-type="gym">${icon('dumbbell')}Gimnasio</button><button class="quick-action" data-action="new-activity" data-type="swim">${icon('waves')}Piscina</button></div><p class="daily-note">Cristina · Diario de actividad</p></div>
    <aside class="diary-aside"><section class="week-summary"><h3 class="aside-heading">${selectedDate >= periodRange('week', today).start && selectedDate <= periodRange('week', today).end ? 'Tu semana' : 'Esa semana'}${icon('sprout')}</h3><div class="week-layout"><div><p class="weekly-number">${weekly.sessions}<span>${weekly.sessions === 1 ? 'actividad' : 'actividades'}</span></p><div class="summary-mini"><div><strong>${number.format(weekly.calories)}</strong><small>kcal${weekly.missingCalories ? ' registradas*' : ' activas'}</small></div><div><strong>${weekly.days}</strong><small>días activos</small></div></div></div><div class="bars" aria-label="Minutos de actividad por día">${days.map((day, index) => `<div class="bar-column" title="${escape(day.key)}: ${day.minutes} min"><div class="bar-track"><span class="bar-fill" style="height:${day.minutes / maximum * 100}%"></span></div><span>${['L', 'M', 'X', 'J', 'V', 'S', 'D'][index]}</span></div>`).join('')}</div></div>${weekly.missingCalories ? '<p class="muted-copy">* Hay actividades sin calorías registradas.</p>' : ''}</section></aside></div>`;
}

function routinesView() {
  return `${heading('Mis rutinas', 'GIMNASIO', '', 'routine')}<div class="routine-grid">${data.routines.length ? data.routines.map((routine, index) => `<button class="routine-card" data-action="open-routine" data-id="${escape(routine.id)}"><span class="activity-symbol ${index % 2 ? 'lilac' : 'sage'}">${icon(index % 2 ? 'sprout' : 'dumbbell')}</span><h2>${escape(routine.name)}</h2><footer><span>${routine.exercises.length} ejercicios</span>${icon('arrow-up-right')}</footer></button>`).join('') : `<div class="empty-state">${icon('layers-2')}<h3>Sin rutinas</h3><button class="text-button" data-action="new-routine">${icon('plus')}Crear rutina</button></div>`}</div><div class="routine-banner">${icon('heart-pulse')}<div><h3>Cardio</h3><p>Caminata, bicicleta o carrera.</p></div><button class="text-button" data-action="new-activity" data-type="cardio">Registrar${icon('arrow-right')}</button></div>`;
}

function progressTitle() {
  if (period === 'year') return String(parseDate(progressAnchor).getFullYear());
  if (period === 'month') return monthLabel(progressAnchor);
  const range = periodRange('week', progressAnchor);
  return `${formatDate(range.start, { day: 'numeric', month: 'short' })} – ${formatDate(range.end, { day: 'numeric', month: 'short' })}`;
}

function progressView() {
  const summary = summarize(data, period, progressAnchor);
  const visible = summary.entries.filter(activity => filter === 'all' || activity.type === filter).sort((left, right) => right.date.localeCompare(left.date));
  return `${heading('Mi progreso', 'RESUMEN', '', 'share')}<div class="period-toolbar"><div class="segmented" role="group" aria-label="Periodo del resumen">${[['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']].map(([key, label]) => `<button data-action="set-period" data-period="${key}" class="${period === key ? 'active' : ''}" aria-pressed="${period === key}">${label}</button>`).join('')}</div><div class="period-navigation"><button class="icon-button" data-action="progress-prev" aria-label="Resumen anterior" title="Resumen anterior">${icon('chevron-left')}</button><span class="period-label">${escape(progressTitle())}</span><button class="icon-button" data-action="progress-next" aria-label="Resumen siguiente" title="Resumen siguiente">${icon('chevron-right')}</button></div></div><div class="stat-grid"><div class="stat-block">${icon('calendar-check-2')}<strong>${summary.sessions}</strong><span>actividades</span></div><div class="stat-block">${icon('sun')}<strong>${summary.days}</strong><span>días activos</span></div><div class="stat-block">${icon('flame')}<strong>${number.format(summary.calories)}</strong><span>kcal ${summary.missingCalories ? 'registradas*' : 'activas'}</span></div><div class="stat-block">${icon('waves')}<strong>${number.format(summary.meters)}</strong><span>metros nadados</span></div></div>${summary.missingCalories ? `<p class="muted-copy" style="margin-top:12px">* ${summary.missingCalories} actividades sin calorías. El total incluye solo las registradas.</p>` : ''}<div class="section-heading"><h2>Por actividad</h2><span class="count-label">${number.format(summary.minutes)} min registrados</span></div><div class="breakdown">${Object.entries(TYPES).map(([key, type]) => { const count = summary.entries.filter(activity => activity.type === key).length; return `<div class="breakdown-row"><span class="activity-symbol ${type.color}">${icon(type.icon)}</span><span>${type.label}</span><div class="breakdown-bar"><span style="width:${summary.sessions ? count / summary.sessions * 100 : 0}%"></span></div><span>${count} ${['barre', 'heat'].includes(key) ? 'clases' : 'sesiones'}</span></div>`; }).join('')}</div><div class="section-heading"><h2>Historial</h2><label class="field" style="margin:0;max-width:145px"><span class="sr-only" hidden>Filtrar actividad</span><select id="history-filter" aria-label="Filtrar actividad" style="font-size:11px;padding:10px"><option value="all">Todas</option>${Object.entries(TYPES).map(([key, type]) => `<option value="${key}" ${filter === key ? 'selected' : ''}>${type.label}</option>`).join('')}</select></label></div><div class="history">${visible.length ? visible.map(activity => activityRow(activity, true)).join('') : '<div class="empty-state"><h3>Sin actividades</h3><p>No hay actividades en este periodo.</p></div>'}</div>`;
}

function openSheet(title, content, footer = '', eyebrow = '') {
  if (!sheet.open) modalOpener = document.activeElement;
  sheetDirty = false;
  sheetBody.innerHTML = `<header class="sheet-header"><div>${eyebrow ? `<p class="eyebrow">${escape(eyebrow)}</p>` : ''}<h2 id="sheet-title">${escape(title)}</h2></div><button class="icon-button" data-action="close-sheet" aria-label="Cerrar" title="Cerrar">${icon('x')}</button></header>${content}${footer}`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  icons();
}

const discardDialog = document.querySelector('#discard-dialog');
let afterDiscard = null;

function closeSheet(force = false, continuation = null) {
  if (!force && (sheetDirty || document.querySelector('#activity-form'))) {
    if (!discardDialog.open) { afterDiscard = continuation; discardDialog.showModal(); }
    return false;
  }
  if (discardDialog.open) discardDialog.close();
  afterDiscard = null;
  sheet.close();
  sheetDirty = false;
  if (pendingExternalData) {
    data = pendingExternalData;
    pendingExternalData = null;
    render();
  }
  if (modalOpener?.isConnected) modalOpener.focus();
  queueMicrotask(showRewardNotification);
  return true;
}

function field(label, name, value, type = 'text', extra = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escape(value ?? '')}" ${extra}></label>`;
}

function openActivity(type = 'barre', existing = null, routine = null) {
  activityDraft = existing ? structuredClone(existing) : {
    id: crypto.randomUUID(), date: selectedDate, type, calories: null,
    minutes: ['barre', 'heat'].includes(type) ? 60 : null, meters: null, notes: '',
    title: routine?.name || '', exercises: structuredClone(routine?.exercises || []), updatedAt: new Date().toISOString(),
  };
  activityDraft.editing = Boolean(existing);
  activityForm();
}

function activityForm() {
  const draft = activityDraft;
  const fixed = ['barre', 'heat'].includes(draft.type);
  const content = `<form id="activity-form"><div class="sheet-content"><label class="field"><span>Actividad</span><select name="type" id="activity-type">${Object.entries(TYPES).map(([key, type]) => `<option value="${key}" ${draft.type === key ? 'selected' : ''}>${type.label}</option>`).join('')}</select></label>${field('Fecha', 'date', draft.date, 'date', `required max="${today}"`)}${fixed ? `<div class="fixed-duration">${icon('clock-3')}Una clase · 60 minutos</div>` : ''}<div class="field-row">${field('Calorías activas <small>opcional</small>', 'calories', draft.calories, 'number', 'min="0" max="10000" step="1" inputmode="numeric" placeholder="—"')}${fixed ? '' : field('Duración <small>min</small>', 'minutes', draft.minutes, 'number', 'min="1" max="1440" step="1" inputmode="numeric" placeholder="—"')}</div>${['swim', 'cardio'].includes(draft.type) ? field('Distancia <small>metros · opcional</small>', 'meters', draft.meters, 'number', 'min="0" max="1000000" step="1" inputmode="numeric" placeholder="—"') : ''}${['gym', 'cardio'].includes(draft.type) ? field(draft.type === 'cardio' ? 'Tipo de cardio' : 'Nombre de la sesión <small>opcional</small>', 'title', draft.title, 'text', `maxlength="150" placeholder="${draft.type === 'cardio' ? 'Caminata, bici…' : 'Mi sesión de hoy'}"`) : ''}${draft.type === 'gym' && data.routines.length ? `<label class="field"><span>Rutina <small>opcional</small></span><select id="activity-routine"><option value="">${draft.exercises.length ? `${draft.exercises.length} ejercicios guardados en esta sesión` : 'Sin rutina'}</option>${data.routines.map(routine => `<option value="${escape(routine.id)}">${escape(routine.name)}</option>`).join('')}</select></label>` : ''}${draft.type === 'gym' && draft.exercises.length ? `<div class="notice" style="margin-bottom:20px">${draft.exercises.map(exercise => `${escape(exercise.name)} · ${exercise.sets} × ${escape(exercise.target)}`).join('<br>')}</div>` : ''}<label class="field"><span>Notas <small>opcional</small></span><textarea name="notes" maxlength="4000" placeholder="Notas de la actividad">${escape(draft.notes)}</textarea></label><p id="form-error" class="form-error" role="alert"></p></div><footer class="sheet-footer">${draft.editing ? `<button type="button" class="danger-button" data-action="delete-activity" aria-label="Eliminar actividad" title="Eliminar actividad">${icon('trash-2')}</button>` : ''}<button type="submit" class="primary-button">${icon('check')}${draft.editing ? 'Guardar cambios' : 'Guardar actividad'}</button></footer></form>`;
  openSheet(draft.editing ? 'Editar actividad' : 'Registrar actividad', content, '', data.demo ? 'DATOS DE EJEMPLO' : 'MI DIARIO');
  if (draft.workout) {
    document.querySelector('#activity-type').disabled = true;
    document.querySelector('#activity-routine')?.closest('label').remove();
  }
}

function readActivityForm() {
  const form = document.querySelector('#activity-form');
  if (!form) return;
  const fields = new FormData(form);
  const type = activityDraft.workout ? 'gym' : fields.get('type');
  Object.assign(activityDraft, {
    date: fields.get('date'), type, calories: nullable(fields.get('calories')),
    minutes: ['barre', 'heat'].includes(type) ? 60 : nullable(fields.get('minutes')),
    meters: ['swim', 'cardio'].includes(type) ? nullable(fields.get('meters')) : null,
    title: fields.get('title') || '', notes: fields.get('notes') || '',
  });
}

function saveActivity(event) {
  event.preventDefault();
  readActivityForm();
  try {
    const { editing, ...activity } = activityDraft;
    if (activity.date > today) throw new Error('Elige hoy o un día pasado para registrar una actividad realizada.');
    activity.updatedAt = new Date().toISOString();
    if (activity.workout) { activity.workout.date = activity.date; activity.workout.title = activity.title; }
    if (activity.type !== 'gym') activity.exercises = [];
    if (!commit(unlockRewards(upsertActivity(data, activity), today))) return;
    selectedDate = activity.date;
    calendarAnchor = selectedDate;
    closeSheet(true);
    render();
    toast(editing ? 'Cambios guardados en este dispositivo.' : 'Actividad guardada.');
    showRewardNotification();
  } catch (error) { document.querySelector('#form-error').textContent = error.message; }
}

function deleteActivity() {
  const activity = data.activities.find(item => item.id === activityDraft.id);
  if (!activity) return;
  const next = structuredClone(data);
  next.activities = next.activities.filter(item => item.id !== activity.id);
  if (!commit(next)) return;
  closeSheet(true);
  render();
  toast('Actividad eliminada.', () => { if (commit(upsertActivity(data, activity))) { render(); toast('Actividad restaurada.'); } });
}

function routineDetails(routine) {
  if (!routine) return;
  routineDraft = structuredClone(routine);
  openSheet(routine.name, `<div class="sheet-content">${routine.exercises.map((exercise, index) => `<section class="exercise-detail"><p class="eyebrow">EJERCICIO ${index + 1}</p><h3>${escape(exercise.name)}</h3><div class="exercise-meta">${exercise.sets} series · ${escape(exercise.target)}</div><p>${escape(exercise.note)}</p>${safeUrl(exercise.url) ? `<a href="${escape(safeUrl(exercise.url))}" target="_blank" rel="noopener noreferrer">Ver referencia${icon('external-link')}</a>` : ''}</section>`).join('') || '<p class="muted-copy">Aún no hay ejercicios.</p>'}</div>`, `<footer class="sheet-footer"><button class="secondary-button" data-action="edit-routine" data-id="${escape(routine.id)}" aria-label="Editar rutina" title="Editar rutina">${icon('pencil')}</button><button class="primary-button" data-action="record-routine" data-id="${escape(routine.id)}">${icon('play')}Iniciar sesión</button></footer>`, `${routine.exercises.length} EJERCICIOS`);
}

function newExercise() { return { id: crypto.randomUUID(), name: '', sets: 3, target: '', note: '', url: '' }; }

function appendRoutineHistory(routine) {
  const history = data.activities.filter(activity => activity.workout?.routineId === routine.id).sort((left, right) => right.date.localeCompare(left.date));
  document.querySelector('#sheet .sheet-content').insertAdjacentHTML('beforeend', `<section class="routine-history"><h3>Historial · ${history.length} sesiones</h3>${history.map(activity => `<button class="history-entry" data-action="view-session" data-id="${escape(activity.id)}"><strong>${escape(formatDate(activity.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</strong><small>${activity.workout.entries.flatMap(entry => entry.sets).filter(set => set.done).length} series completadas · ${escape(activity.workout.unit)}</small></button>`).join('') || '<p class="muted-copy">Sin sesiones registradas.</p>'}</section>`);
}

function editRoutine(existing = null) {
  routineDraft = existing ? structuredClone(existing) : { id: crypto.randomUUID(), name: '', note: '', exercises: [newExercise()] };
  routineForm();
}

function routineForm() {
  const draft = routineDraft;
  openSheet(data.routines.some(routine => routine.id === draft.id) ? 'Editar mi rutina' : 'Nueva rutina', `<form id="routine-form"><div class="sheet-content">${field('Nombre', 'name', draft.name, 'text', 'required maxlength="150" placeholder="Mi rutina de hoy"')}<div id="exercise-fields">${draft.exercises.map((exercise, index) => `<section class="exercise-editor"><div class="exercise-heading"><span>EJERCICIO ${index + 1}</span><div class="exercise-controls"><button type="button" class="icon-button" data-action="move-exercise" data-index="${index}" data-direction="-1" aria-label="Subir ejercicio ${index + 1}" title="Subir" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button type="button" class="icon-button" data-action="move-exercise" data-index="${index}" data-direction="1" aria-label="Bajar ejercicio ${index + 1}" title="Bajar" ${index === draft.exercises.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button><button type="button" class="icon-button" data-action="remove-exercise" data-index="${index}" aria-label="Quitar ejercicio ${index + 1}" title="Quitar">${icon('trash-2')}</button></div></div>${field('Ejercicio', `exercise-name-${index}`, exercise.name, 'text', 'required maxlength="150" placeholder="Nombre del ejercicio"')}<div class="field-row">${field('Series', `exercise-sets-${index}`, exercise.sets, 'number', 'required min="1" max="30" step="1" inputmode="numeric"')}${field('Repeticiones o tiempo', `exercise-target-${index}`, exercise.target, 'text', 'maxlength="100" placeholder="12 reps o 30 s"')}</div><label class="field"><span>Cómo lo hago <small>opcional</small></span><textarea name="exercise-note-${index}" maxlength="4000" placeholder="Mis indicaciones para recordarlo">${escape(exercise.note)}</textarea></label>${field('Enlace de referencia <small>opcional</small>', `exercise-url-${index}`, exercise.url, 'url', 'maxlength="2000" placeholder="https://…"')}</section>`).join('')}</div><button type="button" class="text-button" data-action="add-exercise">${icon('plus')}Añadir ejercicio</button><p id="form-error" class="form-error" role="alert"></p></div><footer class="sheet-footer">${data.routines.some(routine => routine.id === draft.id) ? `<button type="button" class="danger-button" data-action="delete-routine" aria-label="Eliminar rutina" title="Eliminar rutina">${icon('trash-2')}</button>` : ''}<button class="primary-button" type="submit">${icon('check')}Guardar rutina</button></footer></form>`);
}

function readRoutineForm() {
  const form = document.querySelector('#routine-form');
  if (!form) return;
  const fields = new FormData(form);
  routineDraft.name = fields.get('name') || '';
  routineDraft.exercises = routineDraft.exercises.map((exercise, index) => ({ id: exercise.id || crypto.randomUUID(), name: fields.get(`exercise-name-${index}`) || '', sets: Number(fields.get(`exercise-sets-${index}`)), target: fields.get(`exercise-target-${index}`) || '', note: fields.get(`exercise-note-${index}`) || '', url: fields.get(`exercise-url-${index}`) || '' }));
}

function saveRoutine(event) {
  event.preventDefault();
  readRoutineForm();
  if (!routineDraft.exercises.length) { document.querySelector('#form-error').textContent = 'Añade al menos un ejercicio.'; return; }
  const next = structuredClone(data);
  const index = next.routines.findIndex(routine => routine.id === routineDraft.id);
  if (index < 0) next.routines.push(routineDraft); else next.routines[index] = routineDraft;
  if (!commit(next)) return;
  closeSheet(true);
  render();
  toast('Rutina guardada. Tus sesiones anteriores no cambian.');
}

function settingsSheet() {
  openSheet('Ajustes', `<div class="sheet-content"><section class="settings-group"><div class="settings-row"><span>Cristina</span><span class="preview-tag">${data.demo ? 'Vista previa' : cloud?.account ? 'Cuenta' : 'Local'}</span></div><p class="muted-copy">${escape(cloud?.label || 'Solo en este dispositivo')}</p><button class="text-button" data-action="cloud-account">${icon('cloud')}Mi cuenta</button></section><section class="settings-group"><h3>Mis preferencias</h3><div class="settings-row"><span>Unidad de peso</span><div class="segmented" role="group" aria-label="Unidad de peso">${['kg', 'lb'].map(unit => `<button data-action="unit" data-unit="${unit}" class="${data.settings.unit === unit ? 'active' : ''}" aria-pressed="${data.settings.unit === unit}">${unit}</button>`).join('')}</div></div><p class="muted-copy">Español · Inglés en una próxima entrega.</p></section><section class="settings-group"><h3>Mi respaldo</h3><p class="muted-copy">Guarda una copia en Archivos o iCloud antes de borrar los datos del navegador o cambiar de teléfono.</p><div class="settings-buttons"><button class="secondary-button" data-action="export-backup">${icon('download')}Exportar</button><button class="secondary-button" data-action="import-backup">${icon('upload')}Importar</button></div><input type="file" id="backup-file" accept="application/json,.json" hidden></section><section class="settings-group"><h3>Recompensas</h3><button class="text-button" data-action="manage-rewards">Editar recompensas</button></section><section class="settings-group"><h3>Sonido del temporizador</h3><p class="muted-copy">Audio multimedia, como en REAWAKEN.</p><button class="text-button" data-action="test-sound">${icon('volume-2')}Probar sonido</button></section>${data.demo ? '<section class="settings-group"><h3>Datos de ejemplo</h3><button class="text-button" data-action="start-empty">Empezar mi diario vacío</button></section>' : ''}<p class="muted-copy" style="margin-top:20px">Cristina · versión ${VERSION}</p></div>`);
  if (cloud?.account) {
    const status = sheetBody.querySelector('.settings-group .muted-copy');
    status.insertAdjacentHTML('beforebegin', `<p class="settings-email">${escape(cloud.account.email)}</p>`);
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportBackup() {
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `cristina-respaldo-${dateKey()}.json`);
  toast('Respaldo preparado para guardar.');
}

async function importFile(file) {
  if (!file) return;
  if (data.activeWorkout) { toast('Finaliza o descarta la sesión en curso antes de restaurar un respaldo.'); return; }
  if (file.size > 15 * 1024 * 1024) { toast('El archivo supera el límite de 15 MB.'); return; }
  try {
    pendingImport = validateStore(JSON.parse(await file.text()));
    openSheet('Restaurar mi diario', `<div class="sheet-content"><p class="muted-copy">${escape(file.name)}</p><div class="backup-summary"><div><strong>${pendingImport.activities.length}</strong><small>actividades</small></div><div><strong>${pendingImport.routines.length}</strong><small>rutinas</small></div></div><p class="import-warning">Este respaldo reemplazará el diario local actual (${data.activities.length} actividades). No se mezclan datos ni se crean duplicados. Exporta una copia de lo actual antes de continuar.</p><button class="text-button" data-action="export-backup">${icon('download')}Guardar copia actual</button><p class="muted-copy">${pendingImport.demo ? 'El archivo contiene datos de ejemplo.' : 'El archivo contiene un diario personal.'}</p></div>`, '<footer class="sheet-footer"><button class="secondary-button" data-action="close-sheet">Cancelar</button><button class="primary-button" data-action="confirm-import">Restaurar respaldo</button></footer>');
  } catch (error) { toast(error instanceof SyntaxError ? 'No se pudo leer el archivo JSON. No se cambió nada.' : error.message); }
}

function persistTimer() {
  try { sessionStorage.setItem(timerKey, JSON.stringify(timer)); } catch {}
}

function stopSound() {
  for (const oscillator of activeTones) { try { oscillator.stop(); } catch {} }
  activeTones.clear();
  restoreAudio();
}

function restoreAudio() {
  if (previousAudioType === null) return;
  try { navigator.audioSession.type = previousAudioType; } catch {}
  previousAudioType = null;
}

async function prepareSound() {
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    if (navigator.audioSession) {
      if (previousAudioType === null) previousAudioType = navigator.audioSession.type;
      navigator.audioSession.type = 'playback';
    }
    if (!audioContext || audioContext.state === 'closed') audioContext = new Context();
    if (audioContext.state !== 'running') await audioContext.resume();
  } catch { restoreAudio(); }
}

function playSound() {
  if (audioContext?.state !== 'running') { restoreAudio(); return; }
  try {
    for (let tone = 0; tone < 3; tone++) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = audioContext.currentTime + tone * .65;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.06, at + .02);
      gain.gain.exponentialRampToValueAtTime(.001, at + .45);
      gain.gain.linearRampToValueAtTime(0, at + .5);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      activeTones.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (activeTones.delete(oscillator) && !activeTones.size) restoreAudio(); };
      oscillator.start(at);
      oscillator.stop(at + .5);
    }
  } catch { stopSound(); }
}

function timerValue() {
  if (timer.mode === 'stopwatch') return timer.running ? timer.elapsed + Math.floor((Date.now() - timer.startedAt) / 1000) : timer.elapsed;
  return timer.running ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : timer.remaining;
}

function timeLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function timerSheet() {
  if (!data.activeWorkout) return;
  openSheet('Temporizador', `<div class="sheet-content"><div class="segmented" role="group" aria-label="Modo de temporizador">${[['rest', 'Temporizador'], ['stopwatch', 'Cronómetro']].map(([mode, label]) => `<button class="${timer.mode === mode ? 'active' : ''}" data-action="timer-mode" data-mode="${mode}" aria-pressed="${timer.mode === mode}">${label}</button>`).join('')}</div><div class="timer-display" id="timer-display">${timeLabel(timerValue())}</div><p class="timer-label" id="timer-label">${timer.running ? 'En curso' : timer.finished ? 'Tiempo completado.' : 'Listo'}</p><div class="timer-actions"><button class="secondary-button" data-action="timer-reset" aria-label="Reiniciar temporizador" title="Reiniciar">${icon('rotate-ccw')}</button><button class="primary-button" data-action="timer-toggle" id="timer-toggle">${icon(timer.running ? 'pause' : 'play')}${timer.running ? 'Pausar' : 'Iniciar'}</button></div>${timer.mode !== 'stopwatch' ? `<div class="timer-presets">${[30, 45, 60, 90].map(seconds => `<button class="${timer.duration === seconds ? 'active' : ''}" data-action="timer-preset" data-seconds="${seconds}">${seconds} s</button>`).join('')}</div><form id="timer-custom-form"><div class="field-row" style="align-items:end">${field('Otro tiempo <small>segundos</small>', 'seconds', timer.duration, 'number', 'required min="1" max="7200" step="1" inputmode="numeric"')}<button type="submit" class="secondary-button" style="margin-bottom:20px">Aplicar</button></div></form>` : ''}</div>`);
  updateTimer();
}

function updateTimer() {
  const value = timerValue();
  if (timer.running && timer.mode !== 'stopwatch' && value === 0) {
    timer.running = false;
    timer.remaining = 0;
    timer.finished = true;
    persistTimer();
    playSound();
    toast(timer.mode === 'rest' ? 'Descanso completado.' : 'Tiempo completado.');
    if (sheet.open && document.querySelector('#timer-display')) timerSheet();
  }
  const display = document.querySelector('#timer-display');
  if (display) display.textContent = timeLabel(value);
  document.querySelector('#timer-chip-time').textContent = timeLabel(value);
  document.querySelector('#timer-chip').hidden = !timer.running || !showingWorkout || !data.activeWorkout;
}

function setTimerDuration(seconds, remember = true) {
  stopSound();
  timer.duration = seconds;
  timer.remaining = seconds;
  timer.running = false;
  timer.finished = false;
  persistTimer();
  if (timer.mode === 'rest' && remember) {
    const next = structuredClone(data);
    next.settings.rest = seconds;
    commit(next);
  }
  timerSheet();
}

async function shareSheet() {
  const summary = summarize(data, period, progressAnchor);
  openSheet('Compartir resumen', '<div class="sheet-content"><canvas id="share-canvas" class="share-preview" width="1080" height="1920" aria-label="Imagen de mi resumen" role="img"></canvas><p class="image-size">Instagram Story · 1080 × 1920 px</p></div>', `<footer class="sheet-footer"><button class="secondary-button" data-action="download-share" aria-label="Guardar imagen" title="Guardar imagen">${icon('download')}</button><button class="primary-button" data-action="native-share">${icon('share-2')}Compartir imagen</button></footer>`);
  await document.fonts.ready;
  const canvas = document.querySelector('#share-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.fillStyle = '#faf8fc'; context.fillRect(0, 0, 1080, 1920);
  context.translate(0, 200);
  context.fillStyle = '#eee5f5'; context.fillRect(0, 0, 1080, 15);
  context.fillStyle = '#79618e'; context.font = '52px Georgia'; context.fillText('cristina.', 90, 145);
  context.fillStyle = '#998ca5'; context.font = '20px Manrope'; context.fillText(progressTitle().toUpperCase(), 90, 222);
  context.fillStyle = '#352e3d'; context.font = '86px Georgia'; context.fillText('Mi actividad.', 90, 368);
  context.fillStyle = '#84778d'; context.font = '27px Manrope'; context.fillText('Resumen de actividad', 93, 428);
  context.strokeStyle = '#ded5e6'; context.beginPath(); context.moveTo(90, 493); context.lineTo(990, 493); context.stroke();
  const cells = [[summary.sessions, 'actividades', 90, 645], [summary.days, 'días activos', 600, 645], [number.format(summary.calories), summary.missingCalories ? 'kcal registradas*' : 'kcal activas', 90, 850], [number.format(summary.meters), 'metros nadados', 600, 850]];
  for (const [value, label, left, top] of cells) {
    context.fillStyle = '#705286'; context.font = '78px Georgia'; context.fillText(String(value), left, top, 380);
    context.fillStyle = '#897e91'; context.font = '24px Manrope'; context.fillText(label, left, top + 47);
  }
  context.strokeStyle = '#ded5e6'; context.beginPath(); context.moveTo(90, 985); context.lineTo(990, 985); context.stroke();
  context.fillStyle = '#8a779c'; context.font = 'italic 37px Georgia'; context.fillText('Cristina · Diario de actividad', 90, 1080, 900);
  context.fillStyle = '#a295aa'; context.font = '20px Manrope';
  context.fillText(data.demo ? 'VISTA PREVIA · DATOS DE EJEMPLO' : 'MI DIARIO DE MOVIMIENTO', 90, 1230);
  if (summary.missingCalories) context.fillText('* Hay actividades sin calorías registradas.', 90, 1280);
  shareBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function moveCalendar(direction) {
  if (expandedCalendar) {
    const date = parseDate(calendarAnchor);
    calendarAnchor = dateKey(new Date(date.getFullYear(), date.getMonth() + direction, 1));
  } else calendarAnchor = shiftDate(calendarAnchor, direction * 14);
  render();
}

function moveProgress(direction) {
  const date = parseDate(progressAnchor);
  progressAnchor = period === 'week' ? shiftDate(progressAnchor, direction * 7) : period === 'month' ? dateKey(new Date(date.getFullYear(), date.getMonth() + direction, 1)) : dateKey(new Date(date.getFullYear() + direction, 0, 1));
  render();
}

function navigate(next) {
  if (sheet.open && !closeSheet(false, () => navigate(next))) return;
  showingWorkout = false;
  view = next;
  history.replaceState(null, '', `#${view}`);
  render();
  scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.nav) { navigate(button.dataset.nav); return; }
  const action = button.dataset.action;
  if (!action) return;
  if (await training.action(action, button)) return;
  if (await rewardsUI.action(action, button)) return;
  if (await cloud.action(action, button)) return;
  switch (action) {
    case 'settings': settingsSheet(); break;
    case 'close-sheet': closeSheet(); break;
    case 'discard-stay': discardDialog.close(); afterDiscard = null; break;
    case 'discard-leave': { const continuation = afterDiscard; closeSheet(true); continuation?.(); break; }
    case 'select-day': selectedDate = button.dataset.date; render(); break;
    case 'calendar-prev': moveCalendar(-1); break;
    case 'calendar-next': moveCalendar(1); break;
    case 'toggle-calendar': expandedCalendar = !expandedCalendar; render(); break;
    case 'new-activity': openActivity(button.dataset.type || 'barre'); break;
    case 'edit-activity': openActivity(null, data.activities.find(activity => activity.id === button.dataset.id)); break;
    case 'delete-activity': deleteActivity(); break;
    case 'show-progress': navigate('progress'); break;
    case 'set-period': period = button.dataset.period; render(); break;
    case 'progress-prev': moveProgress(-1); break;
    case 'progress-next': moveProgress(1); break;
    case 'new-routine': editRoutine(); break;
    case 'open-routine': { const routine = data.routines.find(item => item.id === button.dataset.id); routineDetails(routine); appendRoutineHistory(routine); break; }
    case 'edit-routine': editRoutine(data.routines.find(routine => routine.id === button.dataset.id)); break;
    case 'record-routine': {
      if (data.activeWorkout) { closeSheet(true); showingWorkout = true; render(); break; }
      const routine = data.routines.find(item => item.id === button.dataset.id);
      if (!routine?.exercises.length) { toast('Añade ejercicios a la rutina primero.'); break; }
      const next = structuredClone(data);
      next.activeWorkout = startWorkout(data, routine);
      if (commit(next)) { closeSheet(true); showingWorkout = true; view = 'routines'; render(); }
      break;
    }
    case 'add-exercise': readRoutineForm(); if (routineDraft.exercises.length >= 100) { toast('Máximo 100 ejercicios por rutina.'); break; } routineDraft.exercises.push(newExercise()); routineForm(); sheetDirty = true; document.querySelectorAll('.exercise-editor').item(routineDraft.exercises.length - 1)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); break;
    case 'remove-exercise': readRoutineForm(); routineDraft.exercises.splice(Number(button.dataset.index), 1); routineForm(); sheetDirty = true; break;
    case 'move-exercise': {
      readRoutineForm();
      const index = Number(button.dataset.index);
      const target = index + Number(button.dataset.direction);
      if (target >= 0 && target < routineDraft.exercises.length) [routineDraft.exercises[index], routineDraft.exercises[target]] = [routineDraft.exercises[target], routineDraft.exercises[index]];
      routineForm(); sheetDirty = true; break;
    }
    case 'delete-routine': {
      const routine = data.routines.find(item => item.id === routineDraft.id);
      const next = structuredClone(data);
      next.routines = next.routines.filter(item => item.id !== routine.id);
      if (!commit(next)) break;
      closeSheet(true); render();
      toast('Rutina eliminada. Las sesiones se conservan.', () => { const restored = structuredClone(data); restored.routines.push(routine); if (commit(restored)) { render(); toast('Rutina restaurada.'); } });
      break;
    }
    case 'unit': { const next = structuredClone(data); next.settings.unit = button.dataset.unit; if (commit(next)) settingsSheet(); break; }
    case 'export-backup': exportBackup(); break;
    case 'import-backup': document.querySelector('#backup-file')?.click(); break;
    case 'confirm-import': if (pendingImport && commit(pendingImport)) { pendingImport = null; closeSheet(true); render(); toast('Respaldo restaurado, sin duplicados.'); } break;
    case 'start-empty': openSheet('Empezar un diario vacío', '<div class="sheet-content"><p class="muted-copy">Se quitarán los datos de ejemplo y cualquier cambio que hayas hecho en esta vista previa. Tus preferencias se conservan.</p><button class="text-button" data-action="export-backup">Guardar una copia antes</button></div>', '<footer class="sheet-footer"><button class="secondary-button" data-action="close-sheet">Cancelar</button><button class="primary-button" data-action="confirm-empty">Empezar vacío</button></footer>'); break;
    case 'confirm-empty': if (data.activeWorkout) { toast('Finaliza o descarta la sesión antes de vaciar el diario.'); break; } if (commit(emptyStore(data.settings))) { closeSheet(true); navigate('diary'); toast('Diario vacío creado.'); } break;
    case 'undo': { const undo = undoAction; undoAction = null; if (undo) undo(); break; }
    case 'raw-backup': { try { download(new Blob([localStorage.getItem(STORAGE_KEY) || ''], { type: 'application/json' }), 'cristina-recuperacion-local.json'); } catch { toast('El navegador no permite leer el almacenamiento.'); } break; }
    case 'timer': if (!data.activeWorkout || !showingWorkout) break; if (sheetDirty && !confirm('¿Descartar los cambios y abrir el temporizador?')) break; timerSheet(); break;
    case 'timer-mode': stopSound(); timer = { ...timer, mode: button.dataset.mode, running: false, elapsed: 0, remaining: timer.duration, finished: false }; persistTimer(); timerSheet(); break;
    case 'timer-preset': setTimerDuration(Number(button.dataset.seconds)); break;
    case 'timer-reset': stopSound(); timer.running = false; timer.remaining = timer.duration; timer.elapsed = 0; timer.finished = false; persistTimer(); timerSheet(); break;
    case 'timer-toggle': {
      if (timer.running) {
        if (timer.mode === 'stopwatch') timer.elapsed = timerValue(); else timer.remaining = timerValue();
        timer.running = false; stopSound();
      } else {
        if (timer.mode !== 'stopwatch') { if (timer.remaining === 0) timer.remaining = timer.duration; void prepareSound(); }
        timer.startedAt = Date.now(); timer.endsAt = Date.now() + timer.remaining * 1000; timer.running = true; timer.finished = false;
      }
      persistTimer(); timerSheet(); break;
    }
    case 'test-sound': stopSound(); await prepareSound(); playSound(); break;
    case 'share': shareBlob = null; await shareSheet(); break;
    case 'download-share': if (shareBlob) download(shareBlob, `cristina-${period}-${progressAnchor}.png`); else toast('La imagen aún se está preparando.'); break;
    case 'native-share': {
      if (!shareBlob) { toast('La imagen aún se está preparando.'); break; }
      const file = new File([shareBlob], `cristina-${progressAnchor}.png`, { type: 'image/png' });
      try {
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Mi resumen' });
        else { download(shareBlob, file.name); toast('Imagen preparada para guardar y compartir.'); }
      } catch (error) { if (error.name !== 'AbortError') toast('No se pudo compartir. Puedes guardar la imagen.'); }
      break;
    }
  }
});

document.addEventListener('submit', event => {
  if (training.submit(event) || rewardsUI.submit(event) || cloud.submit(event)) return;
  if (event.target.id === 'activity-form') saveActivity(event);
  else if (event.target.id === 'routine-form') saveRoutine(event);
  else if (event.target.id === 'timer-custom-form') { event.preventDefault(); const seconds = Number(new FormData(event.target).get('seconds')); if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 7200) setTimerDuration(seconds); }
});

document.addEventListener('change', event => {
  if (training.change(event)) return;
  if (event.target.id === 'activity-type') {
    const before = activityDraft.type;
    readActivityForm();
    if (['barre', 'heat'].includes(before) && !['barre', 'heat'].includes(activityDraft.type)) activityDraft.minutes = null;
    activityForm(); sheetDirty = true;
  } else if (event.target.id === 'activity-routine' && event.target.value) {
    const routine = data.routines.find(item => item.id === event.target.value);
    readActivityForm(); activityDraft.exercises = structuredClone(routine.exercises); activityDraft.title = routine.name; activityForm(); sheetDirty = true;
  } else if (event.target.id === 'history-filter') { filter = event.target.value; render(); }
  else if (event.target.id === 'backup-file') { void importFile(event.target.files[0]); event.target.value = ''; }
});

document.addEventListener('input', event => { if (event.target.matches('[data-workout-input]')) training.change(event); });
discardDialog.addEventListener('cancel', event => { event.preventDefault(); discardDialog.close(); afterDiscard = null; });
sheet.addEventListener('input', event => { if (event.target.closest('form:not(#timer-custom-form)')) sheetDirty = true; });
sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
sheet.addEventListener('click', event => { if (event.target === sheet) { const bounds = sheet.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeSheet(); } });
addEventListener('hashchange', () => { const next = location.hash.slice(1); if (['diary', 'routines', 'progress'].includes(next)) navigate(next); });
addEventListener('storage', event => {
  if (event.key !== (cloud?.key() || STORAGE_KEY) || !event.newValue) return;
  try {
    const decoded = JSON.parse(event.newValue);
    const incoming = validateStore(cloud?.account ? decoded.payload : decoded);
    if (JSON.stringify(incoming) === JSON.stringify(data)) { cloud?.renderStatus(); return; }
    if (sheet.open && sheetDirty) {
      pendingExternalData = incoming;
      toast('El diario cambió en otra pestaña. Tu borrador sigue aquí; conserva tus notas antes de cerrar.');
      return;
    }
    data = incoming;
    if (sheet.open) { toast('El diario cambió en otra pestaña. Cierra y vuelve a abrir antes de editar.'); closeSheet(true); }
    render();
  } catch { toast('No se pudo leer un cambio de otra pestaña.'); }
});
addEventListener('beforeunload', event => { if (sheetDirty || (sheet.open && document.querySelector('#activity-form'))) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateTimer(); });
setInterval(updateTimer, 200);
function stopWorkoutTimer() {
  stopSound(); timer.running = false; timer.remaining = timer.duration; timer.elapsed = 0; timer.finished = false; persistTimer();
}

function showRewardNotification() {
  if (sheet.open || blocked || data.activeWorkout) return;
  const award = data.rewardAwards.find(item => !item.seen);
  if (!award) return;
  rewardsUI.celebrate(award);
}

const training = createTraining({ getData: () => data, commit, escape, icon, icons, openSheet, closeSheet, render, toast,
  setShowing: value => { showingWorkout = value; }, isShowing: () => showingWorkout,
  stopTimer: stopWorkoutTimer, notifyRewards: showRewardNotification,
  openTimer: seconds => { if (seconds) { timer.mode = 'rest'; setTimerDuration(seconds, false); } else timerSheet(); },
  openActivity,
});
const rewardsUI = createRewards({ getData: () => data, commit, escape, icon, icons, openSheet, closeSheet, render, toast, download });
cloud = createCloud({ getData: () => data, escape, icon, icons, openSheet, closeSheet, toast, download, goDiary: () => navigate('diary'),
  canSwitch: () => !sheet.open && !data.activeWorkout && !timer.running && !blocked,
  apply: incoming => { data = incoming; showingWorkout = false; pendingExternalData = null; stopWorkoutTimer(); render(); },
});
if (!data.activeWorkout) stopWorkoutTimer();
if (!blocked) {
  const earned = unlockRewards(data, today);
  if (earned.rewardAwards.length > data.rewardAwards.length) commit(earned);
}
render();
void cloud.start().finally(showRewardNotification);