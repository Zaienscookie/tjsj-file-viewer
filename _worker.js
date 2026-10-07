// ============================================================
// 社团内部软件 (st.zain-dev.top) - Cloudflare Worker
// 功能: 📂文档浏览(GitHub私有仓库) / 📝备忘录 / 📌便利贴 / 📅课表(多班级)
// 存储: CF KV (绑定: memos, notes, scheds)
// 安全: 私有仓库走 Secret GH_TOKEN; 建议加 CF Access 登录保护
// ============================================================

// 登录防爆破: 每 IP 5 次失败锁 10 分钟
const FAILS = new Map();
function checkFail(ip) {
  const f = FAILS.get(ip);
  if (f && f.count >= 5 && Date.now() < f.until) return 600 - Math.ceil((f.until - Date.now()) / 1000);
  return 0;
}
function addFail(ip) {
  const f = FAILS.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + 600000;
  FAILS.set(ip, f);
}
function clearFail(ip) { FAILS.delete(ip); }

const REPO = "Zaienscookie/tjsj-document-together";
const BRANCH = "main";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.GH_TOKEN || "";
    const h = { Authorization: `Bearer ${token}`, "User-Agent": "club-app" };
    // ---- 登录校验 (Secret: ACCESS_PASS) ----
    const cookie = request.headers.get("Cookie") || "";
    const expect = await sha256hex((env.ACCESS_PASS || "") + "::club");
    if (url.pathname === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const lock = checkFail(ip);
      if (lock > 0) return new Response(JSON.stringify({ ok: false, error: "尝试过多，请 " + lock + " 秒后再试" }), { headers: { "Content-Type": "application/json" } });
      const { pass } = await request.json();
      if (pass === (env.ACCESS_PASS || "")) { clearFail(ip);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Set-Cookie": `club_auth=${expect}; Max-Age=2592000; Path=/; SameSite=Lax`, "Content-Type": "application/json" }
        });
      }
      addFail(ip);
      return new Response(JSON.stringify({ ok: false, error: "密码错误" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/logout") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Set-Cookie": "club_auth=; Max-Age=0; Path=/", "Content-Type": "application/json" } });
    }
    if (!cookie.includes("club_auth=" + expect)) {
      if (url.pathname === "/api/login") return new Response(JSON.stringify({ ok: false }), { headers: { "Content-Type": "application/json" } });
      return new Response(LOGIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const path = url.pathname;

    // ---- 文档浏览 API ----
    if (path === "/api/list") {
      const p = url.searchParams.get("path") || "";
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(p)}?ref=${BRANCH}`, { headers: h });
      const d = await r.json();
      if (!Array.isArray(d)) return j({ error: "目录读取失败" });
      return j(d.map(x => ({ name: x.name, type: x.type, size: x.size })));
    }
    if (path === "/api/raw") {
      const p = url.searchParams.get("path") || "";
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(p)}?ref=${BRANCH}`, { headers: h });
      const d = await r.json();
      if (d.content) return j({ b64: d.content });
      const dl = await fetch(d.download_url, { headers: h });
      return new Response(dl.body, { headers: { "Content-Type": d.type || "application/octet-stream" } });
    }

    // ---- 备忘录 API (KV: memos) ----
    if (path === "/api/memo" && request.method === "GET") {
      return j(JSON.parse(await env.memos.get("list") || "[]"));
    }
    if (path === "/api/memo" && request.method === "POST") {
      const body = await request.json();
      const list = JSON.parse(await env.memos.get("list") || "[]");
      body.id = Date.now().toString(36);
      body.time = new Date().toLocaleString("zh-CN");
      list.push(body);
      await env.memos.put("list", JSON.stringify(list));
      return j({ ok: true, list });
    }
    if (path === "/api/memo/del" && request.method === "POST") {
      const { id } = await request.json();
      const list = JSON.parse(await env.memos.get("list") || "[]").filter(x => x.id !== id);
      await env.memos.put("list", JSON.stringify(list));
      return j({ ok: true, list });
    }

    // ---- 便利贴 API (KV: notes) ----
    if (path === "/api/note" && request.method === "GET") {
      return j(JSON.parse(await env.notes.get("list") || "[]"));
    }
    if (path === "/api/note" && request.method === "POST") {
      const body = await request.json();
      const list = JSON.parse(await env.notes.get("list") || "[]");
      body.id = Date.now().toString(36);
      body.time = new Date().toLocaleString("zh-CN");
      list.push(body);
      await env.notes.put("list", JSON.stringify(list));
      return j({ ok: true, list });
    }
    if (path === "/api/note/del" && request.method === "POST") {
      const { id } = await request.json();
      const list = JSON.parse(await env.notes.get("list") || "[]").filter(x => x.id !== id);
      await env.notes.put("list", JSON.stringify(list));
      return j({ ok: true, list });
    }

    // ---- 课表 API (KV: scheds) ----
    if (path === "/api/sched/classes") {
      return j(JSON.parse(await env.scheds.get("classes") || '["默认班级"]'));
    }
    if (path === "/api/sched" && request.method === "GET") {
      const cls = url.searchParams.get("class") || "默认班级";
      const key = "sched_" + cls;
      return j({ class: cls, sched: JSON.parse(await env.scheds.get(key) || '[[],[]]') });
    }
    if (path === "/api/sched" && request.method === "POST") {
      const { cls, sched } = await request.json();
      await env.scheds.put("sched_" + cls, JSON.stringify(sched));
      const classes = JSON.parse(await env.scheds.get("classes") || '["默认班级"]');
      if (!classes.includes(cls)) { classes.push(cls); await env.scheds.put("classes", JSON.stringify(classes)); }
      return j({ ok: true });
    }

        // ---- 首页 ----
    return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
  }
};

