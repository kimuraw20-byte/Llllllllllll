// ======== إعداد التخزين ========
const LS_KEY = 'munazzam_state_full_v3'; // subjects + notes فقط
const DB_NAME = 'munazzam_db_full_v3';
const DB_VERSION = 1; // objectStore: items(id, subjectId, kind, name/title, type, blob, createdAt)

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const state = { subjects: [], selectedSubjectId: null, selecting:false, selectedIds:new Set() };

function load(){
  try{ const raw = localStorage.getItem(LS_KEY); if(raw) Object.assign(state, JSON.parse(raw)); }catch{}
}
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify({subjects: state.subjects, selectedSubjectId: state.selectedSubjectId}));
}

// IndexedDB helpers
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('items')){
        const store = db.createObjectStore('items', {keyPath:'id'});
        store.createIndex('by_subject_kind', ['subjectId','kind']);
        store.createIndex('by_subject', ['subjectId']);
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function idbAdd(item){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    tx.objectStore('items').put(item);
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbGetBySubjectKind(subjectId, kind){
  const db = await openDB();
  return await new Promise((res,rej)=>{
    const tx = db.transaction('items');
    const idx = tx.objectStore('items').index('by_subject_kind');
    const range = IDBKeyRange.only([subjectId, kind]);
    const out = [];
    idx.openCursor(range).onsuccess = e => {
      const cur = e.target.result;
      if(cur){ out.push(cur.value); cur.continue(); } else res(out.sort((a,b)=>b.createdAt-a.createdAt));
    };
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbDeleteMany(ids){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    const st = tx.objectStore('items');
    ids.forEach(id => st.delete(id));
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbDeleteBySubject(subjectId){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    const st = tx.objectStore('items');
    const idx = st.index('by_subject');
    const range = IDBKeyRange.only([subjectId]);
    idx.openCursor(range).onsuccess = e=>{
      const cur = e.target.result;
      if(cur){ st.delete(cur.primaryKey); cur.continue(); }
    };
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}

// ======== أدوات عامة ========
function hexToRGBA(hex,a=1){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)||[];
  const r=parseInt(m[1]||'7E',16),g=parseInt(m[2]||'57',16),b=parseInt(m[3]||'C2',16);
  return `rgba(${r},${g},${b},${a})`;
}
function uid(){ return Math.random().toString(36).slice(2,10); }
function escapeHtml(str){ return (str||'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function escapeAttr(str){ return (str||'').replace(/"/g,'&quot;'); }

// ======== واجهة رئيسية ========
function renderHome(list = state.subjects){
  $('#home').classList.add('active');
  $('#subject').classList.remove('active');
  const grid = $('#subjectsGrid'); grid.innerHTML='';
  if(!list.length){ grid.innerHTML='<div class="empty">لا توجد مواد. اضغط "إضافة مادة".</div>'; return; }
  list.forEach(sub=>{
    const card = document.createElement('div');
    card.className='card selectable';
    card.style.background = `linear-gradient(135deg, ${hexToRGBA(sub.color,.95)}, ${hexToRGBA(sub.color,.7)})`;
    card.dataset.id=sub.id;
    card.innerHTML = `<div class="emoji">${sub.icon}</div><h3>${escapeHtml(sub.name)}</h3><div class="mood">${sub.mood}</div>`;
    // فتح
    card.addEventListener('click', (e)=>{
      if(state.selecting){ toggleSelect(card); return; }
      openSubject(sub.id);
    });
    // تحديد مطول
    attachLongPress(card, ()=>{ startSelecting(); toggleSelect(card); });
    // دعم الماوس (زر يمين)
    card.addEventListener('contextmenu', e=>{e.preventDefault(); startSelecting(); toggleSelect(card);});
    grid.appendChild(card);
  });
}
function startSelecting(){
  state.selecting=true; document.body.classList.add('selecting'); $('#trashBar').classList.add('show');
}
function stopSelecting(){
  state.selecting=false; state.selectedIds.clear(); document.body.classList.remove('selecting'); $('#trashBar').classList.remove('show');
  $$('.selectable').forEach(el=>el.classList.remove('selected'));
}
function toggleSelect(el){ const id=el.dataset.id; if(el.classList.toggle('selected')) state.selectedIds.add(id); else state.selectedIds.delete(id); }

$('#trashBtn').addEventListener('click', async ()=>{
  if(!state.selecting || !state.selectedIds.size) return;
  if($('#home').classList.contains('active')){
    // حذف المواد + بياناتها
    const toDelete = new Set(state.selectedIds);
    state.subjects = state.subjects.filter(s=>{
      const del = toDelete.has(s.id);
      if(del) idbDeleteBySubject(s.id);
      return !del;
    });
    save(); renderHome();
  }else{
    const scope = document.querySelector('.tab-body.active').dataset.scope;
    if(scope==='notes'){
      const s = currentSubject();
      s.notes = (s.notes||[]).filter(n=>!state.selectedIds.has(n.id));
      save(); openSubject(s.id,'notes');
    }else{
      await idbDeleteMany([...state.selectedIds]);
      openSubject(state.selectedSubjectId, scope);
    }
  }
  stopSelecting();
});
$('#cancelSelect').addEventListener('click', stopSelecting);

// إضافة مادة
$('#addSubjectBtn').addEventListener('click', ()=> $('#subjectDialog').showModal());
let pickedIcon='📘', pickedMood='😀', pickedColor='#7E57C2';
$('#iconRow').addEventListener('click', e=>{ if(e.target.tagName==='BUTTON'){ pickedIcon=e.target.textContent; $('#iconPicked').value=pickedIcon; } });
$('#moodRow').addEventListener('click', e=>{ if(e.target.tagName==='BUTTON'){ pickedMood=e.target.textContent; $('#moodPicked').value=pickedMood; } });
$('#colorRow').addEventListener('click', e=>{ if(e.target.dataset.color){ pickedColor=e.target.dataset.color; $('#colorPicked').value=pickedColor; } });
$('#saveSubject').addEventListener('click', e=>{
  e.preventDefault();
  const name=$('#subjectInput').value.trim(); if(!name) return;
  state.subjects.push({id:uid(), name, icon:pickedIcon, mood:pickedMood, color:pickedColor, notes:[]});
  save(); $('#subjectDialog').close(); $('#subjectForm').reset(); renderHome();
});

// ======== شاشة المادة ========
function currentSubject(){ return state.subjects.find(s=>s.id===state.selectedSubjectId); }
function openSubject(id, tab='notes'){
  state.selectedSubjectId=id; save();
  const s=currentSubject(); if(!s) return;
  $('#home').classList.remove('active'); $('#subject').classList.add('active');
  $('#subjectName').textContent=s.name; $('#subjectIcon').textContent=s.icon; $('#subjectMood').textContent=s.mood;
  $$('.tab').forEach(btn=>btn.classList.toggle('active', btn.dataset.tab===tab));
  $$('.tab-body').forEach(body=>body.classList.toggle('active', body.id===`tab-${tab}`));
  renderTab(tab);
}
$('#backBtn').addEventListener('click', ()=> { stopSelecting(); renderHome(); });
$$('.tab').forEach(btn=> btn.addEventListener('click', ()=>{
  const target=btn.dataset.tab;
  $$('.tab').forEach(b=>b.classList.toggle('active', b===btn));
  $$('.tab-body').forEach(body=>body.classList.toggle('active', body.id===`tab-${target}`));
  stopSelecting();
  renderTab(target);
}));

// Long press helper
function attachLongPress(el, cb){
  let t=null;
  const start = ()=>{ clearTimeout(t); t=setTimeout(cb, 500); };
  const cancel = ()=>{ clearTimeout(t); };
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('pointerdown', (e)=>{ if(e.pointerType==='mouse') return; start(); });
  el.addEventListener('pointerup', cancel);
}

// ======== تبويبات ========
async function renderTab(tab){
  const s=currentSubject(); if(!s) return;

  if(tab==='notes'){
    const ul=$('#notesList'); ul.innerHTML='';
    (s.notes||[]).slice().reverse().forEach(n=>{
      const li=document.createElement('li'); li.className='note selectable'; li.dataset.id=n.id;
      li.textContent = n.text; ul.appendChild(li);
      li.addEventListener('click', ()=>{ if(state.selecting) toggleSelect(li); });
      attachLongPress(li, ()=>{ startSelecting(); toggleSelect(li); });
      li.addEventListener('contextmenu', e=>{ e.preventDefault(); startSelecting(); toggleSelect(li); });
    });
    toggleEmpty('notes', (s.notes||[]).length);
  }

  if(tab==='files'){
    const wrap=$('#filesList'); wrap.innerHTML='';
    const items = await idbGetBySubjectKind(s.id,'file');
    items.forEach(it=>{
      const url = URL.createObjectURL(it.blob);
      const ext = (it.name.split('.').pop()||'').toUpperCase();
      const card=document.createElement('div'); card.className='file-card selectable'; card.dataset.id=it.id;
      card.innerHTML = `<div class="file-ext">${ext||'ملف'}</div>
        <div class="file-title">${escapeHtml(it.title||it.name)}</div>
        <div><a href="${url}" download="${escapeAttr(it.name)}">تنزيل</a> · <a target="_blank" href="${url}">فتح</a></div>`;
      // تحديد مطوّل
      card.addEventListener('click', ()=>{ if(state.selecting) toggleSelect(card); });
      attachLongPress(card, ()=>{ startSelecting(); toggleSelect(card); });
      card.addEventListener('contextmenu', e=>{ e.preventDefault(); startSelecting(); toggleSelect(card); });
      wrap.appendChild(card);
    });
    toggleEmpty('files', items.length);
  }

  if(tab==='images'){
    const wrap=$('#imagesList'); wrap.innerHTML='';
    const items = await idbGetBySubjectKind(s.id,'image');
    items.forEach(it=>{
      const url = URL.createObjectURL(it.blob);
      const card=document.createElement('div'); card.className='img-card selectable'; card.dataset.id=it.id;
      const img=document.createElement('img'); img.src=url; img.alt='image';
      img.addEventListener('click', (e)=>{
        if(state.selecting){ toggleSelect(card); return; }
        showImageModal(url);
      });
      card.appendChild(img);
      attachLongPress(card, ()=>{ startSelecting(); toggleSelect(card); });
      card.addEventListener('contextmenu', e=>{ e.preventDefault(); startSelecting(); toggleSelect(card); });
      wrap.appendChild(card);
    });
    toggleEmpty('images', items.length);
  }

  if(tab==='audio'){
    const wrap=$('#audioList'); wrap.innerHTML='';
    const items = await idbGetBySubjectKind(s.id,'audio');
    items.forEach(it=>{
      const url = URL.createObjectURL(it.blob);
      const card=document.createElement('div'); card.className='audio-card selectable'; card.dataset.id=it.id;
      card.innerHTML = `<div class="file-title">${escapeHtml(it.name)}</div><audio controls src="${url}"></audio>`;
      card.addEventListener('click', ()=>{ if(state.selecting) toggleSelect(card); });
      attachLongPress(card, ()=>{ startSelecting(); toggleSelect(card); });
      card.addEventListener('contextmenu', e=>{ e.preventDefault(); startSelecting(); toggleSelect(card); });
      wrap.appendChild(card);
    });
    toggleEmpty('audio', items.length);
  }
}
function toggleEmpty(kind,count){ document.querySelector(`[data-empty="${kind}"]`).style.display = count? 'none':'block'; }

// ======== إضافة عناصر ========
document.body.addEventListener('click', (e)=>{
  const add=e.target.dataset.add;
  if(!add) return;
  if(add==='note') $('#noteDialog').showModal();
  if(add==='file') $('#fileDialog').showModal();
  if(add==='image') $('#imageDialog').showModal();
  if(add==='audio') $('#audioDialog').showModal();
});

$('#saveNote').addEventListener('click', (e)=>{
  e.preventDefault();
  const text = $('#noteText').value.trim(); if(!text) return;
  const s = currentSubject(); s.notes = s.notes||[];
  s.notes.push({id:uid(), text, createdAt:Date.now()}); save();
  $('#noteDialog').close(); $('#noteForm').reset(); renderTab('notes');
});
$('#saveFile').addEventListener('click', async (e)=>{
  e.preventDefault();
  const f = $('#fileInput').files[0]; if(!f) return;
  const title = $('#fileTitle').value.trim();
  const s=currentSubject();
  await idbAdd({id:uid(), subjectId:s.id, kind:'file', name:f.name, title, type:f.type, blob:f, createdAt:Date.now()});
  $('#fileDialog').close(); $('#fileForm').reset(); renderTab('files');
});
$('#saveImage').addEventListener('click', async (e)=>{
  e.preventDefault();
  const f = $('#imageInput').files[0]; if(!f) return;
  const s=currentSubject();
  await idbAdd({id:uid(), subjectId:s.id, kind:'image', name:f.name, type:f.type, blob:f, createdAt:Date.now()});
  $('#imageDialog').close(); $('#imageForm').reset(); renderTab('images');
});
$('#saveAudio').addEventListener('click', async (e)=>{
  e.preventDefault();
  const f = $('#audioInput').files[0]; if(!f) return;
  const s=currentSubject();
  await idbAdd({id:uid(), subjectId:s.id, kind:'audio', name:f.name, type:f.type, blob:f, createdAt:Date.now()});
  $('#audioDialog').close(); $('#audioForm').reset(); renderTab('audio');
});

// ======== صورة بالحجم الكامل ========
function showImageModal(src){
  const modal = $('#imageModal'); const img = $('#modalImage');
  img.src = src; modal.classList.add('show');
}
$('#imageModal').addEventListener('click', ()=> $('#imageModal').classList.remove('show'));

// ======== تشغيل ========
load();
renderHome();