// Keep native selects as the form controls; render their menus inside the app.
let active=null, nextId=0;
// True while the menu was opened by a finger or a pen. A touch screen opens
// its own picker whenever a select is tapped or focused, so there the select
// is never focused and the tap is kept from reaching it.
let byTouch=false;
function closeMenu(restoreFocus=false) {
  if(!active)return;
  const {select,menu}=active;active=null;
  menu.remove();select.setAttribute('aria-expanded','false');select.removeAttribute('aria-controls');
  if(restoreFocus && !byTouch && select.isConnected)select.focus({preventScroll:true});
}
function openMenu(select) {
  if(select.disabled)return;
  if(active?.select===select){closeMenu(true);return;}
  closeMenu();
  const menu=document.createElement('div');menu.className='studio-dropdown';menu.id='studio-dropdown-'+(++nextId);
  menu.classList.toggle('clip-source-menu',select.id==='clip-editor-mode');
  menu.setAttribute('role','listbox');
  menu.setAttribute('aria-label',select.getAttribute('aria-label') || ([...select.labels || []].map(label=>[...label.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()).join(' ')) || 'Options');
  const options=[...select.options], items=[];
  let current=Math.max(0,select.selectedIndex), search='', searchTime=0;
  const focus=index=>{
    if(index<0 || index>=items.length || options[index].disabled)return;
    current=index;items.forEach((item,i)=>item.classList.toggle('focused',i===index));
    items[index].focus({preventScroll:true});items[index].scrollIntoView({block:'nearest'});
  };
  const choose=index=>{
    if(options[index].disabled)return;
    const changed=select.selectedIndex!==index;
    select.selectedIndex=index;closeMenu(true);
    if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
  };
  options.forEach((option,index)=>{
    const item=document.createElement('div');item.className='studio-option';item.tabIndex=-1;
    item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));
    item.setAttribute('aria-disabled',String(option.disabled));item.textContent=option.textContent;
    // An option may carry a picture (data-preview, an image URL), shown before
    // its text in the text colour: the image is used as a mask.
    if(option.dataset.preview){
      const picture=document.createElement('span');picture.className='studio-option-preview';picture.setAttribute('aria-hidden','true');
      picture.style.maskImage=picture.style.webkitMaskImage=`url("${option.dataset.preview}")`;item.prepend(picture);
    }
    item.onclick=()=>choose(index);menu.append(item);items.push(item);
  });
  menu.onkeydown=event=>{
    event.stopPropagation();
    if(event.key==='Tab'){closeMenu(true);return;}
    event.preventDefault();
    if(event.key==='Escape'){closeMenu(true);return;}
    if(event.key==='Enter' || event.key===' '){choose(current);return;}
    const enabled=options.map((option,i)=>option.disabled?-1:i).filter(i=>i>=0);
    if(event.key==='Home')focus(enabled[0]);
    else if(event.key==='End')focus(enabled.at(-1));
    else if(event.key==='ArrowDown')focus(enabled.find(i=>i>current) ?? enabled[0]);
    else if(event.key==='ArrowUp')focus(enabled.findLast(i=>i<current) ?? enabled.at(-1));
    else if(event.key.length===1 && !event.metaKey && !event.ctrlKey){
      const now=Date.now();search=(now-searchTime<700?search:'')+event.key.toLowerCase();searchTime=now;
      const match=enabled.find(i=>options[i].textContent.toLowerCase().startsWith(search));if(match!==undefined)focus(match);
    }
  };
  (select.closest('dialog') || document.body).append(menu);
  active={select,menu};select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',menu.id);
  const rect=select.getBoundingClientRect(), margin=8;
  // Options with a picture need room for it beside their text.
  const least=menu.querySelector('.studio-option-preview')?250:select.id==='clip-editor-mode'?100:160;
  menu.style.width=Math.min(Math.max(rect.width,least),innerWidth-margin*2)+'px';
  menu.style.left=Math.max(margin,Math.min(rect.left,innerWidth-menu.offsetWidth-margin))+'px';
  const below=innerHeight-rect.bottom-margin, above=rect.top-margin;
  const downward=below>=Math.min(menu.scrollHeight,240) || below>=above;
  menu.style.maxHeight=Math.max(40,Math.min(440,downward?below:above))+'px';
  menu.style.top=(downward?rect.bottom+3:Math.max(margin,rect.top-menu.offsetHeight-3))+'px';
  focus(options[current]?.disabled?options.findIndex(option=>!option.disabled):current);
}
document.addEventListener('pointerdown',event=>{
  const select=event.target.closest('select');
  if(select && !select.multiple){
    byTouch=event.pointerType==='touch' || event.pointerType==='pen';
    event.preventDefault();if(!byTouch)select.focus({preventScroll:true});openMenu(select);
  }
  else if(active && !active.menu.contains(event.target))closeMenu();
},true);
document.addEventListener('click',event=>{if(event.target.closest('select'))event.preventDefault();},true);
// Browsers that still send the mouse press after a cancelled pointer press
// would open their own list on it.
document.addEventListener('mousedown',event=>{if(event.target.closest?.('select:not([multiple])'))event.preventDefault();},true);
// Cancelling a pointer event does not stop what a touch does by default; only
// cancelling the touch itself keeps the system picker closed. The listeners
// must not be passive for that.
for(const type of ['touchstart','touchend'])document.addEventListener(type,event=>{
  if(event.target.closest?.('select:not([multiple])') && event.cancelable)event.preventDefault();
},{capture:true,passive:false});
// Some systems still open the picker when a select takes focus by other means.
document.addEventListener('focusin',event=>{if(byTouch && active && event.target===active.select)event.target.blur();},true);
document.addEventListener('keydown',event=>{
  if(event.target.tagName!=='SELECT' || event.target.multiple || event.key==='Tab')return;
  if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){
    event.preventDefault();event.stopPropagation();openMenu(event.target);
  }
},true);
document.addEventListener('scroll',event=>{if(active && !active.menu.contains(event.target))closeMenu();},true);
window.addEventListener('resize',()=>closeMenu());
window.addEventListener('blur',()=>closeMenu());
new MutationObserver(()=>{if(active && !active.select.isConnected)closeMenu();}).observe(document.body,{childList:true,subtree:true});
