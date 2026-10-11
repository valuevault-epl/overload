import { FIREBASE_CONFIG } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, orderBy, limit, onSnapshot, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const { h, render } = preact;
const { useState, useEffect, useMemo, useRef, useCallback } = preactHooks;
const html = htm.bind(h);


/* ---------------- constants ---------------- */
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const GROUPS = ['Chest','Back','Legs','Shoulders','Arms','Core','Other'];
const KG_PER_LB = 0.45359237;
const CATALOG = [
  ['Bench Press','Chest'],['Incline Bench Press','Chest'],['Dumbbell Bench Press','Chest'],['Incline Dumbbell Press','Chest'],['Chest Fly','Chest'],['Dips','Chest'],['Push-up','Chest'],
  ['Deadlift','Back'],['Barbell Row','Back'],['Dumbbell Row','Back'],['Pull-up','Back'],['Chin-up','Back'],['Lat Pulldown','Back'],['Seated Cable Row','Back'],['Face Pull','Back'],['Shrug','Back'],
  ['Squat','Legs'],['Front Squat','Legs'],['Romanian Deadlift','Legs'],['Leg Press','Legs'],['Hack Squat','Legs'],['Leg Curl','Legs'],['Leg Extension','Legs'],['Bulgarian Split Squat','Legs'],['Lunge','Legs'],['Hip Thrust','Legs'],['Calf Raise','Legs'],['Goblet Squat','Legs'],
  ['Overhead Press','Shoulders'],['Dumbbell Shoulder Press','Shoulders'],['Arnold Press','Shoulders'],['Lateral Raise','Shoulders'],['Rear Delt Fly','Shoulders'],
  ['Bicep Curl','Arms'],['Hammer Curl','Arms'],['Preacher Curl','Arms'],['Tricep Pushdown','Arms'],['Skull Crusher','Arms'],['Overhead Tricep Extension','Arms'],
  ['Plank','Core'],['Hanging Leg Raise','Core'],['Cable Crunch','Core'],['Ab Wheel Rollout','Core'],
];
const SPLITS = {
  ppl:{label:'Push / Pull / Legs',blurb:'6 days: Push, Pull, Legs, then again. Goal of 5 a week.',goal:5,
    templates:[['Push',['Bench Press','Overhead Press','Incline Dumbbell Press','Lateral Raise','Tricep Pushdown']],
               ['Pull',['Barbell Row','Pull-up','Lat Pulldown','Face Pull','Bicep Curl']],
               ['Legs',['Squat','Romanian Deadlift','Leg Press','Leg Curl','Calf Raise']]],
    week:{mon:0,tue:1,wed:2,thu:0,fri:1,sat:2}},
  ul:{label:'Upper / Lower',blurb:'4 days: Mon Upper, Tue Lower, Thu Upper, Fri Lower.',goal:4,
    templates:[['Upper',['Bench Press','Barbell Row','Overhead Press','Lat Pulldown','Bicep Curl','Tricep Pushdown']],
               ['Lower',['Squat','Romanian Deadlift','Leg Press','Leg Curl','Calf Raise','Plank']]],
    week:{mon:0,tue:1,thu:0,fri:1}},
  fb:{label:'Full body',blurb:'3 days: Mon, Wed, Fri.',goal:3,
    templates:[['Full Body',['Squat','Bench Press','Barbell Row','Overhead Press','Romanian Deadlift','Plank']]],
    week:{mon:0,wed:0,fri:0}},
  blank:{label:'Start blank',blurb:'No workouts yet. Build your own in Plan.',goal:3,templates:[],week:{}},
};

/* ---------------- helpers ---------------- */
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); };
const dayIdx = s => (parseYmd(s).getDay()+6)%7;
const weekOf = s => addDays(s, -dayIdx(s));
const todayStr = () => ymd(new Date());
const fmtDate = s => parseYmd(s).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
const fmtShort = s => parseYmd(s).toLocaleDateString(undefined,{day:'numeric',month:'short'});
const fmtLong = s => parseYmd(s).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
const fmtTime = t => { if(!t) return ''; const [hh,mm] = t.split(':').map(Number); return new Date(2000,0,1,hh,mm).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); };
const clone = o => JSON.parse(JSON.stringify(o));
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'ex';
const catGroup = n => (CATALOG.find(c => c[0].toLowerCase() === n.toLowerCase()) || [0,'Other'])[1];
const num = v => { if(v===null || v===undefined || v==='') return null; const n = parseFloat(String(v).replace(',','.')); return isFinite(n) ? n : null; };
const toDisp = (kg, unit) => unit === 'lb' ? kg / KG_PER_LB : kg;
const toKg = (v, unit) => unit === 'lb' ? v * KG_PER_LB : v;
const fmtNum = (n, dp=1) => (Math.round(n * 10**dp) / 10**dp).toLocaleString(undefined,{maximumFractionDigits:dp});
const fmtW = (kg, unit) => fmtNum(toDisp(kg, unit), 2);
const rawW = (kg, unit) => String(Math.round(toDisp(kg, unit) * 100) / 100);
const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const tryLS = (k, v) => { try { if(v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch(e) { return null; } };

/* ---------------- lift maths ---------------- */
const e1rm = (w, r) => (!(r > 0) || !(w > 0)) ? 0 : (r === 1 ? w : w * (1 + r / 30));
const setsOf = it => (it.sets || []).filter(s => s && s.r > 0).map(s => ({ w: s.w > 0 ? s.w : 0, r: s.r }));
const hasSets = w => (w.items || []).some(it => setsOf(it).length);
function summarize(sets){
  let top = null, best = 0, vol = 0, reps = 0, maxR = 0;
  for(const s of sets){
    if(!top || s.w > top.w || (s.w === top.w && s.r > top.r)) top = s;
    best = Math.max(best, e1rm(s.w, s.r)); vol += s.w * s.r; reps += s.r; maxR = Math.max(maxR, s.r);
  }
  return { top, e1rm: best, vol, reps, maxR, n: sets.length };
}
const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.savedAt || '') < (b.savedAt || '') ? -1 : 1);
function buildHistory(workouts){
  const map = new Map();
  for(const w of [...workouts].sort(byDate)){
    for(const it of (w.items || [])){
      const sets = setsOf(it); if(!sets.length) continue;
      const s = summarize(sets); s.date = w.date; s.wid = w.id; s.sets = sets; s.example = !!w.example;
      if(!map.has(it.ex)) map.set(it.ex, []);
      map.get(it.ex).push(s);
    }
  }
  for(const arr of map.values()){
    const bw = arr.every(s => s.top.w === 0);
    let best = -1;
    arr.forEach((s, i) => { const v = bw ? s.maxR : s.e1rm; if(i > 0 && v > best + 1e-9) s.pr = true; best = Math.max(best, v); });
    arr.bw = bw;
  }
  return map;
}
function compare(prev, cur){
  if(!prev) return { kind:'first' };
  const eps = 1e-6, dw = cur.top.w - prev.top.w, dr = cur.top.r - prev.top.r;
  if(dw > eps) return { kind:'weight', dw };
  if(Math.abs(dw) <= eps){
    if(dr > 0) return { kind:'reps', dr };
    if(dr === 0){
      if(cur.reps > prev.reps) return { kind:'volume', dr: cur.reps - prev.reps };
      if(cur.reps === prev.reps) return { kind:'hold' };
      return { kind:'down', dr: cur.reps - prev.reps, total:true };
    }
    return { kind:'down', dr };
  }
  if(cur.e1rm > prev.e1rm + eps) return { kind:'e1rm' };
  return { kind:'down', dw };
}
const UP_KINDS = ['weight','reps','volume','e1rm'];
function changeInfo(c, unit){
  switch(c.kind){
    case 'weight': return { tone:'up', text:`▲ ${signed(c.dw, v => fmtW(v, unit))} ${unit}` };
    case 'reps': return { tone:'up', text:`▲ +${plural(c.dr,'rep')}` };
    case 'volume': return { tone:'up', text:`▲ +${c.dr} total reps` };
    case 'e1rm': return { tone:'up', text:'▲ Est. 1RM up' };
    case 'hold': return { tone:'hold', text:'= Same as last' };
    case 'down': return { tone:'down', text: c.dw ? `▼ ${signed(c.dw, v => fmtW(v, unit))} ${unit}` : `▼ ${Math.abs(c.dr)} ${c.total ? 'total ' : ''}rep${Math.abs(c.dr) === 1 ? '' : 's'}` };
    default: return { tone:'new', text:'First log' };
  }
}
function lastBefore(hist, ex, draft){
  const arr = hist.get(ex) || [];
  for(let i = arr.length - 1; i >= 0; i--){ const s = arr[i]; if(s.wid !== draft.id && s.date <= draft.date) return s; }
  return null;
}
function bestBefore(hist, ex, draft){
  const arr = (hist.get(ex) || []).filter(s => s.wid !== draft.id && s.date <= draft.date);
  if(!arr.length) return null;
  return { e1rm: Math.max(...arr.map(s => s.e1rm)), maxR: Math.max(...arr.map(s => s.maxR)), bw: arr.every(s => s.top.w === 0) };
}
function fmtSets(sets, unit){
  if(!sets.length) return '';
  const same = sets.every(s => Math.abs(s.w - sets[0].w) < 1e-6);
  if(same) return sets[0].w > 0 ? `${fmtW(sets[0].w, unit)} ${unit} × ${sets.map(s => s.r).join(', ')}` : `${sets.map(s => s.r).join(', ')} reps`;
  return sets.map(s => s.w > 0 ? `${fmtW(s.w, unit)}×${s.r}` : `BW×${s.r}`).join(', ');
}
const fmtTop = (t, unit) => t.w > 0 ? `${fmtW(t.w, unit)} ${unit} × ${t.r}` : `${plural(t.r,'rep')}`;
const exName = (profile, it) => (profile.exercises && profile.exercises[it.ex] && profile.exercises[it.ex].name) || it.n || it.ex;
function weeklyRows(sessions){
  const m = new Map();
  for(const s of sessions){
    const k = weekOf(s.date);
    const g = m.get(k) || { date:k, top:null, e1rm:0, vol:0, reps:0, maxR:0, n:0, sessions:0, pr:false };
    if(!g.top || s.top.w > g.top.w || (s.top.w === g.top.w && s.top.r > g.top.r)) g.top = s.top;
    g.e1rm = Math.max(g.e1rm, s.e1rm); g.vol += s.vol; g.reps += s.reps; g.maxR = Math.max(g.maxR, s.maxR); g.n += s.n; g.sessions++; g.pr = g.pr || !!s.pr;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.date < b.date ? -1 : 1);
}

