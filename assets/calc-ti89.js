/* TI-89 hardware layout. SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  const key=(name,label,code,second='',alpha='',style='') => [name,label,code,0,second,alpha,style];
  const keyMap={Enter:'enter',Backspace:'del',Delete:'clear',Escape:'esc',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Shift:'second',Alt:'alpha',F1:'f1',F2:'f2',F3:'f3',F4:'f4',F5:'f5','+':'add','-':'subtract','*':'multiply','/':'divide','^':'power','=':'equal','(':'leftparen',')':'rightparen',',':'comma','.':'decimal','_':'negative','|':'with',Home:'home',x:'x',y:'y',z:'z',t:'t'};
  window.createGregleEmulator({engine:'ti89',keyMap,
    diamond:{f1:'Y=',f2:'WINDOW',f3:'GRAPH',f4:'TBLSET',f5:'TABLE',second:'CUT',shift:'COPY',esc:'PASTE',catalog:'∞',del:'DEL',x:'eˣ',y:'sin⁻¹',z:'cos⁻¹',t:'tan⁻¹',power:'θ',ee:'KEY',enter:'≈'},
    menus:[key('f1','F1',47,'F6'),key('f2','F2',39,'F7'),key('f3','F3',31,'F8'),key('f4','F4',23),key('f5','F5',15)],
    controls:[key('second','2nd',4,'','', 'second-key'),key('shift','⇧',5),key('esc','ESC',48,'QUIT'),key('diamond','◆',6),key('alpha','ALPHA',7,'A-LOCK','','alpha-key'),key('apps','APPS',40,'SWITCH')],
    arrows:[['up','▲',0,0],['left','◀',1,0],['right','▶',3,0],['down','▼',2,0]],
    keys:[
      key('home','HOME',46,'CUSTOM'),key('mode','MODE',38),key('catalog','CATALOG',30,'i'),key('del','←',22,'INS'),key('clear','CLEAR',14),
      key('x','X',45,'ln'),key('y','Y',37,'sin'),key('z','Z',29,'cos'),key('t','T',21,'tan'),key('power','^',13,'π'),
      key('equal','=',44,'≠','A'),key('leftparen','(',36,'{','B'),key('rightparen',')',28,'}','C'),key('comma',',',20,'[','D'),key('divide','÷',12,']','E','emu-operator'),
      key('with','|',43,'°','F'),key('7','7',35,"'",'G','emu-number'),key('8','8',27,'∠','H','emu-number'),key('9','9',19,'i','I','emu-number'),key('multiply','×',11,'√','J','emu-operator'),
      key('ee','EE',42,'≤','K'),key('4','4',34,':','L','emu-number'),key('5','5',26,'MATH','M','emu-number'),key('6','6',18,'MEM','N','emu-number'),key('subtract','−',10,'VAR-LINK','O','emu-operator'),
      key('store','STO→',41,'RCL','P'),key('1','1',33,'"','Q','emu-number'),key('2','2',25,'\\','R','emu-number'),key('3','3',17,'UNITS','S','emu-number'),key('add','+',9,'CHAR','U','emu-operator'),
      key('on','ON',80,'OFF'),key('0','0',32,'<','V','emu-number'),key('decimal','.',24,'>','W','emu-number'),key('negative','(−)',16,'ANS','␣'),key('enter','ENTER',8,'ENTRY','↵','emu-enter')
    ]
  });
})();
