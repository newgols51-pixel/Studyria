// arena.js — Studyria Practice Arena Competitive Extension
// ADDITIVE ONLY — extends BrainLab without modifying existing functionality
(function(){
'use strict';

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
var API='https://solas-e60b5349.base44.app/functions/arenaApi';
var POLL_MS=2000, PING_MS=8000, INV_MS=3000;

var MODES=[
  {id:'1v1',label:'1 v 1',icon:'⚔️',desc:'Head-to-head duel',players:2,type:'duel',teamA:1,teamB:1},
  {id:'3p',label:'3 Players',icon:'🏆',desc:'Free-for-all battle',players:3,type:'ffa'},
  {id:'4p',label:'4 Players',icon:'🏆',desc:'Free-for-all battle',players:4,type:'ffa'},
  {id:'5p',label:'5 Players',icon:'🏆',desc:'Free-for-all battle',players:5,type:'ffa'},
  {id:'2v2',label:'2 v 2',icon:'🛡️',desc:'Team battle',players:4,type:'team',teamA:2,teamB:2},
  {id:'3v3',label:'3 v 3',icon:'🛡️',desc:'Team battle',players:6,type:'team',teamA:3,teamB:3},
  {id:'4v4',label:'4 v 4',icon:'🛡️',desc:'Team battle',players:8,type:'team',teamA:4,teamB:4}
];
var QCOUNTS=[10,20,25,30,40,50,75,100,150,200,250,300,400,500];
var EXAMS=['All','APSC','ADRE','Assam Police','Assam TET','Grade III','Grade IV','General','SSC','Railway','Banking'];
var DIFFS=[{id:'mixed',l:'Mixed',icon:'🎲'},{id:'easy',l:'Easy',icon:'🟢'},{id:'medium',l:'Medium',icon:'🟡'},{id:'hard',l:'Hard',icon:'🔴'}];

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
var S={
  user:null,
  cfg:{mode:'1v1',qCount:10,exam:'All',cat:'All',diff:'mixed'},
  matchId:null,
  match:null,
  timers:{presence:null,poll:null,inviteCheck:null,battle:null,search:null},
  battle:{qIdx:0,questions:[],answers:[],startTime:null,qStart:null,correct:0,wrong:0,skipped:0,totalTime:0,topicStats:{}},
  screen:null,
  searchResults:[],
  pendingInvite:null,
  seed:null,
  lobbyReady:false
};

// ══════════════════════════════════════════════
// API
// ══════════════════════════════════════════════
async function api(action,data){
  data=data||{};
  try{
    var res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action},data))});
    return await res.json();
  }catch(e){console.error('Arena API:',e);return{ok:false,error:e.message};}
}

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
function getUser(){
  if(window.currentUser&&window.currentUser.id)return{id:String(window.currentUser.id),name:window.currentUser.name||'Player'};
  if(window.currentUser&&window.currentUser.email)return{id:window.currentUser.email,name:window.currentUser.name||window.currentUser.email.split('@')[0]};
  return null;
}
function getCategories(){
  if(!window.BrainLab)return['All'];
  var cats=window.BrainLab.getCategories?window.BrainLab.getCategories():['All'];
  return ['All'].concat(cats.filter(function(c){return c!=='All';}));
}
function countQuestions(opts){
  if(!window.BrainLab||!window.BrainLab.filterQuestions)return 0;
  var pool=window.BrainLab.filterQuestions({
    category:opts.cat&&opts.cat!=='All'?opts.cat:undefined,
    exam:opts.exam&&opts.exam!=='All'?opts.exam:undefined,
    difficulty:opts.diff&&opts.diff!=='mixed'?opts.diff:undefined
  });
  return pool?pool.length:0;
}
function genSeed(){return Date.now()+Math.floor(Math.random()*1000000);}
function getMatchQuestions(match){
  if(!window.BrainLab||!window.BrainLab.filterQuestions)return[];
  var seedStr=match.questionIds||'';
  var seed=parseInt(String(seedStr).replace('seed:',''))||Date.now();
  var pool=BrainLab.filterQuestions({category:match.category!=='All'?match.category:undefined,exam:match.exam!=='All'?match.exam:undefined,difficulty:match.difficulty!=='mixed'?match.difficulty:undefined});
  var shuffled=BrainLab._seededShuffle?BrainLab._seededShuffle(pool,seed):pool.slice();
  var count=Math.min(match.questionCount||10,shuffled.length);
  return BrainLab.toQuiz(shuffled.slice(0,count));
}
function fmtTime(s){var m=Math.floor(s/60),sec=Math.floor(s%60);return m+':'+(sec<10?'0':'')+sec;}
function escapeHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function modeLabel(id){var m=MODES.find(function(x){return x.id===id;});return m?m.label:id;}
function modeIcon(id){var m=MODES.find(function(x){return x.id===id;});return m?m.icon:'⚔️';}
function getTeamForSlot(modeId,slot){
  var m=MODES.find(function(x){return x.id===modeId;});if(!m)return'A';
  if(m.type==='ffa')return String.fromCharCode(65+slot);
  if(m.type==='duel')return slot===0?'A':'B';
  var half=m.players/2;return slot<half?'A':'B';
}

