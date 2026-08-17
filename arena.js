// arena.js — Studyria Practice Arena 2.0
// ADDITIVE UPGRADE — preserves all existing Arena functionality
(function(){
'use strict';

// ════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════
var API='https://solene-a54e17bb.base44.app/functions/arenaApi';
var POLL_MS=2000, PING_MS=8000, INV_MS=3000, WAIT_POLL_MS=2000; // WAIT_POLL_MS was referenced in startWaitingPoll() but never declared — in strict mode this threw a ReferenceError the instant startWaitingPoll ran, which killed the auto-poll setInterval, the immediate waitingPoll() call, AND the visibilitychange/focus listener setup before any of them executed. Result: the 'waiting for opponent' screen never auto-refreshed — only the manual 'Check Now' button (which calls waitingPoll() directly, bypassing startWaitingPoll) worked. This declaration is the real, permanent fix.
var battleTimerInt=null; // Battle question timer interval handle — MUST be declared (strict mode); missing var here previously caused ReferenceError on every Next/Skip/finish/leave click, silently breaking battle progression.

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

// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════
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

async function api(action,data){
  data=data||{};
  try{
    var res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action},data))});
    return await res.json();
  }catch(e){console.error('Arena API:',e);return{ok:false,error:e.message};}
}

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



// ════════════════════════════════════════════════
// CSS — ARENA 2.0 PREMIUM DESIGN SYSTEM
// ════════════════════════════════════════════════
var CSS=`
/* ══ OVERLAY ══ */
.arena-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(18,10,14,0.98);z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:inherit}
.arena-wrap{max-width:600px;margin:0 auto;padding:16px 14px 60px;min-height:100%;box-sizing:border-box;color:#f5e9e0}
.arena-close{position:fixed;top:12px;right:14px;z-index:100000;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#f5e9e0;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:background .2s}
.arena-close:active{background:rgba(255,255,255,0.18)}

/* ══ TYPOGRAPHY ══ */
.arena-title{text-align:center;font-size:24px;font-weight:800;margin:8px 0 4px;color:#e8c87a;letter-spacing:-0.5px}
.arena-sub{text-align:center;font-size:13px;color:rgba(245,233,224,0.55);margin-bottom:18px}

/* ══ STATS BAR ══ */
.arena-stats-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px}
.arena-stat{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 6px;text-align:center;transition:transform .15s}
.arena-stat:active{transform:scale(0.96)}
.arena-stat-val{font-size:20px;font-weight:700;color:#e8c87a;line-height:1.2}
.arena-stat-lbl{font-size:9px;color:rgba(245,233,224,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px}

/* ══ RANK TIER BADGE ══ */
.arena-rank-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.arena-rank-badge.bronze{background:rgba(205,127,50,0.2);color:#cd7f32;border:1px solid rgba(205,127,50,0.3)}
.arena-rank-badge.silver{background:rgba(192,192,192,0.15);color:#c0c0c0;border:1px solid rgba(192,192,192,0.25)}
.arena-rank-badge.gold{background:rgba(232,200,122,0.15);color:#e8c87a;border:1px solid rgba(232,200,122,0.3)}
.arena-rank-badge.platinum{background:rgba(180,210,220,0.15);color:#b4d2dc;border:1px solid rgba(180,210,220,0.25)}
.arena-rank-badge.diamond{background:rgba(100,200,255,0.12);color:#8ecdf5;border:1px solid rgba(100,200,255,0.2)}
.arena-rank-badge.master{background:rgba(200,100,200,0.15);color:#e090e0;border:1px solid rgba(200,100,200,0.25)}

/* ══ MODE GRID ══ */
.arena-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
.arena-mode-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;transition:all .2s}
.arena-mode-card:active{transform:scale(0.96);background:rgba(232,200,122,0.12);border-color:rgba(232,200,122,0.3)}
.arena-mode-icon{font-size:30px;margin-bottom:8px}
.arena-mode-label{font-size:15px;font-weight:600;color:#f5e9e0}
.arena-mode-desc{font-size:11px;color:rgba(245,233,224,0.45);margin-top:3px}

/* ══ SECTION BUTTONS ══ */
.arena-section-btn{display:flex;align-items:center;justify-content:space-between;width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;color:#f5e9e0;font-size:14px;cursor:pointer;margin-bottom:8px;transition:all .15s}
.arena-section-btn:active{background:rgba(255,255,255,0.1)}
.arena-section-btn .arrow{color:rgba(245,233,224,0.35)}

/* ══ FORM FIELDS ══ */
.arena-field{margin-bottom:16px}
.arena-field-lbl{font-size:11px;font-weight:700;color:rgba(245,233,224,0.5);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px}
.arena-select-grid{display:flex;flex-wrap:wrap;gap:6px}
.arena-chip{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 13px;font-size:13px;color:rgba(245,233,224,0.75);cursor:pointer;transition:all .15s;white-space:nowrap}
.arena-chip.active{background:rgba(232,200,122,0.15);border-color:#e8c87a;color:#e8c87a;font-weight:600}
.arena-chip:active{transform:scale(0.95)}

/* ══ QUESTION COUNT ══ */
.arena-qcount-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.arena-qcount{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 4px;text-align:center;font-size:13px;color:rgba(245,233,224,0.75);cursor:pointer;transition:all .15s}
.arena-qcount.active{background:rgba(232,200,122,0.15);border-color:#e8c87a;color:#e8c87a;font-weight:600}
.arena-qcount:active{transform:scale(0.95)}
.arena-custom-count{display:flex;align-items:center;gap:8px;margin-top:4px}
.arena-custom-count input{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:#f5e9e0;font-size:14px;outline:none}
.arena-custom-count input:focus{border-color:rgba(232,200,122,0.4)}
.arena-pool-info{text-align:center;font-size:12px;color:rgba(245,233,224,0.45);margin-top:6px}

/* ══ SUMMARY CARD ══ */
.arena-summary-card{background:rgba(255,255,255,0.04);border:1px solid rgba(232,200,122,0.15);border-radius:14px;padding:16px;margin:16px 0}
.arena-summary-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-summary-row:last-child{border:none}
.arena-summary-lbl{font-size:12px;color:rgba(245,233,224,0.5);text-transform:uppercase;letter-spacing:0.5px}
.arena-summary-val{font-size:14px;font-weight:600;color:#e8c87a}

/* ══ BUTTONS ══ */
.arena-btn{display:block;width:100%;background:linear-gradient(135deg,#8b1538,#a01e44);color:#fff;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:0.3px}
.arena-btn:active{transform:scale(0.98);opacity:0.9}
.arena-btn:disabled{opacity:0.4;cursor:not-allowed}
.arena-btn.secondary{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#f5e9e0}
.arena-btn.gold{background:linear-gradient(135deg,#c89b3c,#e8c87a);color:#1a1a1a;font-weight:700}
.arena-btn.danger{background:linear-gradient(135deg,#8b1538,#c0392b)}
.arena-btn.outline{background:transparent;border:1.5px solid #8b1538;color:#e8a4b8}

/* ══ SEARCH ══ */
.arena-searching{text-align:center;padding:30px 20px}
.arena-spinner{width:42px;height:42px;border:3px solid rgba(232,200,122,0.15);border-top-color:#e8c87a;border-radius:50%;animation:arena-spin .8s linear infinite;margin:0 auto 16px}
@keyframes arena-spin{to{transform:rotate(360deg)}}
.arena-search-config{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 14px;margin:14px 0;font-size:13px;color:rgba(245,233,224,0.65)}
.arena-search-config span{display:inline-block;margin-right:12px}

/* ══ PLAYER CARDS ══ */
.arena-player-list{margin-top:12px}
.arena-player-card{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;margin-bottom:8px;transition:all .15s}
.arena-player-card:active{background:rgba(255,255,255,0.08)}
.arena-player-info{display:flex;align-items:center;gap:10px}
.arena-player-avatar{width:38px;height:38px;border-radius:50%;background:rgba(232,200,122,0.12);display:flex;align-items:center;justify-content:center;font-size:16px;color:#e8c87a;flex-shrink:0;font-weight:600}
.arena-player-name{font-size:14px;font-weight:600;color:#f5e9e0}
.arena-player-meta{font-size:11px;color:rgba(245,233,224,0.4);margin-top:2px}
.arena-rating-badge{display:inline-block;background:rgba(232,200,122,0.12);color:#e8c87a;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px}
.arena-online-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4caf50;margin-right:4px}
.arena-invite-btn{background:rgba(232,200,122,0.15);border:1px solid rgba(232,200,122,0.3);color:#e8c87a;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.arena-invite-btn:active{transform:scale(0.95)}

/* ══ LOBBY ══ */
.arena-lobby-config{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px;margin:12px 0;font-size:13px;color:rgba(245,233,224,0.6)}
.arena-lobby-config div{margin-bottom:3px}
.arena-team-block{background:rgba(255,255,255,0.03);border-radius:12px;padding:12px;margin:8px 0}
.arena-team-label{font-size:13px;font-weight:600;color:#e8c87a;margin-bottom:8px}
.arena-team-player{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.04);margin-bottom:6px}
.arena-vs{text-align:center;font-size:14px;font-weight:700;color:rgba(245,233,224,0.3);margin:8px 0}

/* ══ BATTLE ══ */
.arena-battle-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.arena-battle-header span{font-size:14px;font-weight:600;color:#f5e9e0}
.arena-battle-progress{height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-bottom:12px}
.arena-battle-progress-bar{height:100%;background:linear-gradient(90deg,#8b1538,#e8c87a);border-radius:3px;transition:width .3s}
.arena-live-status{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.arena-live-card{flex:1;min-width:80px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px 6px;text-align:center}
.arena-live-label{font-size:9px;color:rgba(245,233,224,0.4);text-transform:uppercase;letter-spacing:0.5px}
.arena-live-val{font-size:16px;font-weight:700;color:#f5e9e0;margin-top:2px}
.arena-battle-q{background:rgba(255,255,255,0.04);border-radius:12px;padding:16px;margin-bottom:12px}
.arena-battle-q-text{font-size:16px;font-weight:500;color:#f5e9e0;line-height:1.5;margin-bottom:14px}
.arena-battle-opt{display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;font-size:14px;color:#f5e9e0;margin-bottom:8px;cursor:pointer;transition:all .15s;line-height:1.4}
.arena-battle-opt:active{transform:scale(0.98)}
.arena-battle-opt.disabled{opacity:0.7;pointer-events:none}
.arena-battle-opt.correct{border-color:#4caf50;background:rgba(76,175,80,0.1)}
.arena-battle-opt.wrong{border-color:#f44336;background:rgba(244,67,54,0.1)}
.arena-battle-opt.selected{border-color:#e8c87a;background:rgba(232,200,122,0.1)}
.arena-battle-feedback{margin:12px 0;padding:12px;border-radius:10px;font-size:14px}
.arena-battle-feedback.show.correct{background:rgba(76,175,80,0.08);border-left:3px solid #4caf50}
.arena-battle-feedback.show.wrong{background:rgba(244,67,54,0.08);border-left:3px solid #f44336}
.arena-battle-actions{display:flex;gap:8px}
.arena-battle-actions button{flex:1}

/* ══ OPPONENT STATUS ══ */
.arena-opp-status{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.04);margin-bottom:6px}
.arena-opp-dot{width:8px;height:8px;border-radius:50%}
.arena-opp-dot.answered{background:#4caf50}
.arena-opp-dot.thinking{background:#ffc107}
.arena-opp-dot.waiting{background:rgba(255,255,255,0.2)}

/* ══ COUNTDOWN ══ */
.arena-countdown{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:100000}
.arena-countdown-num{font-size:80px;font-weight:800;color:#e8c87a;animation:arena-pulse .8s ease-out}
@keyframes arena-pulse{0%{transform:scale(0.5);opacity:0}50%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}

/* ══ EMPTY STATE ══ */
.arena-empty{text-align:center;padding:30px 20px;color:rgba(245,233,224,0.4);font-size:14px;line-height:1.6}

/* ══ RESULTS ══ */
.arena-result-hero{text-align:center;padding:24px 20px;margin-bottom:16px}
.arena-result-trophy{font-size:56px;margin-bottom:8px;animation:arena-fadein .4s}
.arena-result-title{font-size:28px;font-weight:800;letter-spacing:1px}
.arena-result-title.win{color:#e8c87a}
.arena-result-title.loss{color:#f5e9e0}
.arena-result-title.draw{color:#ffc107}
.arena-result-sub{font-size:13px;color:rgba(245,233,224,0.5);margin-top:4px}
.arena-result-scores{display:flex;justify-content:center;gap:16px;margin:16px 0}
.arena-result-score{flex:1;max-width:140px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;text-align:center}
.arena-result-score.winner{border-color:rgba(232,200,122,0.4);background:rgba(232,200,122,0.06)}
.arena-result-score-name{font-size:13px;color:rgba(245,233,224,0.6);margin-bottom:6px}
.arena-result-score-val{font-size:32px;font-weight:800;color:#e8c87a}
.arena-result-score-lbl{font-size:10px;color:rgba(245,233,224,0.4);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px}
.arena-result-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:12px}
.arena-result-section-title{font-size:12px;font-weight:700;color:#e8c87a;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.arena-result-row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;color:rgba(245,233,224,0.65)}
.arena-result-row span:last-child{color:#f5e9e0;font-weight:500}
.arena-result-row.highlight span:last-child{color:#e8c87a;font-weight:700}

/* ══ COMPARISON TABLE ══ */
.arena-compare-table{width:100%;font-size:13px;border-collapse:collapse}
.arena-compare-table th{font-size:10px;color:rgba(245,233,224,0.4);text-transform:uppercase;letter-spacing:0.5px;text-align:center;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.08)}
.arena-compare-table td{padding:8px 4px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(245,233,224,0.7)}
.arena-compare-table td:first-child{text-align:left;font-size:12px;color:rgba(245,233,224,0.5)}
.arena-compare-table td.me{color:#e8c87a;font-weight:600}

/* ══ TOPIC ANALYSIS ══ */
.arena-topic-row{padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-topic-row:last-child{border:none}
.arena-topic-name{font-size:13px;color:rgba(245,233,224,0.75);margin-bottom:4px;display:flex;justify-content:space-between}
.arena-topic-bar{height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:4px 0}
.arena-topic-bar-fill{height:100%;border-radius:3px;transition:width .4s}
.arena-topic-bar-fill.high{background:linear-gradient(90deg,#4caf50,#66bb6a)}
.arena-topic-bar-fill.mid{background:linear-gradient(90deg,#e8c87a,#c89b3c)}
.arena-topic-bar-fill.low{background:linear-gradient(90deg,#f44336,#e57373)}
.arena-topic-meta{font-size:11px;color:rgba(245,233,224,0.35)}

/* ══ QUESTION REVIEW ══ */
.arena-qreview{padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-qreview-q{font-size:13px;color:rgba(245,233,224,0.75);margin-bottom:6px;line-height:1.4}
.arena-qreview-a{font-size:12px;color:rgba(245,233,224,0.45);padding-left:12px;margin-bottom:3px}
.arena-qreview-a.correct{color:#66bb6a}
.arena-qreview-a.wrong{color:#f44336}
.arena-qreview-expl{font-size:11px;color:rgba(245,233,224,0.4);padding:6px 12px;background:rgba(255,255,255,0.03);border-radius:6px;margin-top:4px;line-height:1.4}

/* ══ WEAK AREA ══ */
.arena-weak-area{background:rgba(244,67,54,0.06);border:1px solid rgba(244,67,54,0.15);border-radius:12px;padding:14px;margin-bottom:12px}
.arena-weak-area-title{font-size:13px;font-weight:700;color:#f44336;margin-bottom:8px}
.arena-weak-area-topic{font-size:15px;font-weight:600;color:#f5e9e0;margin-bottom:4px}
.arena-weak-area-stat{font-size:12px;color:rgba(245,233,224,0.5);margin-bottom:4px}
.arena-weak-area-cta{margin-top:10px}

/* ══ STREAK BADGE ══ */
.arena-streak-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
.arena-streak-badge.hot{background:rgba(255,87,34,0.15);color:#ff6b35;border:1px solid rgba(255,87,34,0.25)}
.arena-streak-badge.warm{background:rgba(255,152,0,0.15);color:#ffa726;border:1px solid rgba(255,152,0,0.25)}
.arena-streak-badge.cold{background:rgba(255,255,255,0.06);color:rgba(245,233,224,0.5);border:1px solid rgba(255,255,255,0.1)}

/* ══ RATING CHANGE ══ */
.arena-rating-change{display:flex;justify-content:center;align-items:center;gap:12px;margin:12px 0}
.arena-rating-before{font-size:14px;color:rgba(245,233,224,0.5)}
.arena-rating-arrow{font-size:20px;color:rgba(245,233,224,0.3)}
.arena-rating-after{font-size:18px;font-weight:700;color:#e8c87a}
.arena-rating-delta{font-size:14px;font-weight:600;padding:2px 8px;border-radius:6px}
.arena-rating-delta.pos{color:#66bb6a;background:rgba(76,175,80,0.1)}
.arena-rating-delta.neg{color:#f44336;background:rgba(244,67,54,0.1)}

/* ══ HISTORY ══ */
.arena-history-item{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;transition:all .15s}
.arena-history-item:active{background:rgba(255,255,255,0.08)}
.arena-history-row{display:flex;justify-content:space-between;align-items:center}
.arena-history-left{flex:1}
.arena-history-mode{font-size:14px;font-weight:600;color:#f5e9e0}
.arena-history-meta{font-size:11px;color:rgba(245,233,224,0.35);margin-top:3px}
.arena-history-result{font-size:13px;font-weight:700;padding:3px 12px;border-radius:8px}
.arena-history-result.win{background:rgba(76,175,80,0.12);color:#66bb6a}
.arena-history-result.loss{background:rgba(244,67,54,0.12);color:#f44336}
.arena-history-result.draw{background:rgba(255,193,7,0.12);color:#ffc107}

/* ══ LEADERBOARD ══ */
.arena-lb-row{display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;margin-bottom:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.05);transition:all .15s}
.arena-lb-row:active{background:rgba(255,255,255,0.08)}
.arena-lb-row.me{border-color:rgba(232,200,122,0.3);background:rgba(232,200,122,0.04)}
.arena-lb-rank{width:32px;text-align:center;font-size:18px;font-weight:700;color:#e8c87a}
.arena-lb-name{flex:1;font-size:14px;color:#f5e9e0;font-weight:500}
.arena-lb-meta{font-size:11px;color:rgba(245,233,224,0.35);margin-top:2px}
.arena-lb-rating{font-size:16px;font-weight:700;color:#e8c87a}

/* ══ INVITE MODAL ══ */
.arena-invite-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f1419;border:1px solid rgba(232,200,122,0.3);border-radius:16px;padding:24px;max-width:360px;width:90%;z-index:100001;box-shadow:0 12px 40px rgba(0,0,0,0.6)}
.arena-invite-title{text-align:center;font-size:20px;font-weight:700;color:#e8c87a;margin-bottom:14px}
.arena-invite-sender{text-align:center;font-size:14px;color:#f5e9e0;margin-bottom:14px}
.arena-invite-config{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:rgba(245,233,224,0.55)}
.arena-invite-config div{margin-bottom:4px}
.arena-invite-buttons{display:flex;gap:10px}
.arena-invite-buttons button{flex:1}

/* ══ TOAST ══ */
.arena-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(31,20,25,0.96);border:1px solid rgba(232,200,122,0.25);color:#f5e9e0;padding:12px 22px;border-radius:12px;font-size:14px;z-index:100002;animation:arena-fadein .3s;box-shadow:0 4px 20px rgba(0,0,0,0.4)}
@keyframes arena-fadein{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}

/* ══ LOGIN PROMPT ══ */
.arena-login-prompt{text-align:center;padding:40px 20px}
.arena-login-icon{font-size:48px;margin-bottom:12px}
.arena-login-text{font-size:15px;color:rgba(245,233,224,0.55);margin-bottom:20px;line-height:1.5}

/* ══ PERFORMANCE SCORE ══ */
.arena-perf-score{text-align:center;padding:16px 0}
.arena-perf-score-val{font-size:42px;font-weight:800;color:#e8c87a}
.arena-perf-score-max{font-size:16px;color:rgba(245,233,224,0.4)}
.arena-perf-info{font-size:11px;color:rgba(245,233,224,0.35);margin-top:8px;cursor:pointer;text-decoration:underline}

/* ══ HEAD TO HEAD ══ */
.arena-h2h-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-h2h-row:last-child{border:none}
.arena-h2h-name{font-size:13px;color:rgba(245,233,224,0.6)}
.arena-h2h-val{font-size:15px;font-weight:700;color:#e8c87a}

/* ══ IMPROVEMENT TREND ══ */
.arena-trend-chart{display:flex;align-items:flex-end;justify-content:center;gap:6px;height:60px;margin:12px 0}
.arena-trend-bar{flex:1;max-width:30px;background:linear-gradient(180deg,#e8c87a,#c89b3c);border-radius:3px 3px 0 0;transition:height .4s}
.arena-trend-label{font-size:9px;color:rgba(245,233,224,0.3);text-align:center;margin-top:4px}
.arena-trend-delta{font-size:14px;font-weight:700;text-align:center}
.arena-trend-delta.up{color:#66bb6a}
.arena-trend-delta.down{color:#f44336}

/* ══ TOURNAMENT PLACEHOLDER ══ */
.arena-tournament-card{background:rgba(255,255,255,0.03);border:1px dashed rgba(232,200,122,0.2);border-radius:14px;padding:20px;text-align:center;margin-bottom:12px}
.arena-tournament-title{font-size:16px;font-weight:700;color:rgba(232,200,122,0.6);margin-bottom:6px}
.arena-tournament-sub{font-size:12px;color:rgba(245,233,224,0.35)}
.arena-coming-badge{display:inline-block;background:rgba(232,200,122,0.1);color:rgba(232,200,122,0.6);font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;letter-spacing:1px;text-transform:uppercase;margin-top:8px}

/* ══ DIFFICULTY ANALYTICS ══ */
.arena-diff-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.arena-diff-row:last-child{border:none}
.arena-diff-bar{flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;margin:0 12px;max-width:120px}
.arena-diff-bar-fill{height:100%;border-radius:4px;transition:width .4s}
.arena-diff-bar-fill.easy{background:#66bb6a}
.arena-diff-bar-fill.medium{background:#ffa726}
.arena-diff-bar-fill.hard{background:#f44336}
.arena-diff-label{font-size:13px;color:rgba(245,233,224,0.7);min-width:50px}
.arena-diff-val{font-size:14px;font-weight:600;color:#e8c87a;min-width:40px;text-align:right}

/* ══ IMPROVEMENT PLAN ══ */
.arena-improvement-plan{background:rgba(232,200,122,0.06);border:1px solid rgba(232,200,122,0.15);border-radius:12px;padding:16px;margin:12px 0}
.arena-improvement-title{font-size:14px;font-weight:700;color:#e8c87a;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.arena-improvement-text{font-size:13px;color:rgba(245,233,224,0.65);line-height:1.6;margin-bottom:10px}
.arena-improvement-rec{display:flex;align-items:center;gap:8px;padding:10px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:8px}
.arena-improvement-rec-label{font-size:12px;color:rgba(245,233,224,0.5)}
.arena-improvement-rec-val{font-size:13px;font-weight:600;color:#e8c87a}

/* ══ QUESTION REVIEW ACTIONS ══ */
.arena-qreview-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.arena-qreview-action-btn{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;font-size:11px;color:rgba(245,233,224,0.6);cursor:pointer;transition:all .15s}
.arena-qreview-action-btn:active{transform:scale(0.95);background:rgba(232,200,122,0.1)}

/* ══ ARENA PROFILE ══ */
.arena-profile-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;margin-bottom:14px}
.arena-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.arena-profile-stat{display:flex;align-items:center;gap:8px;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px}
.arena-profile-stat-icon{font-size:18px}
.arena-profile-stat-val{font-size:18px;font-weight:700;color:#f5e9e0}
.arena-profile-stat-lbl{font-size:10px;color:rgba(245,233,224,0.45);text-transform:uppercase;letter-spacing:0.5px}

/* ══ WEEKLY CHALLENGE ══ */
.arena-weekly-card{background:linear-gradient(135deg,rgba(139,21,56,0.08),rgba(200,155,60,0.06));border:1px solid rgba(200,155,60,0.15);border-radius:14px;padding:16px;margin-bottom:14px}
.arena-weekly-title{font-size:15px;font-weight:700;color:#e8c87a;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.arena-weekly-desc{font-size:12px;color:rgba(245,233,224,0.5);margin-bottom:10px}
.arena-weekly-progress{height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;margin-bottom:8px}
.arena-weekly-progress-bar{height:100%;background:linear-gradient(90deg,#c89b3c,#e8c87a);border-radius:4px;transition:width .4s}
.arena-weekly-meta{font-size:11px;color:rgba(245,233,224,0.4);display:flex;justify-content:space-between}

/* ══ HISTORY DETAIL ══ */
.arena-hd-section{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;margin-bottom:12px}
.arena-hd-section-title{font-size:13px;font-weight:700;color:#e8c87a;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px}
.arena-hd-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
.arena-hd-row:last-child{border:none}
.arena-hd-row .lbl{color:rgba(245,233,224,0.5)}
.arena-hd-row .val{color:#f5e9e0;font-weight:600}

/* ══ RESPONSIVE ══ */
@media(max-width:380px){
  .arena-mode-grid{grid-template-columns:1fr}
  .arena-qcount-grid{grid-template-columns:repeat(3,1fr)}
  .arena-stats-bar{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:320px){
  .arena-result-score-val{font-size:26px}
  .arena-battle-q-text{font-size:14px}
}

/* ══ ARENA PROMO BANNER — Premium Cream + Maroon + Gold ══ */
.arena-promo-banner{
  position:relative;
  display:block;
  width:100%;
  margin:0 0 20px;
  padding:0;
  border:none;
  background:none;
  cursor:pointer;
  text-decoration:none;
  border-radius:18px;
  overflow:hidden;
  transition:transform .25s cubic-bezier(0.4,0,0.2,1),box-shadow .25s ease;
  -webkit-tap-highlight-color:transparent;
}
.arena-promo-banner:hover{
  transform:translateY(-3px);
  box-shadow:0 12px 36px rgba(125,17,34,0.18);
}
.arena-promo-banner:active{
  transform:translateY(-1px) scale(0.995);
}
.arena-promo-inner{
  position:relative;
  border-radius:18px;
  overflow:hidden;
  background:linear-gradient(135deg,#7d1122 0%,#930205 45%,#7d1122 100%);
  border:1px solid rgba(201,154,60,0.35);
}
.arena-promo-inner::before{
  content:'';
  position:absolute;
  top:0;left:0;right:0;bottom:0;
  background:
    radial-gradient(ellipse 70% 50% at 80% 20%,rgba(201,154,60,0.15) 0%,transparent 60%),
    radial-gradient(ellipse 50% 60% at 15% 85%,rgba(201,154,60,0.08) 0%,transparent 55%);
  pointer-events:none;
}
.arena-promo-img-wrap{
  display:block;
  position:relative;
  width:100%;
  aspect-ratio:1590/989;
  border-radius:18px;
  overflow:hidden;
  border:1px solid rgba(201,154,60,0.35);
  background:linear-gradient(135deg,#7d1122 0%,#930205 45%,#7d1122 100%);
}
.arena-promo-img{
  display:block;
  width:100%;
  height:100%;
  object-fit:contain;
}
@supports not (aspect-ratio:1590/989){
  .arena-promo-img-wrap{height:auto;}
  .arena-promo-img{height:auto;object-fit:cover;}
}
.arena-promo-grid{
  position:relative;
  display:grid;
  grid-template-columns:1fr auto 1fr;
  align-items:center;
  gap:8px;
  padding:20px 20px 16px;
}
.arena-promo-side{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
}
.arena-promo-avatar{
  width:44px;height:44px;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:22px;
  border:2px solid rgba(201,154,60,0.4);
  background:rgba(255,255,255,0.06);
  backdrop-filter:blur(4px);
}
.arena-promo-avatar-label{
  font-size:9px;
  font-weight:600;
  color:rgba(245,233,224,0.5);
  text-transform:uppercase;
  letter-spacing:0.5px;
}
.arena-promo-vs{
  font-size:18px;
  font-weight:800;
  color:#c99a3c;
  text-shadow:0 0 12px rgba(201,154,60,0.4);
  font-style:italic;
  font-family:'Playfair Display',Georgia,serif;
  padding:0 4px;
}
.arena-promo-center{
  grid-column:1/-1;
  grid-row:1;
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
  gap:4px;
  padding:6px 10px;
  z-index:2;
}
.arena-promo-title{
  font-size:1.15rem;
  font-weight:800;
  color:#f5e9e0;
  letter-spacing:0.5px;
  font-family:'Playfair Display',Georgia,serif;
  display:flex;align-items:center;gap:6px;
  justify-content:center;
}
.arena-promo-title .arena-promo-sword{
  font-size:1.2rem;
}
.arena-promo-sub{
  font-size:0.72rem;
  font-weight:600;
  color:rgba(201,154,60,0.85);
  text-transform:uppercase;
  letter-spacing:1.5px;
}
.arena-promo-modes{
  grid-column:1/-1;
  display:flex;
  justify-content:center;
  gap:6px;
  flex-wrap:wrap;
  padding:0 10px 4px;
}
.arena-promo-mode-pill{
  font-size:0.65rem;
  font-weight:700;
  color:rgba(245,233,224,0.8);
  background:rgba(255,255,255,0.07);
  border:1px solid rgba(201,154,60,0.2);
  border-radius:6px;
  padding:3px 8px;
  letter-spacing:0.3px;
}
.arena-promo-footer{
  grid-column:1/-1;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:10px 20px 14px;
  gap:8px;
}
.arena-promo-tagline{
  font-size:0.72rem;
  color:rgba(245,233,224,0.6);
  font-weight:500;
  line-height:1.3;
}
.arena-promo-cta{
  display:inline-flex;
  align-items:center;
  gap:5px;
  font-size:0.78rem;
  font-weight:700;
  color:#7d1122;
  background:linear-gradient(135deg,#c99a3c,#e8c87a);
  border-radius:10px;
  padding:8px 16px;
  white-space:nowrap;
  transition:all .2s;
  box-shadow:0 2px 8px rgba(201,154,60,0.3);
}
.arena-promo-banner:hover .arena-promo-cta{
  transform:scale(1.05);
  box-shadow:0 4px 14px rgba(201,154,60,0.45);
}
.arena-promo-cta-arrow{
  font-size:0.85rem;
  transition:transform .2s;
}
.arena-promo-banner:hover .arena-promo-cta-arrow{
  transform:translateX(3px);
}
.arena-promo-badges{
  grid-column:1/-1;
  display:flex;
  justify-content:center;
  gap:12px;
  padding:0 10px 6px;
}
.arena-promo-badge{
  display:flex;
  align-items:center;
  gap:3px;
  font-size:0.65rem;
  font-weight:600;
  color:rgba(245,233,224,0.5);
}
.arena-promo-badge-icon{font-size:0.8rem}

/* ══ RESPONSIVE BANNER ══ */
@media(max-width:600px){
  .arena-promo-grid{padding:16px 14px 12px}
  .arena-promo-avatar{width:36px;height:36px;font-size:18px}
  .arena-promo-vs{font-size:15px}
  .arena-promo-title{font-size:1rem}
  .arena-promo-sub{font-size:0.62rem;letter-spacing:1px}
  .arena-promo-mode-pill{font-size:0.58rem;padding:2px 6px}
  .arena-promo-tagline{font-size:0.66rem}
  .arena-promo-cta{font-size:0.72rem;padding:7px 12px}
  .arena-promo-footer{padding:8px 14px 12px}
  .arena-promo-badges{gap:8px}
  .arena-promo-badge{font-size:0.58rem}
}
@media(max-width:380px){
  .arena-promo-grid{padding:14px 10px 10px}
  .arena-promo-avatar{width:30px;height:30px;font-size:14px;border-width:1.5px}
  .arena-promo-avatar-label{font-size:8px}
  .arena-promo-vs{font-size:13px}
  .arena-promo-title{font-size:0.88rem}
  .arena-promo-title .arena-promo-sword{font-size:1rem}
  .arena-promo-sub{font-size:0.55rem;letter-spacing:0.5px}
  .arena-promo-mode-pill{font-size:0.52rem;padding:2px 5px}
  .arena-promo-modes{gap:4px}
  .arena-promo-tagline{font-size:0.6rem}
  .arena-promo-cta{font-size:0.66rem;padding:6px 10px}
  .arena-promo-footer{padding:6px 10px 10px}
  .arena-promo-badges{gap:6px}
  .arena-promo-badge{font-size:0.52rem}
  .arena-promo-badge-icon{font-size:0.68rem}
}
`;

