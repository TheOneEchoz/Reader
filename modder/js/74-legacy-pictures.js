/* Picture previews for legacy safe boot. All reads come from the encrypted
 * imported files, including RPA archives. No Python query bridge or game
 * modification is needed. Images made from several displayables are best-
 * effort previews; the running game remains the visual authority. */
function tkbLegacyPictureResolver(gid, story) {
  const Pic = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',avif:'image/avif'};
  const tail = /\s+(?:at|as|behind|onlayer|zorder|with|where)\b[\s\S]*$/i;
  const normalized = s => String(s || '').toLowerCase().replace(/\\/g,'/').replace(/^game\//,'').replace(/^images\//,'');
  const tokens = s => normalized(s).replace(/\.[a-z0-9]+$/,'').split(/[\s_\-/]+/).filter(Boolean);
  const cache = new Map(), urlCache = new Map(), details = new Map();
  const registered = story && story.imagefiles || {};
  const cleanQuery = name => String(name || '').replace(tail,'').trim().replace(/^[\"']|[\"']$/g,'');
  const natural = (a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'});
  let indexP = null, fallbackP = null, listP = null, fullyIndexed = false, disposed = false;
  const storedFiles = () => listP || (listP = S.gal(gid).then(gameFileList));
  const index = () => indexP || (indexP = (async () => {
    const list = await storedFiles();
    const byName = new Map();
    const add = (name, read) => {
      if (!Pic.test(name)) return;
      const key = normalized(name);
      if (!byName.has(key)) byName.set(key, {name:key, read, words:tokens(key)});
    };
    // Archive files first; loose image files override them when names clash.
    for (const f of list) if (/^game\/.*(?:images?|sprites?|backgrounds?|cg)[^/]*\.rpa$/i.test(f.p)) {
      const archive = await rpaIndex(f).catch(() => null);
      if (!archive) continue;
      for (const [name, entry] of archive) add(name, () => rpaRead(f, entry));
    }
    for (const f of list) if (/^game\//i.test(f.p) && !/\.rpa$/i.test(f.p)) {
      const key = normalized(f.p);
      if (Pic.test(key)) byName.set(key, {name:key, read:() => rpyRange(f, 0, f.s), words:tokens(key)});
    }
    return byName;
  })().catch(err => { indexP = null; throw err; }));
  // Most games store artwork in images.rpa. Index unrelated archives only when
  // a requested image was not found there, rather than blocking every preview.
  const fallbackIndex = () => fallbackP || (fallbackP = (async () => {
    const files = await index();
    const list = await storedFiles();
    for (const f of list) if (/^game\/.*\.rpa$/i.test(f.p) && !/(?:images?|sprites?|backgrounds?|cg)[^/]*\.rpa$/i.test(f.p)) {
      const archive = await rpaIndex(f).catch(() => null);
      if (!archive) continue;
      for (const [name, entry] of archive) {
        if (!Pic.test(name)) continue;
        const key = normalized(name);
        if (!files.has(key)) files.set(key, {name:key,read:()=>rpaRead(f,entry),words:tokens(key)});
      }
    }
    fullyIndexed = true;
    return files;
  })().catch(err => {fallbackP=null; throw err;}));
  const urlFor = async item => {
    if (!item || disposed) return null;
    if (!urlCache.has(item.name)) urlCache.set(item.name, Promise.resolve(item.read()).then(bytes => {
      if (disposed) return null;
      const ext = item.name.split('.').pop().toLowerCase();
      return URL.createObjectURL(new Blob([bytes], {type:mime[ext] || 'application/octet-stream'}));
    }).catch(() => null));
    return urlCache.get(item.name);
  };
  const image = name => {
    const query = cleanQuery(name);
    if (!query) return Promise.resolve(null);
    if (!cache.has(query)) cache.set(query, (async () => {
      const files = await index();
      const found = [], seen = new Set();
      const include = (item) => { if (item && !seen.has(item.name)) {seen.add(item.name);found.push(item);} };
      const byPath = path => files.get(normalized(path)) || files.get('images/' + normalized(path));
      // Registered Ren'Py image definitions are preferable to guessing from a
      // filename. Their paths are extracted once during legacy AST export.
      const entry = registered[query] || registered[query.toLowerCase()] || null;
      const candidates = Array.isArray(entry) ? entry : (entry && entry.files) || [];
      for (const path of candidates) {
        const exact = byPath(path);
        if (exact) include(exact);
      }
      if (found.length) {
        // Animation definitions refer to consecutive frames, not layers to
        // paint simultaneously. LayeredImage definitions do need composition.
        if (entry && /(?:animation|movie|anim)/i.test(String(entry.type || ''))) {
          found.sort(natural);
          found.splice(1);
          details.set(query, {why: 'Animated registered image: showing one representative frame.'});
        } else details.set(query, {why: 'Registered image: ' + found.map(x=>x.name).join(', ')});
      }
      // Direct image path, e.g. `bg club` -> images/bg/club.png.
      if (!found.length) {
        const key = normalized(query);
        for (const suffix of ['.png','.jpg','.jpeg','.webp','.gif']) {
          for (const prefix of ['', 'images/']) {
            const exact = files.get(prefix + key.replace(/\s+/g,'/') + suffix) || files.get(prefix + key.replace(/\s+/g,'_') + suffix);
            if (exact) {include(exact);break;}
          }
          if (found.length) break;
        }
      }
      // The name in a `show` statement is a Ren'Py image registration, not
      // necessarily a physical filename. Some games (DDLC included) have CG
      // frame sequences in a folder named after the image, e.g. `show y_kill`
      // uses `images/cg/y_kill/1a.png`, etc. Resolve the group by its folder
      // and show a representative frame instead of stacking an animation.
      if (!found.length) {
        const qwords = tokens(query), qkey = qwords.join('');
        const filesArr = [...files.values()];
        // First prefer a file named exactly after the image, regardless of
        // whether it lives in cg/, images/, gui/, or another subdirectory.
        let direct = filesArr.filter(item => {
          const base = item.name.split('/').pop().replace(/\.[^.]+$/,'');
          return tokens(base).join('') === qkey;
        });
        if (direct.length === 1) {
          include(direct[0]);
          details.set(query, {why:'Image filename: '+direct[0].name});
        }
        // If multiple files share a name there isn't enough information to
        // choose one, so a scoped image directory is the next best signal.
        if (!found.length && qwords.length >= 2) {
          const folders = new Map();
          for (const item of filesArr) {
            const parts = item.name.split('/');
            if (parts.length < 2) continue;
            const folder = parts[parts.length-2];
            if (tokens(folder).join('') !== qkey) continue;
            const dir = parts.slice(0,-1).join('/');
            if (!folders.has(dir)) folders.set(dir, []);
            folders.get(dir).push(item);
          }
          if (folders.size === 1) {
            const group = [...folders.values()][0].sort(natural);
            // Prefer the earliest numbered frame for image sequences.
            include(group[0]);
            details.set(query, {why: group.length > 1
              ? 'Animated / multi-frame image: representative frame from '+group[0].name+' ('+group.length+' files in this group).'
              : 'Image directory match: '+group[0].name});
          }
        }
      }
      if (!found.length) {
        const words = tokens(query), strip = x => x.name.replace(/^images\//,'');
        const names = [...files.values()].filter(x => /^(?:images\/)?(?:bg|cg|splash|sayori|natsuki|yuri|monika)\//.test(x.name));
        // A complete filename-token match is confident enough to show. E.g.
        // `bg club` can match images/bg/club.png; `bg club_day` can match
        // club.png when that is the only matching background file.
        let exact = names.filter(x => x.words.join(' ') === words.join(' '));
        if (!exact.length && words.length >= 2) exact = names.filter(x => x.words[0] === words[0] &&
          (x.words.slice(1).join('') === words.slice(1).join('') ||
           x.words.slice(1).join('') === words.slice(1).join('').replace(/(?:day|night|evening)$/,'') ));
        if (exact.length === 1) {include(exact[0]);details.set(query, {why:'Filename match: '+strip(exact[0])});}
        // Composite sprites in DDLC often have a base pose 1bl/1br and a
        // separate expression a/b/c. Preview those layers rather than blank.
        if (!found.length && words.length >= 2 && /^(sayori|natsuki|yuri|monika)$/.test(words[0])) {
          const pose = words[1], tag = words[0];
          const sprite = names.filter(x => x.words[0] === tag);
          const choose = x => sprite.find(i => i.words.slice(1).join('') === x);
          const base = choose(pose) || choose(pose.replace(/[a-z]$/i,'')+'bl') || choose(pose.replace(/[a-z]$/i,'')+'br');
          if (base) {
            include(base);
            const face = choose((pose.match(/[a-z]$/i)||[])[0]);
            if (face && face !== base) include(face);
            details.set(query,{why:'Approximate sprite preview; see the running game for exact layering.'});
          }
        }
      }
      if (!found.length && !fullyIndexed) {
        await fallbackIndex();
        // Retry against the expanded index. Delete the in-flight cache entry
        // before recursively resolving to avoid waiting on our own promise.
        cache.delete(query);
        return image(query);
      }
      if (!found.length) {details.set(query,{why:'No matching image file found in the game archives.'});return null;}
      const out = (await Promise.all(found.slice(0, 5).map(urlFor))).filter(Boolean);
      return out.length ? out : null;
    })().catch(err => {details.set(query,{why:'Image archive lookup failed: '+String(err.message||err)});return null;}));
    // Avoid a permanent 'looking…' placeholder when an IndexedDB/archive read
    // stalls. An explicit retry may rebuild the index.
    const pending = cache.get(query);
    let timer;
    const timed = Promise.race([pending, new Promise(resolve => {timer=setTimeout(() => {
      details.set(query,{why:'Image lookup timed out. Retry to rebuild the archive index.'});
      resolve(null);
    }, 12000);})]).finally(() => clearTimeout(timer));
    cache.set(query, timed);
    return timed;
  };
  const retry = name => {
    cache.delete(cleanQuery(name));
    indexP=null; fallbackP=null; listP=null; fullyIndexed=false;
    return image(name);
  };
  const info = name => details.get(String(name || '').replace(tail,'').trim()) || null;
  const assets = async kind => {
    if (kind === 'label') return (story.scenes || []).map(s => ({name:s.n,value:s.n}));
    if (kind === 'char') return (story.chars || []).map(c => ({name:c[1],value:c[0]}));
    const files = await index();
    if (kind === 'image' || kind === 'tag') {
      const names = Object.keys(registered);
      if (names.length) return (kind === 'image' ? names : [...new Set(names.map(n=>n.split(/\s+/)[0]))]).sort().map(n=>({name:n,value:n}));
      const derived = [...files.keys()].filter(n=>n.startsWith('images/')).map(n=>n.replace(/^images\//,'').replace(/\.[^.]+$/,'').replace(/[/_]/g,' '));
      return [...new Set(kind === 'tag' ? derived.map(n=>n.split(' ')[0]) : derived)].sort().map(n=>({name:n,value:n}));
    }
    return [];
  };
  const close = () => { disposed = true; for (const promise of urlCache.values()) Promise.resolve(promise).then(url=>url && URL.revokeObjectURL(url)); urlCache.clear(); cache.clear(); };
  return {image, retry, imageInfo:info, assets, close};
}