// ══════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════
var CSS=`
.arena-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(20,12,15,0.97);z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:inherit}
.arena-wrap{max-width:560px;margin:0 auto;padding:16px 14px 40px;min-height:100%;box-sizing:border-box;color:#f5e9e0}
.arena-close{position:fixed;top:12px;right:14px;z-index:100000;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#f5e9e0;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}
.arena-close:active{background:rgba(255,255,255,0.2)}
.arena-title{text-align:center;font-size:22px;font-weight:700;margin:8px 0 4px;color:#e8c87a}
.arena-sub{text-align:center;font-size:13px;color:rgba(245,233,224,0.6);margin-bottom:16px}
.arena-stats-bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.arena-stat{flex:1;min-width:70px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 6px;text-align:center}
.arena-stat-val{font-size:18px;font-weight:700;color:#e8c87a}
.arena-stat-lbl{font-size:10px;color:rgba(245,233,224,0.5);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
.arena-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.arena-mode-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:16px 12px;text-align:center;cursor:pointer;transition:all 0.2s}
.arena-mode-card:active{transform:scale(0.96);background:rgba(232,200,122,0.15)}
.arena-mode-icon{font-size:28px;margin-bottom:6px}
.arena-mode-label{font-size:15px;font-weight:600;color:#f5e9e0}
.arena-mode-desc{font-size:11px;color:rgba(245,233,224,0.5);margin-top:2px}
.arena-section-btn{display:flex;align-items:center;justify-content:space-between;width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px 16px;color:#f5e9e0;font-size:14px;cursor:pointer;margin-bottom:8px}
.arena-section-btn:active{background:rgba(255,255,255,0.1)}
.arena-section-btn .arrow{color:rgba(245,233,224,0.4)}
.arena-field{margin-bottom:14px}
.arena-field-lbl{font-size:12px;font-weight:600;color:rgba(245,233,224,0.6);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.arena-select-grid{display:flex;flex-wrap:wrap;gap:6px}
.arena-chip{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 12px;font-size:13px;color:rgba(245,233,224,0.8);cursor:pointer;transition:all 0.15s;white-space:nowrap}
.arena-chip.active{background:rgba(232,200,122,0.2);border-color:#e8c87a;color:#e8c87a}
.arena-chip:active{transform:scale(0.95)}
.arena-qcount-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.arena-qcount{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 4px;text-align:center;font-size:13px;color:rgba(245,233,224,0.8);cursor:pointer}
.arena-qcount.active{background:rgba(232,200,122,0.2);border-color:#e8c87a;color:#e8c87a;font-weight:600}
.arena-qcount:active{transform:scale(0.95)}
.arena-custom-count{display:flex;align-items:center;gap:8px;margin-top:4px}
.arena-custom-count input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f5e9e0;font-size:14px;outline:none}
.arena-pool-info{text-align:center;font-size:12px;color:rgba(245,233,224,0.5);margin-top:4px}
.arena-btn{display:block;width:100%;background:linear-gradient(135deg,#8b1538,#a01e44);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;cursor:pointer;transition:all 0.2s}
.arena-btn:active{transform:scale(0.98);opacity:0.9}
.arena-btn:disabled{opacity:0.4;cursor:not-allowed}
.arena-btn.secondary{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15)}
.arena-btn.gold{background:linear-gradient(135deg,#c89b3c,#e8c87a);color:#1a1a1a}
.arena-btn.danger{background:linear-gradient(135deg,#8b1538,#c0392b)}
.arena-searching{text-align:center;padding:30px 20px}
.arena-spinner{width:40px;height:40px;border:3px solid rgba(232,200,122,0.2);border-top-color:#e8c87a;border-radius:50%;animation:arena-spin 0.8s linear infinite;margin:0 auto 16px}
@keyframes arena-spin{to{transform:rotate(360deg)}}
.arena-search-config{background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 14px;margin:16px 0;font-size:13px;color:rgba(245,233,224,0.7)}
.arena-search-config span{display:inline-block;margin-right:12px}
.arena-player-list{margin-top:12px}
.arena-player-card{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px;margin-bottom:8px}
.arena-player-info{display:flex;align-items:center;gap:10px}
.arena-player-avatar{width:36px;height:36px;border-radius:50%;background:rgba(232,200,122,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;color:#e8c87a;flex-shrink:0}
.arena-player-name{font-size:14px;font-weight:600;color:#f5e9e0}
.arena-player-meta{font-size:11px;color:rgba(245,233,224,0.5)}
.arena-rating-badge{font-size:11px;background:rgba(232,200,122,0.15);color:#e8c87a;padding:2px 8px;border-radius:6px}
.arena-invite-btn{background:rgba(232,200,122,0.15);border:1px solid rgba(232,200,122,0.3);color:#e8c87a;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
.arena-invite-btn:active{transform:scale(0.95)}
.arena-invite-btn:disabled{opacity:0.4}
.arena-empty{text-align:center;padding:40px 20px;color:rgba(245,233,224,0.4);font-size:14px}
.arena-lobby{padding:8px 0}
.arena-lobby-config{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:rgba(245,233,224,0.7)}
.arena-lobby-config div{margin-bottom:4px}
.arena-team-block{margin-bottom:14px}
.arena-team-label{font-size:13px;font-weight:600;color:#e8c87a;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px}
.arena-team-player{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;margin-bottom:4px}
.arena-ready-badge{font-size:10px;padding:2px 8px;border-radius:6px;margin-left:auto}
.arena-ready-badge.ready{background:rgba(76,175,80,0.2);color:#66bb6a}
.arena-ready-badge.waiting{background:rgba(255,193,7,0.15);color:#ffc107}
.arena-ready-badge.empty{background:rgba(255,255,255,0.06);color:rgba(245,233,224,0.3)}
.arena-vs{font-size:11px;text-align:center;color:rgba(245,233,224,0.3);margin:8px 0;font-weight:700;letter-spacing:2px}
.arena-countdown{text-align:center;padding:60px 20px}
.arena-countdown-num{font-size:72px;font-weight:700;color:#e8c87a;animation:arena-pop 1s ease-out}
@keyframes arena-pop{0%{transform:scale(0.5);opacity:0}50%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:1}}
.arena-battle{padding:0}
.arena-battle-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:12px}
.arena-battle-progress{height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;margin-bottom:12px}
.arena-battle-progress-bar{height:100%;background:linear-gradient(90deg,#8b1538,#e8c87a);transition:width 0.3s;border-radius:3px}
.arena-battle-q{background:rgba(255,255,255,0.06);border-radius:14px;padding:16px;margin-bottom:12px}
.arena-battle-q-text{font-size:16px;font-weight:500;color:#f5e9e0;margin-bottom:14px;line-height:1.5}
.arena-battle-opt{display:block;width:100%;text-align:left;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;margin-bottom:8px;color:#f5e9e0;font-size:14px;cursor:pointer;transition:all 0.15s}
.arena-battle-opt:active{transform:scale(0.98)}
.arena-battle-opt.selected{border-color:#e8c87a;background:rgba(232,200,122,0.1)}
.arena-battle-opt.correct{border-color:#4caf50;background:rgba(76,175,80,0.1)}
.arena-battle-opt.wrong{border-color:#f44336;background:rgba(244,67,54,0.1)}
.arena-battle-opt.disabled{pointer-events:none;opacity:0.5}
.arena-battle-feedback{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;display:none}
.arena-battle-feedback.show{display:block}
.arena-battle-feedback.correct{border-left:3px solid #4caf50}
.arena-battle-feedback.wrong{border-left:3px solid #f44336}
.arena-battle-actions{display:flex;gap:8px;margin-bottom:12px}
.arena-battle-actions button{flex:1}
.arena-live-status{display:flex;justify-content:space-between;gap:8px;margin-bottom:12px}
.arena-live-card{flex:1;background:rgba(255,255,255,0.04);border-radius:10px;padding:8px 10px;text-align:center}
.arena-live-label{font-size:10px;color:rgba(245,233,224,0.4);text-transform:uppercase}
.arena-live-val{font-size:16px;font-weight:600;color:#f5e9e0;margin-top:2px}
.arena-result-hero{text-align:center;padding:30px 20px}
.arena-result-trophy{font-size:56px;margin-bottom:8px}
.arena-result-title{font-size:24px;font-weight:700;color:#e8c87a;margin-bottom:4px}
.arena-result-sub{font-size:14px;color:rgba(245,233,224,0.6)}
.arena-result-scores{display:flex;gap:8px;margin:16px 0}
.arena-result-score{flex:1;background:rgba(255,255,255,0.06);border-radius:12px;padding:14px;text-align:center}
.arena-result-score.winner{border:1.5px solid #e8c87a;background:rgba(232,200,122,0.08)}
.arena-result-score-name{font-size:13px;color:rgba(245,233,224,0.7);margin-bottom:4px}
.arena-result-score-val{font-size:28px;font-weight:700;color:#f5e9e0}
.arena-result-score-lbl{font-size:10px;color:rgba(245,233,224,0.4)}
.arena-result-section{background:rgba(255,255,255,0.04);border-radius:12px;padding:14px;margin-bottom:12px}
.arena-result-section-title{font-size:13px;font-weight:600;color:#e8c87a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px}
.arena-result-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:rgba(245,233,224,0.7)}
.arena-result-row span:last-child{color:#f5e9e0;font-weight:500}
.arena-topic-row{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-topic-row:last-child{border:none}
.arena-topic-name{font-size:13px;color:rgba(245,233,224,0.8);margin-bottom:2px}
.arena-topic-bar{height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin:4px 0}
.arena-topic-bar-fill{height:100%;background:#e8c87a;border-radius:2px}
.arena-topic-meta{font-size:11px;color:rgba(245,233,224,0.4)}
.arena-qreview{padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-qreview-q{font-size:13px;color:rgba(245,233,224,0.8);margin-bottom:4px}
.arena-qreview-a{font-size:12px;color:rgba(245,233,224,0.5);padding-left:12px}
.arena-qreview-a.correct{color:#66bb6a}
.arena-qreview-a.wrong{color:#f44336}
.arena-actions-row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.arena-actions-row button{flex:1;min-width:120px}
.arena-history-item{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer}
.arena-history-item:active{background:rgba(255,255,255,0.08)}
.arena-history-row{display:flex;justify-content:space-between;align-items:center}
.arena-history-left{flex:1}
.arena-history-mode{font-size:13px;font-weight:600;color:#f5e9e0}
.arena-history-meta{font-size:11px;color:rgba(245,233,224,0.4);margin-top:2px}
.arena-history-result{font-size:13px;font-weight:600;padding:2px 10px;border-radius:6px}
.arena-history-result.win{background:rgba(76,175,80,0.15);color:#66bb6a}
.arena-history-result.loss{background:rgba(244,67,54,0.15);color:#f44336}
.arena-history-result.draw{background:rgba(255,193,7,0.15);color:#ffc107}
.arena-lb-row{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;margin-bottom:4px;background:rgba(255,255,255,0.04)}
.arena-lb-rank{width:28px;text-align:center;font-size:16px;font-weight:700;color:#e8c87a}
.arena-lb-name{flex:1;font-size:14px;color:#f5e9e0}
.arena-lb-meta{font-size:11px;color:rgba(245,233,224,0.4)}
.arena-lb-rating{font-size:14px;font-weight:600;color:#e8c87a}
.arena-invite-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f1419;border:1px solid rgba(232,200,122,0.3);border-radius:16px;padding:20px;max-width:340px;width:90%;z-index:100001;box-shadow:0 8px 32px rgba(0,0,0,0.5)}
.arena-invite-title{text-align:center;font-size:18px;font-weight:700;color:#e8c87a;margin-bottom:12px}
.arena-invite-sender{text-align:center;font-size:14px;color:#f5e9e0;margin-bottom:12px}
.arena-invite-config{background:rgba(255,255,255,0.04);border-radius:10px;padding:10px;margin-bottom:14px;font-size:12px;color:rgba(245,233,224,0.6)}
.arena-invite-config div{margin-bottom:3px}
.arena-invite-buttons{display:flex;gap:10px}
.arena-invite-buttons button{flex:1}
.arena-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(31,20,25,0.95);border:1px solid rgba(232,200,122,0.3);color:#f5e9e0;padding:10px 20px;border-radius:10px;font-size:14px;z-index:100002;animation:arena-fadein 0.3s}
@keyframes arena-fadein{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.arena-login-prompt{text-align:center;padding:40px 20px}
.arena-login-icon{font-size:48px;margin-bottom:12px}
.arena-login-text{font-size:15px;color:rgba(245,233,224,0.6);margin-bottom:20px}
@media(max-width:380px){.arena-mode-grid{grid-template-columns:1fr}.arena-qcount-grid{grid-template-columns:repeat(3,1fr)}}
`;

// Inject CSS
var styleEl=document.createElement('style');
styleEl.textContent=CSS;
document.head.appendChild(styleEl);