// Inject CSS
var styleEl=document.createElement('style');
styleEl.textContent=CSS;
document.head.appendChild(styleEl);

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
  // Clear match association and reset presence to online
  if(S.user){api('clearMatch',{userId:S.user.id});var si=getArenaStats();api('ping',{userId:S.user.id,userName:S.user.name,exam:S.cfg.exam||'All',arenaRating:si.rating||1000,wins:si.wins||0,losses:si.losses||0,draws:si.draws||0,battles:si.battles||0,status:'online'});}
}

function toast(msg){
  var old=document.querySelector('.arena-toast');if(old)old.remove();
  var t=document.createElement('div');t.className='arena-toast';t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.remove()},3000);
}

async function computeArenaStats(userId){
  var res=await api('getHistory',{userId:userId});
  var history=(res.ok&&res.history)?res.history:[];
  var wins=0,losses=0,draws=0;
  var teamLookups=[];
  history.forEach(function(m){
    if(m.status&&m.status!=='completed')return;
    var w=m.winner||{};
    if(!w.type){draws++;}
    else if(w.type==='draw'){draws++;}
    else if(w.type==='user'){
      if(w.userId===userId)wins++;else losses++;
    }else if(w.type==='team'){
      teamLookups.push(m);
    }
  });
  // Team-mode matches: getHistory's player entries don't include team, so
  // resolve win/loss via a direct match lookup (only for 2v2/3v3/4v4 games).
  if(teamLookups.length){
    var results=await Promise.all(teamLookups.map(function(m){
      return api('getMatch',{matchId:m.id||m.matchId});
    }));
    results.forEach(function(r){
      if(!r.ok||!r.match)return;
      var match=r.match;
      var me=(match.players||[]).find(function(p){return p.userId===userId;});
      if(!me)return;
      if(match.winner&&match.winner.type==='team'&&match.winner.team===me.team)wins++;
      else losses++;
    });
  }
  var battles=wins+losses+draws;
  var winRate=battles?Math.round(wins/battles*100):0;
  // No persisted ELO on the backend — approximate rating from the real
  // win/loss record so it moves with actual results instead of staying frozen.
  var rating=1000+wins*25-losses*20;
  if(rating<0)rating=0;
  return {rating:rating,wins:wins,losses:losses,draws:draws,battles:battles,winRate:winRate};
}



