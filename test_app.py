import json
import base64
import tempfile
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:60150/"
SCREENSHOTS = Path(tempfile.gettempdir()) / "cristina-preview-checks"


class DiaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel="msedge")
        SCREENSHOTS.mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 402, "height": 874}, device_scale_factor=1, reduced_motion="reduce")
        self.page = self.context.new_page()
        self.errors = []
        self.dialogs = []
        self.accept_dialogs = True
        self.page.on("dialog", self.handle_dialog)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(URL)
        self.page.wait_for_selector(".calendar-day")
        self.page.evaluate("""async () => {
            const model = await import('./store.js');
            const state = model.loadStore(); state.rewards = []; state.rewardAwards = [];
            model.saveStore(state);
        }""")
        self.page.reload()
        self.page.wait_for_selector(".calendar-day")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def stored(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('cristina.diary.preview.v1'))")

    def handle_dialog(self, dialog):
        self.dialogs.append(dialog.message)
        if self.accept_dialogs:
            dialog.accept()
        else:
            dialog.dismiss()

    def start_routine(self):
        self.page.locator('[data-nav="routines"]').click()
        self.page.locator('.routine-card').first.click()
        self.page.get_by_role('button', name='Iniciar sesión', exact=True).click()
        self.page.wait_for_selector('.workout')

    def test_domain_edit_and_summary(self):
        result = self.page.evaluate("""async () => {
          const model = await import('./store.js');
          let state = model.makeDemo('2026-09-24');
          const before = model.summarize(state, 'month', '2026-09-24');
          const activity = { ...state.activities[0], calories: 999, date: '2026-08-24' };
          state = model.upsertActivity(state, activity);
          const after = model.summarize(state, 'month', '2026-09-24');
          const august = model.summarize(state, 'month', '2026-08-24');
          const invalid = structuredClone(state);
          invalid.activities[0].calories = -1;
          let rejected = false;
          try { model.validateStore(invalid); } catch { rejected = true; }
          return { count: state.activities.length, before: before.calories, after: after.calories,
            august: august.calories, rejected, invalidDate: model.validDate('2026-02-30'),
            week: model.periodRange('week', '2026-01-01'),
            badUrl: model.safeUrl('javascript:alert(1)'),
            duplicateRejected: (() => { const dup = structuredClone(state); dup.activities.push(dup.activities[0]); try { model.validateStore(dup); return false; } catch { return true; } })() };
        }""")
        self.assertEqual(result["count"], 12)
        self.assertEqual(result["before"] - result["after"], 284)
        self.assertEqual(result["august"], 999)
        self.assertTrue(result["rejected"])
        self.assertFalse(result["invalidDate"])
        self.assertTrue(result["duplicateRejected"])
        self.assertEqual(result["badUrl"], "")
        self.assertEqual(result["week"], {"start": "2025-12-29", "end": "2026-01-04"})

    def test_edit_past_and_reload_delete_undo(self):
        original = self.page.locator('.activity-list .activity-row').first
        original.click()
        self.page.locator('[name="date"]').fill('2026-09-20')
        self.page.locator('[name="calories"]').fill('432')
        self.page.locator('[name="notes"]').fill('Corrección de prueba')
        self.page.get_by_role('button', name='Guardar cambios').click()
        state = self.stored()
        self.assertEqual(len(state['activities']), 12)
        changed = next(activity for activity in state['activities'] if activity['id'] == 'demo-0')
        self.assertEqual(changed['calories'], 432)
        self.assertEqual(changed['date'], '2026-09-20')
        self.page.reload()
        self.page.wait_for_selector('.calendar-day')
        self.assertEqual(self.stored(), state)
        self.page.locator('[data-date="2026-09-20"]').click()
        self.page.locator('[data-action="edit-activity"][data-id="demo-0"]').click()
        self.page.get_by_role('button', name='Eliminar actividad', exact=True).click()
        self.assertEqual(len(self.stored()['activities']), 11)
        self.page.get_by_role('button', name='Deshacer', exact=True).click()
        self.assertEqual(len(self.stored()['activities']), 12)

    def test_swim_cardio_and_optional_calories(self):
        self.page.locator('.quick-action[data-type="swim"]').click()
        self.page.locator('[name="meters"]').fill('1250')
        self.page.locator('[name="minutes"]').fill('40')
        self.page.get_by_role('button', name='Guardar actividad').click()
        state = self.stored()
        self.assertEqual(state['activities'][-1]['meters'], 1250)
        self.assertIsNone(state['activities'][-1]['calories'])
        self.page.locator('[data-nav="routines"]').click()
        self.page.locator('[data-type="cardio"]').click()
        self.page.locator('[name="title"]').fill('Bici')
        self.page.locator('[name="minutes"]').fill('20')
        self.page.get_by_role('button', name='Guardar actividad').click()
        self.assertEqual(self.stored()['activities'][-1]['type'], 'cardio')

    def test_routine_editor_snapshot_and_safe_text(self):
        self.page.locator('[data-nav="routines"]').click()
        self.page.get_by_role('button', name='Nueva rutina', exact=True).click()
        self.page.locator('[name="name"]').fill('Mi rutina de prueba')
        self.page.locator('[name="exercise-name-0"]').fill('Plancha <script>alert(1)</script>')
        self.page.locator('[name="exercise-target-0"]').fill('30 segundos')
        self.page.locator('[name="exercise-note-0"]').fill('Respirar con calma.')
        self.page.get_by_role('button', name='Guardar rutina', exact=True).click()
        self.page.get_by_role('button', name='Mi rutina de prueba', exact=False).click()
        self.page.get_by_role('button', name='Iniciar sesión').click()
        self.page.locator('.set-check').first.click()
        self.page.get_by_role('button', name='Finalizar sesión', exact=True).click()
        self.page.get_by_role('button', name='Guardar sesión', exact=True).click()
        state = self.stored()
        snapshot = state['activities'][-1]['exercises']
        self.page.get_by_role('button', name='Mi rutina de prueba', exact=False).click()
        self.page.get_by_role('button', name='Editar rutina', exact=True).click()
        self.page.locator('[name="exercise-name-0"]').fill('Plancha lateral')
        self.page.get_by_role('button', name='Guardar rutina', exact=True).click()
        self.assertEqual(self.stored()['activities'][-1]['exercises'], snapshot)
        self.assertEqual(self.stored()['routines'][-1]['exercises'][0]['name'], 'Plancha lateral')

    def test_backup_import_repeated_invalid_atomic(self):
        backup = self.page.evaluate("async () => (await import('./store.js')).makeDemo('2026-09-24')")
        backup['activities'][0]['calories'] = 777
        for _ in range(2):
            self.page.locator('.mobile-settings').click()
            self.page.locator('#backup-file').set_input_files({"name": "test.json", "mimeType": "application/json", "buffer": json.dumps(backup).encode()})
            self.page.get_by_role('button', name='Restaurar respaldo', exact=True).click()
            self.assertEqual(len(self.stored()['activities']), 12)
            self.assertEqual(self.stored()['activities'][0]['calories'], 777)
        before = self.stored()
        self.page.locator('.mobile-settings').click()
        self.page.locator('#backup-file').set_input_files({"name": "bad.json", "mimeType": "application/json", "buffer": b'{"version":999}'})
        self.page.get_by_role('status').filter(has_text='respaldo compatible').wait_for()
        self.assertEqual(self.stored(), before)
        with self.page.expect_download() as pending:
            self.page.get_by_role('button', name='Exportar', exact=True).click()
        download = pending.value
        exported = json.loads(Path(download.path()).read_text(encoding='utf-8'))
        self.assertEqual(exported, before)
        self.assertNotIn('access_token', json.dumps(exported))

    def test_timer_countdown_pause_and_reload(self):
        self.start_routine()
        self.page.get_by_role('button', name='Abrir temporizador', exact=True).click()
        self.page.locator('[name="seconds"]').fill('2')
        self.page.get_by_role('button', name='Aplicar', exact=True).click()
        self.page.get_by_role('button', name='Iniciar', exact=True).click()
        self.page.get_by_text('Tiempo completado.', exact=True).wait_for(timeout=6000)
        self.assertEqual(self.page.locator('#timer-display').inner_text(), '00:00')
        self.page.get_by_role('button', name='Cronómetro', exact=True).click()
        self.page.get_by_role('button', name='Iniciar', exact=True).click()
        self.page.wait_for_function("document.querySelector('#timer-display').textContent !== '00:00'")
        self.page.get_by_role('button', name='Pausar', exact=True).click()
        elapsed = self.page.locator('#timer-display').inner_text()
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.reload()
        self.page.locator('[data-action="resume-workout"]').click()
        self.page.get_by_role('button', name='Abrir temporizador', exact=True).click()
        self.assertEqual(self.page.locator('#timer-display').inner_text(), elapsed)

    def test_external_change_preserves_unsaved_draft(self):
        self.page.locator('.activity-list .activity-row').first.click()
        self.page.locator('[name="notes"]').fill('Borrador que no debe perderse')
        other = self.context.new_page()
        other.goto(URL)
        other.wait_for_selector('.calendar-day')
        other.evaluate("""async () => {
          const model = await import('./store.js');
          const state = model.loadStore();
          state.activities[0].calories = 888;
          model.saveStore(state);
        }""")
        self.page.get_by_role('status').filter(has_text='Tu borrador sigue aquí').wait_for()
        self.assertEqual(self.page.locator('[name="notes"]').input_value(), 'Borrador que no debe perderse')
        self.page.get_by_role('button', name='Guardar cambios').click()
        self.assertEqual(self.stored()['activities'][0]['calories'], 888)
        self.assertTrue(self.page.locator('#sheet').is_visible())
        other.close()

    def test_share_pixels_and_download(self):
        self.page.locator('[data-nav="progress"]').click()
        self.page.get_by_role('button', name='Compartir resumen', exact=True).click()
        self.page.wait_for_function("document.querySelector('#share-canvas').getContext('2d').getImageData(0,0,1,1).data[3] === 255")
        pixels = self.page.locator('#share-canvas').evaluate("canvas => { const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; const colors = new Set(); for(let index=0; index<data.length; index+=128) colors.add(`${data[index]},${data[index+1]},${data[index+2]}`); return colors.size; }")
        self.assertGreater(pixels, 30)
        self.assertEqual(self.page.locator('#share-canvas').get_attribute('height'), '1920')
        with self.page.expect_download() as pending:
            self.page.get_by_role('button', name='Guardar imagen', exact=True).click()
        self.assertTrue(pending.value.suggested_filename.endswith('.png'))

    def test_responsive_views_and_screenshots(self):
        self.assertEqual(self.page.locator('meta[name="apple-mobile-web-app-title"]').get_attribute('content'), 'Cri')
        manifest = self.page.request.get(URL + 'manifest.webmanifest').json()
        self.assertEqual((manifest['name'], manifest['short_name']), ('Cri', 'Cri'))
        self.assertEqual((manifest['start_url'], manifest['scope']), ('./', './'))
        for width, height in [(320, 740), (402, 874), (768, 1024), (1440, 960)]:
            self.page.set_viewport_size({"width": width, "height": height})
            for view in ['diary', 'routines', 'progress']:
                self.page.locator(f'[data-nav="{view}"]').click()
                self.page.evaluate('document.fonts.ready')
                overflow = self.page.evaluate('document.documentElement.scrollWidth > innerWidth')
                self.assertFalse(overflow, f'{width}/{view}: horizontal overflow')
                self.assertGreater(self.page.locator('svg.lucide').count(), 5)
                self.page.screenshot(path=str(SCREENSHOTS / f'{view}-{width}.png'), full_page=True)
            self.page.locator('[data-nav="diary"]').click()
            self.page.locator('.quick-action[data-type="barre"]').click()
            self.assertTrue(self.page.get_by_role('button', name='Guardar actividad').is_visible())
            self.assertFalse(self.page.locator('#sheet').evaluate('element => element.scrollWidth > element.clientWidth'))
            self.page.screenshot(path=str(SCREENSHOTS / f'editor-{width}.png'))
            self.page.get_by_role('button', name='Cerrar', exact=True).click()
            self.page.get_by_role('button', name='Salir sin guardar', exact=True).click()

    def test_unsaved_activity_cancel_escape_and_new_activity(self):
        before = self.stored()
        self.page.locator('.quick-action[data-type="barre"]').click()
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.assertTrue(self.page.locator('#sheet').is_visible())
        self.assertTrue(self.page.get_by_role('dialog', name='¿Salir sin guardar?', exact=True).is_visible())
        self.assertEqual(self.dialogs, [])
        self.page.get_by_role('button', name='Seguir editando', exact=True).click()
        self.page.locator('[name="calories"]').fill('321')
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.locator('#discard-dialog').is_visible())
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#discard-dialog').is_visible())
        self.assertTrue(self.page.locator('#sheet').is_visible())
        self.assertEqual(self.page.locator('[name="calories"]').input_value(), '321')
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.screenshot(path=str(SCREENSHOTS / 'unsaved-dialog-402.png'))
        self.page.get_by_role('button', name='Salir sin guardar', exact=True).click()
        self.assertFalse(self.page.locator('#sheet').is_visible())
        self.assertEqual(self.stored(), before)

    def test_workout_autosave_history_and_unit_conversion(self):
        self.assertEqual(self.page.locator('[data-action="timer"]:visible').count(), 0)
        self.start_routine()
        self.page.locator('[data-workout-input="weight"]').first.fill('10')
        self.page.locator('[data-workout-input="amount"]').first.fill('12')
        self.page.locator('.set-check').first.click()
        saved = self.stored()['activeWorkout']
        self.assertTrue(saved['entries'][0]['sets'][0]['done'])
        self.assertEqual(saved['entries'][0]['sets'][0]['weight'], 10)
        self.page.reload()
        self.page.locator('[data-action="resume-workout"]').click()
        self.assertEqual(self.page.locator('[data-workout-input="weight"]').first.input_value(), '10')
        self.assertEqual(self.page.locator('.set-check').first.get_attribute('aria-pressed'), 'true')
        self.page.get_by_role('button', name='Finalizar sesión', exact=True).click()
        self.page.get_by_role('button', name='Guardar sesión', exact=True).click()
        self.assertIsNone(self.stored()['activeWorkout'])
        self.assertEqual(self.stored()['activities'][-1]['workout']['entries'][0]['sets'][0]['amount'], 12)
        self.page.locator('.routine-card').first.click()
        self.page.locator('.routine-history .history-entry').click()
        self.page.locator('[name="weight-0-0"]').fill('15')
        self.page.get_by_role('button', name='Guardar series', exact=True).click()
        self.assertEqual(self.stored()['activities'][-1]['workout']['entries'][0]['sets'][0]['weight'], 15)
        self.page.locator('.mobile-settings').click()
        self.page.get_by_role('button', name='lb', exact=True).click()
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.start_routine()
        self.assertAlmostEqual(float(self.page.locator('[data-workout-input="weight"]').first.input_value()), 33.07, places=2)
        self.assertEqual(self.page.locator('.set-check').first.get_attribute('aria-pressed'), 'false')
        self.assertEqual(self.stored()['activities'][-1]['workout']['unit'], 'kg')
        self.page.get_by_role('button', name='Historial de Dead bug', exact=True).click()
        self.assertIn('15 kg', self.page.locator('.history-entry').inner_text())

    def test_rewards_unique_days_hidden_and_notifications(self):
        self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const state = model.emptyStore();
          state.rewards = [
            {id:'first', name:'Chocolate de prueba', days:1, icon:'cookie'},
            {id:'next', name:'Siguiente sorpresa', days:3, icon:'gift'},
            {id:'secret', name:'Secreto no visible', days:8, icon:'palmtree'}
          ];
          model.saveStore(state);
        }""")
        self.page.reload()
        self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
        self.assertIn('Chocolate de prueba', self.page.locator('#sheet').inner_text())
        self.assertIn('Siguiente sorpresa', self.page.locator('.following-reward').inner_text())
        self.assertNotIn('Secreto no visible', self.page.locator('#sheet').inner_text())
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.locator('.quick-action[data-type="barre"]').click()
        self.page.get_by_role('button', name='Guardar actividad', exact=True).click()
        self.page.get_by_role('heading', name='Recompensa desbloqueada', exact=True).wait_for()
        self.assertEqual(len(self.stored()['rewardAwards']), 1)
        self.assertTrue(self.stored()['rewardAwards'][0]['seen'])
        self.page.screenshot(path=str(SCREENSHOTS / 'reward-unlocked-402.png'))
        self.page.locator('[data-action="share-award"]').click()
        self.page.wait_for_function("document.querySelector('#reward-canvas').getContext('2d').getImageData(0,0,1,1).data[3] === 255")
        self.assertEqual(self.page.locator('#reward-canvas').get_attribute('height'), '1920')
        with self.page.expect_download() as pending:
            self.page.get_by_role('button', name='Guardar foto', exact=True).click()
        self.assertTrue(pending.value.suggested_filename.endswith('story.png'))
        pending.value.save_as(SCREENSHOTS / 'reward-story.png')
        self.assertEqual(self.page.locator('[data-action="reward-format"]').count(), 0)
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.reload()
        self.assertFalse(self.page.locator('#sheet').is_visible())
        self.page.locator('.quick-action[data-type="barre"]').click()
        self.page.get_by_role('button', name='Guardar actividad', exact=True).click()
        self.assertEqual(len(self.stored()['rewardAwards']), 1)
        self.assertFalse(self.page.locator('#sheet').is_visible())
        self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
        self.assertIn('Siguiente sorpresa', self.page.locator('#sheet').inner_text())
        self.assertIn('Secreto no visible', self.page.locator('.following-reward').inner_text())

    def test_reward_config_backup_and_retroactive_days(self):
        result = self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const rewards = await import('./rewards.js');
          let state = model.validateStore(model.makeDemo('2026-09-24'));
          state = rewards.unlockRewards(state, '2026-09-24');
          const first = state.rewardAwards.length;
          state = rewards.unlockRewards(state, '2026-09-24');
          const again = state.rewardAwards.length;
          state.activities.push({...state.activities[0],id:'same-day'});
          const days = rewards.activeDays(state,'2026-09-24');
          state.activities.push({...state.activities[0],id:'future',date:'2030-01-01'});
          const noFuture = rewards.activeDays(state,'2026-09-24');
          state.activities = [];
          state = rewards.unlockRewards(state,'2026-09-24');
          const preserved = model.validateStore(state).rewardAwards.length;
          const old = model.makeDemo('2026-09-24');
          const migrated = model.validateStore(old);
          return {first,again,days,noFuture,preserved,rewards:migrated.rewards.length,active:migrated.activeWorkout};
        }""")
        self.assertEqual(result, {'first':1,'again':1,'days':12,'noFuture':12,'preserved':1,'rewards':12,'active':None})
        self.page.locator('.mobile-settings').click()
        self.page.get_by_role('button', name='Editar recompensas', exact=True).click()
        self.page.locator('[name="pin"]').fill('0000')
        self.page.get_by_role('button', name='Desbloquear', exact=True).click()
        self.assertEqual(self.page.locator('#pin-error').inner_text(), 'PIN incorrecto')
        self.assertEqual(self.page.locator('[data-action="new-reward"]').count(), 0)
        self.page.locator('[name="pin"]').fill('1318')
        self.page.get_by_role('button', name='Desbloquear', exact=True).click()
        self.page.get_by_role('button', name='Añadir recompensa', exact=True).click()
        self.page.locator('[name="name"]').fill('Una sorpresa nueva')
        self.page.get_by_role('textbox', name='Descripción del regalo', exact=True).fill('Miguel te invita a Bubble Tea de Xing Fu Tan.')
        self.page.locator('[name="days"]').fill('30')
        self.page.locator('[name="metric"]').select_option('gym')
        self.page.get_by_role('button', name='Guardar recompensa', exact=True).click()
        self.assertEqual(self.stored()['rewards'][0]['name'], 'Una sorpresa nueva')
        self.assertEqual(self.stored()['rewards'][0]['days'], 30)
        self.assertEqual(self.stored()['rewards'][0]['metric'], 'gym')
        self.assertEqual(self.stored()['rewards'][0]['description'], 'Miguel te invita a Bubble Tea de Xing Fu Tan.')

    def test_training_and_rewards_geometry(self):
        self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const { DEFAULT_REWARDS } = await import('./rewards.js');
          const state = model.loadStore();
          state.activities = [];
          state.rewards = structuredClone(DEFAULT_REWARDS);
          model.saveStore(state);
        }""")
        self.page.reload()
        self.start_routine()
        for width, height in [(320, 740), (402, 874), (1440, 960)]:
            self.page.set_viewport_size({'width':width,'height':height})
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
            self.page.screenshot(path=str(SCREENSHOTS / f'workout-{width}.png'), full_page=True)
            self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
            self.assertFalse(self.page.locator('#sheet').evaluate('element => element.scrollWidth > element.clientWidth'))
            self.assertIn('Yogurt Myka', self.page.locator('.following-reward').inner_text())
            self.assertIn('10 sorpresas por descubrir', self.page.locator('.secret-rewards').inner_text())
            self.page.screenshot(path=str(SCREENSHOTS / f'rewards-{width}.png'))
            self.page.get_by_role('button', name='Cerrar', exact=True).click()


    def test_reward_queue_and_long_image_title(self):
        self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const state = model.validateStore(model.makeDemo(model.dateKey()));
          state.rewards = [1,2,3].map(days => ({id:`reward-${days}`,name:days === 3 ? 'Una salida de fin de semana con almuerzo y una sorpresa especial para celebrar todos los entrenamientos registrados durante estos meses' : `Premio ${days}`,days,icon:'gift'}));
          state.rewardAwards = [];
          model.saveStore(state);
        }""")
        self.page.reload()
        for count in [1, 2, 3]:
            self.page.get_by_role('heading', name='Recompensa desbloqueada', exact=True).wait_for()
            self.assertEqual(sum(award['seen'] for award in self.stored()['rewardAwards']), count)
            if count < 3:
                self.page.get_by_role('button', name='Cerrar', exact=True).first.click()
        self.page.locator('[data-action="share-award"]').click()
        self.assertEqual(self.page.locator('#reward-canvas').get_attribute('height'), '1920')
        self.page.wait_for_function("document.querySelector('#reward-canvas').getContext('2d').getImageData(0,0,1,1).data[3] === 255")
        with self.page.expect_download() as pending:
            self.page.get_by_role('button', name='Guardar foto', exact=True).click()
        pending.value.save_as(SCREENSHOTS / 'reward-long-title.png')
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.reload()
        self.assertFalse(self.page.locator('#sheet').is_visible())
        self.assertEqual(len(self.stored()['rewardAwards']), 3)

    def test_cloud_account_isolation_pending_and_conflict(self):
        result = self.page.evaluate("""async () => {
          const { createSync } = await import('./sync.js');
          const { emptyStore, validateStore } = await import('./store.js');
          const records = new Map();
          const storage = { getItem:key => records.get(key) || null, setItem:(key,value) => records.set(key,value) };
          const remote = new Map();
          let identity = 'account-a';
          let offline = false;
          let active;
          const client = {
            auth:{getSession:async () => ({data:{session:{user:{id:identity}}}})},
            from:() => ({select:() => ({eq:(_, owner) => ({maybeSingle:async () => offline ? {error:{code:'network'}} : {data:remote.get(owner) || null}})})}),
            rpc:async (_, args) => {
              if (offline) return {error:{code:'network'}};
              const old = remote.get(identity);
              if ((old?.revision || 0) !== args.p_expected_revision) return {error:{code:'40001'}};
              const row = {payload:structuredClone(args.p_payload),revision:(old?.revision || 0)+1,mutation_id:args.p_mutation_id};
              remote.set(identity,row);
              return {data:[row]};
            }
          };
          const sync = createSync({client,storage,apply:value => active=value});
          await sync.activate({user:{id:identity}});
          const newAccount = sync.confirmed && !sync.hasRemoteCopy;
          active.settings.rest = 61;
          sync.adapter.setItem('',JSON.stringify(active));
          await sync.flush();
          const first = remote.get(identity).payload.settings.rest;
          const savedAccount = sync.confirmed && sync.hasRemoteCopy;
          offline = true;
          active.settings.rest = 62;
          sync.adapter.setItem('',JSON.stringify(active));
          await sync.flush();
          const pending = sync.pending;
          sync.detach();
          await sync.activate({user:{id:identity}});
          const localCopyOnly = !sync.confirmed && sync.pending && sync.hasRemoteCopy;
          sync.detach();
          identity = 'account-b';
          offline = false;
          await sync.activate({user:{id:identity}});
          const second = active.settings.rest;
          sync.detach();
          identity = 'account-a';
          await sync.activate({user:{id:identity}});
          const resumed = active.settings.rest;
          remote.get(identity).revision += 1;
          remote.get(identity).payload.settings.rest = 90;
          await sync.flush();
          const conflict = sync.conflict;
          const intact = remote.get(identity).payload.settings.rest;
          await sync.resolve(false);
          const recovered = active.settings.rest;
          const backup = JSON.parse(sync.recovery()).payload.settings.rest;
          let demoRejected = false;
          try { sync.adapter.setItem('',JSON.stringify({...active,demo:true})); } catch { demoRejected=true; }
          sync.detach();
          return {first,pending,second,resumed,conflict,intact,recovered,backup,demoRejected,newAccount,savedAccount,localCopyOnly};
        }""")
        self.assertEqual(result, {'first':61,'pending':True,'second':45,'resumed':62,'conflict':True,'intact':90,'recovered':90,'backup':62,'demoRejected':True,'newAccount':True,'savedAccount':True,'localCopyOnly':True})

    def test_specific_reward_goals(self):
        result = self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const rewards = await import('./rewards.js');
          const state = model.validateStore(model.makeDemo('2026-09-24'));
          const counts = Object.keys(rewards.METRICS).map(metric => rewards.rewardCount(state, {metric}, '2026-09-24'));
          state.rewards = ['barre','swim','gym','gymSets'].map(metric => ({id:metric,name:metric,description:'',metric,days:metric === 'swim' ? 3000 : 3,icon:'gift'}));
          state.activities = state.activities.filter(activity => activity.type === 'swim');
          state.activities.push({...state.activities[0],id:'future',date:'2030-01-01',meters:50000});
          const before = rewards.unlockRewards(state,'2026-09-24').rewardAwards.length;
          state.activities.push({...state.activities[0],id:'more-swim',meters:200});
          const earned = rewards.unlockRewards(state,'2026-09-24').rewardAwards.map(award => award.id);
          const original = rewards.DEFAULT_REWARDS.find(reward => reward.id === 'myka');
          const migrated = rewards.migrateRewardGoal({...original,metric:undefined,days:16});
          const custom = rewards.migrateRewardGoal({...original,metric:undefined,days:17});
          const awarded = model.validateStore({...state,rewardAwards:[{...original,metric:undefined,days:16,earnedAt:'2026-09-24',seen:true,redeemed:true}]}).rewardAwards[0];
          let invalid = false;
          try { model.validateStore({...state,rewards:[{...original,metric:'invalid'}]}); } catch { invalid = true; }
          const workout = model.validateStore(model.makeDemo('2026-09-24'));
          workout.activeWorkout = model.startWorkout(workout, workout.routines[0], '2026-09-24');
          const active = rewards.rewardCount(workout, {metric:'gym'}, '2026-09-24');
          return {counts,before,earned,migrated:[migrated.metric,migrated.days],custom:[custom.metric,custom.days],award:[awarded.days,awarded.redeemed],invalid,active};
        }""")
        self.assertEqual(result['counts'], [6, 2800, 2, 0, 12])
        self.assertEqual(result['before'], 0)
        self.assertEqual(result['earned'], ['swim'])
        self.assertEqual(result['migrated'], ['swim', 2000])
        self.assertEqual(result['custom'], ['days', 17])
        self.assertEqual(result['award'], [16, True])
        self.assertTrue(result['invalid'])
        self.assertEqual(result['active'], 2)

    def test_celebration_preview_motion_and_download(self):
        before = self.stored()
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
        self.page.locator('[data-action="preview-celebration"]').click()
        self.assertFalse(self.page.locator('[data-action="share-award"]').is_visible())
        self.assertGreater(self.page.locator('.celebration-stage').evaluate('element => element.getAnimations().length'), 0)
        self.page.locator('[data-action="share-award"]').wait_for(state='visible')
        self.assertIn('Felicidades', self.page.locator('.celebration-congrats').inner_text())
        self.assertIn('Nacion Sushi', self.page.locator('.celebration-next').inner_text())
        self.assertIn('16 / 30', self.page.locator('.celebration-next').inner_text())
        for width, height in [(320,740),(402,874),(1440,960)]:
            self.page.set_viewport_size({'width':width,'height':height})
            self.assertFalse(self.page.locator('#sheet').evaluate('element => element.scrollWidth > element.clientWidth'))
            self.page.screenshot(path=str(SCREENSHOTS / f'celebration-specific-{width}.png'))
        self.page.set_viewport_size({'width':402,'height':874})
        with self.page.expect_download() as pending:
            self.page.locator('[data-action="save-award"]').click()
        pending.value.save_as(SCREENSHOTS / 'personal-preview-story.png')
        self.assertEqual(self.page.locator('#reward-canvas').get_attribute('height'), '1920')
        self.assertIn('Xing Fu Tan', self.page.locator('#reward-canvas').get_attribute('aria-label'))
        self.assertEqual(self.stored(), before)
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
        self.page.locator('[data-action="preview-celebration"]').click()
        self.page.get_by_role('button', name='Cerrar', exact=True).click()
        self.page.get_by_role('button', name='Mis recompensas', exact=True).click()
        self.assertEqual(self.page.locator('.celebration-actions').count(), 0)
        self.assertEqual(self.stored(), before)

    def test_live_weight_and_workout_backup_integrity(self):
        self.start_routine()
        self.page.locator('[data-workout-input="weight"]').first.fill('7.5')
        self.assertEqual(self.stored()['activeWorkout']['entries'][0]['sets'][0]['weight'], 7.5)
        self.page.reload()
        self.page.locator('[data-action="resume-workout"]').click()
        self.assertEqual(self.page.locator('[data-workout-input="weight"]').first.input_value(), '7.5')
        result = self.page.evaluate("""async () => {
          const model = await import('./store.js');
          const state = model.loadStore();
          const valid = model.validateStore(JSON.parse(JSON.stringify(state)));
          const invalid = structuredClone(state);
          invalid.activeWorkout.entries[0].sets[0].weight = -1;
          let rejected = false;
          try { model.validateStore(invalid); } catch { rejected = true; }
          return {same:JSON.stringify(valid) === JSON.stringify(state),rejected};
        }""")
        self.assertTrue(result['same'])
        self.assertTrue(result['rejected'])
        self.page.locator('[data-action="exercise-timer"]').first.click()
        self.assertEqual(self.stored()['settings']['rest'], 45)


    def test_cloud_login_sync_restore_and_logout(self):
        account_id = '11111111-1111-4111-8111-111111111111'
        account_key = f'cristina.diary.account.v1.{account_id}'
        database = {'row': None}
        claims = {'sub': account_id, 'role': 'authenticated', 'exp': 4102444800}
        encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        token = f'eyJhbGciOiJIUzI1NiJ9.{encoded}.fixture'
        user = {'id':account_id,'aud':'authenticated','role':'authenticated','email':'cristina@example.test','created_at':'2026-09-24T00:00:00Z','app_metadata':{},'user_metadata':{}}
        def respond(route):
            request = route.request
            headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=headers)
                return
            if '/auth/v1/token' in request.url:
                route.fulfill(json={'access_token':token,'refresh_token':'fixture-only','expires_in':3600,'token_type':'bearer','user':user}, headers=headers)
            elif '/auth/v1/logout' in request.url:
                route.fulfill(json={}, headers=headers)
            elif '/rest/v1/cris_diaries' in request.url:
                route.fulfill(json=[database['row']] if database['row'] else [], headers=headers)
            elif '/rest/v1/rpc/cris_save_diary' in request.url:
                payload = request.post_data_json
                previous = database['row']
                revision = previous['revision'] if previous else 0
                if payload['p_expected_revision'] != revision:
                    route.fulfill(status=409, json={'code':'40001','message':'Conflict'}, headers=headers)
                else:
                    database['row'] = {'payload':payload['p_payload'],'revision':revision + 1,'mutation_id':payload['p_mutation_id']}
                    route.fulfill(json=[database['row']], headers=headers)
            else:
                route.fulfill(status=404, json={'message':'Unexpected mocked request'}, headers=headers)
        self.context.route('https://izneyvdlthcwalpdzton.supabase.co/**', respond)
        original = self.stored()
        self.page.locator('.mobile-settings').click()
        self.page.get_by_role('button', name='Mi cuenta', exact=True).click()
        self.page.get_by_role('textbox', name='Correo', exact=True).fill('cristina@example.test')
        self.page.get_by_role('textbox', name='Contraseña', exact=True).fill('fixture-only')
        self.page.get_by_role('button', name='Iniciar sesión', exact=True).click()
        self.page.locator('.cloud-email').wait_for()
        self.assertIn('Ya estás lista para iniciar tu diario', self.page.locator('#cloud-guidance').inner_text())
        self.page.screenshot(path=str(SCREENSHOTS / 'cloud-new-account-402.png'))
        self.assertEqual(self.stored(), original)
        self.page.get_by_role('button', name='Ir a mi diario', exact=True).click()
        self.page.locator('.quick-action[data-type="barre"]').click()
        self.page.locator('[name="calories"]').fill('234')
        self.page.get_by_role('button', name='Guardar actividad', exact=True).click()
        self.page.wait_for_function('key => JSON.parse(localStorage.getItem(key)).dirty === false', arg=account_key)
        self.assertEqual(database['row']['payload']['activities'][0]['calories'], 234)
        self.assertFalse(database['row']['payload']['demo'])
        self.assertEqual(self.stored(), original)
        fresh = self.browser.new_context(viewport={'width':402,'height':874}, reduced_motion='reduce')
        try:
            fresh.route('https://izneyvdlthcwalpdzton.supabase.co/**', respond)
            blank = {'format':'cristina-diary','version':1,'demo':False,'settings':{'unit':'kg','rest':45},'activities':[],'routines':[]}
            fresh.add_init_script("localStorage.setItem('cristina.diary.preview.v1', " + json.dumps(json.dumps(blank)) + ");")
            other = fresh.new_page()
            other.goto(URL)
            other.locator('.mobile-settings').click()
            other.get_by_role('button', name='Mi cuenta', exact=True).click()
            other.get_by_role('textbox', name='Correo', exact=True).fill('cristina@example.test')
            other.get_by_role('textbox', name='Contraseña', exact=True).fill('fixture-only')
            other.get_by_role('button', name='Iniciar sesión', exact=True).click()
            other.locator('.cloud-email').wait_for()
            self.assertIn('Tu diario está sincronizado', other.locator('#cloud-guidance').inner_text())
            recovered = other.evaluate('key => JSON.parse(localStorage.getItem(key))', account_key)
            self.assertEqual(recovered['payload']['activities'][0]['calories'], 234)
            self.assertEqual(recovered['revision'], 1)
            for width, height in [(320,740),(402,874),(1440,960)]:
                other.set_viewport_size({'width':width,'height':height})
                self.assertFalse(other.locator('#sheet').evaluate('element => element.scrollWidth > element.clientWidth'))
                other.screenshot(path=str(SCREENSHOTS / f'cloud-account-{width}.png'))
        finally:
            fresh.close()
        self.page.locator('.mobile-settings').click()
        self.assertEqual(self.page.locator('.settings-email').inner_text(), 'cristina@example.test')
        self.page.get_by_role('button', name='Mi cuenta', exact=True).click()
        self.page.get_by_role('button', name='Cerrar sesión', exact=True).click()
        self.page.wait_for_function("!localStorage.getItem('cristina.auth.v1')")
        self.assertEqual(self.stored(), original)
        self.assertIsNotNone(self.page.evaluate('key => localStorage.getItem(key)', account_key))


if __name__ == '__main__':
    unittest.main(verbosity=2)