/* ---------------- consistency ---------------- */
function consistency(profile, workouts, today){
  const goal = profile.weeklyGoal || 3;
  const dates = new Set(workouts.filter(hasSets).map(w => w.date));
  const planned = ds => { const e = profile.week && profile.week[DAYS[dayIdx(ds)]]; return !!(e && e.tpl && profile.templates && profile.templates[e.tpl]); };
  const firstLog = [...dates].sort()[0];
  const created = profile.createdOn || today;
  const start = firstLog && firstLog < created ? firstLog : created;
  const curWeek = weekOf(today), startWeek = weekOf(start);
  const weekCount = ws => { let c = 0; for(let j = 0; j < 7; j++) if(dates.has(addDays(ws, j))) c++; return c; };
  const weeks = [];
  for(let i = 11; i >= 0; i--){
    const ws = addDays(curWeek, -7 * i), days = [];
    for(let j = 0; j < 7; j++){
      const ds = addDays(ws, j), did = dates.has(ds), p = planned(ds);
      let state;
      if(ds > today) state = p ? 'plan' : 'future';
      else if(did) state = 'done';
      else if(ds < start) state = 'none';
      else if(ds === today) state = p ? 'today' : 'rest';
      else state = p ? 'miss' : 'rest';
      days.push({ date: ds, state });
    }
    weeks.push({ start: ws, days, count: weekCount(ws), before: addDays(ws, 6) < start });
  }
  let streak = weekCount(curWeek) >= goal ? 1 : 0;
  for(let ws = addDays(curWeek, -7); ws >= startWeek && weekCount(ws) >= goal; ws = addDays(ws, -7)) streak++;
  let best = 0, run = 0;
  for(let ws = startWeek; ws <= curWeek; ws = addDays(ws, 7)){
    if(weekCount(ws) >= goal){ run++; best = Math.max(best, run); } else if(ws !== curWeek) run = 0;
  }
  let plannedN = 0, hitN = 0, sessions28 = 0;
  for(let i = 0; i < 28; i++){
    const ds = addDays(today, -i); if(ds < start) break;
    if(dates.has(ds)) sessions28++;
    if(!planned(ds) || (ds === today && !dates.has(ds))) continue;
    plannedN++; if(dates.has(ds)) hitN++;
  }
  let next = null;
  for(let i = 0; i < 8; i++){
    const ds = addDays(today, i);
    if(planned(ds) && !(i === 0 && dates.has(ds))){ const e = profile.week[DAYS[dayIdx(ds)]]; next = { date: ds, tpl: e.tpl, time: e.time }; break; }
  }
  return { goal, weeks, thisWeek: weeks[weeks.length - 1], streak, best, adherence: plannedN ? hitN / plannedN : null, plannedN, hitN, sessions28, next, start };
}

/* ---------------- store (Firebase) ---------------- */
const configured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && !String(FIREBASE_CONFIG.apiKey).startsWith('REPLACE'));
const fbApp = configured ? initializeApp(FIREBASE_CONFIG) : null;
const auth = fbApp ? getAuth(fbApp) : null;
let db = null;
if(fbApp){
  // Keeps a copy of the log on the device, so it opens and saves with no signal and syncs later.
  try { db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch(e){ db = initializeFirestore(fbApp, {}); }
}
const store = { uid: null };
const profileDoc = () => doc(db, 'users', store.uid);
const workoutDoc = id => doc(db, 'users', store.uid, 'workouts', id);
let toastFn = () => {};
const toast = (msg) => toastFn({ msg, id: Date.now() + Math.random() });
function handleWriteError(e){
  const code = e && e.code;
  if(code === 'permission-denied') toast("Couldn't save: the database refused it. Sign out and back in.");
  else if(code === 'resource-exhausted') toast("Today's free database limit is used up. Changes will save tomorrow.");
  else toast("Couldn't save that change. Check your connection and try again.");
}
// Debounces bursts of edits into one write. Firestore applies writes to the local copy straight
// away and queues them for the server, so nothing here waits on the network.
function makeWriter(write, delay){
  let timer = null, pending = null;
  const flush = () => {
    if(timer){ clearTimeout(timer); timer = null; }
    if(!pending) return;
    const data = pending; pending = null;
    write(data).catch(handleWriteError);
  };
  return {
    queue(data, now){ pending = data; if(timer) clearTimeout(timer); timer = null; if(now) flush(); else timer = setTimeout(flush, delay); },
    busy(){ return !!timer; },
    cancel(){ if(timer) clearTimeout(timer); timer = null; pending = null; },
    flush,
  };
}
const profileWriter = makeWriter(data => setDoc(profileDoc(), data), 500);
const wWriters = new Map();
const wWriter = id => { if(!wWriters.has(id)) wWriters.set(id, makeWriter(data => setDoc(workoutDoc(id), data), 900)); return wWriters.get(id); };
const flushAll = () => { profileWriter.flush(); wWriters.forEach(w => w.flush()); };
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);

// The plan built in the Claude version of the app, offered as a starting point on first sign-in.
const MY_PLAN = {
  weeklyGoal: 5,
  exercises: {
    'back-extensions-45-degrees':{group:'Legs',name:'Back Extensions (45 degrees)'},'barbell-row':{group:'Back',name:'Barbell Row'},'bench-press':{group:'Chest',name:'Bench Press'},
    'bicep-curl':{group:'Arms',name:'Bicep Curl'},'calf-raise':{group:'Legs',name:'Calf Raise'},'chest-fly':{group:'Chest',name:'Chest Fly'},'dumbbell-bench-press':{group:'Chest',name:'Dumbbell Bench Press'},
    'face-pull':{group:'Back',name:'Face Pull'},'hack-squat':{group:'Legs',name:'Hack Squat'},'hammer-curl':{group:'Arms',name:'Hammer Curl'},'incline-chest-press':{group:'Chest',name:'Incline Chest Press'},
    'incline-dumbbell-press':{group:'Chest',name:'Incline Dumbbell Press'},'incline-dumbell-curls':{group:'Arms',name:'Incline Dumbell Curls'},'lat-pulldown':{group:'Back',name:'Lat Pulldown'},
    'lateral-raise':{group:'Shoulders',name:'Lateral Raise'},'leg-curl':{group:'Legs',name:'Leg Curl'},'leg-extension':{group:'Legs',name:'Leg Extension'},'leg-press':{group:'Legs',name:'Leg Press'},
    'lying-leg-curl':{group:'Legs',name:'Lying Leg Curl'},'overhead-press':{group:'Shoulders',name:'Overhead Press'},'overhead-tricep-extension':{group:'Arms',name:'Overhead Tricep Extension'},
    'preacher-curl':{group:'Arms',name:'Preacher Curl'},'pull-up':{group:'Back',name:'Pull-up'},'rear-delt-fly':{group:'Shoulders',name:'Rear Delt Fly'},'romanian-deadlift':{group:'Legs',name:'Romanian Deadlift'},
    'seated-cable-row':{group:'Back',name:'Seated Cable Row'},'seated-calf-raises':{group:'Legs',name:'Seated Calf Raises'},'seated-leg-curl':{group:'Legs',name:'Seated Leg Curl'},'squat':{group:'Legs',name:'Squat'},
    'standing-calf-raises':{group:'Legs',name:'Standing Calf Raises'},'t-bar-row':{group:'Back',name:'T-Bar Row'},'tricep-pushdown':{group:'Arms',name:'Tricep Pushdown'},
  },
  templates: {
    't-push':{name:'Push',exIds:['incline-dumbbell-press','dumbbell-bench-press','overhead-press','chest-fly','lateral-raise','overhead-tricep-extension','tricep-pushdown']},
    't-pull':{name:'Pull',exIds:['seated-cable-row','lat-pulldown','rear-delt-fly','preacher-curl','hammer-curl']},
    't-legs':{name:'Legs A',exIds:['lying-leg-curl','hack-squat','leg-extension','standing-calf-raises']},
    't-muzgxlw4uqw5':{name:'Upper',exIds:['incline-chest-press','t-bar-row','overhead-press','lateral-raise','overhead-tricep-extension','incline-dumbell-curls']},
    't-muzthf27kih3':{name:'Legs B',exIds:['seated-leg-curl','leg-press','back-extensions-45-degrees','seated-calf-raises']},
  },
  week: {
    mon:{tpl:null,time:'17:30'}, tue:{tpl:'t-push',time:'16:00'}, wed:{tpl:'t-pull',time:'14:00'}, thu:{tpl:'t-legs',time:'14:00'},
    fri:{tpl:null,time:'17:30'}, sat:{tpl:'t-muzgxlw4uqw5',time:'16:00'}, sun:{tpl:'t-muzthf27kih3',time:'16:00'},
  },
};
const PLAN_CHOICES = [['mine', { label: 'My plan from the Claude version', blurb: 'Push Tue, Pull Wed, Legs A Thu, Upper Sat, Legs B Sun. Goal of 5 a week.' }], ...Object.entries(SPLITS)];
function buildProfile(key, unit){
  if(key === 'mine') return { ...clone(MY_PLAN), unit, createdOn: todayStr(), v: 1 };
  const s = SPLITS[key], exercises = {}, templates = {}, week = {};
  const ids = s.templates.map(([name, exs]) => {
    const id = 't-' + slug(name);
    templates[id] = { name, exIds: exs.map(n => { const eid = slug(n); exercises[eid] = { name: n, group: catGroup(n) }; return eid; }) };
    return id;
  });
  DAYS.forEach(d => { const i = s.week[d]; week[d] = { tpl: i == null ? null : ids[i], time: '17:30' }; });
  return { unit, weeklyGoal: s.goal, exercises, templates, week, createdOn: todayStr(), v: 1 };
}
function uniqueExId(profile, name){
  const base = slug(name); let id = base, i = 2;
  while(profile.exercises && profile.exercises[id]) id = `${base}-${i++}`;
  return id;
}
function saveFile(name, text, type){
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null, installFn = () => {};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installFn(true); });

/* draft <-> doc */
function fromDoc(doc, unit){
  return { id: doc.id, date: doc.date, name: doc.name || 'Workout', tpl: doc.tpl || null, note: doc.note || '', live: !!doc.live, example: !!doc.example, unit,
    items: (doc.items || []).map(it => ({ ex: it.ex, n: it.n, sets: (it.sets || []).map(s => ({ w: s.w == null ? '' : rawW(s.w, unit), r: s.r == null ? '' : String(s.r), d: !!s.d })) })) };
}
function toDoc(d){
  const o = { date: d.date, name: (d.name || '').trim() || 'Workout', tpl: d.tpl || null, note: d.note || '', live: !!d.live, savedAt: new Date().toISOString(),
    items: d.items.map(it => ({ ex: it.ex, n: it.n || '', sets: it.sets.map(s => { const w = num(s.w), r = num(s.r); return { w: w == null ? null : Math.round(toKg(w, d.unit) * 10000) / 10000, r: r == null ? null : Math.max(0, Math.round(r)), d: !!s.d }; }) })) };
  if(d.example) o.example = true;
  return o;
}
const blankSets = n => Array.from({ length: Math.max(1, n) }, () => ({ w:'', r:'', d:false }));