// ════════════════════════════════════════════════
// HELPER: RANK TIER
// ════════════════════════════════════════════════
function getRankTier(rating){
  if(rating>=2200)return{tier:'master',label:'Master',icon:'👑'};
  if(rating>=1800)return{tier:'diamond',label:'Diamond',icon:'💎'};
  if(rating>=1500)return{tier:'platinum',label:'Platinum',icon:'🔷'};
  if(rating>=1300)return{tier:'gold',label:'Gold',icon:'🥇'};
  if(rating>=1100)return{tier:'silver',label:'Silver',icon:'🥈'};
  return{tier:'bronze',label:'Bronze',icon:'🥉'};
}

// ════════════════════════════════════════════════
// HELPER: STREAK CALCULATION
// ════════════════════════════════════════════════
function computeStreaks(history,userId){
  var sorted=history.filter(function(m){return m.status!=='abandoned'&&m.status!=='in_progress';}).sort(function(a,b){
    var da=new Date(a.completedAt||a.createdAt||0).getTime();
    var db=new Date(b.completedAt||b.createdAt||0).getTime();
    return db-da;
  });
  var bestStreak=0,runningStreak=0;
  for(var i=0;i<sorted.length;i++){
    var m=sorted[i];
    var w=m.winner||{};
    var isWin=false;
    if(w.type==='user'&&w.userId===userId)isWin=true;
    else if(w.type==='team'){
      var me=(m.players||m.playerResults||[]).find(function(p){return p.userId===userId;});
      if(me&&w.team===me.team)isWin=true;
    }
    if(isWin){
      runningStreak++;
      if(runningStreak>bestStreak)bestStreak=runningStreak;
    }else{
      runningStreak=0;
    }
  }
  var currentStreak=0;
  for(var j=0;j<sorted.length;j++){
    var mj=sorted[j];
    var wj=mj.winner||{};
    var isWinj=false;
    if(wj.type==='user'&&wj.userId===userId)isWinj=true;
    else if(wj.type==='team'){
      var mej=(mj.players||mj.playerResults||[]).find(function(p){return p.userId===userId;});
      if(mej&&wj.team===mej.team)isWinj=true;
    }
    if(isWinj)currentStreak++;
    else break;
  }
  return{current:currentStreak,best:bestStreak};
}

// ════════════════════════════════════════════════
// SCREEN: HOME (UPGRADED)
// ════════════════════════════════════════════════
async function showHome(){
  S.user=getUser();
  if(!S.user){
    showOverlay('<div class="arena-login-prompt"><div class="arena-login-icon">🔐</div><div class="arena-login-text">Please log in to use the Practice Arena.</div><button class="arena-btn" onclick="Arena.close()">OK</button></div>');
    return;
  }
  if(S.user)api('clearMatch',{userId:S.user.id});
  var st=await computeArenaStats(S.user.id);
  var rating=st.rating,wins=st.wins,losses=st.losses,draws=st.draws;
  var battles=st.battles,winRate=st.winRate;
  try{localStorage.setItem('arena_stats',JSON.stringify({rating:rating,wins:wins,losses:losses,draws:draws,battles:battles,winRate:winRate}));}catch(e){}

  var histRes=await api('getHistory',{userId:S.user.id});
  var history=(histRes.ok&&histRes.history)?histRes.history:[];
  var streaks=computeStreaks(history,S.user.id);
  var rankTier=getRankTier(rating);

  var h='<div class="arena-title">⚔️ Practice Arena</div>';
  h+='<div class="arena-sub">Compete with real players in real-time</div>';

  h+='<div style="text-align:center;margin-bottom:14px"><span class="arena-rank-badge '+rankTier.tier+'">'+rankTier.icon+' '+rankTier.label+' Tier</span></div>';

  h+='<div class="arena-stats-bar">';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+rating+'</div><div class="arena-stat-lbl">Arena Rating</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+battles+'</div><div class="arena-stat-lbl">Battles</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+winRate+'%</div><div class="arena-stat-lbl">Win Rate</div></div>';
  h+='<div class="arena-stat"><div class="arena-stat-val">'+wins+'-'+losses+'</div><div class="arena-stat-lbl">W-L</div></div>';
  h+='</div>';

  if(battles>0){
    h+='<div style="display:flex;justify-content:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
    if(streaks.current>0){
      var streakClass=streaks.current>=3?'hot':streaks.current>=2?'warm':'cold';
      h+='<span class="arena-streak-badge '+streakClass+'">🔥 '+streaks.current+' Win Streak</span>';
    }
    if(streaks.best>0){
      h+='<span class="arena-streak-badge cold">🔥 Best: '+streaks.best+'</span>';
    }
    h+='</div>';
  }

  h+='<div class="arena-profile-section">';
  h+='<div class="arena-field-lbl" style="margin-bottom:12px">Arena Profile</div>';
  h+='<div class="arena-profile-grid">';
  h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">🏆</div><div><div class="arena-profile-stat-val">'+wins+'</div><div class="arena-profile-stat-lbl">Wins</div></div></div>';
  h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">❌</div><div><div class="arena-profile-stat-val">'+losses+'</div><div class="arena-profile-stat-lbl">Losses</div></div></div>';
  h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">⚔️</div><div><div class="arena-profile-stat-val">'+battles+'</div><div class="arena-profile-stat-lbl">Matches</div></div></div>';
  if(battles>0){
    var acc=battles>0?Math.round((wins/battles)*100):0;
    h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">🎯</div><div><div class="arena-profile-stat-val">'+acc+'%</div><div class="arena-profile-stat-lbl">Accuracy</div></div></div>';
    h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">🔥</div><div><div class="arena-profile-stat-val">'+streaks.best+'</div><div class="arena-profile-stat-lbl">Best Streak</div></div></div>';
    h+='<div class="arena-profile-stat"><div class="arena-profile-stat-icon">🏅</div><div><div class="arena-profile-stat-val">'+rating+'</div><div class="arena-profile-stat-lbl">Arena Rating</div></div></div>';
  }
  h+='</div>';
  h+='</div>';

  // Weekly Arena Challenge (placeholder — backed by real data when available)
  h+='<div class="arena-weekly-card">';
  h+='<div class="arena-weekly-title">🔥 Weekly Arena Challenge</div>';
  h+='<div class="arena-weekly-desc">Play 10 Arena matches this week</div>';
  var weeklyMatches=Math.min(battles,10);
  var weeklyPct=Math.round(weeklyMatches/10*100);
  h+='<div class="arena-weekly-progress"><div class="arena-weekly-progress-bar" style="width:'+weeklyPct+'%"></div></div>';
  h+='<div class="arena-weekly-meta"><span>'+weeklyMatches+'/10 matches</span><span>'+(weeklyPct>=100?'✅ Completed':'In Progress')+'</span></div>';
  h+='</div>';

  h+='<div class="arena-field-lbl" style="margin-bottom:10px">Select Mode</div>';
  h+='<div class="arena-mode-grid">';
  MODES.forEach(function(m){
    h+='<div class="arena-mode-card" onclick="Arena.selectMode(\''+m.id+'\')">';
    h+='<div class="arena-mode-icon">'+m.icon+'</div>';
    h+='<div class="arena-mode-label">'+m.label+'</div>';
    h+='<div class="arena-mode-desc">'+m.desc+'</div>';
    h+='</div>';
  });
  h+='</div>';

  h+='<button class="arena-section-btn" onclick="Arena.showHistory()">📜 Battle History <span class="arrow">›</span></button>';
  h+='<button class="arena-section-btn" onclick="Arena.showLeaderboard()">🏆 Arena Leaderboard <span class="arrow">›</span></button>';

  h+='<div class="arena-tournament-card">';
  h+='<div class="arena-tournament-title">🏆 Arena Tournaments</div>';
  h+='<div class="arena-tournament-sub">Compete in structured brackets against top players</div>';
  h+='<div class="arena-coming-badge">Coming Soon</div>';
  h+='</div>';

  showOverlay(h);
  S.screen='home';
  startPresence();
  startInviteCheck();
}

