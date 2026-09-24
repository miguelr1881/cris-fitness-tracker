import { dateKey } from './store.js';
import { DEFAULT_REWARDS, METRICS, rewardGoal, rewardProgress, unlockRewards } from './rewards.js';

export function createRewards(api) {
  const { getData, commit, escape, icon, openSheet, closeSheet, render, toast, download } = api;
  let rewardDraft = null;
  let shareAward = null;
  let imageBlob = null;
  let editorOpen = false;

  function show() {
    editorOpen = false;
    const data = getData();
    const progress = rewardProgress(data, dateKey());
    openSheet('Mis recompensas', `<div class="sheet-content rewards-content">
    ${progress.next ? `<section class="next-reward"><p class="eyebrow">${progress.next.kind === 'welcome' ? 'TU PRIMER LOGRO' : 'SIGUIENTE RECOMPENSA'}</p><span class="reward-emblem">${icon(progress.next.icon)}</span><h3>${escape(progress.next.name)}</h3><p class="reward-description">${escape(progress.next.description || 'Un regalo de Miguel para Cristina.')}</p><p>${escape(rewardGoal(progress.next))}</p><div class="progress-track"><span style="width:${Math.min(100, progress.count / progress.next.days * 100)}%"></span></div><span class="reward-count">${progress.count} / ${escape(rewardGoal(progress.next))}</span></section>` : '<p class="muted-copy">Todas las recompensas están desbloqueadas.</p>'}
    ${progress.following ? `<section class="following-reward"><span class="activity-symbol lilac">${icon(progress.following.icon)}</span><div><p class="eyebrow">DESPUÉS</p><h3>${escape(progress.following.name)}</h3><p>${escape(rewardGoal(progress.following))}</p><span class="reward-count">${progress.followingCount} / ${progress.following.days}</span></div></section>` : ''}
    ${progress.hidden ? `<div class="secret-rewards">${icon('lock-keyhole')}<span>${progress.hidden} sorpresas por descubrir</span></div>` : ''}
    <h3 class="reward-section-label">Desbloqueadas · ${data.rewardAwards.length}</h3>${[...data.rewardAwards].reverse().map(award => `<button class="earned-reward" data-action="show-award" data-id="${escape(award.id)}"><span class="activity-symbol lilac">${icon(award.icon)}</span><span><strong>${escape(award.name)}</strong><small>${award.kind === 'welcome' ? 'Primer logro' : award.redeemed ? 'Disfrutada' : 'Pendiente de disfrutar'} · ${escape(award.earnedAt)}</small></span>${icon('chevron-right')}</button>`).join('') || '<p class="muted-copy">Aún no hay recompensas desbloqueadas.</p>'}
    <button class="text-button" data-action="preview-celebration">${icon('sparkles')}Ver celebración de ejemplo</button></div>`);
  }

  async function celebrate(award) {
    editorOpen = false;
    const next = structuredClone(getData());
    const saved = next.rewardAwards.find(item => item.id === award.id);
    if (saved && !saved.seen) { saved.seen = true; if (!commit(next)) return; }
    shareAward = structuredClone(award);
    const progress = award.preview ? { next: DEFAULT_REWARDS.find(reward => reward.metric === award.metric && reward.days > award.days), count: award.days } : rewardProgress({ ...next, rewardAwards: [...next.rewardAwards, award] }, dateKey());
    openSheet(award.kind === 'welcome' ? 'Tu primer logro' : 'Recompensa desbloqueada', `<div class="sheet-content celebration"><div class="celebration-stage"><div class="celebration-confetti" aria-hidden="true">${Array.from({length:24}, (_, index) => `<i style="--angle:${index * 15}deg;--travel:${85 + index % 4 * 12}px;--delay:${index % 4 * 45}ms;--color:${['#b492ce','#97b9a3','#e4b58f','#c1c9e5'][index % 4]}"></i>`).join('')}</div><div class="reward-emblem">${icon(award.icon)}</div></div><p class="celebration-congrats">¡Felicidades, Cristina!</p><p class="reward-threshold">${escape(rewardGoal(award))}</p><h3>${escape(award.name)}</h3><p class="reward-description">${escape(award.description || 'Un regalo de Miguel para Cristina.')}</p>${getData().demo || award.preview ? '<span class="preview-tag">Celebración de ejemplo</span>' : award.kind === 'welcome' ? '' : `<button class="text-button" data-action="redeem-reward" data-id="${escape(award.id)}">${icon(award.redeemed ? 'check-check' : 'check')}${award.redeemed ? 'Disfrutada · marcar pendiente' : 'Marcar como disfrutada'}</button>`}${progress.next ? `<div class="celebration-next"><small>SIGUIENTE RECOMPENSA</small><strong>${escape(progress.next.name)}</strong><span>${escape(rewardGoal(progress.next))} · ${progress.count} / ${progress.next.days}</span></div>` : ''}<button class="text-button" data-action="replay-celebration">${icon('rotate-ccw')}Volver a ver</button></div>`, `<footer class="sheet-footer celebration-actions" style="visibility:hidden"><button class="secondary-button" data-action="save-award" data-id="${escape(award.id)}">${icon('download')}Guardar foto</button><button class="primary-button" data-action="share-award" data-id="${escape(award.id)}">${icon('share-2')}Compartir</button></footer>`, '');
    const stage = document.querySelector('.celebration-stage');
    const actions = document.querySelector('.celebration-actions');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = stage.animate([{opacity:0,transform:'scale(.65)'},{opacity:1,transform:'scale(1.07)',offset:.45},{opacity:1,transform:'scale(1)'}], {duration:1500,easing:'cubic-bezier(.2,.7,.2,1)'});
      await animation.finished.catch(() => {});
    }
    if (stage.isConnected) { actions.style.visibility = 'visible'; actions.animate([{opacity:0},{opacity:1}], {duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300}); }
  }

  function manage() {
    if (!editorOpen) return;
    const data = getData();
    openSheet('Editar recompensas', `<div class="sheet-content"><p class="notice">Esta lista muestra todas las sorpresas. Las recompensas ya ganadas conservan su nombre y meta originales.</p><div class="reward-admin">${data.rewards.map(reward => `<button class="earned-reward" data-action="edit-reward" data-id="${escape(reward.id)}"><span><strong>${escape(reward.name)}</strong><small>${escape(rewardGoal(reward))}</small></span>${icon('pencil')}</button>`).join('')}</div></div>`, `<footer class="sheet-footer"><button class="primary-button" data-action="new-reward">${icon('plus')}Añadir recompensa</button></footer>`);
  }

  function edit(reward = null) {
    if (!editorOpen) return;
    rewardDraft = reward ? structuredClone(reward) : { id: crypto.randomUUID(), name: '', description: '', days: 10, metric: 'barre', icon: 'gift' };
    openSheet(reward ? 'Editar recompensa' : 'Nueva recompensa', `<form id="reward-form"><div class="sheet-content"><label class="field"><span>Nombre del regalo o lugar</span><input name="name" required maxlength="150" value="${escape(rewardDraft.name)}"></label><label class="field"><span>Descripción del regalo</span><textarea name="description" maxlength="320" placeholder="Miguel te invita a…">${escape(rewardDraft.description || '')}</textarea></label><label class="field"><span>Objetivo</span><select name="metric">${Object.entries(METRICS).filter(([key]) => key !== 'days' || rewardDraft.metric === 'days').map(([key, label]) => `<option value="${key}" ${rewardDraft.metric === key ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label><label class="field"><span>Meta acumulada</span><input name="days" required type="number" min="1" max="1000000" step="1" value="${rewardDraft.days}"></label><label class="field"><span>Tipo</span><select name="icon">${[['heart','Cariño'],['gift','Regalo'],['cookie','Chocolate'],['ice-cream-bowl','Postre'],['cup-soda','Bebida'],['clapperboard','Cine'],['utensils','Restaurante'],['palmtree','Viaje']].map(([key, label]) => `<option value="${key}" ${rewardDraft.icon === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="muted-copy">No depende de calorías ni de entrenar días consecutivos.</p></div><footer class="sheet-footer"><button class="primary-button" type="submit">Guardar recompensa</button></footer></form>`);
  }

  function textLines(context, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  async function share(award, save = false) {
    shareAward = structuredClone(award);
    imageBlob = null;
    const height = 1920;
    openSheet('Compartir recompensa', `<div class="sheet-content"><canvas id="reward-canvas" class="reward-canvas" width="1080" height="1920" role="img" aria-label="${escape(award.name)}. ${escape(award.description || 'Un regalo de Miguel para Cristina.')}"></canvas><p class="image-size">Instagram Story · 1080 × 1920 px</p></div>`, `<footer class="sheet-footer"><button class="secondary-button" data-action="save-reward-image">${icon('download')}Guardar foto</button><button class="primary-button" data-action="share-reward-image">${icon('share-2')}Compartir</button></footer>`);
    await document.fonts.ready;
    const canvas = document.querySelector('#reward-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f9f6fc'; context.fillRect(0, 0, 1080, height);
    context.fillStyle = '#e0d2ec'; context.fillRect(0, 0, 1080, 24);
    context.strokeStyle = '#e6ddeb'; context.lineWidth = 1;
    context.strokeRect(56, 100, 968, 1720);
    context.textAlign = 'center'; context.fillStyle = '#7e658f'; context.font = '44px Georgia'; context.fillText('cristina.', 540, 285);
    context.font = '19px Manrope'; context.fillStyle = '#9987a5'; context.fillText(award.kind === 'welcome' ? 'MI PRIMER LOGRO' : 'RECOMPENSA DESBLOQUEADA', 540, 358);
    const middle = 615;
    context.strokeStyle = '#d2bce3'; context.lineWidth = 2;
    context.beginPath(); context.arc(540, middle, 123, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.arc(540, middle, 114, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#73558d'; context.font = `${String(award.days).length > 3 ? 58 : 88}px Georgia`; context.fillText(String(award.days), 540, middle + 12, 190);
    context.font = '18px Manrope'; context.fillText(METRICS[award.metric || 'days'].toUpperCase(), 540, middle + 58, 200);
    context.font = '21px Manrope'; context.fillStyle = '#947aa5'; context.fillText('DE MIGUEL, PARA TI', 540, 852);
    const fitText = (text, top, availableHeight, initialSize, family, color) => {
      let size = initialSize;
      let lines;
      do {
        context.font = `${size}px ${family}`;
        lines = textLines(context, text, 800);
        if (lines.length * size * 1.35 <= availableHeight) break;
        size -= 1;
      } while (size > 20);
      context.fillStyle = color;
      lines.forEach((line, index) => context.fillText(line, 540, top + index * size * 1.35, 800));
    };
    fitText(award.name, 965, 210, 70, 'Georgia', '#44334f');
    fitText(award.description || 'Un regalo de Miguel para Cristina.', 1220, 240, 32, 'Manrope', '#85718e');
    context.strokeStyle = '#dbd0e3'; context.beginPath(); context.moveTo(415, 1510); context.lineTo(665, 1510); context.stroke();
    context.font = '22px Manrope'; context.fillStyle = '#8d7a9b'; context.fillText(award.earnedAt.split('-').reverse().join(' . '), 540, 1570);
    if (getData().demo || award.preview) { context.font = '18px Manrope'; context.fillText('VISTA PREVIA · DATOS DE EJEMPLO', 540, 1640); }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (document.querySelector('#reward-canvas') === canvas) { imageBlob = blob; if (save && blob) download(blob, `cristina-recompensa-${award.id}-story.png`); }
  }

  async function action(name, button) {
    if (name === 'rewards') { show(); return true; }
    if (name === 'manage-rewards') { editorOpen = false; openSheet('Acceso a recompensas', '<form id="reward-pin-form"><div class="sheet-content"><label class="field"><span>PIN de Miguel</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off"></label><p id="pin-error" role="alert"></p></div><footer class="sheet-footer"><button type="submit" class="primary-button">Desbloquear</button></footer></form>'); return true; }
    if (name === 'preview-celebration') { celebrate({ ...DEFAULT_REWARDS.find(reward => reward.id === 'bubble-tea'), id:'preview', earnedAt:dateKey(), seen:true, redeemed:false, preview:true }); return true; }
    if (name === 'replay-celebration') { celebrate(shareAward); return true; }
    if (name === 'new-reward') { edit(); return true; }
    if (name === 'edit-reward') { edit(getData().rewards.find(reward => reward.id === button.dataset.id)); return true; }
    if (name === 'show-award') { celebrate(getData().rewardAwards.find(award => award.id === button.dataset.id)); return true; }
    if (name === 'share-award' || name === 'save-award') { await share(getData().rewardAwards.find(award => award.id === button.dataset.id) || shareAward, name === 'save-award'); return true; }
    if (name === 'redeem-reward') {
      const next = structuredClone(getData());
      const award = next.rewardAwards.find(item => item.id === button.dataset.id);
      if (!award || award.kind === 'welcome') return true;
      award.redeemed = !award.redeemed;
      if (commit(next)) celebrate(award);
      return true;
    }
    if (['save-reward-image', 'share-reward-image'].includes(name)) {
      if (!imageBlob) { toast('La imagen se está preparando.'); return true; }
      const filename = `cristina-recompensa-${shareAward.days}-story.png`;
      const file = new File([imageBlob], filename, { type: 'image/png' });
      try {
        if (name === 'share-reward-image' && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: shareAward.name });
        else download(imageBlob, filename);
      } catch (error) { if (error.name !== 'AbortError') toast('No se pudo compartir. Puedes guardar la foto.'); }
      return true;
    }
    return false;
  }

  function submit(event) {
    if (event.target.id === 'reward-pin-form') {
      event.preventDefault();
      if (new FormData(event.target).get('pin') === '1318') { editorOpen = true; closeSheet(true); manage(); }
      else { document.querySelector('#pin-error').textContent = 'PIN incorrecto'; event.target.elements.pin.value = ''; event.target.elements.pin.focus(); }
      return true;
    }
    if (event.target.id !== 'reward-form') return false;
    event.preventDefault();
    if (!editorOpen) return true;
    const fields = new FormData(event.target);
    const reward = { ...rewardDraft, name: fields.get('name').trim(), description: fields.get('description').trim(), days: Number(fields.get('days')), metric: fields.get('metric'), icon: fields.get('icon') };
    const next = structuredClone(getData());
    const index = next.rewards.findIndex(item => item.id === reward.id);
    if (index < 0) next.rewards.push(reward); else next.rewards[index] = reward;
    if (commit(unlockRewards(next, dateKey()))) { closeSheet(true); render(); const unseen = getData().rewardAwards.find(award => !award.seen); if (unseen) celebrate(unseen); else manage(); }
    return true;
  }
  return { show, celebrate, action, submit };
}