/* ---------------- icons ---------------- */
const Svg = (size, kids) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kids}</svg>`;
const I = {
  today: (s=22) => Svg(s, html`<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>`),
  progress: (s=22) => Svg(s, html`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  plan: (s=22) => Svg(s, html`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  history: (s=22) => Svg(s, html`<path d="M4 6h16M4 12h16M4 18h10"/>`),
  check: (s=20) => Svg(s, html`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  up: (s=18) => Svg(s, html`<path d="M6 15l6-6 6 6"/>`),
  down: (s=18) => Svg(s, html`<path d="M6 9l6 6 6-6"/>`),
  x: (s=18) => Svg(s, html`<path d="M6 6l12 12M18 6L6 18"/>`),
  back: (s=18) => Svg(s, html`<path d="M15 6l-6 6 6 6"/>`),
};
const PlateGlyph = () => html`<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="var(--accent)"/><circle cx="12" cy="12" r="6" fill="none" stroke="var(--accent-ink)" stroke-width="1.5" opacity=".55"/><circle cx="12" cy="12" r="2.2" fill="var(--bg)"/></svg>`;

/* ---------------- small components ---------------- */
function Seg({ value, options, onChange, label }){
  return html`<div class="seg" role="radiogroup" aria-label=${label}>${options.map(([v, l]) => html`<button type="button" role="radio" aria-checked=${value === v} class=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}
function Chip({ c, unit }){ const x = changeInfo(c, unit); return html`<span class=${'chip t-' + x.tone}>${x.text}</span>`; }

function Barbell({ done, goal }){
  const n = Math.min(Math.max(goal, done, 1), 8), met = done >= goal, plates = [];
  for(let i = 0; i < n; i++){
    const cls = i < done ? (met ? 'pl-met' : 'pl-on') : 'pl-off';
    plates.push(html`<rect x=${114 - i * 15} y="10" width="12" height="64" rx="2.5" class=${cls}/>`);
    plates.push(html`<rect x=${214 + i * 15} y="10" width="12" height="64" rx="2.5" class=${cls}/>`);
  }
  return html`<svg class="barbell" viewBox="0 0 340 84" role="img" aria-label=${`${done} of ${goal} sessions this week`}>
    <rect x="2" y="39" width="336" height="6" rx="3" class="bar"/>
    <rect x="128" y="33" width="6" height="18" rx="1.5" class="collar"/>
    <rect x="206" y="33" width="6" height="18" rx="1.5" class="collar"/>
    ${plates}
  </svg>`;
}
const STATE_LABEL = { done:'Trained', miss:'Missed', today:'Planned today', plan:'Planned', rest:'Rest day', future:'', none:'' };
function WeekStrip({ week }){
  const today = todayStr();
  return html`<div class="strip">${week.days.map((c, j) => html`<div class=${'d' + (c.date === today ? ' is-today' : '')}>
    <span>${DAY_SHORT[j].slice(0, 1)}</span><span class=${'cg c-' + c.state} title=${`${fmtDate(c.date)}: ${STATE_LABEL[c.state] || 'Nothing planned'}`} aria-label=${`${fmtDate(c.date)}: ${STATE_LABEL[c.state] || 'Nothing planned'}`}></span></div>`)}</div>`;
}
function WeekCard({ cons }){
  const done = cons.thisWeek.count, goal = cons.goal, left = Math.max(0, goal - done);
  return html`<section class="card">
    <div class="card-h"><span class="label">This week</span><span class="label">${cons.streak ? `${cons.streak}-week streak` : 'Streak starts when you hit your goal'}</span></div>
    <${Barbell} done=${done} goal=${goal}/>
    <div class="week-meta"><span class="big">${done}<span class="of"> / ${goal}</span></span><span class="sub">${done >= goal ? 'Weekly goal hit. Bar loaded.' : `${plural(left, 'more session')} to hit your weekly goal`}</span></div>
    <${WeekStrip} week=${cons.thisWeek}/>
  </section>`;
}
function Legend(){
  return html`<div class="legend"><span><i class="cg c-done"></i>Trained</span><span><i class="cg c-miss"></i>Missed</span><span><i class="cg c-plan"></i>Planned</span><span><i class="cg c-rest"></i>Rest</span></div>`;
}
function ConsistencyGrid({ cons }){
  return html`<div class="cgrid" role="table" aria-label="Training days over the last 12 weeks">
    <div class="cg-row cg-head" role="row"><span></span>${DAY_SHORT.map(d => html`<span role="columnheader">${d.slice(0, 1)}</span>`)}<span></span></div>
    ${cons.weeks.filter(w => !w.before).map(w => html`<div class="cg-row" role="row">
      <span class="cg-wk" role="rowheader">${fmtShort(w.start)}</span>
      ${w.days.map(c => html`<span role="cell" class=${'cg c-' + c.state} title=${`${fmtDate(c.date)}: ${STATE_LABEL[c.state] || 'Nothing planned'}`} aria-label=${`${fmtDate(c.date)}: ${STATE_LABEL[c.state] || 'Nothing planned'}`}></span>`)}
      <span class=${'cg-count' + (w.count >= cons.goal ? ' met' : '')} title=${`${w.count} sessions`}>${w.count}</span>
    </div>`)}
  </div>`;
}
function Spark({ values }){
  if(values.length < 2) return html`<svg class="spark" viewBox="0 0 72 26" aria-hidden="true"></svg>`;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [3 + i * (66 / (values.length - 1)), 22 - ((v - lo) / span) * 18]);
  const last = pts[pts.length - 1];
  return html`<svg class="spark" viewBox="0 0 72 26" aria-hidden="true"><polyline class="sl" points=${pts.map(p => p.join(',')).join(' ')}/><circle class="se" cx=${last[0]} cy=${last[1]} r="3"/></svg>`;
}
function RestTimer({ since, onClose }){
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if(s > 900) return null;
  return html`<button class="rest" onClick=${onClose} aria-label="Rest timer. Tap to hide.">Rest<b>${Math.floor(s / 60)}:${pad(s % 60)}</b></button>`;
}

