const $=id=>document.getElementById(id), Perf=window.RAPerf;
const host=io(); let viewer=null, code=null, viewerCode=null, stream=null, hostPeer=null, viewerPeer=null, pending=null, timer=null;
let permissions={control:false,clipboard:false,files:false,audio:false}, pendingFile=null, outgoingFile=null, deviceName="PC";

function status(t,kind="good"){$("status").textContent=`● ${t}`;$("status").className=`status ${kind}`}
function fmt(v){return String(v||"").replace(/\D/g,"").slice(0,9).replace(/(\d{3})(?=\d)/g,"$1 ")}
function saveHistory(type,detail){const h=JSON.parse(localStorage.getItem("ra-history")||"[]");h.unshift({type,detail,at:new Date().toISOString()});localStorage.setItem("ra-history",JSON.stringify(h.slice(0,50)));renderHistory()}
function renderHistory(){const h=JSON.parse(localStorage.getItem("ra-history")||"[]");$("historyList").innerHTML=h.length?h.map(x=>`<div class="history-item"><b>${x.type}</b><div>${x.detail}</div><small>${new Date(x.at).toLocaleString()}</small></div>`).join(""):"<p>Aucun historique.</p>"}
function showView(id){document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===id));document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.view===id))}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showView(b.dataset.view));
window.remoteAssist.systemInfo().then(i=>{deviceName=i.hostname;$("deviceInfo").textContent=`${i.hostname} • ${i.displays} écran(s) • ${i.memoryGb} Go RAM`});
renderHistory();

$("remoteCode").oninput=e=>e.target.value=fmt(e.target.value);
$("createCode").onclick=()=>host.emit("host-create",{deviceName,permissions});
host.on("host-created",d=>{code=d.code;$("hostCode").textContent=fmt(code);status("Code prêt");saveHistory("Code créé",fmt(code))});
host.on("session-expired",()=>{code=null;$("hostCode").textContent="Code expiré";status("Code expiré","bad")});

$("chooseScreen").onclick=async()=>{const list=await window.remoteAssist.listSources();$("sourceGrid").innerHTML="";$("picker").classList.remove("hidden");
for(const s of list){const b=document.createElement("button");b.className="source";b.innerHTML=`<img src="${s.thumbnail}"><b>${s.name}</b>`;b.onclick=async()=>{
const p=Perf.profiles[$("profile").value];if(stream)stream.getTracks().forEach(t=>t.stop());
stream=await navigator.mediaDevices.getUserMedia({audio:permissions.audio,video:{mandatory:{chromeMediaSource:"desktop",chromeMediaSourceId:s.id,maxWidth:p.width,maxHeight:p.height,maxFrameRate:p.fps}}});
$("localVideo").srcObject=stream;$("selectedSource").textContent=s.name;$("picker").classList.add("hidden");status("Écran prêt");};$("sourceGrid").appendChild(b)}};
$("closePicker").onclick=()=>$("picker").classList.add("hidden");

host.on("incoming-request",d=>{pending=d.viewerSocketId;$("requester").textContent=`${d.deviceName||"Un ordinateur"} veut se connecter.`;$("incoming").classList.remove("hidden");status("Demande reçue")});
$("deny").onclick=()=>{$("incoming").classList.add("hidden");host.emit("host-decision",{viewerSocketId:pending,approved:false})};
$("accept").onclick=()=>{if(!stream)return status("Choisissez un écran","bad");permissions={control:$("acceptControl").checked,clipboard:$("acceptClipboard").checked,files:$("acceptFiles").checked,audio:$("acceptAudio").checked};
$("incoming").classList.add("hidden");host.emit("host-decision",{viewerSocketId:pending,approved:true,permissions});window.remoteAssist.setControlEnabled(permissions.control);saveHistory("Connexion acceptée","Autorisations visibles accordées")};