// ══════════════════════════════════════════════
// OVERLAY MANAGEMENT
// ══════════════════════════════════════════════
function showOverlay(html){
  var old=document.getElementById('arena-overlay');
  if(old)old.remove();
  var div=document.createElement('div');
  div.id='arena-overlay';
  div.className='arena-overlay';
  div.innerHTML='<button class="arena-close" onclick="Arena.close()">✕</button><div class="arena-wrap">'+html+'</div>';
  document.body.appendChild(div);
  div.scrollTop=0;
}
function closeOverlay(){
  var o=document.getElementById('arena-overlay');
  if(o)o.remove();
  stopAllTimers();
  // Reset presence to online
  if(S.user)api('ping',{userId:S.user.id,userName:S.user.name,exam:S.cfg.exam||'All',arenaRating:0,wins:0,losses:0,draws:0,battles:0,status:'online'});
}
function toast(msg){
  var old=document.querySelector('.arena-toast');if(old)old.remove();
  var t=document.createElement('div');t.className='arena-toast';t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.remove()},3000);
}

// ══════════════════════════════════════════════
// SCREEN: HOME
// ══════════════════════════════════════════════
async function showHome(){
  S.user=getUser();
  if(!S.user){
    showOverlay('<div class="arena-login-prompt"><div class="arena-login-icon">🔐</div><div class="arena-login-text">Please log in to use the Practice Arena.</div><button class="arena-btn" onclick="Arena.close()">OK</button></div>');
    return;
  }
  // Get presence/stats
  var pres=await api('getPresence',{userId:S.user.id});
  var p=pres.ok?pres.presence:null;
  var rating=p?p.arenaRating:1000;
  var wins=p?p.wins:0,losses=p?p.losses:0,draws=p?p.draws:0;
  var battles=p?p.battles:0,winRate=p?p.winRate:0;
  
  var h='<div class="arena-title">⚔️ Practice Arena</div>';
  h+='<div class="arena-sub">Compete with real players in real-time</div>';
  
  // Stats bar
  h+='<div class="arena-stats-bar">';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+rating+'</div><div class="arena-stat-lbl">Rating</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+battles+'</div><div class="arena-stat-lbl">Battles</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+winRate+'%</div><div class="arena-stat-lbl">Win Rate</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+wins+'-'+losses+'</div><div class="arena-stat-lbl">W-L</div></div>';
  h+='</div>';
  
  // Mode selection
  h+='<div class="arena-field-lbl" style="margin-bottom:8px">Select Mode</div>';
  h+='<div class="arena-mode-grid">';
  MODES.forEach(function(m){
    h+='<div class="arena-mode-card" onclick="Arena.selectMode(\''+m.id+'\')">';
    h+='<div class="arena-mode-icon">'+m.icon+'</div>';
    h+='<div class="arena-mode-label">'+m.label+'</div>';
    h+='<div class="arena-mode-desc">'+m.desc+'</div>';
    h+='</div>';
  });
  h+='</div>';
  
  // History & Leaderboard
  h+='<button class="arena-section-btn" onclick="Arena.showHistory()">📜 Battle History <span class="arrow">›</span></button>';
  h+='<button class="arena-section-btn" onclick="Arena.showLeaderboard()">🏆 Arena Leaderboard <span class="arrow">›</span></button>';
  
  showOverlay(h);
  S.screen='home';
  
  // Start presence and invite check
  startPresence();
  startInviteCheck();
}

