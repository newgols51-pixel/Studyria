/* ═══════════════════════════════════════════════════════════════════════
   ADRE EXAM ENGINE — adre-exam.js
   Real exam simulation for ADRE previous-year papers
   Supports: variable marks, grace/dropped questions, image-based questions
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  if (!window.ADRE_PAPERS) { console.error('[ADRE] Paper data not loaded'); return; }

  var _state = {
    paper: null,
    questions: [],
    answers: {},
    marked: {},
    currentIdx: 0,
    startTime: 0,
    endTime: 0,
    attemptId: null,
    submitted: false,
    timerInterval: null,
    timeRemaining: 0,
    lastResult: null,
    filterEdition: 'all',
    filterPaperCode: 'all'
  };

  var PAPER_CODE_ORDER = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 };

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtTime(s) {
    var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
    return h+':'+(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
  }
  function fmtDuration(min) {
    if(min%60===0)return (min/60)+' Hours';
    var h=Math.floor(min/60),m=min%60;
    return h+'h '+m+'m';
  }
  function getUserId() {
    if(window.currentUser&&window.currentUser.id)return String(window.currentUser.id);
    if(window.currentUser&&window.currentUser.email)return window.currentUser.email;
    return null;
  }
  function getUserName() {
    if(window.currentUser&&window.currentUser.name)return window.currentUser.name;
    if(window.currentUser&&window.currentUser.email)return window.currentUser.email.split('@')[0];
    return 'Student';
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem('adre_history')||'[]'); } catch(e) { return []; }
  }
  function saveHistory(entry) {
    var hist=getHistory();
    var existingIdx = hist.findIndex(function(h){return h.attemptId===entry.attemptId;});
    if (existingIdx >= 0) { hist[existingIdx] = entry; }
    else { hist.unshift(entry); if(hist.length>100)hist=hist.slice(0,100); }
    try { localStorage.setItem('adre_history',JSON.stringify(hist)); } catch(e) {}
  }

  function getFilteredPapers() {
    return window.ADRE_PAPERS.papers.filter(function(p){
      if(_state.filterEdition!=='all' && p.edition!==_state.filterEdition) return false;
      if(_state.filterPaperCode!=='all' && p.paper_code!==_state.filterPaperCode) return false;
      return true;
    }).sort(function(a,b){
      // Sort by paper code first (I, II, III, IV, V), then by year (newer first)
      var oa=PAPER_CODE_ORDER[a.paper_code]||99, ob=PAPER_CODE_ORDER[b.paper_code]||99;
      if(oa!==ob) return oa-ob;
      return b.year-a.year;
    });
  }

  function renderPaperList(container) {
    if(!container)return;
    var allPapers=window.ADRE_PAPERS.papers;
    var editions=['all'].concat(Array.from(new Set(allPapers.map(function(p){return p.edition;}))));
    var paperCodes=['all','I','II','III','IV','V'].filter(function(c){
      if(c==='all')return true;
      return allPapers.some(function(p){return p.paper_code===c;});
    });

    var h='';
    h+='<div class="adre-filters">';
    h+='<div class="adre-filter-group"><span class="adre-filter-label">Edition</span>';
    editions.forEach(function(ed){
      var active=_state.filterEdition===ed;
      h+='<button class="adre-filter-btn'+(active?' active':'')+'" onclick="ADREExam.setFilter(\'edition\',\''+ed+'\')">'+(ed==='all'?'All':esc(ed))+'</button>';
    });
    h+='</div>';
    h+='<div class="adre-filter-group"><span class="adre-filter-label">Grade</span>';
    paperCodes.forEach(function(pc){
      var active=_state.filterPaperCode===pc;
      h+='<button class="adre-filter-btn'+(active?' active':'')+'" onclick="ADREExam.setFilter(\'paperCode\',\''+pc+'\')">'+(pc==='all'?'All':esc(pc))+'</button>';
    });
    h+='</div>';
    h+='</div>';

    var papers=getFilteredPapers();
    if(!papers.length){
      h+='<div style="text-align:center;padding:40px 20px;color:#888"><div style="font-size:48px;margin-bottom:12px">📋</div><p>No verified papers available for this paper code yet.</p></div>';
      container.innerHTML=h;
      return;
    }

    h+='<div class="adre-papers-grid">';
    papers.forEach(function(p){
      var isPublished=p.published && p.questions && p.questions.length===p.total_questions;
      var verified=p.verification_status==='VERIFIED_OFFICIAL';

      if(isPublished){
        h+='<div class="adre-paper-card" onclick="ADREExam.startPaper(\''+p.id+'\')">';
        h+='<div class="adre-paper-badge">'+(verified?'✓ Official Paper':'Under Review')+'</div>';
      } else {
        h+='<div class="adre-paper-card adre-paper-locked">';
        h+='<div class="adre-paper-badge" style="background:rgba(251,191,36,0.08);color:#f59e0b;border-color:rgba(251,191,36,0.15)">🔒 Coming Soon</div>';
      }
      h+='<div class="adre-paper-title">🏛️ '+esc(p.title)+'</div>';
      h+='<div class="adre-paper-subtitle">'+esc(p.subtitle)+'</div>';
      h+='<div class="adre-paper-meta">';
      h+='<span>📝 '+p.total_questions+' Questions</span>';
      h+='<span>📊 '+p.total_marks+' Marks</span>';
      h+='<span>⏱️ '+fmtDuration(p.duration_minutes)+'</span>';
      h+='</div>';
      if(p.negative_marking>0){
        var negText='⚠️ Negative Marking: -'+p.negative_marking+' per wrong answer';
        if(p.negative_per_wrong_2mark){
          negText='⚠️ Negative: -'+p.negative_marking+' (1-mark Qs) / -'+p.negative_per_wrong_2mark+' (2-mark Qs)';
        }
        h+='<div class="adre-paper-negative">'+negText+'</div>';
      }
      if(isPublished){
        h+='<div class="adre-paper-verify">✓ Official Answer Key Verified</div>';
        h+='<button class="adre-paper-btn">Start Real Paper →</button>';
      } else {
        h+='<div class="adre-paper-verify" style="color:#999">📋 Paper structure verified — questions being imported from official PDF</div>';
        h+='<button class="adre-paper-btn" disabled style="opacity:0.4;cursor:not-allowed">Questions Coming Soon</button>';
      }
      h+='</div>';
    });
    h+='</div>';

    var hist=getHistory();
    if(hist.length){
      h+='<div class="adre-history-section"><h3 class="adre-section-title">📊 Your ADRE Attempts</h3>';
      h+='<div class="adre-history-list">';
      hist.slice(0,10).forEach(function(a){
        var pctClass=a.percentage>=60?'good':a.percentage>=40?'avg':'low';
        h+='<div class="adre-history-item" onclick="ADREExam.viewResult(\''+a.attemptId+'\')">';
        h+='<div class="adre-history-left"><div class="adre-history-title">'+esc(a.paperTitle)+'</div>';
        h+='<div class="adre-history-date">'+new Date(a.completedAt).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})+' · '+fmtTime(a.timeUsed)+'</div></div>';
        h+='<div class="adre-history-right"><div class="adre-history-score">'+a.finalScore+'/'+a.maxMarks+'</div>';
        h+='<div class="adre-history-pct '+pctClass+'">'+a.percentage+'%</div></div></div>';
      });
      h+='</div></div>';
    }
    container.innerHTML=h;
  }

  function setFilter(type,value) {
    if(type==='edition')_state.filterEdition=value;
    if(type==='paperCode')_state.filterPaperCode=value;
    var page=document.getElementById('page-adre-papers');
    if(page)renderPaperList(page.querySelector('.adre-content')||page);
  }

  function startPaper(paperId) {
    var p=window.ADRE_PAPERS.papers.find(function(x){return x.id===paperId;});
    if(!p||!p.published||!p.questions||!p.questions.length){alert('This paper is not available yet.');return;}
    var uid=getUserId();
    if(!uid){if(typeof navigate==='function')navigate('login');return;}
    _state.paper=p;
    _state.questions=p.questions.slice();
    _state.answers={};
    _state.marked={};
    _state.currentIdx=0;
    _state.startTime=Date.now();
    _state.endTime=_state.startTime+p.duration_minutes*60*1000;
    _state.attemptId='adre-'+paperId+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    _state.submitted=false;
    _state.timeRemaining=p.duration_minutes*60;
    try{
      var saved=JSON.parse(sessionStorage.getItem('adre_active_attempt')||'null');
      if(saved&&saved.attemptId&&saved.paperId===paperId){
        _state.answers=saved.answers||{};
        _state.marked=saved.marked||{};
        _state.currentIdx=saved.currentIdx||0;
        _state.startTime=saved.startTime||_state.startTime;
        _state.endTime=saved.endTime||_state.endTime;
        _state.attemptId=saved.attemptId;
        _state.timeRemaining=Math.max(0,Math.floor((_state.endTime-Date.now())/1000));
      }
    }catch(e){}
    saveAttempt();
    renderExam();
  }

  function saveAttempt() {
    try{
      sessionStorage.setItem('adre_active_attempt',JSON.stringify({
        attemptId:_state.attemptId,paperId:_state.paper.id,
        answers:_state.answers,marked:_state.marked,currentIdx:_state.currentIdx,
        startTime:_state.startTime,endTime:_state.endTime
      }));
    }catch(e){}
  }

  function renderExam() {
    var p=_state.paper,qs=_state.questions,idx=_state.currentIdx,q=qs[idx];
    if(!q)return;
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var answeredCount=Object.keys(_state.answers).length;
    var markedCount=Object.keys(_state.marked).length;
    var unanswered=qs.length-answeredCount;
    var h='<div class="adre-exam-container">';
    h+='<div class="adre-exam-header">';
    h+='<div class="adre-exam-title">🏛️ '+esc(p.title)+'</div>';
    h+='<div class="adre-exam-info">'+esc(p.subtitle)+' · '+p.total_questions+'Q · '+p.total_marks+' Marks</div>';
    h+='<div class="adre-exam-timer" id="adre-timer">⏱ '+fmtTime(_state.timeRemaining)+'</div>';
    h+='</div>';
    h+='<div class="adre-exam-statusbar">';
    h+='<span class="adre-stat-pill answered">✓ '+answeredCount+' Answered</span>';
    h+='<span class="adre-stat-pill unanswered">○ '+unanswered+' Unanswered</span>';
    h+='<span class="adre-stat-pill marked">🚩 '+markedCount+' Marked</span>';
    h+='</div>';
    h+='<div class="adre-exam-body">';
    h+='<div class="adre-palette" id="adre-palette">';
    h+='<div class="adre-palette-title">Question Palette</div>';
    h+='<div class="adre-palette-grid">';
    qs.forEach(function(qq,i){
      var cls='adre-pq';
      if(_state.answers[qq.q_num]!==undefined)cls+=' answered';
      if(_state.marked[qq.q_num])cls+=' marked';
      if(i===idx)cls+=' current';
      h+='<div class="'+cls+'" onclick="ADREExam.gotoQ('+i+')">'+qq.q_num+'</div>';
    });
    h+='</div>';
    h+='<button class="adre-submit-btn" onclick="ADREExam.confirmSubmit()">Submit Exam</button>';
    h+='</div>';
    h+='<div class="adre-question-area">';
    h+='<div class="adre-q-header"><span class="adre-q-num">Question '+q.q_num+' / '+qs.length+'</span>';
    var marksLabel=q.marks+' mark'+(q.marks>1?'s':'');
    if(q.grace){marksLabel='Grace (dropped)';}
    else{marksLabel+=' · -'+q.negative_marks+' wrong';}
    h+='<span class="adre-q-marks">'+marksLabel+'</span></div>';
    h+='<div class="adre-q-text">'+esc(q.question)+'</div>';
    if(q.image_based){
      h+='<div class="adre-q-note" style="font-size:13px;color:#92400e;background:#fef3c7;padding:8px 12px">📷 Original question contains visual figures. Options shown as placeholders.</div>';
    }
    if(q.grace){
      h+='<div class="adre-q-note" style="font-size:13px;color:#1e40af;background:#dbeafe;padding:8px 12px">ℹ️ This question was dropped by SLRC. All candidates receive full marks regardless of answer.</div>';
    }
    if(q.note && !q.image_based && !q.grace){
      h+='<div class="adre-q-note" style="font-size:13px;color:#666;background:#f5f0e8;padding:8px 12px">ℹ️ '+esc(q.note)+'</div>';
    }
    h+='<div class="adre-q-options">';
    var opts=[{key:'a',text:q.option_a},{key:'b',text:q.option_b},{key:'c',text:q.option_c},{key:'d',text:q.option_d}];
    opts.forEach(function(o){
      if(!o.text)return;
      var selected=_state.answers[q.q_num]===o.key;
      h+='<div class="adre-q-option'+(selected?' selected':'')+'" onclick="ADREExam.selectAnswer('+q.q_num+',\''+o.key+'\')">';
      h+='<span class="adre-opt-letter">'+o.key.toUpperCase()+'</span><span class="adre-opt-text">'+esc(o.text)+'</span></div>';
    });
    h+='</div>';
    h+='<div class="adre-q-actions">';
    h+='<button class="adre-btn-clear" onclick="ADREExam.clearAnswer('+q.q_num+')">Clear Answer</button>';
    h+='<button class="adre-btn-mark" onclick="ADREExam.toggleMark('+q.q_num+')">'+(_state.marked[q.q_num]?'🚩 Unmark':'🚩 Mark for Review')+'</button>';
    h+='</div>';
    h+='<div class="adre-nav">';
    if(idx>0)h+='<button class="adre-nav-btn prev" onclick="ADREExam.gotoQ('+(idx-1)+')">← Previous</button>';
    if(idx<qs.length-1)h+='<button class="adre-nav-btn next" onclick="ADREExam.gotoQ('+(idx+1)+')">Next →</button>';
    else h+='<button class="adre-nav-btn submit" onclick="ADREExam.confirmSubmit()">Submit Exam</button>';
    h+='</div></div></div></div>';
    page.innerHTML=h;
    page.classList.add('active');
    window.scrollTo(0,0);
    startTimer();
  }

  function startTimer() {
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    _state.timerInterval=setInterval(function(){
      if(_state.submitted){clearInterval(_state.timerInterval);return;}
      _state.timeRemaining=Math.max(0,Math.floor((_state.endTime-Date.now())/1000));
      var el=document.getElementById('adre-timer');
      if(el){
        el.textContent='⏱ '+fmtTime(_state.timeRemaining);
        if(_state.timeRemaining<=300)el.classList.add('warning');
        if(_state.timeRemaining<=60)el.classList.add('critical');
      }
      if(_state.timeRemaining<=0){clearInterval(_state.timerInterval);submitExam(true);}
    },1000);
  }

  function selectAnswer(qNum,answer) {
    if(_state.submitted)return;
    _state.answers[qNum]=answer;
    saveAttempt();
    renderExam();
  }

  function clearAnswer(qNum) {
    if(_state.submitted)return;
    delete _state.answers[qNum];
    saveAttempt();
    renderExam();
  }

  function toggleMark(qNum) {
    if(_state.marked[qNum])delete _state.marked[qNum];
    else _state.marked[qNum]=true;
    saveAttempt();
    updatePalette();updateStatusBar();
  }

  function gotoQ(idx) {
    _state.currentIdx=idx;
    saveAttempt();
    renderExam();
  }

  function updatePalette() {
    _state.questions.forEach(function(qq,i){
      var el=document.querySelector('.adre-pq:nth-child('+(i+1)+')');
      if(!el)return;
      el.classList.toggle('answered',_state.answers[qq.q_num]!==undefined);
      el.classList.toggle('marked',!!_state.marked[qq.q_num]);
      el.classList.toggle('current',i===_state.currentIdx);
    });
  }

  function updateStatusBar() {
    var answered=Object.keys(_state.answers).length;
    var marked=Object.keys(_state.marked).length;
    var unanswered=_state.questions.length-answered;
    var bar=document.querySelector('.adre-exam-statusbar');
    if(bar)bar.innerHTML='<span class="adre-stat-pill answered">✓ '+answered+' Answered</span><span class="adre-stat-pill unanswered">○ '+unanswered+' Unanswered</span><span class="adre-stat-pill marked">🚩 '+marked+' Marked</span>';
  }

  function confirmSubmit() {
    var answered=Object.keys(_state.answers).length;
    var total=_state.questions.length;
    var unanswered=total-answered;
    var msg='Submit your exam?\n\nAnswered: '+answered+'/'+total+'\nUnanswered: '+unanswered;
    if(unanswered>0)msg+='\n\n⚠️ You have '+unanswered+' unanswered questions.';
    if(!confirm(msg))return;
    submitExam(false);
  }

  function submitExam(autoSubmit) {
    if(_state.submitted)return;
    _state.submitted=true;
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    var p=_state.paper,qs=_state.questions;
    var correct=0,wrong=0,unanswered=0,graceCount=0,rawScore=0,negMarks=0,graceMarks=0;
    qs.forEach(function(q){
      var ans=_state.answers[q.q_num];
      if(q.grace || q.correct_answer==='grace'){
        graceCount++;
        graceMarks+=q.marks;
        rawScore+=q.marks;
        if(ans){correct++;}
        return;
      }
      if(!ans){unanswered++;return;}
      if(ans===q.correct_answer){correct++;rawScore+=q.marks;}
      else{wrong++;negMarks+=(q.negative_marks||0);}
    });
    var finalScore=Math.max(0,rawScore-negMarks);
    var maxMarks=p.total_marks;
    var percentage=Math.round((finalScore/maxMarks)*10000)/100;
    var attempted=correct+wrong;
    var accuracy=attempted>0?Math.round((correct/attempted)*100):0;
    var timeUsed=Math.floor((Date.now()-_state.startTime)/1000);
    var timeRemaining=Math.max(0,_state.timeRemaining);
    var result={
      attemptId:_state.attemptId,paperId:p.id,paperTitle:p.title,
      paperCode:p.paper_code,edition:p.edition,year:p.year,level:p.level,
      totalQuestions:qs.length,totalMarks:maxMarks,correct:correct,wrong:wrong,
      unanswered:unanswered,graceCount:graceCount,graceMarks:graceMarks,
      rawScore:rawScore,negativeMarks:negMarks,
      finalScore:finalScore,maxMarks:maxMarks,percentage:percentage,
      accuracy:accuracy,timeUsed:timeUsed,timeRemaining:timeRemaining,
      autoSubmitted:autoSubmit||false,completedAt:new Date().toISOString(),
      userId:getUserId(),userName:getUserName(),answers:_state.answers,
      questions:qs.map(function(q){
        return{q_num:q.q_num,question:q.question,option_a:q.option_a,option_b:q.option_b,
          option_c:q.option_c,option_d:q.option_d,correct_answer:q.correct_answer,
          user_answer:_state.answers[q.q_num]||null,marks:q.marks,
          negative_marks:q.negative_marks,grace:q.grace||false,image_based:q.image_based||false,
          note:q.note||null,verification_status:q.verification_status};
      })
    };
    saveHistory(result);
    try{sessionStorage.removeItem('adre_active_attempt');}catch(e){}
    renderResult(result);
  }

  function renderResult(r) {
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var isPass=r.percentage>=40;
    var h='<div class="adre-result-container">';
    h+='<div class="adre-result-hero"><div class="adre-result-icon">'+(isPass?'🎉':'💪')+'</div>';
    h+='<div class="adre-result-title">Mock Completed</div>';
    h+='<div class="adre-result-sub">'+esc(r.paperTitle)+'</div>';
    h+='<div class="adre-result-disclaimer">Performance only — not an official recruitment result</div></div>';
    h+='<div class="adre-result-score-box"><div class="adre-result-score-main">'+r.finalScore+' <span class="adre-result-score-max">/ '+r.maxMarks+'</span></div>';
    h+='<div class="adre-result-score-pct">'+r.percentage+'%</div></div>';
    h+='<div class="adre-result-stats">';
    h+='<div class="adre-stat-card correct"><div class="adre-stat-val">'+r.correct+'</div><div class="adre-stat-label">Correct</div></div>';
    h+='<div class="adre-stat-card wrong"><div class="adre-stat-val">'+r.wrong+'</div><div class="adre-stat-label">Wrong</div></div>';
    h+='<div class="adre-stat-card skip"><div class="adre-stat-val">'+r.unanswered+'</div><div class="adre-stat-label">Unanswered</div></div>';
    h+='<div class="adre-stat-card accuracy"><div class="adre-stat-val">'+r.accuracy+'%</div><div class="adre-stat-label">Accuracy</div></div>';
    h+='</div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">📊 Score Breakdown</div>';
    h+='<div class="adre-result-row"><span>Raw Score (correct answers)</span><span>+'+r.rawScore+'</span></div>';
    h+='<div class="adre-result-row"><span>Negative Marks (wrong answers)</span><span class="neg">-'+r.negativeMarks+'</span></div>';
    if(r.graceCount>0){
      h+='<div class="adre-result-row"><span>Grace Marks ('+r.graceCount+' dropped Qs)</span><span>+'+r.graceMarks+'</span></div>';
    }
    h+='<div class="adre-result-row highlight"><span>Final Score</span><span>'+r.finalScore+' / '+r.maxMarks+'</span></div></div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">⏱️ Time Management</div>';
    h+='<div class="adre-result-row"><span>Time Used</span><span>'+fmtTime(r.timeUsed)+'</span></div>';
    h+='<div class="adre-result-row"><span>Time Remaining</span><span>'+fmtTime(r.timeRemaining)+'</span></div>';
    if(r.autoSubmitted)h+='<div class="adre-result-row" style="color:#e57373"><span>⚠️ Auto-submitted (time expired)</span><span></span></div>';
    h+='</div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">📝 Question Review</div>';
    r.questions.forEach(function(q){
      var userAns=q.user_answer;
      var isGrace=q.grace||q.correct_answer==='grace';
      var isCorrect=!isGrace&&userAns===q.correct_answer;
      var isWrong=!isGrace&&userAns&&!isCorrect;
      var statusLabel=isGrace?'⭐ Grace (Dropped)':isCorrect?'✓ Correct':isWrong?'✗ Wrong':'○ Skipped';
      var marksLabel=isGrace?'+'+q.marks:isCorrect?'+'+q.marks:isWrong?'-'+q.negative_marks:'0';
      h+='<div class="adre-review-q'+(isGrace?' grace':isCorrect?' correct':isWrong?' wrong':' skip')+'">';
      h+='<div class="adre-review-q-header"><span class="adre-review-q-num">Q'+q.q_num+'</span>';
      h+='<span class="adre-review-q-status">'+statusLabel+'</span>';
      h+='<span class="adre-review-q-marks">'+marksLabel+'</span></div>';
      h+='<div class="adre-review-q-text">'+esc(q.question)+'</div>';
      if(q.note){h+='<div style="font-size:12px;color:#92400e;margin-bottom:8px">'+esc(q.note)+'</div>';}
      h+='<div class="adre-review-options">';
      ['a','b','c','d'].forEach(function(key){
        var text=q['option_'+key];if(!text)return;
        var cls='adre-review-opt';
        if(!isGrace&&key===q.correct_answer)cls+=' official-correct';
        if(key===userAns&&!isCorrect&&!isGrace)cls+=' user-wrong';
        if(key===userAns&&isCorrect)cls+=' user-correct';
        h+='<div class="'+cls+'"><span>'+key.toUpperCase()+'</span> '+esc(text)+'</div>';
      });
      h+='</div><div class="adre-review-verify">'+(q.verification_status==='VERIFIED_OFFICIAL'?'✓ Official Answer Key':'⚠️ '+esc(q.verification_status))+'</div></div>';
    });
    h+='</div>';
    h+='<div class="adre-result-actions">';
    h+='<button class="adre-btn-primary" onclick="ADREExam.retry()">🔄 Retry Exam</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showCert(\''+r.attemptId+'\')">📜 View Certificate</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showHome()">← Back to Papers</button>';
    h+='</div></div>';
    page.innerHTML=h;
    window.scrollTo(0,0);
    _state.lastResult=r;
  }

  function showCert(attemptId) {
    var hist=getHistory();
    var r=hist.find(function(a){return a.attemptId===attemptId;})||_state.lastResult;
    if(!r)return;
    var certId='STY-'+r.year+'-P'+r.paperCode+'-'+attemptId.slice(-8).toUpperCase();
    var date=new Date(r.completedAt).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'});
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var h='<div class="adre-cert-page"><div class="adre-cert"><div class="adre-cert-border">';
    h+='<div class="adre-cert-logo">🎓 Studyria</div>';
    h+='<div class="adre-cert-title">Studyria Previous-Year Mock Completion Certificate</div>';
    h+='<div class="adre-cert-subtitle">Practice certificate — not an official recruitment certificate</div>';
    h+='<div class="adre-cert-body"><div class="adre-cert-name">'+esc(r.userName)+'</div>';
    h+='<div class="adre-cert-text">has successfully completed the</div>';
    h+='<div class="adre-cert-exam">'+esc(r.paperTitle)+'</div>';
    h+='<div class="adre-cert-paper">'+esc(r.level)+' · '+r.totalQuestions+' Questions · '+r.totalMarks+' Marks</div>';
    h+='<div class="adre-cert-score-label">Score</div>';
    h+='<div class="adre-cert-score">'+r.finalScore+' / '+r.maxMarks+' ('+r.percentage+'%)</div>';
    h+='<div class="adre-cert-accuracy">Accuracy: '+r.accuracy+'%</div>';
    h+='<div class="adre-cert-date">'+date+'</div>';
    h+='<div class="adre-cert-id">Certificate ID: '+certId+'</div></div>';
    h+='<div class="adre-cert-footer">Studyria Practice Certificate · Verify at studyria.qzz.io</div>';
    h+='</div></div>';
    h+='<div class="adre-cert-actions"><button class="adre-btn-primary" onclick="window.print()">🖨️ Print / Save PDF</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showHome()">← Back</button></div></div>';
    page.innerHTML=h;
    window.scrollTo(0,0);
  }

  function viewResult(attemptId) {
    var hist=getHistory();
    var r=hist.find(function(a){return a.attemptId===attemptId;});
    if(r)renderResult(r);
  }

  function retry() { if(_state.paper)startPaper(_state.paper.id); }
  function showHome() {
    var page=document.getElementById('page-adre-papers');
    if(!page)return;
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    _state.submitted=false;
    renderPaperList(page.querySelector('.adre-content')||page);
  }

  window.ADREExam={
    renderPaperList:renderPaperList,startPaper:startPaper,selectAnswer:selectAnswer,
    clearAnswer:clearAnswer,toggleMark:toggleMark,gotoQ:gotoQ,confirmSubmit:confirmSubmit,
    retry:retry,showHome:showHome,showCert:showCert,viewResult:viewResult,setFilter:setFilter
  };
  console.log('[ADRE] Exam engine loaded — '+window.ADRE_PAPERS.papers.length+' paper(s) available');
})();