function peer(socket,c,isHost){const p=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
p.onicecandidate=e=>e.candidate&&socket.emit("signal",{code:c,data:{type:"candidate",candidate:e.candidate}});
p.onconnectionstatechange=()=>{status(p.connectionState);if(p.connectionState==="connected"){showView("session");startStats(p);saveHistory("Connexion établie",c)}};
if(!isHost)p.ontrack=e=>{$("remoteVideo").srcObject=e.streams[0]};return p}
host.on("viewer-ready",async()=>{hostPeer=peer(host,code,true);stream.getTracks().forEach(t=>hostPeer.addTrack(t,stream));await Perf.apply(hostPeer,Perf.profiles[$("profile").value]);const o=await hostPeer.createOffer();await hostPeer.setLocalDescription(o);host.emit("signal",{code,data:{type:"offer",sdp:hostPeer.localDescription}})});
host.on("signal",async({data})=>{if(!hostPeer)return;if(data.type==="answer")await hostPeer.setRemoteDescription(data.sdp);if(data.type==="candidate")try{await hostPeer.addIceCandidate(data.candidate)}catch{}});
host.on("remote-input",p=>window.remoteAssist.sendRemoteInput(p));host.on("viewer-left",()=>status("Le correspondant est parti","bad"));

$("connect").onclick=()=>{viewerCode=$("remoteCode").value.replace(/\D/g,"");if(viewerCode.length!==9)return $("connectMessage").textContent="Code invalide.";
viewer=io();viewer.emit("viewer-request",{code:viewerCode,deviceName});$("connectMessage").textContent="Demande envoyée…";
viewer.on("viewer-denied",d=>$("connectMessage").textContent=d.reason);
viewer.on("viewer-approved",d=>{permissions=d.permissions;viewerPeer=peer(viewer,d.code,false);$("connectMessage").textContent="Accepté.";saveHistory("Demande acceptée",fmt(viewerCode))});
viewer.on("signal",async({data})=>{if(!viewerPeer)return;if(data.type==="offer"){await viewerPeer.setRemoteDescription(data.sdp);const a=await viewerPeer.createAnswer();await viewerPeer.setLocalDescription(a);viewer.emit("signal",{code:viewerCode,data:{type:"answer",sdp:viewerPeer.localDescription}})}if(data.type==="candidate")try{await viewerPeer.addIceCandidate(data.candidate)}catch{}});
viewer.on("permissions-state",p=>permissions=p);viewer.on("session-ended",stopAll);
bindRelay(viewer)};

function bindRelay(socket){socket.on("chat-message",m=>addMessage(m.text,false));socket.on("clipboard-share",async d=>{if(permissions.clipboard){await window.remoteAssist.clipboardWrite(d.text);addMessage("Presse-papiers reçu.",false)}});
socket.on("file-offer",f=>{pendingFile=f;$("fileOfferText").textContent=`${f.name} • ${(f.size/1048576).toFixed(1)} Mo`;$("fileOffer").classList.remove("hidden")});
socket.on("file-decision",d=>{if(outgoingFile&&d.id===outgoingFile.id){if(!d.accepted){$("fileStatus").textContent="Fichier refusé.";return}const r=new FileReader();r.onload=()=>socket.emit("file-data",{id:d.id,name:outgoingFile.file.name,size:outgoingFile.file.size,data:Array.from(new Uint8Array(r.result))});r.readAsArrayBuffer(outgoingFile.file);$("fileStatus").textContent="Envoi…"}});
socket.on("file-data",async d=>{const result=await window.remoteAssist.saveReceivedFile({name:d.name,data:d.data});$("fileStatus").textContent=result.ok?`Enregistré : ${result.path}`:"Enregistrement annulé.";saveHistory("Fichier reçu",d.name)})}
bindRelay(host);