function j(obj) {
  return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const LOGIN_HTML = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>社团内部软件 - 登录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC",sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#fff;border-radius:20px;padding:40px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18);text-align:center}
h1{font-size:20px;margin-bottom:6px;color:#333}
p{color:#999;font-size:13px;margin-bottom:20px}
input{width:100%;padding:12px;border:1px solid #d5d8e0;border-radius:10px;font-size:15px;margin-bottom:14px;text-align:center}
button{width:100%;padding:12px;background:#4a6cf7;color:#fff;border:0;border-radius:10px;font-size:15px;cursor:pointer}
button:hover{background:#3a5be0}
#err{color:#c33;font-size:13px;margin-top:10px;display:none}
</style></head><body>
<div class="box">
  <h1>🏫 社团内部软件</h1>
  <p>请输入访问密码</p>
  <input type="password" id="pass" placeholder="密码" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">登 录</button>
  <div id="err">密码错误，请重试</div>
</div>
<script>
async function login(){
  const pass=document.getElementById("pass").value;
  const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pass})});
  const d=await r.json();
  if(d.ok){location.reload();}else{document.getElementById("err").style.display="block";}
}
</script></body></html>`;


const HTML = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>社团内部软件</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/docx-preview@0.3.0/dist/docx-preview.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6fa;height:100vh;display:flex;flex-direction:column}
/* 顶栏 */
.top{background:#2d3a4e;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.top h1{font-size:18px;font-weight:700;margin-right:12px}
.tab{padding:8px 14px;border-radius:20px;cursor:pointer;font-size:14px;color:#cbd5e1}
.tab:hover{background:#3d4f6b}
.tab.active{background:#4a6cf7;color:#fff}
/* 文档 */
#docView{flex:1;display:flex;overflow:hidden}
#tree{width:280px;min-width:280px;background:#fff;border-right:1px solid #e5e5e5;overflow:auto;padding:10px}
#tree .dir{padding:6px 8px;cursor:pointer;border-radius:6px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tree .dir:hover{background:#f0f2f8}
#mainDoc{flex:1;display:flex;flex-direction:column;overflow:hidden}
#crumbs{padding:8px 14px;background:#fff;border-bottom:1px solid #e5e5e5;font-size:13px;display:flex;gap:5px;flex-wrap:wrap}
#crumbs a{color:#4a6cf7;cursor:pointer}
#files{flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;align-content:start}
.file{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px;cursor:pointer;transition:.15s}
.file:hover{border-color:#4a6cf7;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.06)}
.file .ic{font-size:26px}.file .nm{font-size:12px;margin-top:5px;color:#333;word-break:break-all}
/* 通用面板 */
.panel{flex:1;overflow:auto;padding:20px;display:none}
.panel.active{display:block}
h2{font-size:18px;margin-bottom:14px;color:#333}
/* 表单 */
input,textarea{width:100%;padding:10px;border:1px solid #d5d8e0;border-radius:8px;font-size:14px;margin-bottom:8px;font-family:inherit}
textarea{min-height:80px;resize:vertical}
.btn{background:#4a6cf7;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;font-size:14px}
.btn.gray{background:#e5e7ef;color:#333}
/* 备忘录 */
.memo{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.memo .t{font-weight:600;font-size:14px}.memo .c{color:#555;font-size:13px;margin-top:4px}.memo .tm{color:#aaa;font-size:11px;margin-top:4px}
.memo button{background:#fee;color:#c33;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
/* 便利贴 */
#notesWall{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.note{width:190px;min-height:150px;border-radius:12px;padding:14px;box-shadow:0 4px 10px rgba(0,0,0,.1);position:relative;color:#333;font-size:13px;line-height:1.6}
.note .x{position:absolute;top:6px;right:8px;cursor:pointer;background:rgba(0,0,0,.1);border-radius:50%;width:20px;height:20px;text-align:center;line-height:20px;font-size:11px}
.note .tm{font-size:10px;opacity:.7;margin-top:8px}
/* 课表 */
.sched-tool{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap}
#schedTable{width:100%;border-collapse:collapse;background:#fff}
#schedTable th,#schedTable td{border:1px solid #d5d8e0;padding:8px;text-align:center;font-size:13px;min-width:90px}
#schedTable th{background:#f0f2f8}
#schedTable .period{background:#fafbfc;font-weight:600}
/* 预览弹层 */
#preview{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:99}
#preview .box{position:absolute;inset:20px;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden}
#preview .bar{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #eee;gap:10px}
#preview .bar .t{flex:1;font-size:14px;font-weight:600;word-break:break-all}
#preview .bar button{background:#4a6cf7;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer}
#preview .body{flex:1;overflow:auto;padding:20px;font-size:14px;line-height:1.7}
#preview .body img{max-width:100%}
#preview .body table{border-collapse:collapse}#preview .body td,#preview .body th{border:1px solid #ccc;padding:4px 8px}
#loading{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:none;background:#fff;padding:14px 24px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:100}
</style></head><body>

<div class="top">
  <h1>🏫 社团内部软件</h1>
  <span class="tab active" data-tab="doc" onclick="switchTab('doc')">📂 文档</span>
  <span class="tab" data-tab="memo" onclick="switchTab('memo')">📝 备忘录</span>
  <span class="tab" data-tab="note" onclick="switchTab('note')">📌 便利贴</span>
  <span class="tab" data-tab="sched" onclick="switchTab('sched')">📅 课表</span>
  <span style="margin-left:auto;color:#cbd5e1;cursor:pointer;font-size:13px" onclick="logout()">退出登录 ↩</span>
</div>

<!-- 文档 -->
<div id="docView">
  <div id="tree"></div>
  <div id="mainDoc">
    <div id="crumbs"><a onclick="go('')">📁 根目录</a></div>
    <div id="files"></div>
  </div>
</div>

<!-- 备忘录 -->
<div class="panel" id="panel-memo">
  <h2>📝 备忘录</h2>
  <input id="memoTitle" placeholder="标题">
  <textarea id="memoContent" placeholder="内容…"></textarea>
  <button class="btn" onclick="addMemo()">＋ 添加</button>
  <div id="memoList" style="margin-top:16px"></div>
</div>

<!-- 便利贴 -->
<div class="panel" id="panel-note">
  <h2>📌 便利贴</h2>
  <textarea id="noteContent" placeholder="写点啥…"></textarea>
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
    <span>颜色：</span>
    <input type="color" id="noteColor" value="#fef08a" style="width:40px;height:32px;padding:0;border:0">
    <button class="btn" onclick="addNote()">＋ 贴上去</button>
  </div>
  <div id="notesWall"></div>
</div>

<!-- 课表 -->
<div class="panel" id="panel-sched">
  <h2>📅 课表</h2>
  <div class="sched-tool">
    <span>班级：</span>
    <input id="schedClass" placeholder="输入班级名" style="width:140px">
    <button class="btn" onclick="loadSched()">打开</button>
    <button class="btn gray" onclick="saveSched()">💾 保存课表</button>
    <span style="color:#999;font-size:12px">不同班级可建不同课表，点格子编辑</span>
  </div>
  <div id="schedWrap" style="overflow:auto"></div>
</div>

<div id="preview"><div class="box">
  <div class="bar"><span class="t" id="pvTitle"></span><button onclick="dl()">⬇ 下载</button><button onclick="closePv()">✕</button></div>
  <div class="body" id="pvBody"></div>
</div></div>
<div id="loading">加载中…</div>

<script>
function logout(){ fetch("/api/logout").then(()=>location.reload()); }
// ===== Tab 切换 =====
function switchTab(t){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===t));
  ["doc","memo","note","sched"].forEach(x=>{const el=document.getElementById(x==="doc"?"docView":"panel-"+x); if(el) el.style.display = x===t?"flex":"none";});
  document.getElementById("panel-"+t).classList.add("active");
  if(t==="memo") loadMemo(); if(t==="note") loadNote(); if(t==="sched") loadSchedClasses();
}
// ===== 文档 =====
let curPath="", curName="";
const ICONS={md:"📄",pdf:"📕",docx:"📘",xlsx:"📗",doc:"📘",xls:"📗",pptx:"📙",zip:"🗜️",png:"🖼️",jpg:"🖼️",jpeg:"🖼️",gif:"🖼️",txt:"📄",csv:"📊",default:"📎"};
function ic(n){return ICONS[n.split(".").pop().toLowerCase()]||ICONS.default}
function fmtSize(n){if(!n)return"";if(n>1048576)return(n/1048576).toFixed(1)+" MB";if(n>1024)return(n/1024).toFixed(1)+" KB";return n+" B"}
async function load(path){
  curPath=path; const r=await fetch("/api/list?path="+encodeURIComponent(path)); const items=await r.json();
  const files=document.getElementById("files"); files.innerHTML="";
  items.forEach(it=>{const el=document.createElement("div");el.className="file";
    el.innerHTML=\`<div class="ic">\${ic(it.name)}</div><div class="nm">\${it.name}</div><div style="font-size:11px;color:#999;margin-top:4px">\${it.type==="dir"?"📂 文件夹":fmtSize(it.size)}</div>\`;
    el.onclick=()=>it.type==="dir"?load(path?path+"/"+it.name:it.name):openFile(path?path+"/"+it.name:it.name);
    files.appendChild(el);});
  const tree=document.getElementById("tree"); tree.innerHTML="";
  items.filter(x=>x.type==="dir").forEach(d=>{const el=document.createElement("div");el.className="dir";el.textContent="📂 "+d.name;el.onclick=()=>load(path?path+"/"+d.name:d.name);tree.appendChild(el);});
  const hr=document.createElement("hr");hr.style.cssText="border:none;border-top:1px solid #eee;margin:6px 0";tree.appendChild(hr);
  items.filter(x=>x.type!=="dir").forEach(f=>{const el=document.createElement("div");el.className="dir";el.textContent=ic(f.name)+" "+f.name;el.onclick=()=>openFile(path?path+"/"+f.name:f.name);tree.appendChild(el);});
  document.getElementById("crumbs").innerHTML=\`<a onclick="go('')">📁 根目录</a>\`+(path?path.split("/").map((p,i)=>{const pp=path.split("/").slice(0,i+1).join("/");return \`<span> / </span><a onclick="go('\${pp}')">\${p}</a>\`}).join(""):"");
}
function go(p){load(p)}
async function openFile(path){
  curName=path.split("/").pop(); document.getElementById("pvTitle").textContent=curName;
  const body=document.getElementById("pvBody"); body.innerHTML=""; document.getElementById("loading").style.display="block";
  const ext=curName.split(".").pop().toLowerCase(); document.getElementById("preview").style.display="block";
  try{
    const r=await fetch("/api/raw?path="+encodeURIComponent(path)); const d=await r.json();
    if(ext==="md")body.innerHTML=marked.parse(atob(d.b64));
    else if(["png","jpg","jpeg","gif","svg"].includes(ext))body.innerHTML=\`<img src="data:image/\${ext==="svg"?"svg+xml":ext};base64,\${d.b64}">\`;
    else if(ext==="pdf")body.innerHTML=\`<iframe style="width:100%;height:100%;border:0" src="data:application/pdf;base64,\${d.b64}"></iframe>\`;
    else if(ext==="docx"){const b=new Blob([Uint8Array.from(atob(d.b64),c=>c.charCodeAt(0))],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});docx.renderAsync(b,body);}
    else if(ext==="xlsx"||ext==="xls"){const wb=XLSX.read(d.b64,{type:"base64"});body.innerHTML=wb.SheetNames.map(n=>\`<h3>📊 \${n}</h3>\`+XLSX.utils.sheet_to_html(wb.Sheets[n])).join("");}
    else if(ext==="txt"||ext==="csv")body.innerHTML=\`<pre style="white-space:pre-wrap">\${atob(d.b64)}</pre>\`;
    else body.innerHTML="<p style='color:#999'>该类型不支持在线预览，请点「⬇ 下载」</p>";
  }catch(e){body.innerHTML="<p style='color:#c33'>预览失败: "+e+"</p>"}
  document.getElementById("loading").style.display="none";
}
function dl(){window.open("/api/raw?path="+encodeURIComponent(curPath?curPath+"/"+curName:curName))}
function closePv(){document.getElementById("preview").style.display="none"}

// ===== 备忘录 =====
async function loadMemo(){
  const r=await fetch("/api/memo"); const list=await r.json();
  const box=document.getElementById("memoList"); box.innerHTML="";
  list.forEach(m=>{
    const el=document.createElement("div"); el.className="memo";
    el.innerHTML=\`<div><div class="t">\${m.title||"无标题"}</div><div class="c">\${m.content||""}</div><div class="tm">🕐 \${m.time||""}</div></div><button onclick="delMemo('\${m.id}')">删除</button>\`;
    box.appendChild(el);});
}
async function addMemo(){
  const t=document.getElementById("memoTitle").value, c=document.getElementById("memoContent").value;
  if(!t&&!c){alert("写点内容吧");return}
  await fetch("/api/memo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:t,content:c})});
  document.getElementById("memoTitle").value="";document.getElementById("memoContent").value=""; loadMemo();
}
async function delMemo(id){await fetch("/api/memo/del",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});loadMemo()}

// ===== 便利贴 =====
async function loadNote(){
  const r=await fetch("/api/note"); const list=await r.json();
  const wall=document.getElementById("notesWall"); wall.innerHTML="";
  list.forEach(n=>{
    const el=document.createElement("div"); el.className="note"; el.style.background=n.color||"#fef08a";
    el.innerHTML=\`<div class="x" onclick="delNote('\${n.id}')">✕</div><div>\${n.content||""}</div><div class="tm">🕐 \${n.time||""}</div>\`;
    wall.appendChild(el);});
}
async function addNote(){
  const c=document.getElementById("noteContent").value, col=document.getElementById("noteColor").value;
  if(!c){alert("写点内容吧");return}
  await fetch("/api/note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:c,color:col})});
  document.getElementById("noteContent").value=""; loadNote();
}
async function delNote(id){await fetch("/api/note/del",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});loadNote()}

// ===== 课表 =====
let curSchedClass="默认班级", curSched=[["","","","","","",""],["","","","","","",""],["","","","","","",""],["","","","","","",""],["","","","","","",""]];
const DAYS=["周一","周二","周三","周四","周五","周六","周日"];
async function loadSchedClasses(){
  const r=await fetch("/api/sched/classes"); const classes=await r.json();
  if(classes.length) curSchedClass=classes[0];
  document.getElementById("schedClass").value=curSchedClass; loadSched();
}
async function loadSched(){
  const cls=document.getElementById("schedClass").value||"默认班级"; curSchedClass=cls;
  const r=await fetch("/api/sched?class="+encodeURIComponent(cls)); const d=await r.json(); curSched=d.sched||curSched;
  renderSched();
}
function renderSched(){
  const wrap=document.getElementById("schedWrap");
  let h=\`<table id="schedTable"><tr><th>节次</th>\${DAYS.map(d=>\`<th>\${d}</th>\`).join("")}</tr>\`;
  curSched.forEach((row,ri)=>{
    h+=\`<tr><td class="period">第\${ri+1}节</td>\`;
    row.forEach((cell,ci)=>{ h+=\`<td contenteditable="true" onblur="cellEdit(\${ri},\${ci},this.textContent)">\${cell||""}</td>\`; });
    h+=\`</tr>\`;
  });
  h+=\`</table>\`;
  wrap.innerHTML=h;
}
function cellEdit(r,c,txt){curSched[r][c]=txt}
async function saveSched(){
  await fetch("/api/sched",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cls:curSchedClass,sched:curSched})});
  alert("课表已保存 ✅");
}

// 启动
load("");
</script></body></html>
`;
