// Cancellation stays on the main thread, so it works while the Worker is in WASM.
export function sync(root, cancel, running, chinese) {
  let button=root.querySelector('[data-cancel-battles]');
  if(!button) {
    button=document.createElement('button');button.type='button';
    button.dataset.cancelBattles='';
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();cancel();});
    root.append(button);
  }
  const text=chinese?'取消计算':'Cancel calculation';
  if(button.textContent!==text)button.textContent=text;
  if(button.hidden===Boolean(running))button.hidden=!running;
  if(button.disabled===Boolean(running))button.disabled=!running;
}
