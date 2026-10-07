// tjsj-document-together 在线文件浏览器 (Cloudflare Worker)
// 部署: CF Workers + Secret: GH_TOKEN (GitHub token, 私有仓库)
// 路由: GET / (页面) | /api/list?path= (目录) | /api/raw?path= (文件/下载)

const REPO = "Zaienscookie/tjsj-document-together";
const BRANCH = "main";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.GH_TOKEN || "";
    const h = { Authorization: `Bearer ${token}`, "User-Agent": "tjsj-viewer" };

    // API 代理
    if (url.pathname === "/api/list") {
      const path = url.searchParams.get("path") || "";
      const api = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`;
      const r = await fetch(api, { headers: h });
      const data = await r.json();
      return new Response(JSON.stringify(data.map(x => ({ name: x.name, type: x.type, size: x.size, download: x.download_url }))),
        { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/raw") {
      const path = url.searchParams.get("path") || "";
      const api = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`;
      const r = await fetch(api, { headers: h });
      const data = await r.json();
      if (data.content) {
        return new Response(JSON.stringify({ b64: data.content }), { headers: { "Content-Type": "application/json" } });
      }
      const dl = await fetch(data.download_url, { headers: h });
      return new Response(dl.body, { headers: { "Content-Type": data.type || "application/octet-stream" } });
    }

    // 页面
    return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};