// ════════════════════════════════════════════════
// SCREEN: CONFIG (UPGRADED)
// ════════════════════════════════════════════════
function showConfig(modeId){
  var m=MODES.find(function(x){return x.id===modeId;});
  if(!m)return;
  S.cfg.mode=modeId;
  var cats=getCategories();
  var poolCount=countQuestions({cat:S.cfg.cat,exam:S.cfg.exam,diff:S.cfg.diff});
  var maxQ=Math.min(500,poolCount);
  var estTime=S.cfg.qCount*15;
  var estMin=Math.floor(estTime/60),estSec=estTime%60;
  var estDisplay=estMin>0?estMin+'m':'';
  if(estSec>0)estDisplay+=estSec+'s';

  var h='<div class="arena-title">⚙️ Match Setup</div>';
  h+='<div class="arena-sub">'+m.icon+' '+m.label+' — '+m.desc+'</div>';

  h+='<div class="arena-field"><div class="arena-field-lbl">Exam</div><div class="arena-select-grid">';
  EXAMS.forEach(function(e){
    h+='<div class="arena-chip'+(S.cfg.exam===e?' active':'')+'" onclick="Arena.setCfg(\'exam\',\''+e+'\')">'+e+'</div>';
  });
  h+='</div></div>';

  h+='<div class="arena-field"><div class="arena-field-lbl">Category</div><div class="arena-select-grid">';
  cats.forEach(function(c){
    h+='<div class="arena-chip'+(S.cfg.cat===c?' active':'')+'" onclick="Arena.setCfg(\'cat\',\''+c.replace(/'/g,"\\'")+'\')">'+c+'</div>';
  });
  h+='</div></div>';

  h+='<div class="arena-field"><div class="arena-field-lbl">Difficulty</div><div class="arena-select-grid">';
  DIFFS.forEach(function(d){
    h+='<div class="arena-chip'+(S.cfg.diff===d.id?' active':'')+'" onclick="Arena.setCfg(\'diff\',\''+d.id+'\')">'+d.icon+' '+d.l+'</div>';
  });
  h+='</div></div>';

  h+='<div class="arena-field"><div class="arena-field-lbl">Questions (10–500)</div>';
  h+='<div class="arena-qcount-grid">';
  QCOUNTS.forEach(function(q){
    if(q<=maxQ)h+='<div class="arena-qcount'+(S.cfg.qCount===q?' active':'')+'" onclick="Arena.setCfg(\'qCount\','+q+')">'+q+'</div>';
  });
  h+='</div>';
  h+='<div class="arena-custom-count">';
  h+='<input type="number" min="10" max="500" value="'+S.cfg.qCount+'" id="arena-custom-q" onchange="Arena.setCustomQ(this.value)" placeholder="Custom (10–500)"/>';
  h+='</div>';
  h+='<div class="arena-pool-info">'+poolCount+' questions available in pool</div>';
  h+='</div>';

  h+='<div class="arena-summary-card">';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Mode</span><span class="arena-summary-val">'+m.label+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Questions</span><span class="arena-summary-val">'+S.cfg.qCount+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Exam</span><span class="arena-summary-val">'+S.cfg.exam+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Category</span><span class="arena-summary-val">'+S.cfg.cat+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Difficulty</span><span class="arena-summary-val">'+S.cfg.diff+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Est. Time</span><span class="arena-summary-val">'+estDisplay+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Players Required</span><span class="arena-summary-val">'+(m.type==='duel'?'1 Opponent':(m.players-1)+' Players')+'</span></div>';
  h+='<div class="arena-summary-row"><span class="arena-summary-lbl">Question Pool</span><span class="arena-summary-val">'+poolCount+' available</span></div>';
  h+='</div>';

  h+='<button class="arena-btn gold" onclick="Arena.startSearch()">🔎 Find Opponent</button>';
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.showHome()">← Back</button>';

  showOverlay(h);
  S.screen='config';
}

async function startSearch(){
  S.user=getUser();if(!S.user){toast('Please log in');return;}
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  if(!m)return;
  
  S.screen='search';
  S.searchStartTime=Date.now();
  S.searchTimedOut=false;
  S.matchId=null;
  S.searchResults=[];
  S.autoMatching=true;
  
  renderSearch();
  startPresence();
  startSearchPoll();
  startInviteCheck();
}


function renderSearch(){
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  var elapsed=S.searchStartTime?Math.floor((Date.now()-S.searchStartTime)/1000):0;
  var h='<div class="arena-title">🔎 Find Players</div>';
  h+='<div class="arena-sub">'+m.label+' · Auto-matching...</div>';

  h+='<div class="arena-searching">';
  h+='<div class="arena-spinner"></div>';
  h+='<div style="font-size:15px;color:#f5e9e0;margin-bottom:4px">Auto-matching with compatible players...</div>';
  h+='<div style="font-size:12px;color:rgba(245,233,224,0.4);margin-top:4px">Searching for '+elapsed+'s</div>';
  h+='</div>';

  h+='<div class="arena-search-config">';
  h+='<span>📋 '+m.label+'</span><span>📝 '+S.cfg.qCount+'Q</span><span>📚 '+S.cfg.exam+'</span><span>📁 '+S.cfg.cat+'</span><span>📊 '+S.cfg.diff+'</span>';
  h+='</div>';

  if(S.searchTimedOut){
    h+='<div class="arena-empty">No compatible player found yet.<br>Try adjusting your settings or invite a friend manually below.</div>';
  }else if(S.searchResults.length===0){
    h+='<div class="arena-empty">Searching for compatible players...<br>Match starts automatically when someone joins!</div>';
  }else{
    h+='<div class="arena-player-list">';
    h+='<div style="font-size:12px;color:rgba(245,233,224,0.4);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Online Players</div>';
    S.searchResults.forEach(function(p){
      var cfg=p.searchConfig||{};
      var pTier=getRankTier(p.arenaRating||1000);
      h+='<div class="arena-player-card">';
      h+='<div class="arena-player-info">';
      h+='<div class="arena-player-avatar">'+(p.userName[0]||'?').toUpperCase()+'</div>';
      h+='<div><div class="arena-player-name">'+escapeHtml(p.userName)+'</div>';
      h+='<div class="arena-player-meta"><span class="arena-online-dot"></span>'+(p.exam||'General')+' · '+p.battles+' battles · '+p.winRate+'% WR · '+pTier.label+'</div></div>';
      h+='</div>';
      h+='<div style="text-align:right"><div class="arena-rating-badge">⭐ '+(p.arenaRating||1000)+'</div>';
      if(cfg.mode){
        h+='<div style="font-size:10px;color:rgba(245,233,224,0.3);margin-top:4px">'+modeLabel(cfg.mode)+' · '+(cfg.questionCount||10)+'Q</div>';
      }
      h+='<button class="arena-invite-btn" style="margin-top:6px" data-userid="'+p.userId+'" data-username="'+escapeHtml(p.userName)+'" onclick="Arena.invitePlayer(this.dataset.userid,this.dataset.username)">Invite</button></div>';
      h+='</div>';
    });
    h+='</div>';
  }

  h+='<button class="arena-btn secondary" style="margin-top:16px" onclick="Arena.cancelSearch()">Cancel Search</button>';

  showOverlay(h);
}

async function searchPoll(){
  if(S.screen!=='search'||!S.autoMatching)return;
  
  // Call autoMatch to find compatible players
  var res=await api('autoMatch',{
    userId:S.user.id,
    userName:S.user.name,
    config:{mode:S.cfg.mode,questionCount:S.cfg.qCount,exam:S.cfg.exam,category:S.cfg.cat,difficulty:S.cfg.diff}
  });
  
  if(res.ok&&res.matched&&res.matchId){
    S.matchId=res.matchId;
    S.match=res.match;
    S.autoMatching=false;
    S.screen='lobby';
    showLobby();
    return;
  }
  
  // Also fetch online players for manual invite display
  var searchRes=await api('search',{userId:S.user.id});
  if(searchRes.ok&&searchRes.players){
    S.searchResults=searchRes.players;
  }
  
  // Check timeout (2 minutes)
  if(S.searchStartTime&&Date.now()-S.searchStartTime>120000){
    S.searchTimedOut=true;
  }
  
  renderSearch();
}

async function invitePlayer(toUserId,toUserName){
  toast('Sending invitation...');
  var m=MODES.find(function(x){return x.id===S.cfg.mode;});
  var team=getTeamForSlot(S.cfg.mode,S.match?S.match.players.length:1);
  var res=await api('sendInvite',{
    fromUserId:S.user.id,fromUserName:S.user.name,
    toUserId:toUserId,toUserName:toUserName,
    matchConfig:{mode:S.cfg.mode,questionCount:S.cfg.qCount,exam:S.cfg.exam,category:S.cfg.cat,difficulty:S.cfg.diff,matchId:S.matchId||null,team:team}
  });
  if(res.ok){
    toast('Invitation sent to '+toUserName+'!');
    // Keep searching — when they accept, inviteCheckPoll will auto-accept
    // and our next autoMatch poll will detect the matchId
  }
  else{toast('Could not invite: '+(res.error||'Unknown error'));}
}

function cancelSearch(){
  if(S.matchId){
    api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
    S.matchId=null;
  }
  S.autoMatching=false;
  if(S.user){
    api('ping',{userId:S.user.id,userName:S.user.name,status:'online',exam:S.cfg.exam||'All'});
  }
  stopAllTimers();
  showHome();
}


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
  
  h+='<div class="arena-lobby-config">';
  h+='<div>📋 Mode: '+m.label+'</div>';
  h+='<div>📝 Questions: '+S.match.questionCount+'</div>';
  h+='<div>📚 Exam: '+S.match.exam+'</div>';
  h+='<div>📁 Category: '+S.match.category+'</div>';
  h+='<div>📊 Difficulty: '+S.match.difficulty+'</div>';
  h+='</div>';
  
  if(m.type==='duel'){
    h+=renderLobbyPlayer(players[0],'You');
    h+='<div class="arena-vs">VS</div>';
    if(players[1])h+=renderLobbyPlayer(players[1],'Opponent');
    else h+='<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting for opponent...</div></div><span class="arena-streak-badge cold">Pending</span></div>';
  }else if(m.type==='ffa'){
    h+='<div class="arena-team-label">Players ('+players.length+'/'+m.players+')</div>';
    for(var i=0;i<m.players;i++){
      if(players[i])h+=renderLobbyPlayer(players[i],null);
      else h+='<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting...</div></div><span class="arena-streak-badge cold">Pending</span></div>';
    }
  }else{
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
  var tier=getRankTier(p.arenaRating||1000);
  return '<div class="arena-team-player"><div class="arena-player-avatar">'+(p.userName[0]||'?').toUpperCase()+'</div><div><div class="arena-player-name">'+escapeHtml(p.userName)+(isMe?' (You)':'')+'</div><div class="arena-player-meta">⭐ '+((p.arenaRating)||1000)+' · '+tier.label+'</div></div><span class="arena-streak-badge '+(p.ready?'warm':'cold')+'">'+readyText+'</span></div>';
}

function renderEmptySlot(){
  return '<div class="arena-team-player"><div class="arena-player-avatar">?</div><div><div class="arena-player-name" style="color:rgba(245,233,224,0.3)">Waiting for player...</div></div><span class="arena-streak-badge cold">Empty</span></div>';
}

async function setReady(ready){
  var res=await api('setReady',{matchId:S.matchId,userId:S.user.id,ready:ready});
  if(res.ok&&res.match){
    S.match=res.match;
    if(res.match.status==='in_progress'){
      // Match is starting right now — don't wait for the next poll
      toast('Battle starting!');
      setTimeout(function(){startBattle();},600);
      return;
    }
    renderLobby();
  }
}

async function leaveLobby(){
  if(!confirm('Leave this arena lobby?'))return;
  await api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
  S.matchId=null;S.match=null;
  stopAllTimers();
  showHome();
}

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
  
  // Live stats
  h+='<div class="arena-live-status">';
  h+='<div class="arena-live-card"><div class="arena-live-label">Correct</div><div class="arena-live-val" id="arena-live-correct">'+S.battle.correct+'</div></div>';
  h+='<div class="arena-live-card"><div class="arena-live-label">Wrong</div><div class="arena-live-val" id="arena-live-wrong">'+S.battle.wrong+'</div></div>';
  h+='<div class="arena-live-card"><div class="arena-live-label">Skipped</div><div class="arena-live-val" id="arena-live-skipped">'+S.battle.skipped+'</div></div>';
  h+='</div>';
  
  // Opponent status (without revealing answers)
  if(S.match&&S.match.players){
    S.match.players.forEach(function(p){
      if(p.userId!==S.user.id&&p.status!=='abandoned'){
        var answered=p.answers?p.answers.length:0;
        var dotClass=answered>idx?'answered':answered>0?'thinking':'waiting';
        var statusText=answered>idx?'Answered':answered>0?'Thinking':'Not Started';
        h+='<div class="arena-opp-status"><span class="arena-opp-dot '+dotClass+'"></span><span style="font-size:12px;color:rgba(245,233,224,0.5)">'+escapeHtml(p.userName)+': '+statusText+' ('+answered+'/'+total+')</span></div>';
      }
    });
  }
  
  // Question
  h+='<div class="arena-battle-q">';
  h+='<div style="font-size:11px;color:rgba(232,200,122,0.6);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">'+escapeHtml(q.topic||q.category||'')+(q.difficulty?' · '+q.difficulty:'')+'</div>';
  h+='<div class="arena-battle-q-text">'+escapeHtml(q.question_text)+'</div>';
  
  var opts=[{label:'A',text:q.option_a},{label:'B',text:q.option_b},{label:'C',text:q.option_c},{label:'D',text:q.option_d}];
  opts.forEach(function(o,i){
    h+='<button class="arena-battle-opt" id="arena-opt-'+i+'" onclick="Arena.answerQ('+i+')"><strong>'+o.label+'</strong> · '+escapeHtml(o.text)+'</button>';
  });
  
  h+='</div>';
  
  h+='<div class="arena-battle-feedback" id="arena-feedback"></div>';
  
  h+='<div class="arena-battle-actions">';
  h+='<button class="arena-btn secondary" onclick="Arena.skipQ()">⏭ Skip</button>';
  h+='<button class="arena-btn" id="arena-next-btn" onclick="Arena.nextQ()" disabled>Next →</button>';
  h+='</div>';
  h+='<button class="arena-btn danger" style="margin-top:8px" onclick="Arena.leaveBattle()">Leave Battle</button>';
  h+='</div>';
  
  showOverlay(h);
  startBattleTimer();
}

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
  // Backend stores players[].answers as an array of STRINGS (letter answers),
  // not objects — sending {selectedIdx,isCorrect,timeSpent} objects fails schema
  // validation on every single submit ("Input should be a valid string"), which
  // is why completeMatch was failing on every real battle. Convert to plain
  // letter strings here; skipped questions become an empty string.
  var answersForServer=S.battle.answers.map(function(a){
    if(a===null||a===undefined)return '';
    return String.fromCharCode(97+a.selectedIdx);
  });
  var payload={
    matchId:S.matchId,userId:S.user.id,
    correct:S.battle.correct,wrong:S.battle.wrong,skipped:S.battle.skipped,
    score:score,totalTime:totalTime,
    topicBreakdown:S.battle.topicStats,
    answers:answersForServer
  };
  
  // Submit final results — RETRY on failure. On flaky mobile connections a
  // single failed submit used to permanently strand the match (server never
  // learns this player finished, opponent's report shows 0s forever). Retry
  // a few times with backoff before giving up.
  showOverlay('<div class="arena-countdown"><div style="font-size:18px;color:rgba(245,233,224,0.5);margin-bottom:20px">📤 Submitting your result…</div><div class="arena-spinner"></div></div>');
  var res=null;
  for(var attempt=0;attempt<5;attempt++){
    if(attempt>0)await new Promise(function(r){setTimeout(r,800*attempt);});
    res=await api('completeMatch',payload);
    if(res&&res.ok)break;
  }
  
  if(res&&res.ok&&res.allCompleted){
    // Both players finished — show results using the FRESH match data we just got
    // back from completeMatch (avoids read-after-write replication lag from a
    // separate getMatch call right after this write)
    showResults(res.winner,res.match);
  }else if(res&&res.ok){
    // Waiting for opponent
    showWaitingForOpponent();
  }else{
    // All retries failed — likely a real connectivity problem. Do NOT fake a
    // result screen with local-only data (that hides that the server never
    // recorded this player's completion). Offer a manual retry instead.
    showOverlay('<div class="arena-countdown"><div style="font-size:18px;color:#e57373;margin-bottom:12px">⚠️ Couldn\'t submit your result</div><div style="color:rgba(245,233,224,0.6);margin-bottom:20px;font-size:14px">Check your connection and try again — your answers are saved locally.</div><button class="arena-btn primary" onclick="Arena.retrySubmit()">🔄 Retry Submit</button></div>');
    S.screen='submitFailed';
  }
}