/* ---------------- chart ---------------- */
function niceTicks(min, max, n = 4){
  if(min === max){ const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for(let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}
function LineChart({ points, fmt, label }){
  const wrap = useRef(null);
  const [w, setW] = useState(600);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    if(!wrap.current) return;
    const ro = new ResizeObserver(es => { const cw = Math.round(es[0].contentRect.width); if(cw > 0) setW(cw); });
    ro.observe(wrap.current); return () => ro.disconnect();
  }, []);
  const H = 230, pl = 46, pr = 14, pt = 26, pb = 28;
  const ts = points.map(p => parseYmd(p.x).getTime());
  let x0 = Math.min(...ts), x1 = Math.max(...ts); if(x0 === x1){ x0 -= 86400000 * 3; x1 += 86400000 * 3; }
  const ys = points.map(p => p.y);
  const yMin = Math.min(...ys), yMax = Math.max(...ys), padY = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.05 || 1;
  const { lo, hi: yHi, ticks } = niceTicks(Math.max(0, yMin - padY), yMax + padY, 4);
  const sx = t => pl + (t - x0) / (x1 - x0) * (w - pl - pr);
  const sy = v => pt + (1 - (v - lo) / (yHi - lo)) * (H - pt - pb);
  const P = points.map((p, i) => ({ ...p, px: sx(ts[i]), py: sy(p.y) }));
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join('');
  const area = `${line}L${P[P.length - 1].px.toFixed(1)},${H - pb}L${P[0].px.toFixed(1)},${H - pb}Z`;
  const nX = Math.max(2, Math.min(6, Math.floor((w - pl - pr) / 90)));
  const xt = Array.from({ length: nX }, (_, i) => x0 + (x1 - x0) * i / (nX - 1));
  const last = P[P.length - 1];
  const pick = clientX => {
    const r = wrap.current.getBoundingClientRect(), x = (clientX - r.left) * (w / r.width);
    let bi = 0, bd = Infinity; P.forEach((p, i) => { const d = Math.abs(p.px - x); if(d < bd){ bd = d; bi = i; } });
    setHi(bi);
  };
  const onKey = e => {
    if(e.key === 'ArrowRight'){ e.preventDefault(); setHi(i => i == null ? P.length - 1 : Math.min(P.length - 1, i + 1)); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); setHi(i => i == null ? P.length - 1 : Math.max(0, i - 1)); }
    else if(e.key === 'Escape') setHi(null);
  };
  const hp = hi != null ? P[hi] : null;
  const tipLeft = hp ? Math.min(Math.max(hp.px - 75, 0), w - 150) : 0;
  const showDots = P.length <= 45;
  return html`<div class="chart" ref=${wrap} tabindex="0" role="img" aria-label=${`${label}. ${P.length} points. Latest ${fmt(last.y)}. Use arrow keys to read values.`}
      onPointerMove=${e => pick(e.clientX)} onPointerDown=${e => pick(e.clientX)} onPointerLeave=${e => { if(e.pointerType === 'mouse') setHi(null); }} onKeyDown=${onKey} onBlur=${() => setHi(null)}>
    <svg width=${w} height=${H} viewBox=${`0 0 ${w} ${H}`} aria-hidden="true">
      <g class="grid">${ticks.map(t => html`<line x1=${pl} x2=${w - pr} y1=${sy(t)} y2=${sy(t)}/>`)}</g>
      <g class="axis">
        ${ticks.map(t => html`<text x=${pl - 8} y=${sy(t) + 4} text-anchor="end">${fmtNum(t, 1)}</text>`)}
        ${xt.map((t, i) => html`<text x=${sx(t)} y=${H - 8} text-anchor=${i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle'}>${new Date(t).toLocaleDateString(undefined, { day:'numeric', month:'short' })}</text>`)}
      </g>
      <path class="ar" d=${area}/>
      <path class="ln" d=${line}/>
      ${showDots && P.map((p, i) => i === P.length - 1 ? null : html`<circle class=${'dot' + (p.pr ? ' pr' : '')} cx=${p.px} cy=${p.py} r=${p.pr ? 4.5 : 3.5}/>`)}
      <circle class=${'dot' + (last.pr ? ' pr' : '')} cx=${last.px} cy=${last.py} r="5.5"/>
      ${!hp && html`<text class="endlbl" x=${last.px} y=${last.py - 12} text-anchor="end">${fmt(last.y)}</text>`}
      ${hp && html`<g><line class="xh" x1=${hp.px} x2=${hp.px} y1=${pt - 6} y2=${H - pb}/><circle class=${'dot' + (hp.pr ? ' pr' : '')} cx=${hp.px} cy=${hp.py} r="6"/></g>`}
    </svg>
    ${hp && html`<div class="tip" style=${`left:${tipLeft}px`}><strong>${fmt(hp.y)}${hp.pr ? ' · PR' : ''}</strong><span>${hp.label}</span>${hp.sub && html`<span>${hp.sub}</span>`}</div>`}
  </div>`;
}

/* ---------------- exercise picker ---------------- */
function Picker({ profile, exclude, title, onPick, onClose, updateProfile }){
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('Other');
  const inp = useRef(null);
  useEffect(() => { inp.current && inp.current.focus(); const k = e => { if(e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const ql = q.trim().toLowerCase();
  const exs = profile.exercises || {};
  const lib = Object.entries(exs).filter(([id, e]) => !exclude.includes(id) && (!ql || e.name.toLowerCase().includes(ql))).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const names = new Set(Object.values(exs).map(e => e.name.toLowerCase()));
  const sugg = CATALOG.filter(([n]) => !names.has(n.toLowerCase()) && (!ql || n.toLowerCase().includes(ql)));
  const exact = names.has(ql) || CATALOG.some(([n]) => n.toLowerCase() === ql);
  const create = (name, group) => {
    const id = uniqueExId(profile, name);
    updateProfile(p => { p.exercises = p.exercises || {}; p.exercises[id] = { name, group }; return p; });
    onPick(id, name);
  };
  return html`<div class="sheet-bg" onClick=${e => { if(e.target === e.currentTarget) onClose(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="spread"><h2 class="sec">${title}</h2><button class="iconbtn" onClick=${onClose} aria-label="Close">${I.x()}</button></div>
      <input ref=${inp} id="picker-search" class="inp" placeholder="Search or type a new exercise" value=${q} onInput=${e => setQ(e.target.value)}/>
      <div class="sheet-list">
        ${ql && !exact && html`<div class="list-h label">New exercise</div>
          <div class="opt" style="cursor:default"><span class="min0">${q.trim()}</span>
            <span class="row"><select class="inp" style="height:36px;width:auto" aria-label="Muscle group" value=${grp} onChange=${e => setGrp(e.target.value)}>${GROUPS.map(g => html`<option value=${g}>${g}</option>`)}</select>
            <button class="btn sm primary" onClick=${() => create(q.trim(), grp)}>Add</button></span></div>`}
        ${lib.length > 0 && html`<div class="list-h label">Your exercises</div>`}
        ${lib.map(([id, e]) => html`<button class="opt" onClick=${() => onPick(id, e.name)}><span>${e.name}</span><span class="sub">${e.group}</span></button>`)}
        ${sugg.length > 0 && html`<div class="list-h label">Suggestions</div>`}
        ${sugg.map(([n, g]) => html`<button class="opt" onClick=${() => create(n, g)}><span>${n}</span><span class="sub">${g}</span></button>`)}
        ${!lib.length && !sugg.length && !ql && html`<p class="sub">Type a name to add an exercise.</p>`}
      </div>
    </div>
  </div>`;
}

/* ---------------- logger ---------------- */
function setDelta(s, p, pb, unit){
  const w = num(s.w), r = num(s.r);
  if(r == null || r <= 0) return null;
  const wkg = w == null ? 0 : toKg(w, unit);
  if(pb){
    const val = pb.bw ? r : e1rm(wkg, r), base = pb.bw ? pb.maxR : pb.e1rm;
    if((pb.bw ? wkg === 0 : wkg > 0) && val > base + 1e-6) return { tone:'pr', text:'PR', title:'New best estimated 1RM' };
  }
  if(!p) return null;
  const dw = wkg - p.w;
  if(dw > 0.01) return { tone:'up', text:'+' + fmtW(dw, unit), title:`Up ${fmtW(dw, unit)} ${unit} on last time` };
  if(Math.abs(dw) <= 0.01){
    if(r > p.r) return { tone:'up', text:`+${plural(r - p.r, 'rep')}`, title:'More reps than last time' };
    if(r === p.r) return { tone:'hold', text:'=', title:'Same as last time' };
    return { tone:'down', text:`−${plural(p.r - r, 'rep')}`, title:'Fewer reps than last time' };
  }
  return { tone:'down', text:'−' + fmtW(-dw, unit), title:`Down ${fmtW(-dw, unit)} ${unit} on last time` };
}
function ExerciseBlock({ it, idx, count, draft, profile, hist, changeDraft, onTick }){
  const unit = draft.unit;
  const prev = lastBefore(hist, it.ex, draft);
  const pb = bestBefore(hist, it.ex, draft);
  const prevSet = i => prev ? (prev.sets[i] || prev.sets[prev.sets.length - 1]) : null;
  const upd = (fn, now) => changeDraft(d => { fn(d.items[idx]); return d; }, now);
  const toggle = i => {
    const turningOn = !it.sets[i].d;
    upd(x => {
      const s = x.sets[i], p = prevSet(i);
      if(!s.d && p){ if(s.w === '') s.w = p.w > 0 ? rawW(p.w, unit) : ''; if(s.r === '') s.r = String(p.r); }
      s.d = !s.d;
    }, true);
    if(turningOn) onTick();
  };
  const move = dir => changeDraft(d => { const a = d.items, j = idx + dir; [a[idx], a[j]] = [a[j], a[idx]]; return d; }, true);
  return html`<section class="card exblock">
    <div class="ex-h">
      <div class="min0"><h3 class="ex-name">${exName(profile, it)}</h3>
        <div class="sub">${prev ? `Last time, ${fmtShort(prev.date)}: ${fmtSets(prev.sets, unit)}` : 'First time logging this one'}</div></div>
      <div class="ex-tools">
        <button class="iconbtn" disabled=${idx === 0} onClick=${() => move(-1)} aria-label="Move exercise up">${I.up()}</button>
        <button class="iconbtn" disabled=${idx === count - 1} onClick=${() => move(1)} aria-label="Move exercise down">${I.down()}</button>
        <button class="iconbtn" onClick=${() => changeDraft(d => { d.items.splice(idx, 1); return d; }, true)} aria-label="Remove exercise">${I.x()}</button>
      </div>
    </div>
    <div class="setgrid head" aria-hidden="true"><span>Set</span><span>Last</span><span>${unit}</span><span>Reps</span><span></span><span></span></div>
    ${it.sets.map((s, i) => {
      const p = prevSet(i), d = setDelta(s, p, pb, unit);
      return html`<div class=${'setgrid' + (s.d ? ' done' : '')}>
        <span class="setno">${i + 1}</span>
        <span class="prev">${p ? (p.w > 0 ? `${fmtW(p.w, unit)}×${p.r}` : `BW×${p.r}`) : '–'}</span>
        <input class="inp cell-inp" id=${`w-${it.ex}-${i}`} inputmode="decimal" autocomplete="off" aria-label=${`Set ${i + 1} weight in ${unit}`} placeholder=${p && p.w > 0 ? rawW(p.w, unit) : ''} value=${s.w} onInput=${e => upd(x => { x.sets[i].w = e.target.value; })}/>
        <input class="inp cell-inp" id=${`r-${it.ex}-${i}`} inputmode="numeric" autocomplete="off" aria-label=${`Set ${i + 1} reps`} placeholder=${p ? String(p.r) : ''} value=${s.r} onInput=${e => upd(x => { x.sets[i].r = e.target.value; })}/>
        <span class="delta">${d && html`<span class=${'chip xs t-' + d.tone} title=${d.title}>${d.text}</span>`}</span>
        <button class=${'tick' + (s.d ? ' on' : '')} aria-pressed=${s.d} aria-label=${`Set ${i + 1} done`} onClick=${() => toggle(i)}>${I.check()}</button>
      </div>`;
    })}
    <div class="row">
      <button class="btn sm" onClick=${() => upd(x => { x.sets.push({ w:'', r:'', d:false }); }, true)}>+ Add set</button>
      ${it.sets.length > 1 && html`<button class="btn sm ghost" onClick=${() => upd(x => { x.sets.pop(); }, true)}>Remove last set</button>`}
    </div>
  </section>`;
}
function Logger({ draft, profile, hist, changeDraft, onFinish, onDelete, openPicker }){
  const [confirmDel, setConfirmDel] = useState(false);
  const [restSince, setRestSince] = useState(null);
  const editing = !draft.live;
  const addEx = () => openPicker({
    title: 'Add exercise', exclude: draft.items.map(i => i.ex),
    onPick: (id, name) => {
      const prev = lastBefore(hist, id, draft);
      changeDraft(d => { d.items.push({ ex: id, n: name, sets: blankSets(prev ? prev.sets.length : 3) }); return d; }, true);
    },
  });
  return html`<div class="stack">
    <div class="phead">
      <span class="eyebrow">${editing ? 'Editing a logged workout' : 'Workout in progress'}</span>
      <input class="title-inp" id="workout-name" aria-label="Workout name" value=${draft.name} onInput=${e => changeDraft(d => { d.name = e.target.value; return d; })}/>
      <div class="row"><label class="mini" for="workout-date">Date</label><input type="date" id="workout-date" class="inp" style="height:36px;width:auto" max=${todayStr()} value=${draft.date} onChange=${e => e.target.value && changeDraft(d => { d.date = e.target.value; return d; }, true)}/>
        <span class="sub">Placeholders show last time's numbers. Tick a set to use them.</span></div>
    </div>
    ${draft.items.length === 0 && html`<div class="card empty"><p>No exercises yet. Add your first one to start logging sets.</p></div>`}
    ${draft.items.map((it, idx) => html`<${ExerciseBlock} key=${it.ex} it=${it} idx=${idx} count=${draft.items.length} draft=${draft} profile=${profile} hist=${hist} changeDraft=${changeDraft} onTick=${() => setRestSince(Date.now())}/>`)}
    <button class="btn block" onClick=${addEx}>+ Add exercise</button>
    <textarea class="inp" id="workout-note" placeholder="Notes: how it felt, sleep, anything to remember next time" value=${draft.note} onInput=${e => changeDraft(d => { d.note = e.target.value; return d; })}></textarea>
    <button class="btn primary block lg" onClick=${onFinish}>${editing ? 'Done editing' : 'Finish workout'}</button>
    ${confirmDel
      ? html`<div class="confirm"><span>${editing ? 'Delete this workout for good?' : 'Discard this workout and its sets?'}</span><button class="btn sm danger" onClick=${onDelete}>${editing ? 'Delete' : 'Discard'}</button><button class="btn sm" onClick=${() => setConfirmDel(false)}>Keep it</button></div>`
      : html`<button class="btn ghost" onClick=${() => setConfirmDel(true)}>${editing ? 'Delete workout' : 'Discard workout'}</button>`}
    ${restSince && html`<${RestTimer} key=${restSince} since=${restSince} onClose=${() => setRestSince(null)}/>`}
  </div>`;
}

/* ---------------- today ---------------- */
function TodayTab({ profile, cons, hist, workouts, startWorkout, onEdit }){
  const unit = profile.unit || 'kg', today = todayStr();
  const e = profile.week && profile.week[DAYS[dayIdx(today)]];
  const tplId = e && e.tpl && profile.templates && profile.templates[e.tpl] ? e.tpl : null;
  const tpl = tplId ? profile.templates[tplId] : null;
  const logged = workouts.filter(w => w.date === today && hasSets(w) && !w.live);
  const past = workouts.filter(w => hasSets(w) && !w.live && w.date < today).sort(byDate);
  const lastW = past[past.length - 1];
  const nextTpl = cons.next && profile.templates[cons.next.tpl];
  const fake = { id:'__none__', date: today };
  const title = logged.length ? 'Done today' : tpl ? tpl.name : 'Rest day';
  const others = Object.entries(profile.templates || {}).filter(([id]) => id !== tplId);
  const summaryOf = w => (w.items || []).filter(it => setsOf(it).length).map(it => {
    const cur = summarize(setsOf(it)), arr = hist.get(it.ex) || [];
    const i = arr.findIndex(s => s.wid === w.id), prev = i > 0 ? arr[i - 1] : null;
    return { it, cur, c: compare(prev, cur) };
  });
  return html`<div class="stack">
    <div class="phead">
      <span class="eyebrow">${fmtLong(today)}</span>
      <h1 class="title">${title}</h1>
      ${!logged.length && tpl && html`<p class="lede">${plural(tpl.exIds.length, 'exercise')}${e.time ? `, planned for ${fmtTime(e.time)}` : ''}. Beat last time on at least one lift.</p>`}
      ${!logged.length && !tpl && html`<p class="lede">${nextTpl ? `Next up: ${nextTpl.name}, ${cons.next.date === addDays(today, 1) ? 'tomorrow' : fmtDate(cons.next.date)}${cons.next.time ? ` at ${fmtTime(cons.next.time)}` : ''}.` : 'Nothing scheduled. Set your training days in Plan.'} Recovery counts too.</p>`}
    </div>

    ${!logged.length && tpl && html`<section class="card">
      <div class="card-h"><h2 class="sec">To beat today</h2><span class="label">Last best set</span></div>
      <div class="lifts">${tpl.exIds.filter(id => profile.exercises[id]).map(id => {
        const prev = lastBefore(hist, id, fake);
        return html`<div class="lift"><span class="lift-name min0">${profile.exercises[id].name}</span><span class="num">${prev ? fmtTop(prev.top, unit) : html`<span class="sub">New</span>`}</span>
          ${prev && html`<span class="sub" style="grid-column:1/-1">${fmtShort(prev.date)}: ${fmtSets(prev.sets, unit)}</span>`}</div>`;
      })}</div>
      <button class="btn primary block lg" onClick=${() => startWorkout(tplId)}>Start ${tpl.name}</button>
    </section>`}

    ${logged.map(w => html`<section class="card">
      <div class="card-h"><h2 class="sec">${w.name}</h2><button class="btn sm" onClick=${() => onEdit(w)}>Edit</button></div>
      <div class="lifts">${summaryOf(w).map(({ it, cur, c }) => html`<div class="lift"><span class="min0"><span class="lift-name">${exName(profile, it)}</span><br/><span class="sub num">${fmtTop(cur.top, unit)}</span></span><${Chip} c=${c} unit=${unit}/></div>`)}</div>
    </section>`)}

    <${WeekCard} cons=${cons}/>

    <section class="card">
      <div class="card-h"><h2 class="sec">${tpl && !logged.length ? 'Or start something else' : 'Train now'}</h2></div>
      <div class="row">
        ${(logged.length && tpl ? Object.entries(profile.templates) : others).map(([id, t]) => html`<button class="btn" onClick=${() => startWorkout(id)}>${t.name}</button>`)}
        <button class="btn ghost" onClick=${() => startWorkout(null)}>Empty workout</button>
      </div>
    </section>

    ${lastW && !logged.length && html`<section class="card">
      <div class="card-h"><h2 class="sec">Last session</h2><span class="label">${lastW.name} · ${fmtDate(lastW.date)}</span></div>
      <div class="lifts">${summaryOf(lastW).map(({ it, cur, c }) => html`<div class="lift"><span class="min0"><span class="lift-name">${exName(profile, it)}</span><br/><span class="sub num">${fmtTop(cur.top, unit)}</span></span><${Chip} c=${c} unit=${unit}/></div>`)}</div>
    </section>`}
  </div>`;
}

/* ---------------- progress ---------------- */
function ProgressTab({ profile, hist, sel, setSel }){
  const unit = profile.unit || 'kg';
  const [grp, setGrp] = useState('All');
  if(sel && hist.has(sel)) return html`<${ExerciseDetail} ex=${sel} profile=${profile} hist=${hist} onBack=${() => setSel(null)}/>`;
  const today = todayStr();
  const list = [...hist.entries()].map(([ex, ss]) => {
    const last = ss[ss.length - 1], prev = ss[ss.length - 2], e = profile.exercises[ex];
    return { ex, ss, last, change: compare(prev, last), name: e ? e.name : ex, group: e ? e.group : 'Other', bw: ss.bw };
  }).sort((a, b) => b.last.date.localeCompare(a.last.date) || a.name.localeCompare(b.name));
  if(!list.length) return html`<div class="stack"><div class="phead"><span class="eyebrow">Progress</span><h1 class="title">No lifts yet</h1></div>
    <div class="card empty"><p>Log a workout and each exercise gets its own chart here. You'll see a trend after your second session.</p></div></div>`;
  const groups = ['All', ...GROUPS.filter(g => list.some(l => l.group === g))];
  const shown = list.filter(l => grp === 'All' || l.group === grp);
  let up = 0, comparable = 0;
  for(const l of list){
    if(l.last.date < addDays(today, -28) || l.ss.length < 2) continue;
    const cut = addDays(l.last.date, -28);
    const base = [...l.ss].reverse().find(s => s.date <= cut) || l.ss[0];
    if(base === l.last) continue;
    comparable++;
    if((l.bw ? l.last.maxR - base.maxR : l.last.e1rm - base.e1rm) > 1e-6) up++;
  }
  let prs = 0; for(const l of list) prs += l.ss.filter(s => s.pr && s.date > addDays(today, -30)).length;
  const recent = list.filter(l => l.last.date > addDays(today, -14));
  const recentUp = recent.filter(l => UP_KINDS.includes(l.change.kind)).length;
  return html`<div class="stack">
    <div class="phead"><span class="eyebrow">Progress</span><h1 class="title">Going up?</h1>
      <p class="lede">Each lift compared with the session before it. Tap one for its chart, day by day or week by week.</p></div>
    <div class="tiles three">
      <div class="tile"><span class="label">Up on last session</span><span class="v">${recentUp}<small> of ${recent.length} lifts</small></span><span class="sub">Trained in the last 14 days</span></div>
      <div class="tile"><span class="label">Up over 4 weeks</span><span class="v">${up}<small> of ${comparable}</small></span><span class="sub">By estimated 1RM, or reps for bodyweight</span></div>
      <div class="tile"><span class="label">PRs, last 30 days</span><span class="v">${prs}</span><span class="sub">New best estimated 1RM</span></div>
    </div>
    <div class="filters">${groups.length > 2 && html`<${Seg} label="Muscle group" value=${grp} onChange=${setGrp} options=${groups.map(g => [g, g])}/>`}</div>
    <section class="card" style="padding-block:6px">
      ${shown.map(l => html`<button class="exrow" onClick=${() => { setSel(l.ex); window.scrollTo(0, 0); }}>
        <span class="min0"><span class="lift-name">${l.name}</span><br/><span class="sub num">${fmtTop(l.last.top, unit)} · ${fmtShort(l.last.date)}</span></span>
        <${Chip} c=${l.change} unit=${unit}/>
        <${Spark} values=${l.ss.slice(-10).map(s => l.bw ? s.maxR : s.e1rm)}/>
      </button>`)}
    </section>
  </div>`;
}
function ExerciseDetail({ ex, profile, hist, onBack }){
  const unit = profile.unit || 'kg';
  const ss = hist.get(ex) || [], bw = ss.bw;
  const e = profile.exercises[ex];
  const [view, setView] = useState('session');
  const [metric, setMetric] = useState(bw ? 'reps' : 'top');
  const rows = view === 'session' ? ss : weeklyRows(ss);
  const metrics = bw ? [['reps','Best set'],['total','Total reps']] : [['top','Top set'],['e1rm','Est. 1RM'],['vol','Volume'],['reps','Reps']];
  const m = metrics.some(x => x[0] === metric) ? metric : metrics[0][0];
  const val = r => m === 'top' ? toDisp(r.top.w, unit) : m === 'e1rm' ? toDisp(r.e1rm, unit) : m === 'vol' ? toDisp(r.vol, unit) : m === 'total' ? r.reps : (bw ? r.maxR : r.top.r);
  const fmt = v => (m === 'reps' || m === 'total') ? plural(Math.round(v), 'rep') : `${fmtNum(v, m === 'vol' ? 0 : 1)} ${unit}`;
  const mLabel = { top:'Top set weight', e1rm:'Estimated 1RM', vol:'Volume (weight × reps)', reps: bw ? 'Most reps in a set' : 'Reps on top set', total:'Total reps' }[m];
  const points = rows.map(r => ({ x: r.date, y: val(r), pr: r.pr, label: view === 'session' ? fmtDate(r.date) : `Week of ${fmtShort(r.date)}`, sub: view === 'session' ? fmtSets(r.sets, unit) : `${plural(r.sessions, 'session')} · best ${fmtTop(r.top, unit)}` }));
  const last = rows[rows.length - 1], prevRow = rows[rows.length - 2];
  const lastS = ss[ss.length - 1];
  const bestS = ss.reduce((a, s) => (bw ? s.maxR > a.maxR : s.e1rm > a.e1rm) ? s : a, ss[0]);
  const cut = addDays(lastS.date, -28);
  const base = [...ss].reverse().find(s => s.date <= cut) || ss[0];
  const d4 = bw ? lastS.maxR - base.maxR : lastS.e1rm - base.e1rm;
  const tableRows = [...rows].reverse();
  return html`<div class="stack">
    <div class="phead">
      <button class="btn ghost sm" style="align-self:flex-start;margin-left:-10px" onClick=${onBack}>${I.back()} All lifts</button>
      <span class="eyebrow">${e ? e.group : 'Exercise'} · ${plural(ss.length, 'session')}</span>
      <h1 class="title">${e ? e.name : ex}</h1>
    </div>
    <div class="tiles four">
      <div class="tile"><span class="label">${bw ? 'Best set' : 'Top set'}</span><span class="v num">${fmtTop(last.top, unit)}</span>${prevRow ? html`<${Chip} c=${compare(prevRow, last)} unit=${unit}/>` : html`<span class="sub">First ${view === 'session' ? 'session' : 'week'}</span>`}</div>
      ${bw ? html`<div class="tile"><span class="label">Total reps</span><span class="v">${last.reps}</span><span class="sub">${view === 'session' ? 'Latest session' : 'This week'}</span></div>`
           : html`<div class="tile"><span class="label">Est. 1RM</span><span class="v">${fmtNum(toDisp(lastS.e1rm, unit), 1)}<small> ${unit}</small></span><span class="sub">Best ${fmtNum(toDisp(bestS.e1rm, unit), 1)} ${unit} on ${fmtShort(bestS.date)}</span></div>`}
      <div class="tile"><span class="label">4-week change</span><span class="v">${base === lastS ? '–' : bw ? signed(d4, v => v) : signed(d4, v => fmtNum(toDisp(v, unit), 1))}${base !== lastS && html`<small> ${bw ? 'reps' : unit}</small>`}</span><span class="sub">${base === lastS ? 'Needs a second session' : `${bw ? 'Best set' : 'Est. 1RM'} since ${fmtShort(base.date)}`}</span></div>
      <div class="tile"><span class="label">Logged</span><span class="v">${ss.length}<small> sessions</small></span><span class="sub">Since ${fmtShort(ss[0].date)}</span></div>
    </div>
    <div class="filters">
      <${Seg} label="Group by" value=${view} onChange=${setView} options=${[['session','By session'],['week','By week']]}/>
      <${Seg} label="Measure" value=${m} onChange=${setMetric} options=${metrics}/>
    </div>
    <section class="card">
      <div class="card-h"><span class="label">${mLabel}${m === 'reps' || m === 'total' ? '' : ` (${unit})`}</span>${rows.some(r => r.pr) && html`<span class="key"><i></i>New personal best</span>`}</div>
      ${rows.length >= 2 ? html`<${LineChart} key=${view + m} points=${points} fmt=${fmt} label=${`${e ? e.name : ex}: ${mLabel} ${view === 'session' ? 'per session' : 'per week'}`}/>`
        : html`<div class="empty"><p>One ${view === 'session' ? 'session' : 'week'} so far: ${fmt(points[0].y)}. Log it again to see a trend.</p></div>`}
    </section>
    <section class="card">
      <div class="card-h"><h2 class="sec">${view === 'session' ? 'Every session' : 'Week by week'}</h2></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${view === 'session' ? 'Date' : 'Week of'}</th><th>${bw ? 'Best set' : 'Top set'}</th><th>vs previous</th><th>${view === 'session' ? 'Reps per set' : 'Sessions'}</th><th class="r">${bw ? 'Total reps' : `Volume (${unit})`}</th></tr></thead>
        <tbody>${tableRows.map((r, i) => html`<tr>
          <td>${view === 'session' ? fmtDate(r.date) : fmtShort(r.date)}${r.pr ? html` <span class="chip xs t-pr">PR</span>` : ''}</td>
          <td>${fmtTop(r.top, unit)}</td>
          <td><${Chip} c=${compare(tableRows[i + 1], r)} unit=${unit}/></td>
          <td>${view === 'session' ? r.sets.map(s => s.r).join(' · ') : `${r.sessions} · ${r.n} sets`}</td>
          <td class="r">${bw ? r.reps : fmtNum(toDisp(r.vol, unit), 0)}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>
  </div>`;
}

/* ---------------- plan ---------------- */
function TemplateItem({ id, t, profile, open, setOpen, updateProfile, openPicker }){
  const [confirm, setConfirm] = useState(false);
  const exs = (t.exIds || []).filter(x => profile.exercises[x]);
  const setT = fn => updateProfile(p => { fn(p.templates[id]); return p; });
  const move = (i, dir) => setT(tp => { const a = tp.exIds, j = i + dir; [a[i], a[j]] = [a[j], a[i]]; });
  const days = DAYS.filter(k => profile.week && profile.week[k] && profile.week[k].tpl === id).map(k => DAY_SHORT[DAYS.indexOf(k)]);
  return html`<div class="tpl">
    <button class="tpl-head" aria-expanded=${open} onClick=${() => setOpen(open ? null : id)}>
      <span class="min0"><span class="lift-name">${t.name}</span><br/><span class="sub">${plural(exs.length, 'exercise')}${days.length ? ` · ${days.join(', ')}` : ' · not scheduled'}</span></span>
      ${open ? I.up() : I.down()}
    </button>
    ${open && html`<div class="stack" style="gap:10px">
      <label class="label" for=${'tn-' + id}>Name</label>
      <input class="inp" id=${'tn-' + id} value=${t.name} onInput=${e => setT(tp => { tp.name = e.target.value; })}/>
      <div>${exs.map((x, i) => html`<div class="tpl-ex"><span class="min0">${profile.exercises[x].name} <span class="sub">· ${profile.exercises[x].group}</span></span>
        <span class="row" style="flex-wrap:nowrap;gap:4px">
          <button class="iconbtn" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label=${`Move ${profile.exercises[x].name} up`}>${I.up()}</button>
          <button class="iconbtn" disabled=${i === exs.length - 1} onClick=${() => move(i, 1)} aria-label=${`Move ${profile.exercises[x].name} down`}>${I.down()}</button>
          <button class="iconbtn" onClick=${() => setT(tp => { tp.exIds = tp.exIds.filter(y => y !== x); })} aria-label=${`Remove ${profile.exercises[x].name}`}>${I.x()}</button>
        </span></div>`)}</div>
      <div class="row">
        <button class="btn sm" onClick=${() => openPicker({ title: `Add to ${t.name}`, exclude: t.exIds || [], onPick: (eid) => setT(tp => { tp.exIds = [...(tp.exIds || []), eid]; }) })}>+ Add exercise</button>
        ${confirm ? html`<span class="confirm"><span>Delete ${t.name}?</span><button class="btn sm danger" onClick=${() => { updateProfile(p => { delete p.templates[id]; DAYS.forEach(k => { if(p.week && p.week[k] && p.week[k].tpl === id) p.week[k].tpl = null; }); return p; }); setOpen(null); }}>Delete</button><button class="btn sm" onClick=${() => setConfirm(false)}>Keep</button></span>`
          : html`<button class="btn sm ghost" onClick=${() => setConfirm(true)}>Delete workout</button>`}
      </div>
    </div>`}
  </div>`;
}
function PlanTab({ profile, cons, updateProfile, openPicker, account }){
  const [open, setOpen] = useState(null);
  const tpls = Object.entries(profile.templates || {});
  const todayK = DAYS[dayIdx(todayStr())];
  const unit = profile.unit || 'kg';
  const setDay = (k, patch) => updateProfile(p => { p.week = p.week || {}; p.week[k] = { tpl: null, time: '17:30', ...(p.week[k] || {}), ...patch }; return p; });
  const scheduled = DAYS.filter(k => profile.week && profile.week[k] && profile.week[k].tpl && profile.templates[profile.week[k].tpl]).length;
  return html`<div class="stack">
    <div class="phead"><span class="eyebrow">Plan</span><h1 class="title">Your week</h1>
      <p class="lede">Set which workout falls on which day. Missed days show up in your consistency record.</p></div>
    <${WeekCard} cons=${cons}/>
    <section class="card">
      <div class="card-h"><h2 class="sec">Consistency</h2><span class="label">Last 12 weeks</span></div>
      <div class="tiles three">
        <div class="tile"><span class="label">Streak</span><span class="v">${cons.streak}<small> wk</small></span><span class="sub">Weeks in a row at ${cons.goal}+ sessions</span></div>
        <div class="tile"><span class="label">Best streak</span><span class="v">${cons.best}<small> wk</small></span><span class="sub">Since ${fmtShort(cons.start)}</span></div>
        <div class="tile"><span class="label">Planned days hit</span><span class="v">${cons.adherence == null ? '–' : Math.round(cons.adherence * 100) + '%'}</span><span class="sub">${cons.adherence == null ? 'No planned days yet' : `${cons.hitN} of ${cons.plannedN}, last 4 weeks`}</span></div>
      </div>
      <${ConsistencyGrid} cons=${cons}/>
      <${Legend}/>
    </section>
    <section class="card">
      <div class="card-h"><h2 class="sec">Weekly schedule</h2><span class="label">${scheduled} training days</span></div>
      ${DAYS.map((k, i) => { const d = (profile.week && profile.week[k]) || { tpl: null, time: '17:30' }; const has = d.tpl && profile.templates[d.tpl];
        return html`<div class=${'dayrow' + (k === todayK ? ' is-today' : '')}>
          <span class="dname">${DAY_SHORT[i]}</span>
          <select class="inp" id=${'day-' + k} aria-label=${`${DAY_SHORT[i]} workout`} value=${has ? d.tpl : ''} onChange=${e => setDay(k, { tpl: e.target.value || null })}>
            <option value="">Rest</option>${tpls.map(([id, t]) => html`<option value=${id}>${t.name}</option>`)}
          </select>
          ${has ? html`<input type="time" class="inp" id=${'time-' + k} aria-label=${`${DAY_SHORT[i]} time`} value=${d.time || ''} onChange=${e => setDay(k, { time: e.target.value })}/>` : html`<span></span>`}
        </div>`; })}
      <div class="divider"></div>
      <div class="spread"><span class="min0"><span class="lift-name">Weekly goal</span><br/><span class="sub">Sessions that count as a full week</span></span>
        <span class="stepper"><button class="iconbtn" aria-label="Lower weekly goal" disabled=${(profile.weeklyGoal || 3) <= 1} onClick=${() => updateProfile(p => { p.weeklyGoal = Math.max(1, (p.weeklyGoal || 3) - 1); return p; })}>−</button>
          <b>${profile.weeklyGoal || 3}</b>
          <button class="iconbtn" aria-label="Raise weekly goal" disabled=${(profile.weeklyGoal || 3) >= 7} onClick=${() => updateProfile(p => { p.weeklyGoal = Math.min(7, (p.weeklyGoal || 3) + 1); return p; })}>+</button></span></div>
    </section>
    <section class="card">
      <div class="card-h"><h2 class="sec">Workouts</h2>
        <button class="btn sm" onClick=${() => { const id = newId('t-'); updateProfile(p => { p.templates = p.templates || {}; p.templates[id] = { name: 'New workout', exIds: [] }; return p; }); setOpen(id); }}>+ New workout</button></div>
      ${tpls.length === 0 && html`<p class="sub" style="margin:0">No workouts yet. Create one, add exercises, then put it on a day above.</p>`}
      ${tpls.map(([id, t]) => html`<${TemplateItem} key=${id} id=${id} t=${t} profile=${profile} open=${open === id} setOpen=${setOpen} updateProfile=${updateProfile} openPicker=${openPicker}/>`)}
    </section>
    <section class="card">
      <div class="spread"><span class="min0"><span class="lift-name">Weight unit</span><br/><span class="sub">Past workouts convert automatically</span></span>
        <${Seg} label="Weight unit" value=${unit} onChange=${u => updateProfile(p => { p.unit = u; return p; })} options=${[['kg','kg'],['lb','lb']]}/></div>
    </section>
    <${InstallCard}/>
    <${AccountCard} account=${account}/>
  </div>`;
}

/* ---------------- history ---------------- */
const SAFE_ID = /^[A-Za-z0-9_.~:@+-]{1,120}$/;
function cleanWorkout(w){
  if(!w || typeof w !== 'object' || !SAFE_ID.test(String(w.id || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(w.date || ''))) return null;
  const items = Array.isArray(w.items) ? w.items.filter(it => it && typeof it.ex === 'string').map(it => ({
    ex: it.ex, n: String(it.n || ''),
    sets: (Array.isArray(it.sets) ? it.sets : []).map(s => ({ w: typeof s.w === 'number' ? s.w : null, r: typeof s.r === 'number' ? s.r : null, d: !!s.d })),
  })) : [];
  return { id: w.id, body: { date: w.date, name: String(w.name || 'Workout'), tpl: w.tpl || null, note: String(w.note || ''), live: false, savedAt: String(w.savedAt || new Date().toISOString()), items } };
}
function HistoryTab({ profile, workouts, onEdit, onDelete, onImport }){
  const unit = profile.unit || 'kg';
  const [confirm, setConfirm] = useState(null);
  const [imp, setImp] = useState(null);
  const fileRef = useRef(null);
  const list = workouts.filter(w => hasSets(w) || w.live).sort(byDate).reverse();
  const weeks = [];
  for(const w of list){ const k = weekOf(w.date); let g = weeks[weeks.length - 1]; if(!g || g.k !== k){ g = { k, items: [] }; weeks.push(g); } g.items.push(w); }
  const exportCsv = () => {
    const rows = [['Date','Workout','Exercise','Set',`Weight (${unit})`,'Reps']];
    for(const w of [...list].reverse()) for(const it of (w.items || [])) setsOf(it).forEach((s, i) => rows.push([w.date, w.name, exName(profile, it), i + 1, s.w > 0 ? rawW(s.w, unit) : '', s.r]));
    const csv = rows.map(r => r.map(v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
    saveFile(`overload-${todayStr()}.csv`, csv, 'text/csv');
  };
  const exportJson = () => {
    const data = { app: 'overload', v: 1, exportedAt: new Date().toISOString(), profile, workouts: workouts.filter(w => !w.live) };
    saveFile(`overload-backup-${todayStr()}.json`, JSON.stringify(data, null, 1), 'application/json');
  };
  const onFile = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if(!f) return;
    try {
      const data = JSON.parse(await f.text());
      if(!data || data.app !== 'overload' || !Array.isArray(data.workouts)) throw new Error('shape');
      const ws = data.workouts.map(cleanWorkout).filter(Boolean);
      setImp({ ws, profile: data.profile && typeof data.profile === 'object' && data.profile.templates ? data.profile : null });
    } catch(_) { toast("That file isn't an Overload backup."); }
  };
  const backup = html`<section class="card">
    <div class="card-h"><h2 class="sec">Backup</h2></div>
    <div class="row">
      <button class="btn sm" onClick=${exportCsv} disabled=${!list.length}>Export CSV</button>
      <button class="btn sm" onClick=${exportJson}>Export backup</button>
      <button class="btn sm ghost" onClick=${() => fileRef.current && fileRef.current.click()}>Import backup</button>
      <input ref=${fileRef} id="import-file" type="file" accept=".json,application/json" hidden onChange=${onFile}/>
    </div>
    ${imp && html`<div class="confirm" style="justify-content:flex-start">
      <span>Import ${plural(imp.ws.length, 'workout')}? Any with the same id are replaced.</span>
      <button class="btn sm primary" onClick=${() => { onImport(imp.ws, null); setImp(null); }}>Import workouts</button>
      ${imp.profile && html`<button class="btn sm" onClick=${() => { onImport(imp.ws, imp.profile); setImp(null); }}>Workouts and plan</button>`}
      <button class="btn sm ghost" onClick=${() => setImp(null)}>Cancel</button></div>`}
    <span class="sub">CSV opens in a spreadsheet. A backup file can be imported back into the app.</span>
  </section>`;
  if(!list.length) return html`<div class="stack"><div class="phead"><span class="eyebrow">History</span><h1 class="title">Nothing logged</h1></div>
    <div class="card empty"><p>Your workouts will be listed here week by week once you finish your first one.</p></div>${backup}</div>`;
  return html`<div class="stack">
    <div class="phead"><span class="eyebrow">History</span><h1 class="title">${plural(list.length, 'workout')}</h1></div>
    ${weeks.map(g => {
      const days = new Set(g.items.filter(hasSets).map(w => w.date)).size;
      return html`<div class="stack" style="gap:10px">
        <div class="wk-h"><span class="label">Week of ${fmtShort(g.k)}</span><span class=${'chip ' + (days >= (profile.weeklyGoal || 3) ? 't-new' : 't-hold')}>${days} / ${profile.weeklyGoal || 3} sessions</span></div>
        ${g.items.map(w => {
          const items = (w.items || []).filter(it => setsOf(it).length);
          const vol = items.reduce((a, it) => a + summarize(setsOf(it)).vol, 0);
          return html`<section class="card wcard">
            <div class="spread"><span class="min0"><span class="lift-name">${w.name}</span>${w.live ? html` <span class="chip xs t-new">In progress</span>` : ''}<br/><span class="sub">${fmtDate(w.date)} · ${plural(items.length, 'exercise')}${vol ? ` · ${fmtNum(toDisp(vol, unit), 0)} ${unit} moved` : ''}</span></span>
              <span class="row">${!w.live && html`<button class="btn sm" onClick=${() => onEdit(w)}>Edit</button>`}
                ${confirm === w.id ? html`<button class="btn sm danger" onClick=${() => { setConfirm(null); onDelete(w.id); }}>Confirm delete</button><button class="btn sm ghost" onClick=${() => setConfirm(null)}>Keep</button>`
                  : html`<button class="btn sm ghost" onClick=${() => setConfirm(w.id)}>Delete</button>`}</span></div>
            ${items.map(it => { const s = summarize(setsOf(it)); return html`<div class="wline"><span>${exName(profile, it)}</span><span>${plural(s.n, 'set')} · ${fmtTop(s.top, unit)}</span></div>`; })}
            ${w.note && html`<p class="sub" style="margin:0">${w.note}</p>`}
          </section>`;
        })}
      </div>`;
    })}
    ${backup}
  </div>`;
}

/* ---------------- install + account ---------------- */
function InstallCard(){
  const [canPrompt, setCanPrompt] = useState(!!installEvt);
  useEffect(() => { installFn = setCanPrompt; return () => { installFn = () => {}; }; }, []);
  if(isStandalone()) return null;
  const ios = isIOS();
  if(!ios && !canPrompt) return null;
  return html`<section class="card">
    <div class="spread"><span class="min0"><span class="lift-name">Add to your home screen</span><br/>
      <span class="sub">${ios ? 'In Safari, tap the Share button, then Add to Home Screen.' : 'Opens full screen like an app, even with no signal.'}</span></span>
      ${!ios && html`<button class="btn sm primary" onClick=${async () => { const e = installEvt; installEvt = null; setCanPrompt(false); if(e){ e.prompt(); try { await e.userChoice; } catch(_) {} } }}>Install</button>`}</div>
  </section>`;
}
function AccountCard({ account }){
  if(!account) return null;
  return html`<section class="card">
    <div class="spread"><span class="min0"><span class="lift-name">Account</span><br/><span class="sub" style="overflow-wrap:anywhere">${account.email || 'Signed in'}</span></span>
      <button class="btn sm" onClick=${account.onSignOut}>Sign out</button></div>
  </section>`;
}

/* ---------------- onboarding ---------------- */
function Onboarding({ onCreate }){
  const [split, setSplit] = useState('mine');
  const [unit, setUnit] = useState('kg');
  return html`<div class="stack">
    <div class="phead"><span class="eyebrow">Set up</span><h1 class="title">Plan your week</h1>
      <p class="lede">Pick a starting plan. You can change the days, workouts and exercises any time from Plan.</p></div>
    <section class="card">
      ${PLAN_CHOICES.map(([k, s]) => html`<label class=${'choice' + (split === k ? ' on' : '')}>
        <input type="radio" name="split" value=${k} checked=${split === k} onChange=${() => setSplit(k)}/>
        <span><span class="lift-name">${s.label}</span><br/><span class="sub">${s.blurb}</span></span></label>`)}
    </section>
    <section class="card"><div class="spread"><span class="lift-name">Weight unit</span><${Seg} label="Weight unit" value=${unit} onChange=${setUnit} options=${[['kg','kg'],['lb','lb']]}/></div></section>
    <button class="btn primary block lg" onClick=${() => onCreate(split, unit)}>Create my plan</button>
  </div>`;
}

/* ---------------- sign in ---------------- */
const AUTH_MSG = {
  'auth/invalid-credential': "That email and password don't match. Check them, or reset your password.",
  'auth/wrong-password': "That email and password don't match. Check them, or reset your password.",
  'auth/user-not-found': "There's no account with that email yet. Create one instead.",
  'auth/invalid-login-credentials': "That email and password don't match. Check them, or reset your password.",
  'auth/email-already-in-use': "There's already an account with that email. Sign in instead.",
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-email': "That email address doesn't look right.",
  'auth/network-request-failed': 'No connection. Signing in needs the internet the first time on each device.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
  'auth/operation-not-allowed': "Email sign-in isn't switched on in Firebase yet. Finish the Authentication step of the setup.",
};
function AuthScreen(){
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const go = m => { setMode(m); setErr(''); setMsg(''); };
  const submit = async e => {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      if(mode === 'signup') await createUserWithEmailAndPassword(auth, email.trim(), pw);
      else if(mode === 'reset'){ await sendPasswordResetEmail(auth, email.trim()); setMsg('If that email has an account, a reset link is on its way. Check your inbox and spam folder.'); }
      else await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch(x) { setErr(AUTH_MSG[x && x.code] || `Sign-in failed (${(x && x.code) || 'unknown error'}). Try again.`); }
    finally { setBusy(false); }
  };
  const heading = { signin: 'Sign in', signup: 'Start your log', reset: 'Forgot it?' }[mode];
  return html`<div class="stack auth">
    <div class="phead"><span class="eyebrow">${mode === 'signup' ? 'Create an account' : mode === 'reset' ? 'Reset your password' : 'Overload lift log'}</span>
      <h1 class="title">${heading}</h1>
      <p class="lede">${mode === 'reset' ? "Enter your email and you'll get a link to set a new password." : 'One account keeps your log in sync on every device. It still works with no signal at the gym.'}</p></div>
    <form class="card" onSubmit=${submit} novalidate>
      <div class="field"><label class="label" for="auth-email">Email</label>
        <input class="inp" id="auth-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" required value=${email} onInput=${e => setEmail(e.target.value)}/></div>
      ${mode !== 'reset' && html`<div class="field"><label class="label" for="auth-pw">Password${mode === 'signup' ? ' (6+ characters)' : ''}</label>
        <input class="inp" id="auth-pw" type="password" autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} minlength="6" required value=${pw} onInput=${e => setPw(e.target.value)}/></div>`}
      ${err && html`<p class="form-msg bad" role="alert">${err}</p>`}
      ${msg && html`<p class="form-msg good" role="status">${msg}</p>`}
      <button class="btn primary block lg" type="submit" disabled=${busy}>${busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
    </form>
    <div class="row" style="justify-content:center">
      ${mode === 'signin'
        ? html`<button class="btn ghost" onClick=${() => go('signup')}>New here? Create an account</button><button class="btn ghost" onClick=${() => go('reset')}>Forgot password?</button>`
        : html`<button class="btn ghost" onClick=${() => go('signin')}>Back to sign in</button>`}
    </div>
  </div>`;
}

/* ---------------- app ---------------- */
const TABS = [['today','Today'],['progress','Progress'],['plan','Plan'],['history','History']];
const closed = new Set();
const LOAD_ERR = {
  'permission-denied': 'The database refused access. Check that the Firestore rules from the setup steps are published, then reload.',
};
function App(){
  const [user, setUser] = useState(configured ? undefined : null);
  const [loadState, setLoadState] = useState('loading');
  const [loadErr, setLoadErr] = useState('');
  const [profile, setProfile] = useState(undefined);
  const [workouts, setWorkouts] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTabState] = useState(() => { const hsh = (location.hash || '').slice(1); return TABS.some(t => t[0] === hsh) ? hsh : 'today'; });
  const [sel, setSel] = useState(null);
  const [picker, setPicker] = useState(null);
  const [note, setNote] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const profileRef = useRef(profile); profileRef.current = profile;
  const draftRef = useRef(draft); draftRef.current = draft;

  useEffect(() => { toastFn = setNote; }, []);
  useEffect(() => { if(!note) return; const t = setTimeout(() => setNote(null), 3800); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => auth ? onAuthStateChanged(auth, u => setUser(u || null)) : undefined, []);

  const uid = user ? user.uid : null;
  useEffect(() => {
    setProfile(undefined); setWorkouts(null); setDraft(null); draftRef.current = null; setLoadState('loading'); setLoadErr(''); setSel(null);
    if(!uid) return;
    store.uid = uid;
    const slow = setTimeout(() => setLoadState(s => s === 'loading' ? 'slow' : s), 8000);
    const fail = e => { console.error(e); setLoadErr(LOAD_ERR[e && e.code] || "Couldn't load your log. Reload the app to try again."); setLoadState('error'); };
    const u1 = onSnapshot(doc(db, 'users', uid), snap => {
      if(profileWriter.busy()) return;
      if(!snap.exists() && snap.metadata.fromCache) return; // only trust "no plan yet" from the server
      setProfile(snap.exists() ? snap.data() : null); setLoadState('ready');
    }, fail);
    const u2 = onSnapshot(query(collection(db, 'users', uid, 'workouts'), orderBy('date', 'desc'), limit(1000)), snap => {
      setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, fail);
    return () => { clearTimeout(slow); u1(); u2(); };
  }, [uid]);

  const setTab = t => { setTabState(t); window.scrollTo(0, 0); };
  const updateProfile = useCallback((fn, now) => {
    const next = fn(clone(profileRef.current)); profileRef.current = next; setProfile(next); profileWriter.queue(next, now);
  }, []);
  const changeDraft = useCallback((fn, now) => {
    const next = fn(clone(draftRef.current)); draftRef.current = next; setDraft(next);
    wWriter(next.id).queue(toDoc(next), now);
  }, []);

  // resume a workout left open on this or another device
  useEffect(() => {
    if(!workouts || draftRef.current || !profile) return;
    const live = workouts.find(w => w.live && !closed.has(w.id));
    if(live) setDraft(fromDoc(live, profile.unit || 'kg'));
  }, [workouts, profile]);

  const draftDoc = draft ? { id: draft.id, ...toDoc(draft) } : null;
  const all = useMemo(() => { if(!workouts) return []; const list = workouts.filter(w => !draftDoc || w.id !== draftDoc.id); if(draftDoc) list.push(draftDoc); return list; }, [workouts, draft]);
  const hist = useMemo(() => buildHistory(all), [all]);
  const cons = useMemo(() => profile ? consistency(profile, all, todayStr()) : null, [profile, all]);

  const remove = id => {
    const w = wWriter(id); w.cancel(); closed.add(id);
    if(draftRef.current && draftRef.current.id === id){ draftRef.current = null; setDraft(null); }
    deleteDoc(workoutDoc(id)).catch(handleWriteError);
  };
  const startWorkout = tplId => {
    if(draftRef.current){ setTab('today'); toast('Finish or discard the workout you have open first.'); return; }
    const p = profileRef.current, tpl = tplId && p.templates[tplId], unit = p.unit || 'kg';
    const d = { id: newId('w'), date: todayStr(), name: tpl ? tpl.name : 'Workout', tpl: tplId || null, note: '', live: true, unit, items: [] };
    d.items = (tpl ? tpl.exIds : []).filter(id => p.exercises[id]).map(id => { const prev = lastBefore(hist, id, d); return { ex: id, n: p.exercises[id].name, sets: blankSets(prev ? prev.sets.length : 3) }; });
    draftRef.current = d; setDraft(d); wWriter(d.id).queue(toDoc(d), true); setTab('today');
  };
  const finish = () => {
    const wasLive = draftRef.current.live;
    const d = { ...draftRef.current, live: false };
    closed.add(d.id);
    const body = toDoc(d);
    if(!body.items.some(it => setsOf(it).length)){ remove(d.id); toast(wasLive ? 'No sets logged, so nothing was saved.' : 'No sets left, so the workout was removed.'); return; }
    let up = 0, total = 0;
    for(const it of body.items){ const sets = setsOf(it); if(!sets.length) continue; total++; if(UP_KINDS.includes(compare(lastBefore(hist, it.ex, d), summarize(sets)).kind)) up++; }
    draftRef.current = null; setDraft(null);
    wWriter(d.id).queue(body, true);
    toast(wasLive ? `Saved. ${up} of ${total} lifts up on last time.` : 'Changes saved.');
    window.scrollTo(0, 0);
  };
  const edit = w => {
    if(draftRef.current){ setTab('today'); toast('Finish the workout you have open first.'); return; }
    const d = fromDoc(w, profileRef.current.unit || 'kg'); draftRef.current = d; setDraft(d); setTab('today');
  };
  const importBackup = (ws, plan) => {
    for(const { id, body } of ws) setDoc(workoutDoc(id), body).catch(handleWriteError);
    if(plan) updateProfile(() => ({ ...clone(plan), createdOn: plan.createdOn || todayStr() }), true);
    toast(`Imported ${plural(ws.length, 'workout')}${plan ? ' and your plan' : ''}.`);
  };
  const create = (split, unit) => { const p = buildProfile(split, unit); profileRef.current = p; setProfile(p); profileWriter.queue(p, true); };
  const doSignOut = async () => { flushAll(); try { await signOut(auth); } catch(_) { toast("Couldn't sign out. Try again."); } };

  const ready = !!uid && profile !== undefined && workouts !== null;
  const loading = (eyebrow, lede) => html`<div class="stack"><div class="phead"><span class="eyebrow">${eyebrow}</span><h1 class="title">Your lift log</h1><p class="lede">${lede}</p></div></div>`;
  let body;
  if(!configured) body = html`<div class="stack"><div class="phead"><span class="eyebrow">Setup</span><h1 class="title">Almost there</h1>
    <p class="lede">This copy of Overload doesn't have its Firebase settings yet. Add them to firebase-config.js and reload.</p></div></div>`;
  else if(user === undefined) body = loading('Loading', 'Opening your workouts, plan and progress.');
  else if(user === null) body = html`<${AuthScreen}/>`;
  else if(loadState === 'error') body = html`<div class="stack"><div class="phead"><span class="eyebrow">Something went wrong</span><h1 class="title">Log unavailable</h1><p class="lede">${loadErr}</p></div>
    <button class="btn" style="align-self:flex-start" onClick=${doSignOut}>Sign out</button></div>`;
  else if(!ready) body = loadState === 'slow'
    ? loading('Still connecting', online ? 'This is taking longer than usual. Check your connection, or reload the app.' : "You're offline. The first time on each device, the app needs the internet to load your log.")
    : loading('Loading', 'Opening your workouts, plan and progress.');
  else if(profile === null) body = html`<${Onboarding} onCreate=${create}/>`;
  else if(tab === 'today') body = draft
    ? html`<${Logger} draft=${draft} profile=${profile} hist=${hist} changeDraft=${changeDraft} onFinish=${finish} onDelete=${() => { remove(draft.id); setTab('today'); }} openPicker=${setPicker}/>`
    : html`<${TodayTab} profile=${profile} cons=${cons} hist=${hist} workouts=${all} startWorkout=${startWorkout} onEdit=${edit}/>`;
  else if(tab === 'progress') body = html`<${ProgressTab} profile=${profile} hist=${hist} sel=${sel} setSel=${setSel}/>`;
  else if(tab === 'plan') body = html`<${PlanTab} profile=${profile} cons=${cons} updateProfile=${updateProfile} openPicker=${setPicker} account=${{ email: user.email, onSignOut: doSignOut }}/>`;
  else body = html`<${HistoryTab} profile=${profile} workouts=${all} onEdit=${edit} onDelete=${remove} onImport=${importBackup}/>`;

  const showNav = ready && profile;
  return html`<div class="app">
    <header class="top">
      <div class="brand"><${PlateGlyph}/>Overload</div>
      ${showNav && html`<nav class="tabs-top" aria-label="Sections">${TABS.map(([k, l]) => html`<button aria-current=${tab === k ? 'page' : null} onClick=${() => setTab(k)}>${l}${k === 'today' && draft ? ' •' : ''}</button>`)}</nav>`}
      <span class="top-date">${parseYmd(todayStr()).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' })}</span>
    </header>
    ${!online && uid && html`<div class="offline" role="status">Offline. Sets save on this device and sync when you're back online.</div>`}
    <main>${body}</main>
    ${showNav && html`<nav class="navbar" aria-label="Sections">${TABS.map(([k, l]) => html`<button aria-current=${tab === k ? 'page' : null} onClick=${() => setTab(k)}>${I[k]()}<span>${l}${k === 'today' && draft ? ' •' : ''}</span></button>`)}</nav>`}
    ${picker && profile && html`<${Picker} profile=${profile} exclude=${picker.exclude || []} title=${picker.title} updateProfile=${updateProfile}
        onPick=${(id, name) => { const p = picker; setPicker(null); p.onPick(id, name); }} onClose=${() => setPicker(null)}/>`}
    ${note && html`<div class="toast" role="status" key=${note.id}>${note.msg}</div>`}
  </div>`;
}
render(html`<${App}/>`, document.getElementById('root'));
if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
