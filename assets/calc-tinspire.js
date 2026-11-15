/* TI-Nspire CX CAS hardware matrix and keypad.
   SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  const key=(name,label,code,second='',style='')=>[name,label,Math.floor(code/11),code%11,second,'',style];
  const letterCodes=[50,49,48,46,45,44,39,38,37,35,34,33,28,27,26,24,23,22,17,16,15,13,12,11,6,5];
  const letters=letterCodes.map((code,i)=>key(String.fromCharCode(97+i),String.fromCharCode(65+i),code));
  const menus=[key('esc','esc',73,'↶'),key('scratchpad','pad',65,'save'),key('tab','tab',75),key('on','⌂ on',9,'off'),key('doc','doc ▾',69,'+ page'),key('menu','menu',71,'▤')];
  const controls=[key('ctrl','ctrl',86,'','nspire-ctrl'),key('shift','⇧ shift',85,'CAPS'),key('var','var',56,'sto →'),key('del','del',64,'clear')];
  const keys=[
    key('equal','=',51,'| ≠ ≥'),key('trig','trig',20,'?'),
    key('7','7',40,'','emu-number'),key('8','8',72,'','emu-number'),key('9','9',36,'','emu-number'),
    key('fraction','▦',63,':='),key('catalog','▱',62,'∞ β°'),
    key('power','^',53,'ⁿ√x'),key('square','x²',31,'√'),
    key('4','4',29,'','emu-number'),key('5','5',61,'','emu-number'),key('6','6',25,'','emu-number'),
    key('multiply','×',52,'" ▪"'),key('divide','÷',41,'÷'),
    key('exp','eˣ',42,'ln'),key('pow10','10ˣ',21,'log'),
    key('1','1',18,'','emu-number'),key('2','2',70,'','emu-number'),key('3','3',14,'','emu-number'),
    key('add','+',68,'◐ ▸'),key('subtract','−',57,'◂ ◑'),
    key('leftparen','(',60,'[ ]'),key('rightparen',')',58,'{ }'),
    key('0','0',7,'','emu-number'),key('decimal','.',59,'capture','emu-number'),key('negative','(−)',3,'ans','emu-number'),key('enter','enter',1,'≈','emu-enter')
  ];
  const alphaKeys=[key('ee','EE',30),...letters.slice(0,7),key('punct','?!▸',8),
    key('pi','π▸',19),...letters.slice(7,14),key('flag','⚑',66),
    key('comma',',',87),...letters.slice(14,21),key('return','↵',0),
    ...letters.slice(21),key('space','space',4)];
  const all=[...menus,...controls,...keys,...alphaKeys], byName=new Map(all.map(k=>[k[0],k]));
  function renderLayout(render) {
    const button=name=>render(byName.get(name));
    const pair=(a,b)=>`<div class="nspire-key-pair">${button(a)}${button(b)}</div>`;
    const numbers=names=>names.map(button).join('');
    return `<div class="nspire-hardware">
      <div class="nspire-navigation">
        <div class="nspire-side-keys">${numbers(['esc','scratchpad','tab'])}</div>
        <div class="nspire-touchpad" role="application" tabindex="0" aria-label="TI-Nspire touchpad. Drag to move the pointer, tap to click, or use arrow keys and Enter.">
          <span class="nspire-pad-up" aria-hidden="true">▲</span><span class="nspire-pad-left" aria-hidden="true">◀</span>
          <span class="nspire-pad-right" aria-hidden="true">▶</span><span class="nspire-pad-down" aria-hidden="true">▼</span>
          <span class="nspire-pad-center" aria-hidden="true">☝<br>⌖</span><span class="nspire-pad-contact" aria-hidden="true" hidden></span>
        </div>
        <div class="nspire-side-keys">${numbers(['on','doc','menu'])}</div>
      </div>
      <div class="nspire-lower">
        <div class="nspire-modifiers" role="group" aria-label="TI-Nspire modifiers">${button('ctrl')}${button('shift')}<span></span>${button('var')}${button('del')}</div>
        <div class="nspire-number-keys" role="group" aria-label="TI-Nspire number and function keys">
          ${pair('equal','trig')}${numbers(['7','8','9'])}${pair('fraction','catalog')}
          ${pair('power','square')}${numbers(['4','5','6'])}${pair('multiply','divide')}
          ${pair('exp','pow10')}${numbers(['1','2','3'])}${pair('add','subtract')}
          ${pair('leftparen','rightparen')}${numbers(['0','decimal','negative','enter'])}
        </div>
        <div class="nspire-alpha-keys" role="group" aria-label="TI-Nspire alphabet keypad">${alphaKeys.map(render).join('')}</div>
      </div>
    </div>`;
  }
  function bindTouchpad(surface,send) {
    let pointer=null, start, position={x:.5,y:.5}, down=false, moved=false, holdTimer, tapTimer;
    const marker=surface.querySelector('.nspire-pad-contact');
    const emit=(contact,pressed)=>{send({...position,contact,down:pressed});surface.classList.toggle('is-down',pressed);marker.hidden=!contact;marker.style.left=`${position.x*100}%`;marker.style.top=`${position.y*100}%`;};
    const locate=event=>{const rect=surface.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};};
    const release=()=>{clearTimeout(holdTimer);clearTimeout(tapTimer);pointer=null;down=false;emit(false,false);};
    surface.addEventListener('pointerdown',event=>{
      if (pointer!==null || (event.pointerType==='mouse' && event.button!==0)) return;
      event.preventDefault();clearTimeout(tapTimer);surface.focus({preventScroll:true});surface.setPointerCapture(event.pointerId);
      pointer=event.pointerId;start={x:event.clientX,y:event.clientY};position=locate(event);down=false;moved=false;emit(true,false);
      holdTimer=setTimeout(()=>{down=true;emit(true,true);},200);
    });
    surface.addEventListener('pointermove',event=>{
      if (pointer!==event.pointerId) return;
      const rect=surface.getBoundingClientRect();
      if (Math.hypot(event.clientX-start.x,event.clientY-start.y)>rect.width*.035) {moved=true;clearTimeout(holdTimer);}
      position=locate(event);emit(true,down);
    });
    surface.addEventListener('pointerup',event=>{
      if (pointer!==event.pointerId) return;
      clearTimeout(holdTimer);pointer=null;
      if (moved || down) {down=false;emit(false,false);return;}
      // Edge taps behave like the handheld's four direction clicks.
      if (position.y<.2) position={x:.5,y:0};
      else if (position.y>.8) position={x:.5,y:1};
      else if (position.x<.2) position={x:0,y:.5};
      else if (position.x>.8) position={x:1,y:.5};
      else position={x:.5,y:.5};
      emit(true,true);tapTimer=setTimeout(()=>emit(false,false),90);
    });
    surface.addEventListener('pointercancel',event=>{if (pointer===event.pointerId) release();});
    surface.addEventListener('lostpointercapture',event=>{if (pointer===event.pointerId) release();});
    return release;
  }
  const keyMap={Enter:'enter',Escape:'esc',Backspace:'del',Delete:'del',Tab:'tab',Home:'on',PageUp:'doc',PageDown:'menu',Control:'ctrl',Shift:'shift',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right','+':'add','-':'subtract','*':'multiply','/':'divide','^':'power','=':'equal','(':'leftparen',')':'rightparen','.':'decimal',',':'comma',' ':'space','_':'negative','?':'punct'};
  for (let i=0;i<26;i++) keyMap[String.fromCharCode(97+i)]=String.fromCharCode(97+i);
  window.createGregleEmulator({engine:'tinspire',keyMap,alphaKeys,menus,controls,keys,renderLayout,bindTouchpad,
    arrows:[['up','▲',8,0],['left','◀',8,1],['right','▶',8,2],['down','▼',8,3]]
  });
})();