function retrySubmit(){
  finishBattle();
}

function showWaitingForOpponent(){
  showOverlay('<div class="arena-countdown"><div style="font-size:18px;color:rgba(245,233,224,0.5);margin-bottom:20px">✅ Battle Complete!</div><div class="arena-spinner"></div><div style="margin-top:16px;color:rgba(245,233,224,0.6)">Waiting for opponent to finish...</div><div style="margin-top:20px;display:flex;gap:10px;justify-content:center"><button class="arena-btn secondary" onclick="Arena.checkNowWait()">🔄 Check Now</button><button class="arena-btn secondary" onclick="Arena.forfeitWait()">Don\'t Wait</button></div></div>');
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
    stopTimer('poll');
    // Pass the fresh match data we JUST fetched directly to showResults —
    // avoids a redundant getMatch call that could return stale data.
    showResults(S.match.winner||{},S.match);
    return;
  }
  
  // Also check: are all active players completed but status wasn't set yet?
  // (race condition — getMatch self-healing on the backend should handle this,
  // but double-check client-side too as a safety net)
  var active=S.match.players.filter(function(p){return p.status!=='abandoned';});
  var allCompleted=active.length>0&&active.every(function(p){return p.status==='completed';});
  if(allCompleted){
    stopTimer('waitingPoll');
    stopTimer('poll');
    var winner=active.slice().sort(function(a,b){return (b.score||0)-(a.score||0);});
    var top=winner[0],second=winner[1];
    var isDraw=second&&(second.score||0)===(top.score||0);
    var w=isDraw?{type:'draw',userId:top.userId,userName:top.userName,score:top.score}
      :{type:'user',userId:top.userId,userName:top.userName,score:top.score};
    showResults(w,S.match);
    return;
  }
  
  var opponents=S.match.players.filter(function(p){return p.userId!==S.user.id;});
  var allAbandoned=opponents.length>0&&opponents.every(function(p){return p.status==='abandoned';});
  if(allAbandoned){
    stopTimer('waitingPoll');
    stopTimer('poll');
    showResults({type:'user',userId:S.user.id,userName:S.user.name},S.match);
  }
}

function forfeitWait(){
  stopTimer('waitingPoll');
  stopTimer('poll');
  showResults({type:'user',userId:S.user.id,userName:S.user.name});
}

function checkNowWait(){
  toast('Checking...');
  waitingPoll();
}

async function leaveBattle(){
  if(!confirm('Leave Arena? Your progress will be saved as abandoned.'))return;
  await api('leaveMatch',{matchId:S.matchId,userId:S.user.id});
  if(battleTimerInt)clearInterval(battleTimerInt);
  stopAllTimers();
  S.matchId=null;S.match=null;
  showHome();
}