function activeSocket(){return viewer||host}
function addMessage(text,me){const d=document.createElement("div");d.className=`bubble ${me?"me":""}`;d.textContent=text;$("messages").appendChild(d);$("messages").scrollTop=$("messages").scrollHeight}
$("sendChat").onclick=()=>{const t=$("chatInput").value.trim();if(!t)return;activeSocket().emit("chat-message",{text:t});addMessage(t,true);$("chatInput").value=""};
$("readClipboard").onclick=async()=>$("clipboardText").value=await window.remoteAssist.clipboardRead();
$("shareClipboard").onclick=()=>{if(!permissions.clipboard)return alert("Le presse-papiers n’est pas autorisé.");activeSocket().emit("clipboard-share",{text:$("clipboardText").value});addMessage("Presse-papiers partagé.",true)};
$("sendFile").onclick=()=>{const file=$("fileInput").files[0];if(!file)return;if(file.size>25*1024*1024)return $("fileStatus").textContent="Maximum 25 Mo.";if(!permissions.files)return $("fileStatus").textContent="Transfert non autorisé.";
outgoingFile={id:crypto.randomUUID(),file};activeSocket().emit("file-offer",{id:outgoingFile.id,name:file.name,type:file.type,size:file.size});$("fileStatus").textContent="En attente de l’accord…"};
$("acceptFile").onclick=()=>{$("fileOffer").classList.add("hidden");activeSocket().emit("file-decision",{id:pendingFile.id,accepted:true})};
$("declineFile").onclick=()=>{$("fileOffer").classList.add("hidden");activeSocket().emit("file-decision",{id:pendingFile.id,accepted:false})};

$("applyPermissions").onclick=()=>{permissions={control:$("permControl").checked,clipboard:$("permClipboard").checked,files:$("permFiles").checked,audio:$("permAudio").checked};
window.remoteAssist.setControlEnabled(permissions.control);if(code)host.emit("set-permissions",{code,permissions});saveHistory("Autorisations modifiées",JSON.stringify(permissions))};
$("profile").onchange=()=>hostPeer&&Perf.apply(hostPeer,Perf.profiles[$("profile").value]);
function startStats(p){if(timer)clearInterval(timer);timer=Perf.monitor(p,s=>{$("sent").textContent=Math.round(s.sent);$("recv").textContent=Math.round(s.recv);$("ping").textContent=`${s.rtt} ms`;$("rate").textContent=`${s.mbps.toFixed(1)} Mb/s`;$("loss").textContent=`${s.loss.toFixed(1)} %`;$("codec").textContent=s.codec;$("resolution").textContent=s.resolution;if($("profile").value==="auto"&&hostPeer)Perf.apply(hostPeer,Perf.adaptive(s))})}

function pos(e){const v=$("remoteVideo"),r=v.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
let queued=null,raf=false;$("remoteVideo").onmousemove=e=>{queued=e;if(!raf){raf=true;requestAnimationFrame(()=>{raf=false;if(viewer&&permissions.control)viewer.emit("remote-input",{code:viewerCode,payload:{type:"mousemove",...pos(queued)}})})}};
["mousedown","mouseup"].forEach(type=>$("remoteVideo").addEventListener(type,e=>viewer&&permissions.control&&viewer.emit("remote-input",{code:viewerCode,payload:{type,button:e.button,...pos(e)}})));
$("remoteVideo").onwheel=e=>{if(viewer&&permissions.control){e.preventDefault();viewer.emit("remote-input",{code:viewerCode,payload:{type:"wheel",deltaY:e.deltaY}})}};
$("remoteVideo").onkeydown=e=>{if(viewer&&permissions.control){e.preventDefault();viewer.emit("remote-input",{code:viewerCode,payload:{type:"keydown",key:e.key}})}};
$("fullscreen").onclick=()=>$("remoteVideo").requestFullscreen();
function stopAll(){if(timer)clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());hostPeer?.close();viewerPeer?.close();viewer?.disconnect();stream=hostPeer=viewerPeer=viewer=null;$("remoteVideo").srcObject=$("localVideo").srcObject=null;status("Prêt");showView("home")}
$("stop").onclick=stopAll;$("clearHistory").onclick=()=>{localStorage.removeItem("ra-history");renderHistory()};
