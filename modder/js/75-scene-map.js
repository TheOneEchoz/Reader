/* A scene-to-scene map above the per-scene command charts. Only static
 * compiled AST relationships are represented: Jump / Call / fall-through.
 * Dynamic expression jumps are not guessed. */
function tkbSceneMapData(scenes, start = 'start') {
  const lookup = new Map(scenes.map(s => [s.n, s]));
  const edges = [], uniq = new Set();
  for (const s of scenes) {
    const add = (to, kind) => {
      if (!to || !lookup.has(to) || to === s.n) return;
      const key = s.n + '\n' + to + '\n' + kind;
      if (!uniq.has(key)) {uniq.add(key);edges.push({from:s.n,to,kind});}
    };
    for (const r of s.r || []) if ((r.k === 'jump' || r.k === 'call') && r.g) add(String(r.g),r.k);
    if (s.fall) add(String(s.fall),'fall');
  }
  const links = new Map(scenes.map(s => [s.n, []]));
  for (const e of edges) links.get(e.from).push(e);
  const priority = {jump:0,fall:1,call:2};
  for (const es of links.values()) es.sort((a,b)=>priority[a.kind]-priority[b.kind]);
  const ordered = scenes.slice().sort((a,b)=>(a.f||'').localeCompare(b.f||'') || (a.l||0)-(b.l||0));
  const roots = [start,...ordered.map(s=>s.n)].filter((n,i,a)=>lookup.has(n) && a.indexOf(n)===i);
  const groups = [], assigned = new Set();
  for (const root of roots) {
    if (assigned.has(root)) continue;
    const depth = new Map([[root,0]]), queue = [root]; assigned.add(root);
    for (let q=0;q<queue.length;q++) for (const e of links.get(queue[q]) || []) {
      if (assigned.has(e.to)) continue;
      assigned.add(e.to); depth.set(e.to,Math.min(50,depth.get(queue[q])+1));queue.push(e.to);
    }
    groups.push({root, depth, queue});
  }
  const positions = new Map(), NW=222, NH=76, CW=282, RH=112;
  let bandY = 40, maxW = 250;
  for (const group of groups) {
    const layers = new Map();
    for (const name of group.queue) {const d = group.depth.get(name)||0;(layers.get(d)||layers.set(d,[]).get(d)).push(name);}
    // Stable parent ordering minimizes crossing among sibling scene nodes.
    const rank = new Map(group.queue.map((n,i)=>[n,i]));
    for (const [d,names] of layers) if (d>0) names.sort((a,b)=>{
      const par = x => edges.filter(e=>e.to===x&&group.depth.get(e.from)===d-1);
      const x=par(a),y=par(b);
      const ax=x.length?Math.min(...x.map(e=>rank.get(e.from))):rank.get(a);
      const by=y.length?Math.min(...y.map(e=>rank.get(e.from))):rank.get(b);
      return ax-by || rank.get(a)-rank.get(b);
    });
    const rows = Math.max(1,...[...layers.values()].map(n=>n.length));
    for (const [d,names] of layers) names.forEach((n,i)=>positions.set(n,{x:32+d*CW,y:bandY+i*RH,w:NW,h:NH,depth:d,root:group.root}));
    maxW = Math.max(maxW, 32 + layers.size*CW);
    bandY += Math.max(120, rows*RH)+96;
  }
  return {positions, edges, width:maxW+80, height:bandY+30, components:groups.length};
}
function tkbDrawSceneMap(root, scenes, openScene, closeMap, initial='start', state={}) {
  const map = tkbSceneMapData(scenes, initial);
  const mk = h;
  const header = mk('div',{class:'mtop'},
    mk('button',{class:'btn small',id:'ch-close',onclick:closeMap},icon('back'),'Game'),
    mk('b',{},'Scene map'), mk('small',{class:'hint'},ENGINE_VERSION+' · '+scenes.length+' scenes'),
    mk('button',{class:'btn small ghost',id:'ch-map-fit'},icon('full'),'Fit all'),
    mk('button',{class:'btn small ghost',id:'ch-map-start'},'Go to start'));
  const search = mk('input',{class:'text',type:'search',id:'ch-map-search',placeholder:'Find scene label…','aria-label':'Find a scene'});
  const matches = mk('div',{class:'ch-map-matches',id:'ch-map-results'});
  const aside = mk('aside',{class:'ch-map-sidebar'},
    mk('p',{class:'hint'},'Each box is a scene. Click one to open its command graph; use “Scene map” to come back here.'),search,
    mk('div',{class:'ch-map-legend'},mk('span',{class:'jump'},'Jump'),mk('span',{class:'call'},'Call'),mk('span',{class:'fall'},'Fall through')),
    matches, mk('small',{class:'hint'},'Only statically named links are drawn. Expression-based jumps can add routes at runtime.'));
  const viewport = mk('div',{class:'ch-map-viewport',id:'ch-map-viewport',tabindex:'0',role:'region','aria-label':'Pan and zoom the scene map'});
  const world = mk('div',{class:'ch-map-world',style:`width:${map.width}px;height:${map.height}px`});
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',map.width);svg.setAttribute('height',map.height);
  svg.classList.add('ch-map-lines');
  const NS='http://www.w3.org/2000/svg';
  for (const e of map.edges) {
    const a=map.positions.get(e.from),b=map.positions.get(e.to);if (!a||!b) continue;
    const backward=b.x <= a.x;
    const x1=a.x+a.w,y1=a.y+32,x2=b.x,y2=b.y+32;
    const bend=backward?Math.max(a.x,b.x)+a.w+40:(x2-x1)*.44;
    const d=backward?`M ${x1} ${y1} C ${bend} ${y1} ${bend} ${y2} ${x2} ${y2}`:`M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`;
    const path=document.createElementNS(NS,'path');path.setAttribute('d',d);path.setAttribute('class',e.kind);
    const tip=document.createElementNS(NS,'title');tip.textContent=e.from+' → '+e.to+' ('+e.kind+')';path.appendChild(tip);svg.appendChild(path);
  }
  world.appendChild(svg);
  const nodes=new Map();
  for (const s of scenes) {
    const p=map.positions.get(s.n);if (!p)continue;
    const el=mk('button',{class:'ch-map-node'+(s.n===initial?' start':''),type:'button','data-scene':s.n,
      title:s.n+' — open '+(s.r||[]).length+' commands',style:`left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`,onclick:()=>{state.focus=s.n;openScene(s.n);}},
      mk('b',{},s.n),mk('small',{},(s.r||[]).length+' commands'));
    world.append(el);nodes.set(s.n,el);
  }
  viewport.append(world);
  const main=mk('div',{class:'ch-map-main'},aside,viewport);
  root.replaceChildren(header,main);
  let zoom = state.zoom || .84, panX = Number.isFinite(state.x)?state.x:36, panY=Number.isFinite(state.y)?state.y:64;
  const transform=()=>{world.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;state.x=panX;state.y=panY;state.zoom=zoom;};
  const focus=name=>{
    const p=map.positions.get(name);if(!p)return;
    panX=Math.round(viewport.clientWidth*.32-(p.x+p.w/2)*zoom);
    panY=Math.round(viewport.clientHeight*.4-(p.y+p.h/2)*zoom);
    transform();for(const [n,el] of nodes) el.classList.toggle('focused',n===name);
    state.focus=name;
  };
  const fit=()=>{
    zoom=Math.max(.13,Math.min(1,(viewport.clientWidth-40)/map.width,(viewport.clientHeight-40)/map.height));
    panX=20;panY=20;transform();
  };
  header.querySelector('#ch-map-fit').onclick=fit;
  header.querySelector('#ch-map-start').onclick=()=>{zoom=.84;focus(scenes.some(s=>s.n==='start')?'start':scenes[0]?.n);};
  const renderMatches=()=>{
    const q=search.value.trim().toLowerCase();const found=q?scenes.filter(s=>s.n.toLowerCase().includes(q)||String(s.f||'').toLowerCase().includes(q)):scenes;
    matches.replaceChildren(mk('small',{class:'hint'},found.length+' scenes'+(found.length>100?' · search to narrow':'')),
      ...found.slice(0,100).map(s=>mk('button',{class:'ch-map-result',type:'button',onclick:()=>focus(s.n)},
        mk('span',{},s.n),mk('small',{},(s.r||[]).length))));
    for(const [n,el] of nodes) el.classList.toggle('dim',!!q&&!n.toLowerCase().includes(q));
  };
  search.addEventListener('input',renderMatches);renderMatches();
  let dragging=null;
  viewport.addEventListener('pointerdown',e=>{
    if (e.button!==0&&e.button!==1)return;
    if(e.target.closest('button'))return;
    dragging={x:e.clientX,y:e.clientY,px:panX,py:panY,id:e.pointerId};
    viewport.setPointerCapture(e.pointerId);viewport.classList.add('panning');e.preventDefault();
  });
  viewport.addEventListener('pointermove',e=>{
    if (!dragging||e.pointerId!==dragging.id)return;
    panX=dragging.px+e.clientX-dragging.x;panY=dragging.py+e.clientY-dragging.y;transform();
  });
  const endDrag=()=>{dragging=null;viewport.classList.remove('panning');};
  viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
  viewport.addEventListener('wheel',e=>{
    e.preventDefault();const r=viewport.getBoundingClientRect();const x=e.clientX-r.left,y=e.clientY-r.top;
    const nz=Math.min(2.2,Math.max(.13,zoom*Math.exp(-e.deltaY*.0014))),ratio=nz/zoom;
    panX=x-(x-panX)*ratio;panY=y-(y-panY)*ratio;zoom=nz;transform();
  },{passive:false});
  const openAt=state.focus&&map.positions.has(state.focus)?state.focus:map.positions.has(initial)?initial:scenes[0]?.n;
  // Wait for the viewport to obtain its actual width before centering.
  requestAnimationFrame(()=>{if(!viewport.isConnected)return;transform();if(!state.visited&&openAt)focus(openAt);state.visited=true;});
  transform();
}
