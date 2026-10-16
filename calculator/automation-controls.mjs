const PREFIX = 'mwi-lab-auto-estimate-control';
const STORAGE_KEY = 'mwi_lab_auto_target_seconds';
export function normalizeSeconds(value) {
  const seconds = Math.floor(Number(value));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(100000, seconds) : 300;
}
function loadSeconds() {
  try {return normalizeSeconds(localStorage.getItem(STORAGE_KEY));}
  catch {return 300;}
}
function saveSeconds(value) {
  const seconds = normalizeSeconds(value);
  try {if (localStorage.getItem(STORAGE_KEY) !== String(seconds)) localStorage.setItem(STORAGE_KEY, String(seconds));} catch {}
  return seconds;
}
export function getTargetSeconds() {
  const input = document.querySelector(`.${PREFIX}__target-seconds-input`);
  const seconds = saveSeconds(input ? input.value : loadSeconds());
  if (input && input.value !== String(seconds)) input.value = String(seconds);
  return seconds;
}
export const formatSeconds = value => Number.isFinite(value) ? `${value.toFixed(1)} s` : '∞';
const setText = (node, text) => {if (node.textContent !== text) node.textContent = text;};
export function sync(root, t, recommend, running, basis) {
  let timeRow = root.querySelector('[data-recommend-row="seconds"]');
  if (!timeRow) {
    // Keep the original inputs and listeners while grouping controls into the
    // same calculation / win target / time target rows as Greasyfork 1.6.0.
    for (const [kind, button] of [['estimate', root.querySelector(`.${PREFIX}__button`)],
      ['winRate', root.querySelector(`.${PREFIX}__recommend-button`)]]) {
      const settings = button.previousElementSibling;
      const row = document.createElement('div');row.dataset.recommendRow = kind;
      row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 100%;min-width:0';
      root.insertBefore(row, settings);row.append(settings, button);
    }
    timeRow = document.createElement('div');timeRow.dataset.recommendRow = 'seconds';
    timeRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 100%;min-width:0';
    const settings = document.createElement('label');settings.className = `${PREFIX}__settings`;
    const label = document.createElement('span');label.className = `${PREFIX}__target-seconds-label`;
    label.style.cssText = 'font-size:11px;color:rgba(240,244,255,.92)';
    const input = document.createElement('input');
    input.type = 'number';input.min = '1';input.max = '100000';input.step = '1';input.inputMode = 'numeric';
    input.className = `${PREFIX}__target-seconds-input`;
    input.value = String(loadSeconds());
    input.addEventListener('input', () => {if (Number(input.value) > 0) saveSeconds(input.value);});
    const finalize = () => {input.value = String(saveSeconds(input.value));};
    input.addEventListener('change', finalize);input.addEventListener('blur', finalize);
    settings.append(label, input);
    const button = document.createElement('button');button.type = 'button';
    button.className = `${PREFIX}__button ${PREFIX}__recommend-seconds-button`;
    button.addEventListener('click', () => recommend('seconds'));
    timeRow.append(settings, button);
    root.insertBefore(timeRow, root.querySelector(`.${PREFIX}__status`));
  }
  setText(timeRow.querySelector('span'), t('targetSeconds'));
  const input = timeRow.querySelector('input');
  if (input.title !== t('targetSecondsHint')) input.title = t('targetSecondsHint');
  setRunning(root, t, running, basis);
}
export function setRunning(root, t, running, basis) {
  const input = root.querySelector(`.${PREFIX}__target-seconds-input`);
  const button = root.querySelector(`.${PREFIX}__recommend-seconds-button`);
  if (input && input.disabled !== running) input.disabled = running;
  if (button) {
    if (button.disabled !== running) button.disabled = running;
    setText(button, running && basis === 'seconds' ? t('calculating') : t('recommendBySeconds'));
  }
}