const HTML = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TJSJ 文档库</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/docx-preview@0.3.0/dist/docx-preview.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC",sans-serif;display:flex;height:100vh;background:#f5f6fa}
#tree{width:300px;min-width:300px;background:#2d3a4e;color:#eee;overflow:auto;padding:12px}
#tree .dir{padding:6px 8px;cursor:pointer;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tree .dir:hover{background:#3d4f6b}
#main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#crumbs{padding:10px 16px;background:#fff;border-bottom:1px solid #ddd;font-size:14px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#crumbs a{color:#4a6cf7;cursor:pointer;text-decoration:none}
#files{flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;align-content:start}
.file{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px;cursor:pointer;transition:.15s}
.file:hover{border-color:#4a6cf7;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.08)}
.file .ic{font-size:28px}.file .nm{font-size:13px;margin-top:6px;word-break:break-all;color:#333}
.file .sz{font-size:11px;color:#999;margin-top:4px}
#preview{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:99}
#preview .box{position:absolute;inset:20px;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden}
#preview .bar{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #eee;gap:10px}
#preview .bar .t{flex:1;font-size:14px;font-weight:600;word-break:break-all}
#preview .bar button{background:#4a6cf7;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer}
#preview .body{flex:1;overflow:auto;padding:20px;font-size:14px;line-height:1.7}
#preview .body img{max-width:100%}
#preview .body table{border-collapse:collapse} #preview .body td,#preview .body th{border:1px solid #ccc;padding:4px 8px}
#loading{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:none;font-size:15px;background:#fff;padding:14px 24px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2)}
</style></head><body>
<div id="tree"></div>
<div id="main">
  <div id="crumbs"><a onclick="go('')">📁 根目录</a></div>
  <div id="files"></div>
</div>
<div id="preview"><div class="box">
  <div class="bar"><span class="t" id="pvTitle"></span><button onclick="dl()">⬇ 下载</button><button onclick="closePv()">✕</button></div>
  <div class="body" id="pvBody"></div>
</div></div>
<div id="loading">加载中…</div>
<script>
let curPath = "", curName = "";
const ICONS = { md:"📄", pdf:"📕", docx:"📘", xlsx:"📗", doc:"📘", xls:"📗", pptx:"📙", zip:"🗜️", png:"🖼️", jpg:"🖼️", jpeg:"🖼️", gif:"🖼️", txt:"📄", csv:"📊", default:"📎" };
function ic(name){ const e = name.split(".").pop().toLowerCase(); return ICONS[e] || ICONS.default; }
function fmtSize(n){ if(!n) return ""; if(n>1048576) return (n/1048576).toFixed(1)+" MB"; if(n>1024) return (n/1024).toFixed(1)+" KB"; return n+" B"; }
async function load(path){ curPath = path; const r = await fetch("/api/list?path="+encodeURIComponent(path)); const items = await r.json();
  const files = document.getElementById("files"); files.innerHTML = "";
  items.forEach(it => { const el = document.createElement("div"); el.className = "file";
    el.innerHTML = `<div class="ic">${ic(it.name)}</div><div class="nm">${it.name}</div><div class="sz">${it.type==="dir"?"📂 文件夹":fmtSize(it.size)}</div>`;
    el.onclick = () => it.type==="dir" ? load(path ? path+"/"+it.name : it.name) : openFile(path ? path+"/"+it.name : it.name);
    files.appendChild(el); });
  document.getElementById("crumbs").innerHTML = `<a onclick="go('')">📁 根目录</a>` + (path ? path.split("/").map((p,i)=>{const pp=path.split("/").slice(0,i+1).join("/");return `<span> / </span><a onclick="go('${pp}')">${p}</a>`;}).join("") : "");
  buildTree(items, path);
}
function buildTree(items, cur){ const tree=document.getElementById("tree"); tree.innerHTML="";
  items.filter(x=>x.type==="dir").forEach(d=>{ const el=document.createElement("div"); el.className="dir"; el.textContent="📂 "+d.name;
    el.onclick=()=>load(cur?cur+"/"+d.name:d.name); tree.appendChild(el); });
  const hr=document.createElement("hr"); hr.style.cssText="border:none;border-top:1px solid #4a5a72;margin:8px 0"; tree.appendChild(hr);
  items.filter(x=>x.type!=="dir").forEach(f=>{ const el=document.createElement("div"); el.className="dir"; el.textContent=ic(f.name)+" "+f.name;
    el.onclick=()=>openFile(cur?cur+"/"+f.name:f.name); tree.appendChild(el); });
}
function go(p){ load(p); }
async function openFile(path){ curName = path.split("/").pop(); document.getElementById("pvTitle").textContent = curName;
  const body = document.getElementById("pvBody"); body.innerHTML = ""; document.getElementById("loading").style.display="block";
  const ext = curName.split(".").pop().toLowerCase(); const pv = document.getElementById("preview"); pv.style.display="block";
  try {
    const r = await fetch("/api/raw?path="+encodeURIComponent(path)); const d = await r.json();
    if (ext === "md") { body.innerHTML = marked.parse(atob(d.b64)); }
    else if (["png","jpg","jpeg","gif","svg"].includes(ext)) { body.innerHTML = `<img src="data:image/${ext==="svg"?"svg+xml":ext};base64,${d.b64}">`; }
    else if (ext === "pdf") { body.innerHTML = `<iframe style="width:100%;height:100%;border:0" src="data:application/pdf;base64,${d.b64}"></iframe>`; }
    else if (ext === "docx") { const blob = new Blob([Uint8Array.from(atob(d.b64), c=>c.charCodeAt(0))], {type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}); docx.renderAsync(blob, body); }
    else if (ext === "xlsx" || ext === "xls") { const wb = XLSX.read(d.b64, {type:"base64"}); body.innerHTML = wb.SheetNames.map(n=>`<h3>📊 ${n}</h3>`+XLSX.utils.sheet_to_html(wb.Sheets[n])).join(""); }
    else if (ext === "txt" || ext === "csv") { body.innerHTML = `<pre style="white-space:pre-wrap">${atob(d.b64)}</pre>`; }
    else body.innerHTML = "<p style='color:#999'>该类型不支持在线预览，请点「⬇ 下载」查看</p>";
  } catch(e) { body.innerHTML = "<p style='color:#c33'>预览失败: "+e+"</p>"; }
  document.getElementById("loading").style.display="none";
}
async function dl(){ window.open("/api/raw?path="+encodeURIComponent(curPath?curPath+"/"+curName:curName)); }
function closePv(){ document.getElementById("preview").style.display="none"; }
load("");
</script></body></html>`;