// ══════════════════════════════════════════════
// SCREEN: CONFIG
// ══════════════════════════════════════════════
function showConfig(modeId){
  var m=MODES.find(function(x){return x.id===modeId;});
  if(!m)return;
  S.cfg.mode=modeId;
  var cats=getCategories();
  var poolCount=countQuestions({cat:S.cfg.cat,exam:S.cfg.exam,diff:S.cfg.diff});
  var maxQ=Math.min(500,poolCount);
  
  var h='<div class="arena-title">'+m.icon+' '+m.label+'</div>';
  h+='<div class="arena-sub">'+m.desc+' · '+(m.players-1)+' opponent(s) needed</div>';
  
  // Exam
  h+='<div class="arena-field"><div class="arena-field-lbl">Exam</div><div class="arena-select-grid">';
  EXAMS.forEach(function(e){
    h+='<div class="arena-chip'+(S.cfg.exam===e?' active':'')+'" onclick="Arena.setCfg(\'exam\',\''+e+'\')">'+e+'</div>';
  });
  h+='</div></div>';
  
  // Category
  h+='<div class="arena-field"><div class="arena-field-lbl">Category</div><div class="arena-select-grid">';
  cats.forEach(function(c){
    h+='<div class="arena-chip'+(S.cfg.cat===c?' active':'')+'" onclick="Arena.setCfg(\'cat\',\''+c.replace(/'/g,'')+'\')">'+c+'</div>';
  });
  h+='</div></div>';
  
  // Difficulty
  h+='<div class="arena-field"><div class="arena-field-lbl">Difficulty</div><div class="arena-select-grid">';
  DIFFS.forEach(function(d){
    h+='<div class="arena-chip'+(S.cfg.diff===d.id?' active':'')+'" onclick="Arena.setCfg(\'diff\',\''+d.id+'\')">'+d.icon+' '+d.l+'</div>';
  });
  h+='</div></div>';
  
  // Question count
  h+='<div class="arena-field"><div class="arena-field-lbl">Questions (10–500)</div>';
  h+='<div class="arena-qcount-grid">';
  QCOUNTS.forEach(function(q){
    if(q<=maxQ)h+='<div class="arena-qcount'+(S.cfg.qCount===q?' active':'')+'" onclick="Arena.setCfg(\'qCount\','+q+')">'+q+'</div>';
  });
  h+='</div>';
  // Custom count
  h+='<div class="arena-custom-count">';
  h+='<input type="number" min="10" max="500" value="'+S.cfg.qCount+'" id="arena-custom-q" onchange="Arena.setCustomQ(this.value)" placeholder="Custom (10–500)"/>';
  h+='</div>';
  h+='<div class="arena-pool-info">'+poolCount+' questions available in pool</div>';
  h+='</div>';
  
  // Summary
  h+='<div class="arena-search-config"><span>📋 Mode: '+m.label+'</span><span>📝 Questions: '+S.cfg.qCount+'</span><span>📚 Exam: '+S.cfg.exam+'</span><span>📁 Cat: '+S.cfg.cat+'</span><span>📊 Diff: '+S.cfg.diff+'</span></div>';
  
  h+='<button class="arena-btn gold" onclick="Arena.startSearch()">🔍 Find Online Players</button>';
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.showHome()">← Back</button>';
  
  showOverlay(h);
  S.screen='config';
}

// ══════════════════════════════════════════════
// SCREEN: PLAYER SEARCH
// ══════════════════════════════════════════════
async function startSearch(){
  S.user=getUser();if(!S.user){toast('Please log in');return;}
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  if(!m)return;
  
  // Generate seed and create match
  S.seed=genSeed();
  var team=getTeamForSlot(S.cfg.mode,0);
  var players=[{userId:S.user.id,userName:S.user.name,team:team,status:'lobby',ready:false,score:0,correct:0,wrong:0,skipped:0,answers:[],timing:[],completedAt:''}];
  
  var res=await api('createMatch',{
    mode:S.cfg.mode,questionCount:S.cfg.qCount,exam:S.cfg.exam,category:S.cfg.cat,difficulty:S.cfg.diff,
    questionIds:'seed:'+S.seed,players:players
  });
  
  if(!res.ok){toast('Failed to create arena: '+(res.error||''));return;}
  S.matchId=res.matchId;
  
  // Update presence
  await api('ping',{userId:S.user.id,userName:S.user.name,exam:S.cfg.exam,arenaRating:0,wins:0,losses:0,draws:0,battles:0,status:'in_arena'});
  
  renderSearch();
  startPresence();
  startSearchPoll();
  startInviteCheck();
}

function renderSearch(){
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  var needed=m.players-1;
  var h='<div class="arena-title">🔍 Find Players</div>';
  h+='<div class="arena-sub">'+m.label+' · Need '+needed+' more player'+(needed>1?'s':'')+'</div>';
  
  h+='<div class="arena-searching">';
  h+='<div class="arena-spinner"></div>';
  h+='<div>Searching for online players...</div>';
  h+='</div>';
  
  h+='<div class="arena-search-config">';
  h+='<span>📋 '+m.label+'</span><span>📝 '+S.cfg.qCount+'Q</span><span>📚 '+S.cfg.exam+'</span><span>📁 '+S.cfg.cat+'</span><span>📊 '+S.cfg.diff+'</span>';
  h+='</div>';
  
  if(S.searchResults.length===0){
    h+='<div class="arena-empty">No online players found yet.<br>Keep waiting — players will appear when they come online.</div>';
  }else{
    h+='<div class="arena-player-list">';
    S.searchResults.forEach(function(p){
      h+='<div class="arena-player-card">';
      h+='<div class="arena-player-info">';
      h+='<div class="arena-player-avatar">'+(p.userName[0]||'?').toUpperCase()+'</div>';
      h+='<div><div class="arena-player-name">'+escapeHtml(p.userName)+'</div>';
      h+='<div class="arena-player-meta">'+(p.exam||'General')+' · '+p.battles+' battles · '+p.winRate+'% WR</div></div>';
      h+='</div>';
      h+='<div style="text-align:right"><div class="arena-rating-badge">⭐ '+p.arenaRating+'</div>';
      h+='<button class="arena-invite-btn" style="margin-top:6px" onclick="Arena.invitePlayer(\''+p.userId+'\',\''+escapeHtml(p.userName).replace(/'/g,'')+'\')">Invite</button></div>';
      h+='</div>';
    });
    h+='</div>';
  }
  
  h+='<button class="arena-btn secondary" style="margin-top:16px" onclick="Arena.cancelSearch()">Cancel Search</button>';
  
  showOverlay(h);
}

async function searchPoll(){
  if(!S.matchId||S.screen!=='search')return;
  var res=await api('search',{userId:S.user.id});
  if(res.ok&&res.players){
    // Filter out players already in the match
    var matchRes=await api('getMatch',{matchId:S.matchId});
    var existingIds=[];
    if(matchRes.ok&&matchRes.match){
      existingIds=matchRes.match.players.map(function(p){return p.userId;});
    }
    S.searchResults=res.players.filter(function(p){return existingIds.indexOf(p.userId)===-1;});
    renderSearch();
    
    // Check if enough players have joined
    if(matchRes.ok&&matchRes.match){
      var joined=matchRes.match.players.filter(function(p){return p.status!=='abandoned';}).length;
      var m=MODES.find(function(x){return x.id===S.cfg.mode;});
      if(joined>=m.players){
        // Enough players! Show lobby
        S.match=matchRes.match;
        showLobby();
        return;
      }
    }
  }
}

async function invitePlayer(toUserId,toUserName){
  toast('Sending invitation...');
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  var team=getTeamForSlot(S.cfg.mode,S.match?S.match.players.length:1);
  var res=await api('sendInvite',{
    fromUserId:S.user.id,fromUserName:S.user.name,
    toUserId:toUserId,toUserName:toUserName,
    matchConfig:{mode:S.cfg.mode,questionCount:S.cfg.qCount,exam:S.cfg.exam,category:S.cfg.cat,difficulty:S.cfg.diff,matchId:S.matchId,team:team}
  });
  if(res.ok){toast('Invitation sent to '+toUserName+'!');}
  else{toast('Could not invite: '+(res.error||'Unknown error'));}
}

function cancelSearch(){
  if(S.matchId){
    api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
    S.matchId=null;
  }
  stopAllTimers();
  showHome();
}

// ══════════════════════════════════════════════
// SCREEN: LOBBY
// ══════════════════════════════════════════════
async function showLobby(){
  if(!S.matchId){
    // Match ID from accepted invite
    S.matchId=S.matchId||S._pendingMatchId;
    if(!S.matchId){toast('No active match');return;}
  }
  stopTimer('search');
  S.screen='lobby';
  await pollLobby();
  startLobbyPoll();
}

async function pollLobby(){
  if(S.screen!=='lobby'||!S.matchId)return;
  var res=await api('getMatch',{matchId:S.matchId});
  if(!res.ok){toast('Match not found');closeOverlay();return;}
  S.match=res.match;
  renderLobby();
  
  // Check if match started
  if(S.match.status==='in_progress'){
    startBattle();
    return;
  }
}

function renderLobby(){
  var m=MODES.find(function(x){return x.id===S.match.mode;});
  var players=S.match.players.filter(function(p){return p.status!=='abandoned';});
  
  var h='<div class="arena-title">⚔️ Arena Lobby</div>';
  h+='<div class="arena-sub">'+m.label+' · '+S.match.questionCount+' Questions</div>';
  
  // Config
  h+='<div class="arena-lobby-config">';
  h+='<div>📋 Mode: '+m.label+'</div>';
  h+='<div>📝 Questions: '+S.match.questionCount+'</div>';
  h+='<div>📚 Exam: '+S.match.exam+'</div>';
  h+='<div>📁 Category: '+S.match.category+'</div>';
  h+='<div>📊 Difficulty: '+S.match.difficulty+'</div>';
  h+='</div>';
  
  if(m.type==='duel'){
    // 1v1
    h+=renderLobbyPlayer(players[0],'You');
    h+='<div class="arena-vs">VS</div>';
    if(players[1])h+=renderLobbyPlayer(players[1],'Opponent');
    else h+='<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting for opponent...</div></div><span class="arena-ready-badge empty">Pending</span></div>';
  }else if(m.type==='ffa'){
    // Free-for-all
    h+='<div class="arena-team-label">Players ('+players.length+'/'+m.players+')</div>';
    for(var i=0;i<m.players;i++){
      if(players[i])h+=renderLobbyPlayer(players[i],null);
      else h+='<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting...</div></div><span class="arena-ready-badge empty">Pending</span></div>';
    }
  }else{
    // Team mode
    var teamA=players.filter(function(p){return p.team==='A';});
    var teamB=players.filter(function(p){return p.team==='B';});
    var teamASize=m.teamA,teamBSize=m.teamB;
    
    h+='<div class="arena-team-block"><div class="arena-team-label">Team A ('+teamA.length+'/'+teamASize+')</div>';
    for(var i=0;i<teamASize;i++)h+=teamA[i]?renderLobbyPlayer(teamA[i],null):renderEmptySlot();
    h+='</div>';
    
    h+='<div class="arena-vs">VS</div>';
    
    h+='<div class="arena-team-block"><div class="arena-team-label">Team B ('+teamB.length+'/'+teamBSize+')</div>';
    for(var i=0;i<teamBSize;i++)h+=teamB[i]?renderLobbyPlayer(teamB[i],null):renderEmptySlot();
    h+='</div>';
  }
  
  // Ready button
  var me=players.find(function(p){return p.userId===S.user.id;});
  var allReady=players.length>=m.players&&players.every(function(p){return p.ready;});
  
  if(me&&me.ready){
    h+='<button class="arena-btn" disabled>✅ Ready — Waiting for others...</button>';
  }else if(players.length<m.players){
    h+='<button class="arena-btn secondary" disabled>Waiting for '+(m.players-players.length)+' more player'+(m.players-players.length>1?'s':'')+'...</button>';
  }else{
    h+='<button class="arena-btn gold" onclick="Arena.setReady(true)">Ready Up!</button>';
  }
  
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.leaveLobby()">Leave Lobby</button>';
  
  showOverlay(h);
}

function renderLobbyPlayer(p,label){
  if(!p)return renderEmptySlot();
  var isMe=p.userId===S.user.id;
  var readyClass=p.ready?'ready':'waiting';
  var readyText=p.ready?'✅ Ready':'⏳ Not Ready';
  return '<div class="arena-team-player"><div class="arena-player-avatar">'+(p.userName[0]||'?').toUpperCase()+'</div><div><div class="arena-player-name">'+escapeHtml(p.userName)+(isMe?' (You)':'')+'</div><div class="arena-player-meta">⭐ Rating: '+((p.arenaRating)||1000)+'</div></div><span class="arena-ready-badge '+readyClass+'">'+readyText+'</span></div>';
}

function renderEmptySlot(){
  return '<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting for player...</div></div><span class="arena-ready-badge empty">Empty</span></div>';
}

async function setReady(ready){
  var res=await api('setReady',{matchId:S.matchId,userId:S.user.id,ready:ready});
  if(res.ok&&res.matchStarted){
    // Match is starting!
    toast('Battle starting!');
    setTimeout(function(){startBattle();},1000);
  }
}

async function leaveLobby(){
  if(!confirm('Leave this arena lobby?'))return;
  await api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
  S.matchId=null;S.match=null;
  stopAllTimers();
  showHome();
}

// ══════════════════════════════════════════════
// SCREEN: BATTLE
// ══════════════════════════════════════════════
async function startBattle(){
  stopTimer('poll');
  S.screen='battle';
  
  // Get match with questions
  var res=await api('getMatch',{matchId:S.matchId});
  if(!res.ok){toast('Match not found');return;}
  S.match=res.match;
  
  // Generate questions from seed
  S.battle.questions=getMatchQuestions(S.match);
  if(!S.battle.questions.length){toast('No questions available');return;}
  S.battle.qIdx=0;
  S.battle.answers=[];
  S.battle.correct=0;
  S.battle.wrong=0;
  S.battle.skipped=0;
  S.battle.totalTime=0;
  S.battle.topicStats={};
  S.battle.startTime=Date.now();
  S.battle.qStart=Date.now();
  
  // Countdown
  showCountdown(3);
}

function showCountdown(n){
  if(n<=0){
    renderBattle();
    startBattlePoll();
    return;
  }
  showOverlay('<div class="arena-countdown"><div style="font-size:18px;color:rgba(245,233,224,0.5);margin-bottom:20px">⚔️ BATTLE START</div><div class="arena-countdown-num">'+n+'</div></div>');
  setTimeout(function(){showCountdown(n-1);},1000);
}

function renderBattle(){
  var idx=S.battle.qIdx;
  var q=S.battle.questions[idx];
  if(!q){finishBattle();return;}
  var total=S.battle.questions.length;
  var progress=((idx)/total)*100;
  
  var h='<div class="arena-battle">';
  h+='<div class="arena-battle-header"><span>Q'+(idx+1)+' / '+total+'</span><span id="arena-battle-timer">⏱ 0:00</span></div>';
  h+='<div class="arena-battle-progress"><div class="arena-battle-progress-bar" style="width:'+progress+'%"></div></div>';
  
  // Live status
  h+='<div class="arena-live-status">';
  h+='<div class="arena-live-card"><div class="arena-live-label">Correct</div><div class="arena-live-val" id="arena-live-correct">'+S.battle.correct+'</div></div>';
  h+='<div class="arena-live-card"><div class="arena-live-label">Wrong</div><div class="arena-live-val" id="arena-live-wrong">'+S.battle.wrong+'</div></div>';
  h+='<div class="arena-live-card"><div class="arena-live-label">Skipped</div><div class="arena-live-val" id="arena-live-skipped">'+S.battle.skipped+'</div></div>';
  h+='</div>';
  
  // Opponent status (if available)
  if(S.match&&S.match.players){
    S.match.players.forEach(function(p){
      if(p.userId!==S.user.id&&p.status!=='abandoned'){
        var answered=p.answers?p.answers.length:0;
        h+='<div class="arena-live-card" style="margin-bottom:8px"><div class="arena-live-label">'+escapeHtml(p.userName)+'</div><div class="arena-live-val" style="font-size:13px">'+answered+'/'+total+' answered</div></div>';
      }
    });
  }
  
  // Question
  h+='<div class="arena-battle-q">';
  h+='<div style="font-size:11px;color:rgba(232,200,122,0.6);margin-bottom:6px">'+escapeHtml(q.topic||q.category||'')+(q.difficulty?' · '+q.difficulty:'')+'</div>';
  h+='<div class="arena-battle-q-text">'+escapeHtml(q.question_text)+'</div>';
  
  // Options
  var opts=[{label:'A',text:q.option_a},{label:'B',text:q.option_b},{label:'C',text:q.option_c},{label:'D',text:q.option_d}];
  opts.forEach(function(o,i){
    h+='<button class="arena-battle-opt" id="arena-opt-'+i+'" onclick="Arena.answerQ('+i+')"><strong>'+o.label+'</strong> · '+escapeHtml(o.text)+'</button>';
  });
  
  h+='</div>';
  
  // Feedback
  h+='<div class="arena-battle-feedback" id="arena-feedback"></div>';
  
  // Actions
  h+='<div class="arena-battle-actions">';
  h+='<button class="arena-btn secondary" onclick="Arena.skipQ()">⏭ Skip</button>';
  h+='<button class="arena-btn" id="arena-next-btn" onclick="Arena.nextQ()" disabled>Next →</button>';
  h+='</div>';
  h+='<button class="arena-btn danger" style="margin-top:8px" onclick="Arena.leaveBattle()">Leave Battle</button>';
  h+='</div>';
  
  showOverlay(h);
  startBattleTimer();
}

var battleTimerInt=null;
function startBattleTimer(){
  if(battleTimerInt)clearInterval(battleTimerInt);
  battleTimerInt=setInterval(function(){
    var el=document.getElementById('arena-battle-timer');
    if(el){
      var s=Math.floor((Date.now()-S.battle.qStart)/1000);
      el.textContent='⏱ '+fmtTime(s);
    }
  },1000);
}

function answerQ(optIdx){
  var idx=S.battle.qIdx;
  var q=S.battle.questions[idx];
  if(!q)return;
  
  // Determine correct answer
  var correctIdx=q.correct_answer==='a'?0:q.correct_answer==='b'?1:q.correct_answer==='c'?2:q.correct_answer==='d'?3:-1;
  var isCorrect=optIdx===correctIdx;
  var timeSpent=Math.floor((Date.now()-S.battle.qStart)/1000);
  
  // Submit to backend
  api('submitAnswer',{matchId:S.matchId,userId:S.user.id,questionIndex:idx,answer:String.fromCharCode(97+optIdx),timeSpent:timeSpent});
  
  // Show feedback
  var opts=document.querySelectorAll('.arena-battle-opt');
  opts.forEach(function(o,i){
    o.classList.add('disabled');
    if(i===correctIdx)o.classList.add('correct');
    if(i===optIdx&&!isCorrect)o.classList.add('wrong');
    if(i===optIdx&&isCorrect)o.classList.add('selected');
  });
  
  var fb=document.getElementById('arena-feedback');
  if(fb){
    fb.className='arena-battle-feedback show '+(isCorrect?'correct':'wrong');
    fb.innerHTML=(isCorrect?'✅ Correct!':'❌ Wrong!')+'<br><span style="font-size:12px;color:rgba(245,233,224,0.6)">'+escapeHtml(q.explanation||'')+'</span>';
  }
  
  // Record answer
  S.battle.answers[idx]={selectedIdx:optIdx,isCorrect:isCorrect,timeSpent:timeSpent};
  if(isCorrect)S.battle.correct++;else S.battle.wrong++;
  
  // Topic stats
  var topic=q.topic||q.category||'Unknown';
  if(!S.battle.topicStats[topic])S.battle.topicStats[topic]={correct:0,total:0,time:0};
  S.battle.topicStats[topic].total++;
  if(isCorrect)S.battle.topicStats[topic].correct++;
  S.battle.topicStats[topic].time+=timeSpent;
  
  // Save mistake
  if(!isCorrect&&window.BrainLab){
    BrainLab.saveMistakeLocal(q,String.fromCharCode(97+optIdx));
  }
  
  // Update live status
  var cEl=document.getElementById('arena-live-correct');
  var wEl=document.getElementById('arena-live-wrong');
  if(cEl)cEl.textContent=S.battle.correct;
  if(wEl)wEl.textContent=S.battle.wrong;
  
  // Enable next button
  var nb=document.getElementById('arena-next-btn');
  if(nb)nb.disabled=false;
}

function skipQ(){
  var idx=S.battle.qIdx;
  var timeSpent=Math.floor((Date.now()-S.battle.qStart)/1000);
  S.battle.answers[idx]=null;
  S.battle.skipped++;
  var sEl=document.getElementById('arena-live-skipped');
  if(sEl)sEl.textContent=S.battle.skipped;
  
  // Topic stats
  var q=S.battle.questions[idx];
  var topic=q?(q.topic||q.category||'Unknown'):'Unknown';
  if(!S.battle.topicStats[topic])S.battle.topicStats[topic]={correct:0,total:0,time:0};
  S.battle.topicStats[topic].total++;
  S.battle.topicStats[topic].time+=timeSpent;
  
  nextQ();
}

function nextQ(){
  if(battleTimerInt)clearInterval(battleTimerInt);
  S.battle.totalTime+=Math.floor((Date.now()-S.battle.qStart)/1000);
  S.battle.qIdx++;
  S.battle.qStart=Date.now();
  if(S.battle.qIdx>=S.battle.questions.length){
    finishBattle();
  }else{
    renderBattle();
  }
}

async function finishBattle(){
  if(battleTimerInt)clearInterval(battleTimerInt);
  stopTimer('battlePoll');
  
  // Calculate final stats
  var total=S.battle.questions.length;
  var totalTime=S.battle.totalTime+Math.floor((Date.now()-S.battle.qStart)/1000);
  var score=Math.round((S.battle.correct/total)*100);
  
  // Submit final results
  var res=await api('completeMatch',{
    matchId:S.matchId,userId:S.user.id,
    correct:S.battle.correct,wrong:S.battle.wrong,skipped:S.battle.skipped,
    score:score,totalTime:totalTime,
    topicBreakdown:S.battle.topicStats,
    answers:S.battle.answers
  });
  
  if(res.ok&&res.allCompleted){
    // Both players finished — show results
    showResults(res.winner);
  }else if(res.ok){
    // Waiting for opponent
    showWaitingForOpponent();
  }else{
    toast('Error: '+(res.error||''));
    showResults({});
  }
}

function showWaitingForOpponent(){
  showOverlay('<div class="arena-countdown"><div style="font-size:18px;color:rgba(245,233,224,0.5);margin-bottom:20px">✅ Battle Complete!</div><div class="arena-spinner"></div><div style="margin-top:16px;color:rgba(245,233,224,0.6)">Waiting for opponent to finish...</div><button class="arena-btn secondary" style="margin-top:24px" onclick="Arena.forfeitWait()">Don\'t Wait</button></div>');
  S.screen='waiting';
  startWaitingPoll();
}

async function waitingPoll(){
  if(S.screen!=='waiting'||!S.matchId)return;
  var res=await api('getMatch',{matchId:S.matchId});
  if(!res.ok)return;
  S.match=res.match;
  
  if(S.match.status==='completed'){
    stopTimer('waitingPoll');
    showResults(JSON.parse(S.match.winner||'{}'));
    return;
  }
  
  // Check if opponent abandoned
  var opponents=S.match.players.filter(function(p){return p.userId!==S.user.id;});
  var allAbandoned=opponents.every(function(p){return p.status==='abandoned';});
  if(allAbandoned&&opponents.length>0){
    stopTimer('waitingPoll');
    showResults({type:'user',userId:S.user.id,userName:S.user.name});
  }
}

function forfeitWait(){
  stopTimer('waitingPoll');
  // Show results with just our data
  showResults({type:'user',userId:S.user.id,userName:S.user.name});
}

async function leaveBattle(){
  if(!confirm('Leave Arena? Your progress will be saved as abandoned.'))return;
  await api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
  if(battleTimerInt)clearInterval(battleTimerInt);
  stopAllTimers();
  S.matchId=null;S.match=null;
  showHome();
}

// ══════════════════════════════════════════════
// SCREEN: RESULTS
// ══════════════════════════════════════════════
async function showResults(winner){
  stopAllTimers();
  S.screen='results';
  
  // Get final match state
  var res=await api('getMatch',{matchId:S.matchId});
  if(res.ok)S.match=res.match;
  
  var m=MODES.find(function(x){return x.id===S.match.mode;});
  var players=S.match.players;
  var me=players.find(function(p){return p.userId===S.user.id;});
  var total=S.battle.questions.length||S.match.questionCount;
  var totalTime=S.battle.totalTime||0;
  
  var isWin=winner.type==='user'&&winner.userId===S.user.id;
  var isDraw=winner.type==='draw';
  var isTeamWin=winner.type==='team'&&me&&me.team===winner.team;
  
  var h='<div class="arena-result-hero">';
  if(isWin||isTeamWin){
    h+='<div class="arena-result-trophy">🏆</div>';
    h+='<div class="arena-result-title">YOU WIN!</div>';
    h+='<div class="arena-result-sub">Congratulations on your victory!</div>';
  }else if(isDraw){
    h+='<div class="arena-result-trophy">🤝</div>';
    h+='<div class="arena-result-title">DRAW</div>';
    h+='<div class="arena-result-sub">Evenly matched!</div>';
  }else if(winner.type==='ffa'&&winner.ranking){
    var myRank=winner.ranking.findIndex(function(p){return p.userId===S.user.id;})+1;
    h+='<div class="arena-result-trophy">'+(myRank===1?'🏆':myRank===2?'🥈':myRank===3?'🥉':'🎮')+'</div>';
    h+='<div class="arena-result-title">RANK #'+myRank+'</div>';
    h+='<div class="arena-result-sub">Out of '+winner.ranking.length+' players</div>';
  }else{
    h+='<div class="arena-result-trophy">💪</div>';
    h+='<div class="arena-result-title">YOU LOST</div>';
    h+='<div class="arena-result-sub">Better luck next time!</div>';
  }
  h+='</div>';
  
  // Scores
  if(winner.type==='ffa'&&winner.ranking){
    // FFA ranking
    h+='<div class="arena-result-section"><div class="arena-result-section-title">🏆 Final Ranking</div>';
    winner.ranking.forEach(function(p,i){
      h+='<div class="arena-result-row"><span>'+(i+1)+'. '+escapeHtml(p.userName)+(p.userId===S.user.id?' (You)':'')+'</span><span>'+p.score+'% ('+p.correct+'C)</span></div>';
    });
    h+='</div>';
  }else if(m&&m.type==='team'){
    // Team scores
    var teamA=players.filter(function(p){return p.team==='A';});
    var teamB=players.filter(function(p){return p.team==='B';});
    var scoreA=teamA.reduce(function(s,p){return s+(p.score||0);},0);
    var scoreB=teamB.reduce(function(s,p){return s+(p.score||0);},0);
    h+='<div class="arena-result-scores">';
    h+='<div class="arena-result-score'+(winner.team==='A'?' winner':'')+'"><div class="arena-result-score-name">Team A</div><div class="arena-result-score-val">'+Math.round(scoreA/(teamA.length||1))+'%</div><div class="arena-result-score-lbl">Avg Score</div></div>';
    h+='<div class="arena-result-score'+(winner.team==='B'?' winner':'')+'"><div class="arena-result-score-name">Team B</div><div class="arena-result-score-val">'+Math.round(scoreB/(teamB.length||1))+'%</div><div class="arena-result-score-lbl">Avg Score</div></div>';
    h+='</div>';
  }else{
    // 1v1
    var opp=players.find(function(p){return p.userId!==S.user.id;});
    h+='<div class="arena-result-scores">';
    h+='<div class="arena-result-score'+(isWin?' winner':'')+'"><div class="arena-result-score-name">You</div><div class="arena-result-score-val">'+(me?me.score||0:0)+'</div><div class="arena-result-score-lbl">Score</div></div>';
    if(opp)h+='<div class="arena-result-score'+(!isWin&&!isDraw?' winner':'')+'"><div class="arena-result-score-name">'+escapeHtml(opp.userName)+'</div><div class="arena-result-score-val">'+(opp.score||0)+'</div><div class="arena-result-score-lbl">Score</div></div>';
    h+='</div>';
  }
  
  // Performance analysis
  h+='<div class="arena-result-section"><div class="arena-result-section-title">📊 Your Performance</div>';
  h+='<div class="arena-result-row"><span>Questions</span><span>'+total+'</span></div>';
  h+='<div class="arena-result-row"><span>Correct</span><span>'+S.battle.correct+'</span></div>';
  h+='<div class="arena-result-row"><span>Wrong</span><span>'+S.battle.wrong+'</span></div>';
  h+='<div class="arena-result-row"><span>Skipped</span><span>'+S.battle.skipped+'</span></div>';
  h+='<div class="arena-result-row"><span>Accuracy</span><span>'+Math.round((S.battle.correct/(S.battle.correct+S.battle.wrong||1))*100)+'%</span></div>';
  h+='<div class="arena-result-row"><span>Total Time</span><span>'+fmtTime(totalTime)+'</span></div>';
  h+='<div class="arena-result-row"><span>Avg Time/Q</span><span>'+fmtTime(totalTime/(total||1))+'s</span></div>';
  
  // Timing analysis
  var times=S.battle.answers.filter(function(a){return a;}).map(function(a){return a.timeSpent;});
  if(times.length){
    var fastest=Math.min.apply(null,times);
    var slowest=Math.max.apply(null,times);
    var avgCorrect=S.battle.answers.filter(function(a){return a&&a.isCorrect;}).map(function(a){return a.timeSpent;});
    var avgWrong=S.battle.answers.filter(function(a){return a&&!a.isCorrect;}).map(function(a){return a.timeSpent;});
    h+='<div class="arena-result-row"><span>Fastest Answer</span><span>'+fastest+'s</span></div>';
    h+='<div class="arena-result-row"><span>Slowest Answer</span><span>'+slowest+'s</span></div>';
    if(avgCorrect.length)h+='<div class="arena-result-row"><span>Avg Time (Correct)</span><span>'+Math.round(avgCorrect.reduce(function(a,b){return a+b;},0)/avgCorrect.length)+'s</span></div>';
    if(avgWrong.length)h+='<div class="arena-result-row"><span>Avg Time (Wrong)</span><span>'+Math.round(avgWrong.reduce(function(a,b){return a+b;},0)/avgWrong.length)+'s</span></div>';
  }
  h+='</div>';
  
  // Topic-wise analysis
  var topics=Object.keys(S.battle.topicStats);
  if(topics.length>1){
    h+='<div class="arena-result-section"><div class="arena-result-section-title">📚 Topic Analysis</div>';
    topics.forEach(function(t){
      var s=S.battle.topicStats[t];
      var acc=Math.round((s.correct/s.total)*100);
      var avgT=Math.round(s.time/s.total);
      h+='<div class="arena-topic-row">';
      h+='<div class="arena-topic-name">'+escapeHtml(t)+'</div>';
      h+='<div class="arena-topic-bar"><div class="arena-topic-bar-fill" style="width:'+acc+'%"></div></div>';
      h+='<div class="arena-topic-meta">Correct: '+s.correct+'/'+s.total+' · Accuracy: '+acc+'% · Avg: '+avgT+'s</div>';
      h+='</div>';
    });
    h+='</div>';
  }
  
  // Head-to-head (1v1 only)
  if(m&&m.type==='duel'){
    var opp2=players.find(function(p){return p.userId!==S.user.id;});
    if(opp2){
      h+='<div class="arena-result-section"><div class="arena-result-section-title">🎯 Head-to-Head</div>';
      var myAcc=me&&me.correct+me.wrong>0?Math.round((me.correct/(me.correct+me.wrong))*100):0;
      var oppAcc=opp2.correct+opp2.wrong>0?Math.round((opp2.correct/(opp2.correct+opp2.wrong))*100):0;
      h+='<div class="arena-result-row"><span>Accuracy — You</span><span>'+myAcc+'%</span></div>';
      h+='<div class="arena-result-row"><span>Accuracy — '+escapeHtml(opp2.userName)+'</span><span>'+oppAcc+'%</span></div>';
      h+='<div class="arena-result-row"><span>Correct — You</span><span>'+(me?me.correct:0)+'</span></div>';
      h+='<div class="arena-result-row"><span>Correct — '+escapeHtml(opp2.userName)+'</span><span>'+opp2.correct+'</span></div>';
      if(me&&opp2){
        h+='<div class="arena-result-row"><span>Time — You</span><span>'+fmtTime(me.totalTime||totalTime)+'</span></div>';
        h+='<div class="arena-result-row"><span>Time — '+escapeHtml(opp2.userName)+'</span><span>'+fmtTime(opp2.totalTime||0)+'</span></div>';
      }
      
      // Why you won/lost
      if(isWin){
        h+='<div style="margin-top:10px;font-size:13px;color:#66bb6a">🏆 You won due to: '+(myAcc>oppAcc?'Higher accuracy':(me&&me.correct>opp2.correct?'More correct answers':'Better overall performance'))+'</div>';
      }else if(!isDraw){
        h+='<div style="margin-top:10px;font-size:13px;color:rgba(245,233,224,0.5)">Opponent won due to: '+(oppAcc>myAcc?'Higher accuracy':(opp2.correct>(me?me.correct:0)?'More correct answers':'Better overall performance'))+'</div>';
      }
      h+='</div>';
    }
  }
  
  // Question review
  h+='<div class="arena-result-section"><div class="arena-result-section-title">📝 Question Review</div>';
  S.battle.questions.slice(0,20).forEach(function(q,i){
    var a=S.battle.answers[i];
    var correctIdx=q.correct_answer==='a'?0:q.correct_answer==='b'?1:q.correct_answer==='c'?2:q.correct_answer==='d'?3:-1;
    var correctLabel=String.fromCharCode(65+correctIdx);
    h+='<div class="arena-qreview">';
    h+='<div class="arena-qreview-q">Q'+(i+1)+'. '+escapeHtml(q.question_text).slice(0,100)+(q.question_text.length>100?'...':'')+'</div>';
    if(a===null){
      h+='<div class="arena-qreview-a">⏭ Skipped · Correct: '+correctLabel+'</div>';
    }else if(a){
      var userLabel=String.fromCharCode(65+a.selectedIdx);
      h+='<div class="arena-qreview-a '+(a.isCorrect?'correct':'wrong')+'">'+(a.isCorrect?'✅':'❌')+' Your answer: '+userLabel+' · Correct: '+correctLabel+' · '+a.timeSpent+'s</div>';
    }
    h+='</div>';
  });
  if(S.battle.questions.length>20)h+='<div style="font-size:12px;color:rgba(245,233,224,0.4);text-align:center;padding:8px">Showing first 20 questions. '+S.battle.questions.length+' total.</div>';
  h+='</div>';
  
  // Save session for performance integration
  if(window.BrainLab){
    BrainLab.saveSession({
      id:'arena-'+S.matchId+'-'+Date.now(),
      mode:'arena',title:'Arena Battle ('+m.label+')',
      category:S.match.category,topic:'All',exam:S.match.exam,difficulty:S.match.difficulty,
      total_questions:total,correct_count:S.battle.correct,wrong_count:S.battle.wrong,skipped_count:S.battle.skipped,
      score:Math.round((S.battle.correct/total)*100),time_taken:totalTime,
      completed_at:new Date().toISOString()
    });
  }
  
  // Action buttons
  h+='<div class="arena-actions-row">';
  h+='<button class="arena-btn gold" onclick="Arena.rematch()">⚔️ Rematch</button>';
  h+='<button class="arena-btn secondary" onclick="Arena.reviewMistakes()">📚 Review Mistakes</button>';
  h+='<button class="arena-btn secondary" onclick="Arena.practiceSimilar()">📚 Practice Similar</button>';
  h+='<button class="arena-btn secondary" onclick="Arena.showHome()">← Back to Arena</button>';
  h+='</div>';
  
  showOverlay(h);
}

function rematch(){
  // Create new match with same config
  S.matchId=null;S.match=null;
  S.seed=genSeed();
  startSearch();
}

function reviewMistakes(){
  Arena.close();
  if(window.BrainLab){
    BrainLab.scrollToSection('bl-sec-mistakes');
    BrainLab.renderMistakes();
  }
}

function practiceSimilar(){
  Arena.close();
  if(window.BrainLab){
    var pool=BrainLab.filterQuestions({category:S.match.category!=='All'?S.match.category:undefined,exam:S.match.exam!=='All'?S.match.exam:undefined,difficulty:S.match.difficulty!=='mixed'?S.match.difficulty:undefined});
    var selected=BrainLab.selectQuestions(pool,Math.min(S.match.questionCount,pool.length));
    var qs=BrainLab.toQuiz(selected);
    var sessionId='sess-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
    BrainLab._sessionId=sessionId;
    BrainLab._sessionMeta={id:sessionId,mode:'practice',title:'Arena Practice ('+S.match.category+')',category:S.match.category,topic:'All',exam:S.match.exam,difficulty:S.match.difficulty,total_questions:qs.length,started_at:new Date().toISOString()};
    BrainLab._startPlayer({title:'Arena Practice',questions:qs,mode:'practice'});
  }
}

// ══════════════════════════════════════════════
// SCREEN: HISTORY
// ══════════════════════════════════════════════
async function showHistory(){
  S.user=getUser();if(!S.user){toast('Please log in');return;}
  var res=await api('getHistory',{userId:S.user.id});
  var history=res.ok?res.history:[];
  
  var h='<div class="arena-title">📜 Battle History</div>';
  h+='<div class="arena-sub">'+history.length+' battles</div>';
  
  if(!history.length){
    h+='<div class="arena-empty">No battles yet.<br>Start your first arena battle!</div>';
  }else{
    history.slice().reverse().forEach(function(b){
      var myResult=b.playerResults.find(function(p){return p.userId===S.user.id;});
      var isWin=b.winner.type==='user'&&b.winner.userId===S.user.id;
      var isDraw=b.winner.type==='draw';
      var isTeamWin=b.winner.type==='team'&&myResult&&myResult.team===b.winner.team;
      var resultClass=isWin||isTeamWin?'win':isDraw?'draw':'loss';
      var resultText=isWin||isTeamWin?'WIN':isDraw?'DRAW':'LOSS';
      
      var date=new Date(b.createdAt).toLocaleDateString([],{month:'short',day:'numeric'})+' '+new Date(b.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      var oppNames=b.playerResults.filter(function(p){return p.userId!==S.user.id;}).map(function(p){return p.userName;}).join(', ');
      
      h+='<div class="arena-history-item" onclick=\'Arena.showHistoryDetail("'+b.matchId+'")\'>';
      h+='<div class="arena-history-row">';
      h+='<div class="arena-history-left">';
      h+='<div class="arena-history-mode">'+modeIcon(b.mode)+' '+modeLabel(b.mode)+' · '+b.questionCount+'Q</div>';
      h+='<div class="arena-history-meta">'+date+' · vs '+escapeHtml(oppNames||'Unknown')+' · '+(myResult?myResult.accuracy+'%':'')+'</div>';
      h+='</div>';
      h+='<div class="arena-history-result '+resultClass+'">'+resultText+'</div>';
      h+='</div>';
      h+='</div>';
    });
  }
  
  h+='<button class="arena-btn secondary" style="margin-top:16px" onclick="Arena.showHome()">← Back</button>';
  showOverlay(h);
  S.screen='history';
}

function showHistoryDetail(matchId){
  // For now, just toast — full detail would need stored results
  toast('Battle detail: '+matchId);
}

// ══════════════════════════════════════════════
// SCREEN: LEADERBOARD
// ══════════════════════════════════════════════
async function showLeaderboard(){
  var res=await api('getLeaderboard',{});
  var lb=res.ok?res.leaderboard:[];
  
  var h='<div class="arena-title">🏆 Arena Leaderboard</div>';
  h+='<div class="arena-sub">Top players by Arena Rating</div>';
  
  if(!lb.length){
    h+='<div class="arena-empty">No rated battles yet.<br>Play some arena matches to appear here!</div>';
  }else{
    lb.forEach(function(p,i){
      var rank=i+1;
      var medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
      h+='<div class="arena-lb-row">';
      h+='<div class="arena-lb-rank">'+(medal||'#'+rank)+'</div>';
      h+='<div><div class="arena-lb-name">'+escapeHtml(p.userName)+(p.userId===S.user.id?' (You)':'')+'</div>';
      h+='<div class="arena-lb-meta">'+(p.exam||'General')+' · '+p.wins+'W-'+p.losses+'L · '+p.winRate+'% WR</div></div>';
      h+='<div class="arena-lb-rating">'+p.arenaRating+'</div>';
      h+='</div>';
    });
  }
  
  h+='<button class="arena-btn secondary" style="margin-top:16px" onclick="Arena.showHome()">← Back</button>';
  showOverlay(h);
  S.screen='leaderboard';
}

// ══════════════════════════════════════════════
// INVITATION HANDLING
// ══════════════════════════════════════════════
async function inviteCheckPoll(){
  if(!S.user)return;
  if(S.screen==='battle'||S.screen==='waiting')return; // Don't show invites during battle
  
  var res=await api('checkInvites',{userId:S.user.id});
  if(res.ok&&res.invites&&res.invites.length>0){
    // Show the first pending invite
    if(!S.pendingInvite||S.pendingInvite.id!==res.invites[0].id){
      S.pendingInvite=res.invites[0];
      showInviteModal(res.invites[0]);
    }
  }
}

function showInviteModal(inv){
  // Don't show if already showing
  if(document.getElementById('arena-invite-modal'))return;
  
  var cfg=inv.matchConfig||{};
  var m=MODES.find(function(x){return x.id===cfg.mode;});
  
  var div=document.createElement('div');
  div.id='arena-invite-modal';
  div.className='arena-invite-modal';
  div.innerHTML=`
    <div class="arena-invite-title">⚔️ Arena Invitation</div>
    <div class="arena-invite-sender"><strong>${escapeHtml(inv.fromUserName)}</strong> wants to challenge you!</div>
    <div class="arena-invite-config">
      <div>📋 Mode: ${m?m.label:cfg.mode||'1v1'}</div>
      <div>📝 Questions: ${cfg.questionCount||10}</div>
      <div>📚 Exam: ${cfg.exam||'All'}</div>
      <div>📁 Category: ${cfg.category||'All'}</div>
      <div>📊 Difficulty: ${cfg.difficulty||'mixed'}</div>
    </div>
    <div class="arena-invite-buttons">
      <button class="arena-btn gold" onclick="Arena.acceptInvite('${inv.id}')">✅ Accept</button>
      <button class="arena-btn secondary" onclick="Arena.rejectInvite('${inv.id}')">❌ Reject</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function acceptInvite(inviteId){
  // Remove modal
  var modal=document.getElementById('arena-invite-modal');
  if(modal)modal.remove();
  
  var inv=S.pendingInvite;
  S.pendingInvite=null;
  if(!inv)return;
  
  S.user=getUser();if(!S.user){toast('Please log in');return;}
  
  // Get match config from invitation
  var cfg=inv.matchConfig||{};
  var team=cfg.team||'B';
  
  // Accept the invitation — backend always creates/joins a match and returns matchId
  var res=await api('respondInvite',{inviteId:inviteId,response:'accepted'});
  if(!res.ok){toast('Could not accept: '+(res.error||'Unknown error'));return;}
  
  var matchId=res.matchId;
  if(!matchId){toast('Match could not be created. Please try again.');return;}
  
  S.matchId=matchId;
  S.cfg={mode:cfg.mode||'1v1',qCount:cfg.questionCount||10,exam:cfg.exam||'All',cat:cfg.category||'All',diff:cfg.difficulty||'mixed'};
  await api('ping',{userId:S.user.id,userName:S.user.name,exam:S.cfg.exam,arenaRating:0,wins:0,losses:0,draws:0,battles:0,status:'in_arena'});
  
  // Ensure we're actually in the match's player list (backend adds us on respondInvite, but double-check)
  var matchRes=await api('getMatch',{matchId:matchId});
  if(matchRes.ok&&matchRes.match){
    var existing=matchRes.match.players.find(function(p){return p.userId===S.user.id;});
    if(!existing){
      await api('joinMatch',{matchId:matchId,userId:S.user.id,userName:S.user.name,team:team});
    }
  }
  
  toast('Match found! Entering lobby...');
  S._pendingMatchId=matchId;
  showLobby();
  startPresence();
}

async function rejectInvite(inviteId){
  var modal=document.getElementById('arena-invite-modal');
  if(modal)modal.remove();
  S.pendingInvite=null;
  await api('respondInvite',{inviteId:inviteId,response:'rejected'});
  toast('Invitation declined.');
}

// ══════════════════════════════════════════════
// TIMERS / POLLING
// ══════════════════════════════════════════════
function doPing(){
  if(S.user){
    var stats=getArenaStats();
    api('ping',{
      userId:S.user.id,userName:S.user.name,exam:S.cfg.exam||'All',
      arenaRating:stats.rating||1000,wins:stats.wins||0,losses:stats.losses||0,
      draws:stats.draws||0,battles:stats.battles||0,
      status:S.screen==='battle'||S.screen==='lobby'||S.screen==='waiting'?'in_arena':'online'
    });
  }
}
function startPresence(){
  stopTimer('presence');
  doPing(); // Ping immediately — don't wait for the first interval tick
  S.timers.presence=setInterval(doPing,PING_MS);
}

function startInviteCheck(){
  stopTimer('inviteCheck');
  S.timers.inviteCheck=setInterval(inviteCheckPoll,INV_MS);
  inviteCheckPoll(); // Check immediately
}

function startSearchPoll(){
  stopTimer('search');
  S.timers.search=setInterval(searchPoll,POLL_MS);
  searchPoll(); // Run immediately
}

function startLobbyPoll(){
  stopTimer('poll');
  S.timers.poll=setInterval(pollLobby,POLL_MS);
}

function startBattlePoll(){
  stopTimer('poll');
  S.timers.poll=setInterval(async function(){
    if(S.screen!=='battle'||!S.matchId)return;
    var res=await api('getMatch',{matchId:S.matchId});
    if(res.ok){
      S.match=res.match;
      // Update live opponent status without re-rendering
      var oppsEl=document.querySelectorAll('.arena-live-card');
      // Just update the opponent's progress
    }
  },POLL_MS);
}

function startWaitingPoll(){
  stopTimer('poll');
  S.timers.poll=setInterval(waitingPoll,POLL_MS);
  waitingPoll();
}

function stopTimer(name){
  if(S.timers[name]){clearInterval(S.timers[name]);S.timers[name]=null;}
}

function stopAllTimers(){
  stopTimer('presence');stopTimer('poll');stopTimer('inviteCheck');stopTimer('search');
  if(battleTimerInt){clearInterval(battleTimerInt);battleTimerInt=null;}
}

function getArenaStats(){
  try{return JSON.parse(localStorage.getItem('arena_stats')||'{}');}catch(e){return{};}
}

// ══════════════════════════════════════════════
// CONFIG SETTERS
// ══════════════════════════════════════════════
function setCfg(key,val){
  S.cfg[key]=val;
  // Re-render config screen to update active states
  if(S.screen==='config')showConfig(S.cfg.mode);
}

function setCustomQ(val){
  var q=parseInt(val)||10;
  q=Math.max(10,Math.min(500,q));
  S.cfg.qCount=q;
  if(S.screen==='config')showConfig(S.cfg.mode);
}

function selectMode(modeId){
  S.cfg={mode:modeId,qCount:10,exam:'All',cat:'All',diff:'mixed'};
  showConfig(modeId);
}

// ══════════════════════════════════════════════
// BRAINLAB HOOK
// ══════════════════════════════════════════════
function init(){
  if(!window.BrainLab)return;
  if(window._arenaInitDone)return; // Prevent double-init
  window._arenaInitDone=true;
  
  // Store original renderPracticeArena
  var origRender=BrainLab.renderPracticeArena;
  
  // Override to add competitive arena section
  BrainLab.renderPracticeArena=function(){
    var c=document.getElementById('bl-arena');
    if(!c)return;
    
    // Call original to keep existing quick practice modes
    origRender.call(this);
    
    // Add competitive arena banner (idempotent — remove any old one first)
    var oldBanner=c.querySelector('.arena-comp-banner');
    if(oldBanner)oldBanner.remove();
    var banner=document.createElement('div');
    banner.className='arena-comp-banner';
    banner.style.cssText='margin-top:16px;padding:16px;background:linear-gradient(135deg,rgba(139,21,56,0.08),rgba(200,155,60,0.08));border:1px solid rgba(200,155,60,0.2);border-radius:14px;cursor:pointer';
    banner.onclick=function(){window.Arena.showHome();};
    banner.innerHTML=`
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:32px">⚔️</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:600;color:#8b1538">Practice Arena — Competitive Mode</div>
          <div style="font-size:13px;color:#666;margin-top:2px">Battle real players in 1v1, team & free-for-all modes</div>
        </div>
        <div style="font-size:20px;color:#c89b3c">›</div>
      </div>
    `;
    c.appendChild(banner);
  };
  
  // Re-render the arena section
  if(BrainLab.initialized){
    BrainLab.renderPracticeArena();
  }
}

// ══════════════════════════════════════════════
// EXPOSE PUBLIC API
// ══════════════════════════════════════════════
window.Arena={
  showHome:showHome,
  selectMode:selectMode,
  showConfig:showConfig,
  setCfg:setCfg,
  setCustomQ:setCustomQ,
  startSearch:startSearch,
  cancelSearch:cancelSearch,
  invitePlayer:invitePlayer,
  showLobby:showLobby,
  setReady:setReady,
  leaveLobby:leaveLobby,
  answerQ:answerQ,
  skipQ:skipQ,
  nextQ:nextQ,
  leaveBattle:leaveBattle,
  rematch:rematch,
  reviewMistakes:reviewMistakes,
  practiceSimilar:practiceSimilar,
  showHistory:showHistory,
  showHistoryDetail:showHistoryDetail,
  showLeaderboard:showLeaderboard,
  acceptInvite:acceptInvite,
  rejectInvite:rejectInvite,
  close:closeOverlay
};

// Initialize when BrainLab is ready
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){setTimeout(init,500);});
}else{
  setTimeout(init,500);
}

// Also try after window load (in case BrainLab loads late)
window.addEventListener('load',function(){setTimeout(init,1000);});

})();