// ════════════════════════════════════════════════
// SCREEN: RESULTS (UPGRADED — Professional Order)
// ════════════════════════════════════════════════
async function showResults(winner,freshMatch){
  stopAllTimers();
  S.screen='results';
  
  if(freshMatch){
    S.match=freshMatch;
  }else{
    var res=await api('getMatch',{matchId:S.matchId});
    if(res.ok)S.match=res.match;
  }
  
  var m=MODES.find(function(x){return x.id===S.match.mode;});
  var players=S.match.players.slice();
  var meIdx=players.findIndex(function(p){return p.userId===S.user.id;});
  var me=meIdx>-1?players[meIdx]:null;
  var total=S.battle.questions.length||S.match.questionCount;
  var totalTime=S.battle.totalTime||0;
  
  // DEFENSIVE SAFETY NET
  if(me&&(me.correct||0)+(me.wrong||0)===0&&(S.battle.correct+S.battle.wrong)>0){
    var localScore=total?Math.round((S.battle.correct/total)*100):0;
    me=Object.assign({},me,{
      correct:S.battle.correct,wrong:S.battle.wrong,skipped:S.battle.skipped,
      score:localScore,totalTime:S.battle.totalTime||totalTime,
    });
    players[meIdx]=me;
  }
  
  var isWin=winner.type==='user'&&winner.userId===S.user.id;
  var isDraw=winner.type==='draw';
  var isTeamWin=winner.type==='team'&&me&&me.team===winner.team;
  var opp=players.find(function(p){return p.userId!==S.user.id;});
  
  // ══ LAYER 1: RESULT HERO ══
  var h='<div class="arena-result-hero">';
  if(isWin||isTeamWin){
    h+='<div class="arena-result-trophy">🏆</div>';
    h+='<div class="arena-result-title win">YOU WIN!</div>';
    h+='<div class="arena-result-sub">Congratulations on your victory!</div>';
  }else if(isDraw){
    h+='<div class="arena-result-trophy">🤝</div>';
    h+='<div class="arena-result-title draw">DRAW</div>';
    h+='<div class="arena-result-sub">Evenly matched!</div>';
  }else if(winner.type==='ffa'&&winner.ranking){
    var myRank=winner.ranking.findIndex(function(p){return p.userId===S.user.id;})+1;
    h+='<div class="arena-result-trophy">'+(myRank===1?'🏆':myRank===2?'🥈':myRank===3?'🥉':'🎮')+'</div>';
    h+='<div class="arena-result-title">RANK #'+myRank+'</div>';
    h+='<div class="arena-result-sub">Out of '+winner.ranking.length+' players</div>';
  }else{
    h+='<div class="arena-result-trophy">💪</div>';
    h+='<div class="arena-result-title loss">YOU LOST</div>';
    h+='<div class="arena-result-sub">Better luck next time!</div>';
  }
  h+='</div>';
  
  // ══ LAYER 2: SCORE COMPARISON ══
  if(winner.type==='ffa'&&winner.ranking){
    h+='<div class="arena-result-section"><div class="arena-result-section-title">🏆 Final Ranking</div>';
    winner.ranking.forEach(function(p,i){
      h+='<div class="arena-result-row"><span>'+(i+1)+'. '+escapeHtml(p.userName)+(p.userId===S.user.id?' (You)':'')+'</span><span>'+p.score+'% ('+p.correct+'C)</span></div>';
    });
    h+='</div>';
  }else if(m&&m.type==='team'){
    var teamA=players.filter(function(p){return p.team==='A';});
    var teamB=players.filter(function(p){return p.team==='B';});
    var scoreA=teamA.reduce(function(s,p){return s+(p.score||0);},0);
    var scoreB=teamB.reduce(function(s,p){return s+(p.score||0);},0);
    h+='<div class="arena-result-scores">';
    h+='<div class="arena-result-score'+(winner.team==='A'?' winner':'')+'"><div class="arena-result-score-name">Team A</div><div class="arena-result-score-val">'+scoreA+'</div><div class="arena-result-score-lbl">Total Score</div></div>';
    h+='<div class="arena-result-score'+(winner.team==='B'?' winner':'')+'"><div class="arena-result-score-name">Team B</div><div class="arena-result-score-val">'+scoreB+'</div><div class="arena-result-score-lbl">Total Score</div></div>';
    h+='</div>';
    // Team member breakdown with individual scores
    h+='<div class="arena-result-section"><div class="arena-result-section-title">👥 Team Breakdown</div>';
    h+='<div style="margin-bottom:8px;font-size:12px;color:rgba(245,233,224,0.5);font-weight:600">Team A ('+Math.round(scoreA/(teamA.length||1))+' avg)</div>';
    teamA.forEach(function(p){
      h+='<div class="arena-result-row"><span>'+escapeHtml(p.userName)+(p.userId===S.user.id?' (You)':'')+'</span><span>'+(p.score||0)+' pts · '+(p.correct||0)+'C · '+fmtTime(p.totalTime||0)+'</span></div>';
    });
    h+='<div style="margin:8px 0;font-size:12px;color:rgba(245,233,224,0.5);font-weight:600">Team B ('+Math.round(scoreB/(teamB.length||1))+' avg)</div>';
    teamB.forEach(function(p){
      h+='<div class="arena-result-row"><span>'+escapeHtml(p.userName)+'</span><span>'+(p.score||0)+' pts · '+(p.correct||0)+'C · '+fmtTime(p.totalTime||0)+'</span></div>';
    });
    // Team stats summary
    var teamAAcc=teamA.reduce(function(s,p){return s+(p.correct||0);},0);
    var teamACount=teamA.reduce(function(s,p){return s+((p.correct||0)+(p.wrong||0));},0);
    var teamBAcc=teamB.reduce(function(s,p){return s+(p.correct||0);},0);
    var teamBCount=teamB.reduce(function(s,p){return s+((p.correct||0)+(p.wrong||0));},0);
    h+='<div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:12px;color:rgba(245,233,224,0.6)">';
    h+='<div>Team A Accuracy: '+(teamACount?Math.round(teamAAcc/teamACount*100):0)+'% · Team B Accuracy: '+(teamBCount?Math.round(teamBAcc/teamBCount*100):0)+'%</div>';
    // Best player
    var allPlayers=players.slice().sort(function(a,b){return (b.score||0)-(a.score||0);});
    if(allPlayers[0])h+='<div style="margin-top:4px">Best Player: '+escapeHtml(allPlayers[0].userName)+' ('+(allPlayers[0].score||0)+' pts)</div>';
    h+='</div>';
    h+='</div>';
  }else{
    h+='<div class="arena-result-scores">';
    h+='<div class="arena-result-score'+(isWin?' winner':'')+'"><div class="arena-result-score-name">You</div><div class="arena-result-score-val">'+(me?me.score||0:0)+'</div><div class="arena-result-score-lbl">Score</div></div>';
    if(opp)h+='<div class="arena-result-score'+(!isWin&&!isDraw?' winner':'')+'"><div class="arena-result-score-name">'+escapeHtml(opp.userName)+'</div><div class="arena-result-score-val">'+(opp.score||0)+'</div><div class="arena-result-score-lbl">Score</div></div>';
    h+='</div>';
  }
  
  // ══ LAYER 3: QUICK STATS ══
  var myCorrect=me?(me.correct||S.battle.correct):S.battle.correct;
  var myWrong=me?(me.wrong||S.battle.wrong):S.battle.wrong;
  var mySkipped=me?(me.skipped||S.battle.skipped):S.battle.skipped;
  var myAcc=total?Math.round((myCorrect/total)*100):0;
  
  h+='<div class="arena-result-section"><div class="arena-result-section-title">📊 Quick Stats</div>';
  if(opp&&m&&m.type==='duel'&&winner.type!=='ffa'){
    h+='<table class="arena-compare-table"><thead><tr><th></th><th>You</th><th>'+escapeHtml(opp.userName)+'</th></tr></thead><tbody>';
    h+='<tr><td>Score</td><td class="me">'+(me?me.score||0:0)+'</td><td>'+(opp.score||0)+'</td></tr>';
    h+='<tr><td>Correct</td><td class="me">'+myCorrect+'</td><td>'+(opp.correct||0)+'</td></tr>';
    h+='<tr><td>Accuracy</td><td class="me">'+myAcc+'%</td><td>'+((opp.correct||0)&&total?Math.round((opp.correct/total)*100):0)+'%</td></tr>';
    var myTime=me?(me.totalTime||totalTime):totalTime;
    var oppTime=opp?(opp.totalTime||0):0;
    h+='<tr><td>Time</td><td class="me">'+fmtTime(myTime)+'</td><td>'+fmtTime(oppTime)+'</td></tr>';
    h+='</tbody></table>';
  }else{
    h+='<div class="arena-result-row"><span>Questions</span><span>'+total+'</span></div>';
    h+='<div class="arena-result-row"><span>Correct</span><span>'+myCorrect+'</span></div>';
    h+='<div class="arena-result-row"><span>Wrong</span><span>'+myWrong+'</span></div>';
    h+='<div class="arena-result-row"><span>Skipped</span><span>'+mySkipped+'</span></div>';
    h+='<div class="arena-result-row highlight"><span>Accuracy</span><span>'+myAcc+'%</span></div>';
    h+='<div class="arena-result-row"><span>Time</span><span>'+fmtTime(totalTime)+'</span></div>';
  }
  // Win reason
  if(isWin||isTeamWin){
    var reasonText=isWin?'Higher accuracy + faster completion':'Stronger team performance';
    if(opp){
      var myScore=me?me.score||0:0,oppScore=opp.score||0;
      h+='<div style="margin-top:10px;padding:10px;background:rgba(76,175,80,0.06);border-radius:8px;font-size:13px;color:#66bb6a">🏆 You won by '+(myScore-oppScore)+' points — '+reasonText+'</div>';
    }
  }else if(!isDraw&&!isTeamWin&&winner.type!=='ffa'){
    if(opp){
      var oppScore=opp.score||0,myScore=me?me.score||0:0;
      h+='<div style="margin-top:10px;padding:10px;background:rgba(244,67,54,0.06);border-radius:8px;font-size:13px;color:#f44336">💪 You lost by '+(oppScore-myScore)+' points. Keep practicing!</div>';
    }
  }
  h+='</div>';
  
  // ══ LAYER 4: SPEED ANALYSIS ══
  if(S.battle.answers.length>0){
    var fastTime=Infinity,slowTime=0,allTimes=[];
    S.battle.answers.forEach(function(a){
      if(a&&a.timeSpent){
        allTimes.push(a.timeSpent);
        if(a.timeSpent<fastTime)fastTime=a.timeSpent;
        if(a.timeSpent>slowTime)slowTime=a.timeSpent;
      }
    });
    if(allTimes.length>0){
      var avgTime=allTimes.reduce(function(s,t){return s+t;},0)/allTimes.length;
      var correctTimes=S.battle.answers.filter(function(a){return a&&a.isCorrect;}).map(function(a){return a.timeSpent;});
      var wrongTimes=S.battle.answers.filter(function(a){return a&&!a.isCorrect;}).map(function(a){return a.timeSpent;});
      var avgCorrect=correctTimes.length?Math.round(correctTimes.reduce(function(s,t){return s+t;},0)/correctTimes.length*10)/10:0;
      var avgWrong=wrongTimes.length?Math.round(wrongTimes.reduce(function(s,t){return s+t;},0)/wrongTimes.length*10)/10:0;
      
      h+='<div class="arena-result-section"><div class="arena-result-section-title">⚡ Speed Analysis</div>';
      h+='<div class="arena-result-row"><span>Fastest Answer</span><span>'+fastTime+'s</span></div>';
      h+='<div class="arena-result-row"><span>Average Time</span><span>'+Math.round(avgTime*10)/10+'s</span></div>';
      h+='<div class="arena-result-row"><span>Slowest Answer</span><span>'+slowTime+'s</span></div>';
      h+='<div class="arena-result-row"><span>Avg Correct Time</span><span>'+avgCorrect+'s</span></div>';
      h+='<div class="arena-result-row"><span>Avg Wrong Time</span><span>'+avgWrong+'s</span></div>';
      // Speed comparison
      if(opp&&opp.totalTime){
        var myTotal=totalTime||0;
        if(myTotal<opp.totalTime){
          var pct=Math.round((1-myTotal/opp.totalTime)*100);
          h+='<div style="margin-top:8px;padding:8px;background:rgba(76,175,80,0.06);border-radius:6px;font-size:12px;color:#66bb6a">⚡ You were '+pct+'% faster than your opponent.</div>';
        }else if(opp.totalTime<myTotal){
          var pct2=Math.round((1-opp.totalTime/myTotal)*100);
          h+='<div style="margin-top:8px;padding:8px;background:rgba(244,67,54,0.06);border-radius:6px;font-size:12px;color:#f44336">⏳ Opponent was '+pct2+'% faster than you.</div>';
        }
      }
      h+='</div>';
    }
  }
  
  // ══ LAYER 5: TOPIC ANALYSIS + STRONG/WEAK AREAS ══
  var topicStats=S.battle.topicStats;
  var topicKeys=Object.keys(topicStats);
  var sortedTopics=[];
  var weakestTopic=null;
  if(topicKeys.length>0){
    sortedTopics=topicKeys.map(function(t){
      var s=topicStats[t];
      var acc=s.total>0?Math.round(s.correct/s.total*100):0;
      return{topic:t,correct:s.correct,total:s.total,acc:acc,time:s.time,avgTime:s.total>0?Math.round(s.time/s.total*10)/10:0};
    }).sort(function(a,b){return b.acc-a.acc;});
    
    var strongest=sortedTopics[0];
    weakestTopic=sortedTopics[sortedTopics.length-1];
    
    // Strong area
    if(strongest&&strongest.total>0&&strongest.acc>=50){
      h+='<div class="arena-result-section"><div class="arena-result-section-title">🟢 Strong Areas</div>';
      h+='<div style="font-size:15px;font-weight:600;color:#66bb6a;margin-bottom:4px">'+escapeHtml(strongest.topic)+'</div>';
      h+='<div class="arena-topic-meta">'+strongest.correct+'/'+strongest.total+' correct · '+strongest.acc+'% accuracy</div>';
      h+='</div>';
    }
    
    // Full topic analysis
    h+='<div class="arena-result-section"><div class="arena-result-section-title">📊 Topic Analysis</div>';
    sortedTopics.forEach(function(t){
      var barClass=t.acc>=75?'high':t.acc>=50?'mid':'low';
      h+='<div class="arena-topic-row">';
      h+='<div class="arena-topic-name"><span>'+escapeHtml(t.topic)+'</span><span>'+t.acc+'%</span></div>';
      h+='<div class="arena-topic-bar"><div class="arena-topic-bar-fill '+barClass+'" style="width:'+t.acc+'%"></div></div>';
      h+='<div class="arena-topic-meta">'+t.correct+' correct · '+(t.total-t.correct)+' wrong · '+t.avgTime+'s avg</div>';
      h+='</div>';
    });
    h+='</div>';
    
    // Weak area detection
    if(weakestTopic&&weakestTopic.total>=2&&weakestTopic.acc<50){
      var avgAcc=sortedTopics.reduce(function(s,t){return s+t.acc;},0)/sortedTopics.length;
      var issueText=weakestTopic.acc<avgAcc?'Accuracy below your Arena average.':'Needs improvement.';
      h+='<div class="arena-weak-area">';
      h+='<div class="arena-weak-area-title">🔴 WEAK AREA</div>';
      h+='<div class="arena-weak-area-topic">'+escapeHtml(weakestTopic.topic)+'</div>';
      h+='<div class="arena-weak-area-stat">'+weakestTopic.correct+' / '+weakestTopic.total+' correct</div>';
      h+='<div class="arena-weak-area-stat">'+weakestTopic.acc+'% accuracy</div>';
      h+='<div class="arena-weak-area-stat" style="margin-top:6px">Issue: '+issueText+'</div>';
      h+='<div class="arena-weak-area-cta"><button class="arena-btn gold" onclick="Arena.practiceWeakTopic(\''+weakestTopic.topic.replace(/'/g,"\\'")+'\')">📚 Practice '+escapeHtml(weakestTopic.topic)+' — 20 Questions</button></div>';
      h+='</div>';
    }
  }
  
  // ══ LAYER 5b: DIFFICULTY ANALYTICS ══
  if(S.battle.questions.length>=5){
    var diffStats={easy:{correct:0,total:0},medium:{correct:0,total:0},hard:{correct:0,total:0}};
    S.battle.questions.forEach(function(q,i){
      var d=(q.difficulty||'').toLowerCase();
      if(d==='easy'||d==='medium'||d==='hard'){
        diffStats[d].total++;
        if(S.battle.answers[i]&&S.battle.answers[i].isCorrect)diffStats[d].correct++;
      }
    });
    var diffHasData=diffStats.easy.total>0||diffStats.medium.total>0||diffStats.hard.total>0;
    if(diffHasData){
      h+='<div class="arena-result-section"><div class="arena-result-section-title">📊 Difficulty Analytics</div>';
      ['easy','medium','hard'].forEach(function(d){
        if(diffStats[d].total>0){
          var acc=Math.round(diffStats[d].correct/diffStats[d].total*100);
          h+='<div class="arena-diff-row">';
          h+='<span class="arena-diff-label">'+d.charAt(0).toUpperCase()+d.slice(1)+'</span>';
          h+='<div class="arena-diff-bar"><div class="arena-diff-bar-fill '+d+'" style="width:'+acc+'%"></div></div>';
          h+='<span class="arena-diff-val">'+acc+'%</span>';
          h+='</div>';
        }
      });
      // Insight
      if(diffStats.hard.total>=2){
        var hardAcc=Math.round(diffStats.hard.correct/diffStats.hard.total*100);
        if(hardAcc<60)h+='<div style="margin-top:8px;padding:8px;background:rgba(244,67,54,0.06);border-radius:6px;font-size:12px;color:#f44336">🎯 Hard-question accuracy needs improvement.</div>';
      }
      h+='</div>';
    }
  }
  
  // ══ LAYER 6: PERFORMANCE SCORE ══
  if(total>0){
    var perfScore=Math.round(
      (myAcc*0.4)+
      (Math.min(100,Math.round(myCorrect*100/Math.max(myCorrect+myWrong,1)))*0.3)+
      (Math.min(100,Math.max(0,100-Math.round(totalTime/total)))*0.2)+
      (mySkipped===0?10:Math.max(0,10-mySkipped*2))*0.1
    );
    var perfGrade=perfScore>=80?'Excellent':perfScore>=60?'Good':perfScore>=40?'Average':'Needs Work';
    h+='<div class="arena-result-section"><div class="arena-result-section-title">⭐ Arena Performance</div>';
    h+='<div class="arena-perf-score"><span class="arena-perf-score-val">'+perfScore+'</span><span class="arena-perf-score-max"> / 100</span></div>';
    h+='<div style="text-align:center;font-size:13px;color:rgba(245,233,224,0.6);margin-bottom:8px">'+perfGrade+'</div>';
    h+='<div class="arena-perf-info" onclick="alert(\'Performance Score = Accuracy (40%) + Correctness (30%) + Speed (20%) + Consistency (10%)\')">How this score is calculated</div>';
    h+='</div>';
  }
  
  // ══ LAYER 7: RATING CHANGE ══
  if(S.user){
    var oldStats=getArenaStats();
    var newRating=oldStats.rating||1000;
    if(isWin||isTeamWin)newRating+=Math.round(15+Math.random()*10);
    else if(!isDraw)newRating-=Math.round(10+Math.random()*8);
    var delta=newRating-(oldStats.rating||1000);
    if(delta!==0){
      h+='<div class="arena-result-section"><div class="arena-result-section-title">🏅 Arena Rating</div>';
      h+='<div class="arena-rating-change">';
      h+='<div class="arena-rating-before">'+(oldStats.rating||1000)+'</div>';
      h+='<div class="arena-rating-arrow">→</div>';
      h+='<div class="arena-rating-after">'+newRating+'</div>';
      h+='<div class="arena-rating-delta '+(delta>0?'pos':'neg')+'">'+(delta>0?'+':'')+delta+'</div>';
      h+='</div>';
      try{
        var updated=Object.assign({},oldStats,{rating:newRating});
        localStorage.setItem('arena_stats',JSON.stringify(updated));
      }catch(e){}
      h+='</div>';
    }
  }
  
  // ══ LAYER 7b: IMPROVEMENT TREND CHART ══
  if(S.user){
    try{
      var trendRes=await api('getHistory',{userId:S.user.id});
      var trendHistory=(trendRes.ok&&trendRes.history)?trendRes.history:[];
      var recentBattles=trendHistory.slice().reverse().slice(-5);
      if(recentBattles.length>=2){
        var accData=recentBattles.map(function(b){
          var ps=b.playerResults||b.players||[];
          var myR=ps.find(function(p){return p.userId===S.user.id;});
          var qCount=b.questionCount||1;
          return myR?Math.round((myR.correct||0)/qCount*100):0;
        });
        var firstAcc=accData[0];
        var lastAcc=accData[accData.length-1];
        var delta=lastAcc-firstAcc;
        
        h+='<div class="arena-result-section"><div class="arena-result-section-title">📈 Improvement Trend</div>';
        h+='<div class="arena-trend-chart">';
        accData.forEach(function(a,i){
          var barH=Math.max(4,a*0.5);
          h+='<div style="flex:1;text-align:center">';
          h+='<div style="height:50px;display:flex;align-items:flex-end;justify-content:center">';
          h+='<div class="arena-trend-bar" style="height:'+barH+'px;width:100%"></div>';
          h+='</div>';
          h+='<div class="arena-trend-label">'+a+'%</div>';
          h+='</div>';
        });
        h+='</div>';
        if(delta!==0){
          var deltaClass=delta>0?'up':'down';
          var deltaSign=delta>0?'+':'';
          h+='<div class="arena-trend-delta '+deltaClass+'">'+(delta>0?'📈':'📉')+' '+deltaSign+delta+' percentage points</div>';
        }
        h+='</div>';
      }
    }catch(e){}
  }
  
  // ══ LAYER 8: IMPROVEMENT PLAN (data-driven recommendation) ══
  if(weakestTopic&&weakestTopic.total>=2){
    h+='<div class="arena-improvement-plan">';
    h+='<div class="arena-improvement-title">🎯 Your Next Step</div>';
    // Generate dynamic recommendation text
    var recText='Your weakest area in this battle was '+weakestTopic.topic+' at '+weakestTopic.acc+'%.';
    // Check if user spent more time on wrong answers in this topic
    var wrongInTopic=S.battle.answers.filter(function(a,i){
      var q=S.battle.questions[i];
      return q&&(q.topic||q.category)===weakestTopic.topic&&a&&!a.isCorrect;
    });
    var correctInTopic=S.battle.answers.filter(function(a,i){
      var q=S.battle.questions[i];
      return q&&(q.topic||q.category)===weakestTopic.topic&&a&&a.isCorrect;
    });
    if(wrongInTopic.length>0&&correctInTopic.length>0){
      var wrongAvg=wrongInTopic.reduce(function(s,a){return s+a.timeSpent;},0)/wrongInTopic.length;
      var correctAvg=correctInTopic.reduce(function(s,a){return s+a.timeSpent;},0)/correctInTopic.length;
      if(wrongAvg>correctAvg){
        recText+=' You also spent more time on incorrect '+weakestTopic.topic+' answers.';
      }
    }
    h+='<div class="arena-improvement-text">'+recText+'</div>';
    h+='<div class="arena-improvement-rec"><span class="arena-improvement-rec-label">Topic:</span><span class="arena-improvement-rec-val">'+escapeHtml(weakestTopic.topic)+'</span></div>';
    h+='<div class="arena-improvement-rec"><span class="arena-improvement-rec-label">Questions:</span><span class="arena-improvement-rec-val">25 MCQs</span></div>';
    h+='<div class="arena-improvement-rec"><span class="arena-improvement-rec-label">Difficulty:</span><span class="arena-improvement-rec-val">Medium</span></div>';
    h+='<button class="arena-btn gold" style="margin-top:10px" onclick="Arena.practiceWeakTopic(\''+weakestTopic.topic.replace(/'/g,"\\'")+'\')">Practice Now</button>';
    h+='</div>';
  }
  
  // ══ LAYER 9: HEAD-TO-HEAD ══
  if(opp&&S.user){
    try{
      var histRes=await api('getHistory',{userId:S.user.id});
      var history=(histRes.ok&&histRes.history)?histRes.history:[];
      var h2hOpps=history.filter(function(b){
        var ps=b.playerResults||b.players||[];
        return ps.some(function(p){return p.userId===opp.userId;});
      });
      if(h2hOpps.length>=2){
        var myH2HWins=0,oppH2HWins=0;
        h2hOpps.forEach(function(b){
          var w=b.winner||{};
          if(w.type==='user'&&w.userId===S.user.id)myH2HWins++;
          else if(w.type==='user'&&w.userId===opp.userId)oppH2HWins++;
        });
        h+='<div class="arena-result-section"><div class="arena-result-section-title">🎯 Head-to-Head</div>';
        h+='<div class="arena-h2h-row"><span class="arena-h2h-name">You</span><span class="arena-h2h-val">'+myH2HWins+' Wins</span></div>';
        h+='<div class="arena-h2h-row"><span class="arena-h2h-name">'+escapeHtml(opp.userName)+'</span><span class="arena-h2h-val">'+oppH2HWins+' Wins</span></div>';
        h+='<div class="arena-h2h-row"><span class="arena-h2h-name">Total matches</span><span class="arena-h2h-val">'+h2hOpps.length+'</span></div>';
        h+='</div>';
      }
    }catch(e){}
  }
  
  // ══ LAYER 10: QUESTION REVIEW (with actions) ══
  h+='<div class="arena-result-section"><div class="arena-result-section-title">📝 Question Review</div>';
  S.battle.questions.slice(0,20).forEach(function(q,i){
    var a=S.battle.answers[i];
    var correctIdx=q.correct_answer==='a'?0:q.correct_answer==='b'?1:q.correct_answer==='c'?2:q.correct_answer==='d'?3:-1;
    var correctLabel=String.fromCharCode(65+correctIdx);
    var qTopic=escapeHtml(q.topic||q.category||'').replace(/'/g,"\\'");
    h+='<div class="arena-qreview">';
    h+='<div class="arena-qreview-q">Q'+(i+1)+'. '+escapeHtml(q.question_text).slice(0,120)+(q.question_text.length>120?'...':'')+'</div>';
    if(a===null||a===undefined){
      h+='<div class="arena-qreview-a">⏭ Skipped · Correct: '+correctLabel+'</div>';
    }else if(a){
      var userLabel=String.fromCharCode(65+a.selectedIdx);
      h+='<div class="arena-qreview-a '+(a.isCorrect?'correct':'wrong')+'">'+(a.isCorrect?'✅':'❌')+' Your answer: '+userLabel+' · Correct: '+correctLabel+' · '+a.timeSpent+'s</div>';
    }
    if(q.explanation){
      h+='<div class="arena-qreview-expl">💡 '+escapeHtml(q.explanation).slice(0,200)+(q.explanation.length>200?'...':'')+'</div>';
    }
    // Question review actions
    h+='<div class="arena-qreview-actions">';
    h+='<button class="arena-qreview-action-btn" onclick="Arena.practiceWeakTopic(\''+qTopic+'\')">📚 Practice This Topic</button>';
    if(a&&!a.isCorrect){
      h+='<button class="arena-qreview-action-btn" onclick="Arena.addToMistakeBook('+i+')">📕 Add to Mistake Book</button>';
    }
    h+='<button class="arena-qreview-action-btn" onclick="Arena.trySimilarQuestion('+i+')">🔄 Try Similar</button>';
    h+='</div>';
    h+='</div>';
  });
  if(S.battle.questions.length>20)h+='<div style="font-size:12px;color:rgba(245,233,224,0.35);text-align:center;padding:8px">Showing first 20 questions. '+S.battle.questions.length+' total.</div>';
  h+='</div>';
  
  // Save session
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
  
  // ══ LAYER 11: ACTION BUTTONS (professional order) ══
  // Rematch
  h+='<button class="arena-btn gold" style="margin-top:12px" onclick="Arena.rematch()">⚔️ Rematch</button>';
  // Practice weak topics
  if(weakestTopic&&weakestTopic.total>=2&&weakestTopic.acc<50){
    h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.practiceWeakTopic(\''+weakestTopic.topic.replace(/'/g,"\\'")+'\')">📚 Practice Weak Topics</button>';
  }
  // Review mistakes
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.reviewMistakes()">📚 Review Mistakes</button>';
  // Practice similar
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.practiceSimilar()">📚 Practice Similar</button>';
  // Back to Arena
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.showHome()">↩ Back to Arena</button>';
  
  showOverlay(h);
}

// Add to Mistake Book — re-saves a specific question to BrainLab mistake book
function addToMistakeBook(qIdx){
  var q=S.battle.questions[qIdx];
  if(!q){toast('Question not found');return;}
  if(window.BrainLab&&BrainLab.saveMistakeLocal){
    var a=S.battle.answers[qIdx];
    var ans=a&&a.selectedIdx!==undefined?String.fromCharCode(97+a.selectedIdx):'';
    BrainLab.saveMistakeLocal(q,ans);
    toast('Added to Mistake Book');
  }else{
    toast('Mistake Book not available');
  }
}

// Try Similar Question — finds and starts a 1-question practice from same topic
function trySimilarQuestion(qIdx){
  var q=S.battle.questions[qIdx];
  if(!q){toast('Question not found');return;}
  if(!window.BrainLab){toast('Practice not available');return;}
  var topic=q.topic||q.category;
  if(!topic){toast('No topic info');return;}
  var pool=BrainLab.filterQuestions({topic:topic});
  if(!pool||!pool.length){pool=BrainLab.filterQuestions({category:topic});}
  if(!pool||!pool.length){toast('No similar questions found for '+topic);return;}
  // Pick a different question than the current one
  var filtered=pool.filter(function(p){return p.id!==q.id;});
  if(filtered.length>0)pool=filtered;
  var selected=BrainLab.selectQuestions(pool,Math.min(10,pool.length));
  var qs=BrainLab.toQuiz(selected);
  Arena.close();
  var sessionId='sess-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  BrainLab._sessionId=sessionId;
  BrainLab._sessionMeta={id:sessionId,mode:'practice',title:'Similar: '+topic,topic:topic,total_questions:qs.length,started_at:new Date().toISOString()};
  BrainLab._startPlayer({title:'Practice: '+topic,questions:qs,mode:'practice'});
}

function practiceWeakTopic(topic){
  Arena.close();
  if(window.BrainLab){
    var pool=BrainLab.filterQuestions({category:undefined,topic:topic,difficulty:undefined});
    if(!pool||!pool.length){pool=BrainLab.filterQuestions({topic:topic});}
    if(!pool||!pool.length){alert('No questions found for '+topic);return;}
    var selected=BrainLab.selectQuestions(pool,Math.min(20,pool.length));
    var qs=BrainLab.toQuiz(selected);
    var sessionId='sess-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
    BrainLab._sessionId=sessionId;
    BrainLab._sessionMeta={id:sessionId,mode:'practice',title:'Weak Topic: '+topic,topic:topic,total_questions:qs.length,started_at:new Date().toISOString()};
    BrainLab._startPlayer({title:'Practice: '+topic,questions:qs,mode:'practice'});
  }
}

function rematch(){
  // Create new match with same config
  if(S.user)api('clearMatch',{userId:S.user.id});
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


async function showHistory(){
  S.user=getUser();if(!S.user){toast('Please log in');return;}
  var res=await api('getHistory',{userId:S.user.id});
  var history=res.ok?res.history:[];
  
  var h='<div class="arena-title">📜 Battle History</div>';
  h+='<div class="arena-sub">'+history.length+' battles</div>';
  
  if(!history.length){
    h+='<div class="arena-empty">No battles yet.<br>Start your first arena battle!</div>';
  }else{
    // Head-to-Head: find most frequent opponent
    var oppCounts={};
    history.forEach(function(b){
      var players=b.playerResults||b.players||[];
      players.forEach(function(p){
        if(p.userId!==S.user.id){
          oppCounts[p.userId]={name:p.userName,count:(oppCounts[p.userId]?oppCounts[p.userId].count:0)+1};
        }
      });
    });
    var topOpps=Object.keys(oppCounts).sort(function(a,b){return oppCounts[b].count-oppCounts[a].count;});
    if(topOpps.length>0&&oppCounts[topOpps[0]].count>=2){
      var topOppId=topOpps[0];
      var topOppName=oppCounts[topOppId].name;
      var myWins=0,oppWins=0;
      history.forEach(function(b){
        var w=b.winner||{};
        var players=b.playerResults||b.players||[];
        var opp=players.find(function(p){return p.userId===topOppId;});
        if(opp){
          if(w.type==='user'&&w.userId===S.user.id)myWins++;
          else if(w.type==='user'&&w.userId===topOppId)oppWins++;
        }
      });
      h+='<div class="arena-result-section"><div class="arena-result-section-title">🤝 Head-to-Head</div>';
      h+='<div class="arena-h2h-row"><span class="arena-h2h-name">You</span><span class="arena-h2h-val">'+myWins+' Wins</span></div>';
      h+='<div class="arena-h2h-row"><span class="arena-h2h-name">'+escapeHtml(topOppName)+'</span><span class="arena-h2h-val">'+oppWins+' Wins</span></div>';
      h+='<div class="arena-h2h-row"><span class="arena-h2h-name">Last '+Math.min(oppCounts[topOppId].count,6)+' matches</span><span class="arena-h2h-val">vs '+escapeHtml(topOppName)+'</span></div>';
      h+='</div>';
    }
    
    history.slice().reverse().forEach(function(b){
      var matchId=b.matchId||b.id;
      var players=b.playerResults||b.players||[];
      var myResult=players.find(function(p){return p.userId===S.user.id;});
      var w=b.winner||{};
      var isWin=w.type==='user'&&w.userId===S.user.id;
      var isDraw=!w.type||w.type==='draw';
      var isTeamWin=w.type==='team'&&myResult&&myResult.team===w.team;
      var resultClass=isWin||isTeamWin?'win':isDraw?'draw':'loss';
      var resultText=isWin||isTeamWin?'WIN':isDraw?'DRAW':'LOSS';
      
      var when=b.createdAt||b.completedAt;
      var date=when?(new Date(when).toLocaleDateString([],{month:'short',day:'numeric'})+' · '+new Date(when).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})):'';
      var oppNames=players.filter(function(p){return p.userId!==S.user.id;}).map(function(p){return p.userName;}).join(', ');
      var myAcc=myResult?(myResult.accuracy!==undefined?myResult.accuracy:(myResult.correct!==undefined&&b.questionCount?Math.round(myResult.correct/b.questionCount*100):null)):null;
      
      h+='<div class="arena-history-item" onclick=\'Arena.showHistoryDetail("'+matchId+'")\'>';
      h+='<div class="arena-history-row">';
      h+='<div class="arena-history-left">';
      h+='<div class="arena-history-mode">'+modeIcon(b.mode)+' '+modeLabel(b.mode)+' · '+b.questionCount+'Q</div>';
      h+='<div class="arena-history-meta">'+date+' · vs '+escapeHtml(oppNames||'Unknown')+(myAcc!==null?' · '+myAcc+'% acc':'')+'</div>';
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

async function showHistoryDetail(matchId){
  // Show full battle detail from stored match data
  var res=await api('getMatch',{matchId:matchId});
  if(!res.ok||!res.match){toast('Battle record not found');return;}
  var mt=res.match;
  var m=MODES.find(function(x){return x.id===mt.mode;});
  var players=mt.players||[];
  var me=players.find(function(p){return p.userId===S.user.id;});
  var opp=players.find(function(p){return p.userId!==S.user.id;});
  var w=mt.winner||{};
  var isWin=w.type==='user'&&w.userId===S.user.id;
  var isDraw=!w.type||w.type==='draw';
  var isTeamWin=w.type==='team'&&me&&me.team===w.team;
  var total=mt.questionCount||0;
  
  var h='<div class="arena-title">📜 Battle Detail</div>';
  h+='<div class="arena-sub">'+(m?m.label:mt.mode)+' · '+total+'Q · '+(mt.exam||'All')+' · '+(mt.category||'All')+'</div>';
  
  // Result badge
  var resultText=isWin||isTeamWin?'WIN':isDraw?'DRAW':'LOSS';
  var resultClass=isWin||isTeamWin?'win':isDraw?'draw':'loss';
  h+='<div style="text-align:center;margin-bottom:14px"><span class="arena-history-result '+resultClass+'" style="font-size:16px;padding:6px 20px">'+resultText+'</span></div>';
  
  // Player results
  h+='<div class="arena-hd-section">';
  h+='<div class="arena-hd-section-title">Players</div>';
  players.forEach(function(p){
    var isMe=p.userId===S.user.id;
    var pAcc=p.correct&&total?Math.round(p.correct/total*100):0;
    h+='<div class="arena-hd-row"><span class="lbl">'+escapeHtml(p.userName)+(isMe?' (You)':'')+'</span><span class="val">'+(p.score||0)+' pts · '+(p.correct||0)+'C · '+pAcc+'%</span></div>';
    if(p.totalTime)h+='<div class="arena-hd-row"><span class="lbl">Time</span><span class="val">'+fmtTime(p.totalTime)+'</span></div>';
  });
  h+='</div>';
  
  // Topic breakdown if available
  if(me&&me.topicBreakdown){
    var tb=me.topicBreakdown;
    var tbKeys=Object.keys(tb);
    if(tbKeys.length>0){
      h+='<div class="arena-hd-section">';
      h+='<div class="arena-hd-section-title">Topic Breakdown</div>';
      tbKeys.forEach(function(t){
        var s=tb[t];
        var acc=s.total>0?Math.round(s.correct/s.total*100):0;
        h+='<div class="arena-hd-row"><span class="lbl">'+escapeHtml(t)+'</span><span class="val">'+s.correct+'/'+s.total+' · '+acc+'%</span></div>';
      });
      h+='</div>';
    }
  }
  
  // Timing
  if(me&&me.timing&&me.timing.length>0){
    h+='<div class="arena-hd-section">';
    h+='<div class="arena-hd-section-title">Timing</div>';
    var times=me.timing.filter(function(t){return t>0;});
    if(times.length>0){
      var fast=Math.min.apply(null,times);
      var slow=Math.max.apply(null,times);
      var avg=Math.round(times.reduce(function(s,t){return s+t;},0)/times.length*10)/10;
      h+='<div class="arena-hd-row"><span class="lbl">Fastest</span><span class="val">'+fast+'s</span></div>';
      h+='<div class="arena-hd-row"><span class="lbl">Average</span><span class="val">'+avg+'s</span></div>';
      h+='<div class="arena-hd-row"><span class="lbl">Slowest</span><span class="val">'+slow+'s</span></div>';
    }
    h+='</div>';
  }
  
  // Match info
  h+='<div class="arena-hd-section">';
  h+='<div class="arena-hd-section-title">Match Info</div>';
  if(mt.createdAt)h+='<div class="arena-hd-row"><span class="lbl">Created</span><span class="val">'+new Date(mt.createdAt).toLocaleString()+'</span></div>';
  if(mt.completedAt)h+='<div class="arena-hd-row"><span class="lbl">Completed</span><span class="val">'+new Date(mt.completedAt).toLocaleString()+'</span></div>';
  h+='<div class="arena-hd-row"><span class="lbl">Difficulty</span><span class="val">'+(mt.difficulty||'mixed')+'</span></div>';
  h+='<div class="arena-hd-row"><span class="lbl">Status</span><span class="val">'+(mt.status||'unknown')+'</span></div>';
  h+='</div>';
  
  // Actions
  if(opp){
    h+='<button class="arena-btn secondary" style="margin-top:12px" onclick="Arena.challengeAgain("'+opp.userId+'")">⚔️ Challenge Again</button>';
  }
  h+='<button class="arena-btn secondary" style="margin-top:8px" onclick="Arena.showHistory()">← Back to History</button>';
  
  showOverlay(h);
}

// Challenge Again — send a new invite to a past opponent
async function challengeAgain(oppUserId){
  if(!S.user){toast('Please log in');return;}
  if(!S.match){toast('No match context');return;}
  // Use the current match config to send a new invite
  var cfg=S.match;
  var res=await api('sendInvite',{
    fromUserId:S.user.id,fromUserName:S.user.name,
    toUserId:oppUserId,toUserName:'',
    matchConfig:{mode:cfg.mode,questionCount:cfg.questionCount,exam:cfg.exam,category:cfg.category,difficulty:cfg.difficulty,matchId:null,team:'B'}
  });
  if(res.ok){
    toast('Challenge sent!');
    Arena.showHome();
    startSearch();
  }else{
    toast('Could not send challenge: '+(res.error||'Unknown error'));
  }
}


async function showLeaderboard(){
  var res=await api('getLeaderboard',{});
  var lb=res.ok?res.leaderboard:[];
  
  var h='<div class="arena-title">🏆 Arena Leaderboard</div>';
  h+='<div class="arena-sub">Top players by Arena Rating</div>';
  
  // Filter chips
  h+='<div class="arena-select-grid" style="margin-bottom:14px">';
  h+='<div class="arena-chip active" onclick="Arena.filterLeaderboard(this,\'all\')">Global</div>';
  h+='<div class="arena-chip" onclick="Arena.filterLeaderboard(this,\'weekly\')">Weekly</div>';
  h+='<div class="arena-chip" onclick="Arena.filterLeaderboard(this,\'monthly\')">Monthly</div>';
  h+='<div class="arena-chip" onclick="Arena.filterLeaderboard(this,\'exam\')">Exam</div>';
  h+='</div>';
  
  if(!lb.length){
    h+='<div class="arena-empty">No rated battles yet.<br>Play some arena matches to appear here!</div>';
  }else{
    h+='<div id="arena-lb-list">';
    lb.forEach(function(p,i){
      var rank=i+1;
      var medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
      var tier=getRankTier(p.arenaRating||1000);
      var isMe=p.userId===S.user.id;
      h+='<div class="arena-lb-row'+(isMe?' me':'')+'">';
      h+='<div class="arena-lb-rank">'+(medal||'#'+rank)+'</div>';
      h+='<div><div class="arena-lb-name">'+escapeHtml(p.userName)+(isMe?' (You)':'')+'</div>';
      h+='<div class="arena-lb-meta">'+(p.exam||'General')+' · '+p.wins+'W-'+p.losses+'L · '+p.winRate+'% WR · '+tier.label+'</div></div>';
      h+='<div class="arena-lb-rating">'+(p.arenaRating||1000)+'</div>';
      h+='</div>';
    });
    h+='</div>';
  }
  
  h+='<button class="arena-btn secondary" style="margin-top:16px" onclick="Arena.showHome()">← Back</button>';
  showOverlay(h);
  S.screen='leaderboard';
}

function filterLeaderboard(chipEl,filter){
  // Update active chip
  document.querySelectorAll('.arena-select-grid .arena-chip').forEach(function(c){c.classList.remove('active');});
  chipEl.classList.add('active');
  // For now, filters are visual only — backend getLeaderboard returns all-time data.
  // When backend supports time-based filtering, this will pass the filter param.
  toast(filter.charAt(0).toUpperCase()+filter.slice(1)+' filter applied');
}



// ════════════════════════════════════════════════
// INVITATION HANDLING
// ════════════════════════════════════════════════
async function inviteCheckPoll(){
  if(!S.user)return;
  if(S.screen==='battle'||S.screen==='waiting')return;
  
  var res=await api('checkInvites',{userId:S.user.id});
  if(res.ok&&res.invites&&res.invites.length>0){
    var inv=res.invites[0];
    // Auto-accept if we're in search mode (auto-matching)
    if(S.screen==='search'&&S.autoMatching){
      S.autoMatching=false;
      var accRes=await api('respondInvite',{inviteId:inv.id,response:'accepted',userName:S.user.name});
      if(accRes.ok&&accRes.matchId){
        // Direct transition to lobby — no waiting for next poll
        S.matchId=accRes.matchId;
        // Self-heal: matches created via respondInvite can leave this player's stored
        // status as 'abandoned' instead of 'lobby', which makes renderLobby() filter them
        // out of their own lobby. setReady(false) corrects the stored status without
        // marking anyone ready (same self-heal the existing autoMatch flow already
        // performs for the inviter's side).
        await api('setReady',{matchId:S.matchId,userId:S.user.id,ready:false});
        var matchRes=await api('getMatch',{matchId:S.matchId});
        if(matchRes.ok&&matchRes.match){
          S.match=matchRes.match;
          S.screen='lobby';
          showLobby();
          return;
        }
      }
      // Fallback: re-enable autoMatching so next searchPoll picks it up
      S.autoMatching=true;
      return;
    }
    // Show modal for manual accept/reject (when not in search mode)
    if(!S.pendingInvite||S.pendingInvite.id!==inv.id){
      S.pendingInvite=inv;
      showInviteModal(inv);
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
  var res=await api('respondInvite',{inviteId:inviteId,response:'accepted',userName:S.user.name});
  if(!res.ok){toast('Could not accept: '+(res.error||'Unknown error'));return;}
  
  var matchId=res.matchId;
  if(!matchId){toast('Match could not be created. Please try again.');return;}
  
  S.matchId=matchId;
  S.cfg={mode:cfg.mode||'1v1',qCount:cfg.questionCount||10,exam:cfg.exam||'All',cat:cfg.category||'All',diff:cfg.difficulty||'mixed'};
  {var sai=getArenaStats();await api('ping',{userId:S.user.id,userName:S.user.name,exam:S.cfg.exam,arenaRating:sai.rating||1000,wins:sai.wins||0,losses:sai.losses||0,draws:sai.draws||0,battles:sai.battles||0,status:'in_arena'});}
  
  // Ensure we're actually in the match's player list (backend adds us on respondInvite, but double-check)
  var matchRes=await api('getMatch',{matchId:matchId});
  if(matchRes.ok&&matchRes.match){
    var existing=matchRes.match.players.find(function(p){return p.userId===S.user.id;});
    if(!existing){
      await api('joinMatch',{matchId:matchId,userId:S.user.id,userName:S.user.name,team:team});
    }
  }
  
  // Self-heal: matches created via respondInvite can leave this player's stored status
  // as 'abandoned' instead of 'lobby', which makes renderLobby() filter them out of their
  // own lobby (players.filter(p=>p.status!=='abandoned')) — the lobby then looks stuck on
  // "Waiting for opponent" forever for both sides. setReady(false) corrects the stored
  // status without marking anyone ready — it's the same self-heal the existing autoMatch
  // flow already performs for the inviter's side (verified: autoMatch persists 'lobby').
  await api('setReady',{matchId:matchId,userId:S.user.id,ready:false});
  
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


// ════════════════════════════════════════════════
// TIMERS / POLLING
// ════════════════════════════════════════════════
function doPing(){
  if(S.user){
    var stats=getArenaStats();
    var status='online';
    var searchConfig=null;
    if(S.screen==='search'){status='searching';searchConfig={mode:S.cfg.mode,questionCount:S.cfg.qCount,exam:S.cfg.exam,category:S.cfg.cat,difficulty:S.cfg.diff};}
    else if(S.screen==='battle'||S.screen==='lobby'||S.screen==='waiting'){status='in_arena';}
    api('ping',{
      userId:S.user.id,userName:S.user.name,exam:S.cfg.exam||'All',
      arenaRating:stats.rating||1000,wins:stats.wins||0,losses:stats.losses||0,
      draws:stats.draws||0,battles:stats.battles||0,
      status:status,searchConfig:searchConfig
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
  stopTimer('waitingPoll');
  // Defensive: wrap setup in try/catch so any future error here (e.g. an
  // undeclared variable, like the WAIT_POLL_MS bug this replaced) degrades
  // to a safe fallback interval instead of silently killing auto-polling
  // and stranding the user on "Waiting for opponent" forever.
  try{
    S.timers.waitingPoll=setInterval(waitingPoll,WAIT_POLL_MS);
  }catch(e){
    console.error('Arena: startWaitingPoll interval setup failed, using fallback interval',e);
    S.timers.waitingPoll=setInterval(waitingPoll,2500);
  }
  waitingPoll();
  if(!S._waitVisHandler){
    S._waitVisHandler=function(){
      if(document.visibilityState==='visible'&&S.screen==='waiting')waitingPoll();
    };
    document.addEventListener('visibilitychange',S._waitVisHandler);
    window.addEventListener('focus',S._waitVisHandler);
  }
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


// ════════════════════════════════════════════════
// CONFIG SETTERS
// ════════════════════════════════════════════════
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


// ════════════════════════════════════════════════
// BRAINLAB HOOK
// ════════════════════════════════════════════════
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
    
    // Call original to keep existing quick practice modes (this sets c.innerHTML = cards)
    origRender.call(this);
    
    // Premium Arena promo banner — entire banner is clickable via <a> wrapper
    var bannerHTML='<a href="javascript:void(0)" class="arena-promo-banner" onclick="window.Arena.showHome()" role="button" aria-label="Enter Studyria Arena — real-time competitive learning: 1v1, Team Battles and Free-for-All quiz battles">'+
      '<div class="arena-promo-img-wrap">'+
        '<picture>'+
          '<source srcset="arena-banner.webp" type="image/webp">'+
          '<img src="arena-banner.jpg" alt="Studyria Arena — Real Students, Real Battles. Battle. Learn. Improve. Win. 1v1, Team Battles and Free-for-All." width="1590" height="989" loading="lazy" decoding="async" class="arena-promo-img">'+
        '</picture>'+
      '</div>'+
      '</a>';
    c.innerHTML=bannerHTML+c.innerHTML;
  };
  
  // Re-render the arena section
  if(BrainLab.initialized){
    BrainLab.renderPracticeArena();
  }
}


// ════════════════════════════════════════════════
// EXPOSE PUBLIC API
// ════════════════════════════════════════════════
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
  practiceWeakTopic:practiceWeakTopic,
  showHistory:showHistory,
  showHistoryDetail:showHistoryDetail,
  challengeAgain:challengeAgain,
  showLeaderboard:showLeaderboard,
  acceptInvite:acceptInvite,
  rejectInvite:rejectInvite,
  addToMistakeBook:addToMistakeBook,
  trySimilarQuestion:trySimilarQuestion,
  filterLeaderboard:filterLeaderboard,
  forfeitWait:forfeitWait,
  retrySubmit:retrySubmit,
  checkNowWait:checkNowWait,
  close:closeOverlay
};

// Initialize when BrainLab is ready
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){setTimeout(init,500);});
}else{
  setTimeout(init,500);
}

// Note: single init path via DOMContentLoaded/readyState above.
// Removed window load listener that caused double-init race condition.

})();
