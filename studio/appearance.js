export function setupMotion(doc=document) {
  doc.addEventListener('click',event=>{
    if(!event.target.closest('[data-clip-settings],#sequence-settings,#options-toggle'))return;
    if(doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    if(doc.querySelector('#inspector')?.hidden)return;
    const content=doc.querySelector('.inspector-content');
    if(!content||content.hidden)return;
    content.getAnimations?.().forEach(animation=>animation.cancel());
    content.animate?.([{opacity:.65,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{
      duration:160,easing:'cubic-bezier(.22,1,.36,1)',
    });
  });
}

export function setupTheme(doc=document,storage=localStorage,api=null,onError=()=>{}) {
  const root=doc.documentElement,button=doc.querySelector('#theme-toggle');
  let theme='dark',edited=false,saves=Promise.resolve();
  try{if(storage.getItem('studio-theme')==='light')theme='light';}catch{}
  const apply=()=>{
    root.dataset.theme=theme;
    button.title=`Switch to ${theme==='light'?'dark':'light'} mode`;
    button.setAttribute('aria-pressed',String(theme==='light'));
  };
  button.onclick=()=>{
    edited=true;theme=theme==='light'?'dark':'light';apply();
    try{storage.setItem('studio-theme',theme);}catch{}
    if(api){const value={theme};saves=saves.then(()=>api('theme',value)).catch(onError);}
  };
  apply();
  const ready=api?api('theme').then(value=>{
    if(!edited&&['light','dark'].includes(value?.theme)){
      theme=value.theme;apply();try{storage.setItem('studio-theme',theme);}catch{}
    }
  }).catch(onError):Promise.resolve();
  return {ready};
}
